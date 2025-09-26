#!/usr/bin/env python3
"""
Unified OpenCode Agent Dashboard WebSocket Server
Provides real-time monitoring with enhanced Claude process detection
"""

import asyncio
import json
import os
import time
import psutil
import subprocess
import threading
import signal
import re
import sys
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Set, Optional, Any
from collections import OrderedDict
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# Try to import websockets, fallback gracefully if not available
try:
    import websockets

    WEBSOCKETS_AVAILABLE = True
except ImportError:
    WEBSOCKETS_AVAILABLE = False
    print("Warning: websockets not available. Install with: pip install websockets")
    print("Falling back to monitoring-only mode.")

try:
    from logger import StructuredLogger

    logger = StructuredLogger(__name__)
except ImportError:
    import logging

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )
    logger = logging.getLogger(__name__)

try:
    from task_manager import TaskManager, TaskStatus

    TASK_MANAGER_AVAILABLE = True
except ImportError:
    TASK_MANAGER_AVAILABLE = False
    logger.warning("TaskManager not available, using basic task tracking")

try:
    from optimized_database import OptimizedDatabase

    OPTIMIZED_DB_AVAILABLE = True
except ImportError:
    OPTIMIZED_DB_AVAILABLE = False
    logger.warning("OptimizedDatabase not available, using basic file operations")

try:
    from intelligent_cache import (
        get_cache,
        cache_file_operation,
        cache_process_operation,
        cache_system_operation,
        cache_task_operation,
        cache_log_operation,
        invalidate_file_cache,
        invalidate_process_cache,
        invalidate_system_cache,
        invalidate_task_cache,
        invalidate_log_cache,
    )

    CACHE_AVAILABLE = True
except ImportError:
    CACHE_AVAILABLE = False
    logger.warning("Intelligent cache not available, using basic caching")


class LogFileHandler(FileSystemEventHandler):
    """Handles log file changes and broadcasts updates"""

    def __init__(self, server):
        self.server = server
        self.last_positions = {}

    def on_modified(self, event):
        if event.is_directory or not str(event.src_path).endswith(".log"):
            return

        self.process_log_file(event.src_path)

    def process_log_file(self, file_path):
        """Process new lines in log file and broadcast"""
        try:
            with open(file_path, "r") as f:
                # Get current position or start from end for new files
                current_pos = self.last_positions.get(file_path, 0)
                f.seek(current_pos)

                new_lines = f.readlines()
                if new_lines:
                    # Update position
                    self.last_positions[file_path] = f.tell()

                    # Process and broadcast new log entries
                    for line in new_lines:
                        line = line.strip()
                        if line:
                            self.server.broadcast_log_entry(file_path, line)

        except Exception as e:
            logger.error(f"Error processing log file {file_path}: {e}")


class DashboardServer:
    """WebSocket server for the OpenCode agent dashboard"""

    def __init__(self, project_dir: str = None, port: int = 8080):
        self.project_dir = Path(project_dir) if project_dir else Path.cwd()
        self.claude_dir = self.project_dir / ".claude"
        self.logs_dir = self.claude_dir / "logs"
        self.tasks_file = self.claude_dir / "tasks.json"
        self.port = port

        # WebSocket connections
        self.clients: Set[websockets.WebSocketServerProtocol] = set()

        # Data storage
        self.agents = {}
        self.tasks = {}
        self.logs = []
        self.system_resources = {}
        self.claude_processes = {}  # Track Claude/OpenCode processes specifically

        # File monitoring
        self.observer = Observer()
        self.log_handler = LogFileHandler(self)

        # Optimized database integration
        self.optimized_db = None
        if OPTIMIZED_DB_AVAILABLE:
            try:
                self.optimized_db = OptimizedDatabase(self.claude_dir)
                logger.info("Optimized database initialized successfully")
            except Exception as e:
                logger.warning(f"Could not initialize optimized database: {e}")
                self.optimized_db = None

        # Task manager integration
        self.task_manager = None
        if TASK_MANAGER_AVAILABLE:
            try:
                self.task_manager = TaskManager(str(self.project_dir))
                self.task_manager.add_status_callback(self._on_task_status_change)
                self.task_manager.add_progress_callback(self._on_task_progress_update)
            except Exception as e:
                logger.warning(f"Could not initialize task manager: {e}")

        # Process monitoring with enhanced LRU caching
        self.last_process_scan = datetime.now()
        self.process_scan_interval = timedelta(
            seconds=30
        )  # Reduced from 10 to 30 seconds

        # Enhanced LRU cache for process information
        self.process_cache = (
            OrderedDict()
        )  # LRU cache: key -> (data, timestamp, access_count)
        self.cache_max_size = 200  # Maximum cache entries
        self.cache_ttl = timedelta(seconds=120)  # Cache validity period
        self.process_change_detection = {}  # Track process changes for invalidation

    def _get_cached_process_data(self, cache_key: str) -> Optional[Dict]:
        """Get data from LRU cache with access tracking"""
        now = datetime.now()

        if cache_key in self.process_cache:
            data, timestamp, access_count = self.process_cache[cache_key]

            # Check if cache entry is still valid
            if (now - timestamp) < self.cache_ttl:
                # Move to end (most recently used) and increment access count
                self.process_cache.move_to_end(cache_key)
                self.process_cache[cache_key] = (data, timestamp, access_count + 1)
                return data
            else:
                # Remove expired entry
                del self.process_cache[cache_key]

        return None

    def _set_cached_process_data(self, cache_key: str, data: Dict):
        """Store data in LRU cache with eviction"""
        now = datetime.now()

        # Remove expired entries first
        expired_keys = [
            key
            for key, (_, timestamp, _) in self.process_cache.items()
            if (now - timestamp) >= self.cache_ttl
        ]
        for key in expired_keys:
            del self.process_cache[key]

        # Evict least recently used if cache is full
        if len(self.process_cache) >= self.cache_max_size:
            self.process_cache.popitem(last=False)  # Remove oldest

        # Add new entry
        self.process_cache[cache_key] = (data, now, 1)
        self.process_cache.move_to_end(cache_key)  # Mark as most recently used

    def _invalidate_process_cache(self, reason: str = "unknown"):
        """Invalidate process cache with logging"""
        cache_size = len(self.process_cache)
        self.process_cache.clear()
        self.process_change_detection.clear()
        logger.debug(
            f"Process cache invalidated ({cache_size} entries cleared): {reason}"
        )

    def _detect_process_changes(self, current_processes: Dict[str, Dict]) -> bool:
        """Detect if processes have changed since last scan"""
        current_pids = set()
        current_tasks = set()

        for proc_key, proc_info in current_processes.items():
            current_pids.add(proc_info["pid"])
            if proc_info.get("task_id"):
                current_tasks.add(proc_info["task_id"])

        # Compare with previous scan
        prev_pids = self.process_change_detection.get("pids", set())
        prev_tasks = self.process_change_detection.get("tasks", set())

        # Update detection state
        self.process_change_detection["pids"] = current_pids
        self.process_change_detection["tasks"] = current_tasks

        # Check for changes
        pid_changes = current_pids != prev_pids
        task_changes = current_tasks != prev_tasks

        if pid_changes or task_changes:
            logger.debug(
                f"Process changes detected: PIDs {len(current_pids)}->{len(prev_pids)}, Tasks {len(current_tasks)}->{len(prev_tasks)}"
            )
            return True

        return False

        # Performance optimization caches
        self._progress_cache = {}  # Cache for progress estimation
        self._log_cache = {}  # Cache for log-based agent status
        self._log_content_cache = {}  # Cache for log content
        self._log_cache_ttl = 30  # 30 seconds TTL for log cache

        # Log file caching for lazy loading
        self._log_content_cache: Dict[str, Dict] = {}  # Cache for log file content
        self._log_cache_ttl = 60  # Log cache TTL in seconds

    async def register(self, websocket):
        """Register a new WebSocket client"""
        self.clients.add(websocket)
        logger.info(f"Client connected. Total clients: {len(self.clients)}")

        # Send current status to new client
        await self.send_full_status(websocket)

    async def unregister(self, websocket):
        """Unregister a WebSocket client"""
        self.clients.discard(websocket)
        logger.info(f"Client disconnected. Total clients: {len(self.clients)}")

    async def send_to_client(self, websocket, data):
        """Send data to a specific client"""
        try:
            await websocket.send(json.dumps(data))
        except websockets.exceptions.ConnectionClosed:
            await self.unregister(websocket)
        except Exception as e:
            logger.error(f"Error sending to client: {e}")

    async def broadcast(self, data):
        """Broadcast data to all connected clients"""
        if not self.clients:
            return

        message = json.dumps(data)
        disconnected = set()

        for client in self.clients.copy():
            try:
                await client.send(message)
            except websockets.exceptions.ConnectionClosed:
                disconnected.add(client)
            except Exception as e:
                logger.error(f"Error broadcasting to client: {e}")
                disconnected.add(client)

        # Remove disconnected clients
        for client in disconnected:
            self.clients.discard(client)

    async def send_full_status(self, websocket):
        """Send complete current status to a client"""
        status_data = {
            "type": "full_status",
            "agents": list(self.agents.values()),
            "tasks": list(self.tasks.values()),
            "logs": self.logs[-100:],  # Last 100 logs
            "resources": self.system_resources,
            "claude_processes": list(self.claude_processes.values()),
        }
        await self.send_to_client(websocket, status_data)

    def _on_task_status_change(self, task, old_status, new_status):
        """Handle task status changes from task manager"""
        asyncio.create_task(
            self.broadcast(
                {
                    "type": "task_status_change",
                    "task_id": task.id,
                    "old_status": old_status.value,
                    "new_status": new_status.value,
                    "task": task.to_dict(),
                }
            )
        )

    def _on_task_progress_update(self, task, old_progress, new_progress):
        """Handle task progress updates from task manager"""
        asyncio.create_task(
            self.broadcast(
                {
                    "type": "task_progress_update",
                    "task_id": task.id,
                    "old_progress": old_progress,
                    "new_progress": new_progress,
                }
            )
        )

    def load_tasks(self):
        """Load tasks from tasks.json file with optimized database when available"""
        if self.optimized_db:
            # Use optimized database with indexing and caching
            try:
                tasks_data = self.optimized_db.get_tasks()
                # Convert to dict keyed by ID for compatibility
                self.tasks = {
                    task.get("id"): task for task in tasks_data if task.get("id")
                }
                logger.debug(f"Loaded {len(self.tasks)} tasks using optimized database")
                return
            except Exception as e:
                logger.warning(
                    f"Optimized database failed, falling back to basic loading: {e}"
                )

        # Fallback to original implementation
        if not CACHE_AVAILABLE:
            # Fallback to original implementation
            try:
                if self.tasks_file.exists():
                    with open(self.tasks_file, "r") as f:
                        data = json.load(f)
                        tasks_list = data.get("tasks", [])

                        # Convert to dict keyed by ID and add runtime status
                        for task in tasks_list:
                            task_id = task.get("id")
                            if task_id:
                                # Check if task is currently running
                                status = self.get_task_runtime_status(task_id)
                                task["runtime_status"] = status
                                self.tasks[task_id] = task

            except Exception as e:
                logger.error(f"Error loading tasks: {e}")
            return

        # Use intelligent caching
        def _load_tasks_data():
            try:
                if self.tasks_file.exists():
                    with open(self.tasks_file, "r") as f:
                        data = json.load(f)
                        tasks_list = data.get("tasks", [])

                        # Get all task IDs for batch status check
                        task_ids = [
                            task.get("id") for task in tasks_list if task.get("id")
                        ]

                        # Batch get runtime status for all tasks
                        if task_ids:
                            status_map = self.get_batch_task_runtime_status(task_ids)
                        else:
                            status_map = {}

                        # Convert to dict keyed by ID and add runtime status
                        tasks_dict = {}
                        for task in tasks_list:
                            task_id = task.get("id")
                            if task_id:
                                task["runtime_status"] = status_map.get(
                                    task_id, "pending"
                                )
                                tasks_dict[task_id] = task
                        return tasks_dict
                return {}
            except Exception as e:
                logger.error(f"Error loading tasks: {e}")
                return {}

        # Cache the task loading operation
        self.tasks = cache_file_operation(_load_tasks_data, str(self.tasks_file))

    def get_task_runtime_status(self, task_id: str) -> str:
        """Get runtime status of a task by checking processes and logs"""
        # First check if we have this in our Claude processes tracking
        if task_id in self.claude_processes:
            proc_info = self.claude_processes[task_id]
            if proc_info["status"] in ["running", "sleeping"]:
                return "running"

        # Check if there's a running process for this task using enhanced detection
        try:
            for proc_id, proc_info in self.claude_processes.items():
                if proc_info.get("task_id") == task_id:
                    if proc_info["status"] in ["running", "sleeping"]:
                        return "running"
                    else:
                        return "stopped"
        except Exception:
            pass

        # Fallback to process grep
        try:
            result = subprocess.run(
                ["pgrep", "-f", f"opencode.*{task_id}"], capture_output=True, text=True
            )
            if result.returncode == 0 and result.stdout.strip():
                return "running"
        except Exception:
            pass

        # Check log file for completion status
        log_file = self.logs_dir / f"{task_id}.log"
        if log_file.exists():
            try:
                with open(log_file, "r") as f:
                    content = f.read()
                    if "completed successfully" in content.lower():
                        return "completed"
                    elif any(
                        word in content.lower()
                        for word in ["error", "failed", "exception"]
                    ):
                        return "error"
                    elif content.strip():  # Has content but not completed
                        return "running"
            except Exception:
                pass

        return "pending"

    def get_batch_task_runtime_status(self, task_ids: List[str]) -> Dict[str, str]:
        """Get runtime status for multiple tasks efficiently"""
        # Pre-scan all processes once
        running_processes = set()
        try:
            for proc_id, proc_info in self.claude_processes.items():
                if proc_info["status"] in ["running", "sleeping"]:
                    task_id = proc_info.get("task_id")
                    if task_id:
                        running_processes.add(task_id)
        except Exception:
            pass

        # Batch process grep for all tasks
        pgrep_results = {}
        try:
            for task_id in task_ids:
                if task_id not in running_processes:
                    result = subprocess.run(
                        ["pgrep", "-f", f"opencode.*{task_id}"],
                        capture_output=True,
                        text=True,
                    )
                    if result.returncode == 0 and result.stdout.strip():
                        pgrep_results[task_id] = "running"
        except Exception:
            pass

        # Check log files for completion status (batch file operations)
        log_status_cache = {}
        for task_id in task_ids:
            if task_id in running_processes:
                log_status_cache[task_id] = "running"
            elif task_id in pgrep_results:
                log_status_cache[task_id] = "running"
            else:
                log_file = self.logs_dir / f"{task_id}.log"
                if log_file.exists():
                    try:
                        with open(log_file, "r") as f:
                            content = f.read()
                            if "completed successfully" in content.lower():
                                log_status_cache[task_id] = "completed"
                            elif any(
                                word in content.lower()
                                for word in ["error", "failed", "exception"]
                            ):
                                log_status_cache[task_id] = "error"
                            elif content.strip():  # Has content but not completed
                                log_status_cache[task_id] = "running"
                            else:
                                log_status_cache[task_id] = "pending"
                    except Exception:
                        log_status_cache[task_id] = "pending"
                else:
                    log_status_cache[task_id] = "pending"

        return log_status_cache

    def detect_claude_processes(self) -> Dict[str, Dict]:
        """Enhanced Claude/OpenCode process detection with caching and optimization"""
        now = datetime.now()

        # Check if we can use cached data
        if (
            now - self.last_process_scan < self.process_scan_interval
            and self.claude_processes
            and hasattr(self, "process_cache")
            and self.process_cache
        ):
            return self.claude_processes

        # Full scan needed - but optimize the scanning
        claude_processes = {}

        try:
            # Pre-compile regex patterns for better performance
            if not hasattr(self, "_compiled_patterns"):
                self._compiled_patterns = [
                    re.compile(pattern, re.IGNORECASE)
                    for pattern in [
                        r"opencode.*run",
                        r"claude.*desktop",
                        r"claude.*cli",
                        r"anthropic.*claude",
                        r"python.*opencode",
                        r"node.*opencode",
                        r"opencode-agent",
                    ]
                ]

            # Use more efficient process iteration with pre-filtering
            # Only get the fields we actually need
            processes = []
            for proc in psutil.process_iter(
                [
                    "pid",
                    "cmdline",
                    "create_time",
                    "memory_info",
                    "cpu_percent",
                    "status",
                    "name",
                ]
            ):
                try:
                    if not proc.info["cmdline"]:
                        continue

                    cmdline_str = " ".join(proc.info["cmdline"]).lower()
                    process_name = proc.info.get("name", "").lower()

                    # Quick pre-filter: check if any Claude-related term exists
                    is_claude_related = any(
                        term in cmdline_str or term in process_name
                        for term in ["opencode", "claude", "anthropic"]
                    )

                    if is_claude_related:
                        processes.append(proc)

                except (
                    psutil.NoSuchProcess,
                    psutil.AccessDenied,
                    psutil.ZombieProcess,
                ):
                    continue

            # Process only the filtered list
            for proc in processes:
                try:
                    proc_info = proc.info
                    cmdline = " ".join(proc_info["cmdline"]).lower()
                    process_name = proc_info.get("name", "").lower()

                    # Use compiled regex patterns for better performance
                    is_claude_process = False
                    process_type = "unknown"

                    for i, pattern in enumerate(self._compiled_patterns):
                        if pattern.search(cmdline) or pattern.search(process_name):
                            is_claude_process = True
                            # Map pattern index to type
                            type_map = [
                                "opencode",
                                "claude",
                                "claude",
                                "anthropic_claude",
                                "opencode",
                                "opencode",
                                "opencode",
                            ]
                            process_type = type_map[i]
                            break

                    if is_claude_process:
                        # Extract additional information
                        task_id = self._extract_task_id_from_cmdline(cmdline)
                        working_dir = self._get_process_working_dir(proc)

                        process_info = {
                            "pid": proc_info["pid"],
                            "type": process_type,
                            "status": proc_info.get("status", "unknown"),
                            "cmdline": " ".join(proc_info["cmdline"]),
                            "name": proc_info.get("name", ""),
                            "start_time": datetime.fromtimestamp(
                                proc_info["create_time"]
                            ).isoformat(),
                            "memory_usage": (
                                proc_info["memory_info"].rss
                                if proc_info["memory_info"]
                                else 0
                            ),
                            "memory_percent": (
                                proc.memory_percent()
                                if hasattr(proc, "memory_percent")
                                else 0
                            ),
                            "cpu_percent": proc_info.get("cpu_percent", 0),
                            "task_id": task_id,
                            "working_dir": working_dir,
                            "is_opencode": "opencode" in cmdline,
                            "is_claude_desktop": "claude" in process_name
                            and "desktop" in cmdline,
                            "discovered_at": datetime.now().isoformat(),
                        }

                        # Estimate what this process is doing
                        process_info["activity"] = self._estimate_process_activity(
                            process_info
                        )

                        # Use task_id if available, otherwise use PID
                        key = task_id if task_id else f"pid_{proc_info['pid']}"
                        claude_processes[key] = process_info

                except (
                    psutil.NoSuchProcess,
                    psutil.AccessDenied,
                    psutil.ZombieProcess,
                ):
                    continue
                except Exception as e:
                    logger.debug(f"Error processing process info: {e}")
                    continue

        except Exception as e:
            logger.error(f"Error detecting Claude processes: {e}")

        # Update cache
        self.claude_processes = claude_processes
        self.last_process_scan = now
        self.process_cache = claude_processes

        return claude_processes

    def update_agents_from_processes(self):
        """Update agents from full process scan"""
        self.claude_processes = self.detect_claude_processes()
        return self.update_agents_lightweight()

    def _extract_task_id_from_cmdline(self, cmdline: str) -> Optional[str]:
        """Extract task ID from command line if present"""
        # Look for task ID patterns
        patterns = [
            r"task[_-]([a-zA-Z0-9_-]+)",
            r"--task[=\s]+([a-zA-Z0-9_-]+)",
            r"id[=:]([a-zA-Z0-9_-]+)",
        ]

        for pattern in patterns:
            match = re.search(pattern, cmdline, re.IGNORECASE)
            if match:
                return match.group(1)

        return None

    def _get_process_working_dir(self, proc) -> Optional[str]:
        """Get working directory of a process"""
        try:
            return proc.cwd()
        except (psutil.AccessDenied, psutil.NoSuchProcess):
            return None

    def _estimate_process_activity(self, process_info: Dict) -> str:
        """Estimate what the Claude/OpenCode process is doing"""
        cmdline = process_info["cmdline"].lower()

        if "run" in cmdline:
            return "executing_task"
        elif "test" in cmdline:
            return "running_tests"
        elif "build" in cmdline:
            return "building"
        elif "analyze" in cmdline:
            return "analyzing_code"
        elif "chat" in cmdline or "interactive" in cmdline:
            return "interactive_session"
        elif process_info["is_claude_desktop"]:
            return "desktop_app"
        else:
            return "unknown_activity"
        """Get runtime status of a task by checking processes and logs"""
        # Check if there's a running process for this task
        try:
            result = subprocess.run(
                ["pgrep", "-f", f"opencode.*{task_id}"], capture_output=True, text=True
            )
            if result.returncode == 0 and result.stdout.strip():
                return "running"
        except Exception:
            pass

        # Check log file for completion status
        log_file = self.logs_dir / f"{task_id}.log"
        if log_file.exists():
            try:
                with open(log_file, "r") as f:
                    content = f.read()
                    if "completed successfully" in content.lower():
                        return "completed"
                    elif any(
                        word in content.lower()
                        for word in ["error", "failed", "exception"]
                    ):
                        return "error"
                    elif content.strip():  # Has content but not completed
                        return "running"
            except Exception:
                pass

        return "pending"

    def update_system_resources(self):
        """Update system resource information with optimized calls"""
        try:
            # Batch system calls to reduce overhead
            cpu_percent = psutil.cpu_percent(interval=0.5)  # Increased from 0.1 to 0.5
            memory = psutil.virtual_memory()
            disk = psutil.disk_usage("/")

            # Cache active process count to avoid repeated scanning
            if not hasattr(self, "_last_process_count_time"):
                self._last_process_count_time = datetime.now()
                self._cached_process_count = 0

            # Only recount processes every 30 seconds
            now = datetime.now()
            if (now - self._last_process_count_time).total_seconds() > 30:
                active_processes = 0
                for proc in psutil.process_iter(["pid", "cmdline"]):
                    try:
                        cmdline = " ".join(proc.info["cmdline"] or [])
                        if "opencode run" in cmdline.lower():
                            active_processes += 1
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        continue

                self._cached_process_count = active_processes
                self._last_process_count_time = now
            else:
                active_processes = self._cached_process_count

            self.system_resources = {
                "cpu_usage": cpu_percent,
                "memory_usage": memory.percent,
                "memory_used": memory.used,
                "memory_total": memory.total,
                "disk_usage": disk.percent,
                "disk_used": disk.used,
                "disk_total": disk.total,
                "active_processes": active_processes,
                "timestamp": datetime.now().isoformat(),
            }

        except Exception as e:
            logger.error(f"Error updating system resources: {e}")

    def update_agents_lightweight(self):
        """Lightweight agent update that doesn't do full process scanning"""
        current_agents = {}

        # Check existing processes without full scan
        for proc_id, proc_info in self.claude_processes.items():
            agent_id = proc_info.get("task_id", f"agent_{proc_info['pid']}")

            # Try to match with existing tasks
            task_desc = proc_info.get("activity", "Unknown task")
            task_type = "opencode" if proc_info["is_opencode"] else "claude"

            for task_id, task in self.tasks.items():
                if task_id == agent_id or task_id in proc_info["cmdline"]:
                    task_desc = task.get("description", task_desc)
                    task_type = task.get("type", task_type)
                    agent_id = task_id
                    break

            current_agents[agent_id] = {
                "id": agent_id,
                "pid": proc_info["pid"],
                "status": (
                    "running"
                    if proc_info["status"] in ["running", "sleeping"]
                    else "stopped"
                ),
                "type": task_type,
                "task": task_desc,
                "start_time": proc_info["start_time"],
                "memory_usage": proc_info["memory_usage"],
                "memory_percent": proc_info["memory_percent"],
                "cpu_percent": proc_info["cpu_percent"],
                "progress": self.estimate_progress(agent_id),
                "activity": proc_info["activity"],
                "working_dir": proc_info["working_dir"],
                "is_claude_desktop": proc_info["is_claude_desktop"],
                "process_type": proc_info["type"],
            }

        # Check for completed tasks in logs
        if self.logs_dir.exists():
            for log_file in self.logs_dir.glob("*.log"):
                task_id = log_file.stem
                if task_id not in current_agents:
                    try:
                        # Use cached mtime check
                        cache_key = f"log_status_{task_id}"
                        current_mtime = log_file.stat().st_mtime

                        if (
                            not hasattr(self, "_log_cache")
                            or cache_key not in self._log_cache
                            or self._log_cache[cache_key]["mtime"] != current_mtime
                        ):

                            with open(log_file, "r") as f:
                                content = f.read()
                                if content.strip():
                                    task = self.tasks.get(task_id, {})
                                    agent = {
                                        "id": task_id,
                                        "status": (
                                            "completed"
                                            if "completed successfully"
                                            in content.lower()
                                            else "error"
                                        ),
                                        "type": task.get("type", "general"),
                                        "task": task.get("description", "Unknown task"),
                                        "progress": (
                                            100
                                            if "completed successfully"
                                            in content.lower()
                                            else 0
                                        ),
                                        "log_file": str(log_file),
                                    }

                                    if any(
                                        word in content.lower()
                                        for word in ["error", "failed", "exception"]
                                    ):
                                        agent["status"] = "error"
                                        agent["error"] = self.extract_error_message(
                                            content
                                        )

                                    current_agents[task_id] = agent

                                    # Cache the result
                                    if not hasattr(self, "_log_cache"):
                                        self._log_cache = {}
                                    self._log_cache[cache_key] = {
                                        "mtime": current_mtime,
                                        "agent": agent,
                                    }
                        else:
                            # Use cached agent data
                            current_agents[task_id] = self._log_cache[cache_key][
                                "agent"
                            ]

                    except Exception as e:
                        logger.error(f"Error reading log file {log_file}: {e}")

        # Update agents and broadcast changes
        changed = False
        for agent_id, agent_data in current_agents.items():
            if agent_id not in self.agents or self.agents[agent_id] != agent_data:
                self.agents[agent_id] = agent_data
                changed = True
                asyncio.create_task(
                    self.broadcast({"type": "agent_update", "agent": agent_data})
                )

        # Remove agents that are no longer active
        for agent_id in list(self.agents.keys()):
            if agent_id not in current_agents:
                del self.agents[agent_id]
                changed = True

        return changed

    def estimate_progress(self, agent_id: str) -> int:
        """Estimate task progress based on log content and runtime with caching"""
        log_file = self.logs_dir / f"{agent_id}.log"
        if not log_file.exists():
            return 0

        # Cache key for this log file
        cache_key = f"{agent_id}_{log_file.stat().st_mtime}"

        # Check if we have cached progress estimation
        if hasattr(self, "_progress_cache") and cache_key in self._progress_cache:
            return self._progress_cache[cache_key]

        try:
            with open(log_file, "r") as f:
                content = f.read()
                lines = len(content.splitlines())

                # Simple heuristic: more log lines = more progress
                # Cap at 90% unless explicitly completed
                if "completed successfully" in content.lower():
                    progress = 100
                elif lines > 100:
                    progress = min(90, 10 + (lines - 10) // 5)
                elif lines > 10:
                    progress = min(50, lines * 2)
                else:
                    progress = min(20, lines * 2)

            # Cache the result
            if not hasattr(self, "_progress_cache"):
                self._progress_cache = {}
            self._progress_cache[cache_key] = progress

            # Limit cache size
            if len(self._progress_cache) > 100:
                # Remove oldest entries (simple FIFO)
                oldest_keys = list(self._progress_cache.keys())[:20]
                for key in oldest_keys:
                    del self._progress_cache[key]

            return progress

        except Exception:
            return 0

    def extract_error_message(self, log_content: str) -> str:
        """Extract a meaningful error message from log content"""
        lines = log_content.splitlines()
        for line in reversed(lines):
            if any(word in line.lower() for word in ["error", "failed", "exception"]):
                return line.strip()[:100]
        return "Unknown error occurred"

    def get_log_content_lazy(self, task_id: str, max_lines: int = 100) -> List[str]:
        """Get log content with lazy loading and caching"""
        log_file = self.logs_dir / f"{task_id}.log"
        if not log_file.exists():
            return []

        cache_key = f"{task_id}_{log_file.stat().st_mtime}"
        current_time = time.time()

        # Check cache first
        if (
            cache_key in self._log_content_cache
            and (current_time - self._log_content_cache[cache_key]["timestamp"])
            < self._log_cache_ttl
        ):
            return self._log_content_cache[cache_key]["content"][-max_lines:]

        # Load from file
        try:
            with open(log_file, "r") as f:
                lines = f.readlines()
                # Cache the full content
                self._log_content_cache[cache_key] = {
                    "content": lines,
                    "timestamp": current_time,
                }

                # Clean old cache entries
                if len(self._log_content_cache) > 50:  # Limit cache size
                    oldest_keys = sorted(
                        self._log_content_cache.keys(),
                        key=lambda k: self._log_content_cache[k]["timestamp"],
                    )[:10]
                    for key in oldest_keys:
                        del self._log_content_cache[key]

                return lines[-max_lines:]

        except Exception as e:
            logger.error(f"Error reading log file {log_file}: {e}")
            return []

    def broadcast_log_entry(self, file_path: str, line: str):
        """Broadcast a new log entry to all clients"""
        log_entry = {
            "time": datetime.now().isoformat(),
            "level": self.extract_log_level(line),
            "message": line,
            "agent": Path(file_path).stem,
        }

        self.logs.append(log_entry)
        # Keep only last 1000 logs in memory
        if len(self.logs) > 1000:
            self.logs = self.logs[-1000:]

        # Broadcast to clients
        asyncio.create_task(self.broadcast({"type": "log_entry", "log": log_entry}))

    def extract_log_level(self, line: str) -> str:
        """Extract log level from log line"""
        line_lower = line.lower()
        if "error" in line_lower:
            return "error"
        elif "warn" in line_lower:
            return "warn"
        elif "info" in line_lower:
            return "info"
        elif "debug" in line_lower:
            return "debug"
        else:
            return "info"

    async def handle_client_message(self, websocket, message):
        """Handle incoming client messages with enhanced functionality"""
        try:
            data = json.loads(message)
            msg_type = data.get("type")

            if msg_type == "request_status":
                await self.send_full_status(websocket)
            elif msg_type == "ping":
                await self.send_to_client(websocket, {"type": "pong"})
            elif msg_type == "request_claude_processes":
                # Send current Claude processes
                await self.send_to_client(
                    websocket,
                    {
                        "type": "claude_processes",
                        "processes": list(self.claude_processes.values()),
                    },
                )
            elif msg_type == "request_agent_details":
                agent_id = data.get("agent_id")
                if agent_id and agent_id in self.agents:
                    agent = self.agents[agent_id]
                    # Add additional details like recent logs
                    agent_details = agent.copy()
                    agent_details["recent_logs"] = self.get_agent_recent_logs(agent_id)
                    await self.send_to_client(
                        websocket, {"type": "agent_details", "agent": agent_details}
                    )
            elif msg_type == "kill_process":
                # Allow clients to request killing a process (with safety checks)
                pid = data.get("pid")
                if pid and self.is_safe_to_kill(pid):
                    success = self.kill_process_safely(pid)
                    await self.send_to_client(
                        websocket,
                        {
                            "type": "kill_process_response",
                            "success": success,
                            "pid": pid,
                        },
                    )
            elif msg_type == "start_task":
                # Start a new task if task manager is available
                if self.task_manager:
                    task_data = data.get("task_data", {})
                    task = self.task_manager.add_task(task_data)
                    await self.send_to_client(
                        websocket, {"type": "task_started", "task": task.to_dict()}
                    )

        except Exception as e:
            logger.error(f"Error handling client message: {e}")
            await self.send_to_client(
                websocket,
                {"type": "error", "message": f"Error processing message: {str(e)}"},
            )

    def get_agent_recent_logs(self, agent_id: str) -> List[Dict]:
        """Get recent logs for a specific agent"""
        agent_logs = []
        for log_entry in reversed(self.logs):
            if log_entry.get("agent") == agent_id:
                agent_logs.append(log_entry)
                if len(agent_logs) >= 20:  # Last 20 logs for this agent
                    break
        return list(reversed(agent_logs))

    def is_safe_to_kill(self, pid: int) -> bool:
        """Check if it's safe to kill a process (only Claude/OpenCode processes)"""
        try:
            proc = psutil.Process(pid)
            cmdline = " ".join(proc.cmdline()).lower()

            # Only allow killing Claude/OpenCode related processes
            safe_patterns = ["opencode", "claude", "anthropic"]
            return any(pattern in cmdline for pattern in safe_patterns)
        except:
            return False

    def kill_process_safely(self, pid: int) -> bool:
        """Safely kill a Claude/OpenCode process"""
        try:
            proc = psutil.Process(pid)
            proc.terminate()

            # Wait for graceful termination
            try:
                proc.wait(timeout=10)
            except psutil.TimeoutExpired:
                # Force kill if necessary
                proc.kill()

            logger.info(f"Successfully terminated process {pid}")
            return True
        except Exception as e:
            logger.error(f"Failed to kill process {pid}: {e}")
            return False

    async def client_handler(self, websocket, path):
        """Handle WebSocket client connections"""
        await self.register(websocket)
        try:
            async for message in websocket:
                await self.handle_client_message(websocket, message)
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            await self.unregister(websocket)

    def start_file_monitoring(self):
        """Start monitoring log files for changes"""
        if self.logs_dir.exists():
            self.observer.schedule(
                self.log_handler, str(self.logs_dir), recursive=False
            )
            self.observer.start()
            logger.info(f"Started monitoring {self.logs_dir}")

    def stop_file_monitoring(self):
        """Stop file monitoring"""
        self.observer.stop()
        self.observer.join()

    async def periodic_updates(self):
        """Periodic updates for system resources and agent status with optimized scheduling"""
        update_count = 0

        while True:
            try:
                update_count += 1

                # Update system resources every 5 seconds
                self.update_system_resources()
                await self.broadcast(
                    {"type": "resource_update", "resources": self.system_resources}
                )

                # Update agents using enhanced Claude process detection
                # Only do full process scan every 30 seconds (every 6th update)
                if update_count % 6 == 0:
                    agents_changed = self.update_agents_from_processes()
                else:
                    # Light update: just check existing processes and logs
                    agents_changed = self.update_agents_lightweight()

                # Reload tasks from file every 10 seconds (every 2nd update)
                if update_count % 2 == 0:
                    self.load_tasks()

                # If task manager is available, sync with it every 15 seconds (every 3rd update)
                if update_count % 3 == 0 and self.task_manager:
                    task_summary = self.task_manager.get_status_summary()
                    await self.broadcast(
                        {"type": "task_manager_status", "summary": task_summary}
                    )

                # Periodic detailed process scan every 30 seconds (every 6th update)
                if update_count % 6 == 0:
                    now = datetime.now()
                    detailed_processes = self.detect_claude_processes()
                    await self.broadcast(
                        {
                            "type": "detailed_process_scan",
                            "processes": list(detailed_processes.values()),
                            "scan_time": now.isoformat(),
                        }
                    )
                    self.last_process_scan = now

                await asyncio.sleep(5)  # Update every 5 seconds

            except Exception as e:
                logger.error(f"Error in periodic updates: {e}")
                await asyncio.sleep(5)

    async def start_server(self):
        """Start the WebSocket server with enhanced functionality"""
        logger.info(f"Starting enhanced dashboard server on port {self.port}")

        # Initial data load
        self.load_tasks()
        self.update_system_resources()
        self.update_agents_from_processes()

        # Start task manager if available
        if self.task_manager:
            try:
                self.task_manager.start()
                logger.info("Task manager started successfully")
            except Exception as e:
                logger.warning(f"Could not start task manager: {e}")

        # Start file monitoring
        self.start_file_monitoring()

        # Start periodic updates
        asyncio.create_task(self.periodic_updates())

        # Start WebSocket server
        start_server = websockets.serve(
            self.client_handler,
            "localhost",
            self.port,
            ping_interval=20,
            ping_timeout=10,
        )

        logger.info(
            f"Enhanced dashboard server started at ws://localhost:{self.port}/ws"
        )
        logger.info(f"Monitoring project: {self.project_dir}")
        logger.info(f"Claude process detection: Enhanced")
        logger.info(
            f"Task manager integration: {'Enabled' if self.task_manager else 'Disabled'}"
        )

        await start_server

    def shutdown(self):
        """Shutdown the server with cleanup"""
        logger.info("Shutting down enhanced dashboard server...")

        # Stop task manager
        if self.task_manager:
            try:
                self.task_manager.stop()
                logger.info("Task manager stopped")
            except Exception as e:
                logger.error(f"Error stopping task manager: {e}")

        # Stop file monitoring
        self.stop_file_monitoring()

        logger.info("Dashboard server shutdown complete")


def main():
    """Main entry point"""
    import argparse
    import signal

    parser = argparse.ArgumentParser(description="OpenCode Agent Dashboard Server")
    parser.add_argument(
        "--port",
        "-p",
        type=int,
        default=8080,
        help="WebSocket server port (default: 8080)",
    )
    parser.add_argument(
        "--project", type=str, default=".", help="Project directory path"
    )

    args = parser.parse_args()

    server = DashboardServer(args.project, args.port)

    # Handle shutdown gracefully
    def signal_handler(signum, frame):
        print("\nShutting down...")
        server.shutdown()
        exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Start the server
    try:
        asyncio.run(server.start_server())
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
