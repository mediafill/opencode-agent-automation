#!/usr/bin/env python3
"""
Enhanced OpenCode Agent Dashboard WebSocket Server
Provides real-time data to the web dashboard with proper Claude process detection
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
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Set, Optional, Any
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# Try to import websockets, fallback gracefully if not available
try:
    import websockets

    WEBSOCKETS_AVAILABLE = True
except ImportError:
    WEBSOCKETS_AVAILABLE = False
    print("Warning: websockets not available. Install with: pip install websockets")

try:
    from logger import StructuredLogger

    logger = StructuredLogger(__name__)
except ImportError:
    import logging

    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

try:
    from task_manager import TaskManager, TaskStatus

    TASK_MANAGER_AVAILABLE = True
except ImportError:
    TASK_MANAGER_AVAILABLE = False
    logger.warning("TaskManager not available, using basic task tracking")

    # Create placeholder classes when TaskManager is not available
    class _TaskManager:
        def __init__(self, *args, **kwargs):
            pass

        def add_status_callback(self, callback):
            pass

        def add_progress_callback(self, callback):
            pass

        def start(self):
            pass

        def stop(self):
            pass

        def add_task(self, task_data):
            return None

        def get_status_summary(self):
            return {"total": 0, "pending": 0, "running": 0, "completed": 0, "failed": 0}

    class _TaskStatus:
        PENDING = "pending"
        RUNNING = "running"
        COMPLETED = "completed"
        FAILED = "failed"

    # Assign placeholder classes
    TaskManager = _TaskManager
    TaskStatus = _TaskStatus


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


class EnhancedDashboardServer:
    """Enhanced WebSocket server for the OpenCode agent dashboard"""

    def __init__(self, project_dir: Optional[str] = None, port: int = 8080):
        self.project_dir = Path(project_dir) if project_dir else Path.cwd()
        self.claude_dir = self.project_dir / ".claude"
        self.logs_dir = self.claude_dir / "logs"
        self.tasks_file = self.claude_dir / "tasks.json"
        self.port = port

        # WebSocket connections (if available)
        if WEBSOCKETS_AVAILABLE:
            self.clients: Set = set()
        else:
            self.clients = set()

        # Data storage
        self.agents = {}
        self.tasks = {}
        self.logs = []
        self.system_resources = {}
        self.claude_processes = {}  # Track Claude/OpenCode processes specifically

        # File monitoring
        self.observer = Observer()
        self.log_handler = LogFileHandler(self)

        # Task manager integration
        self.task_manager = None
        if TASK_MANAGER_AVAILABLE:
            try:
                self.task_manager = TaskManager(str(self.project_dir))
                self.task_manager.add_status_callback(self._on_task_status_change)
                self.task_manager.add_progress_callback(self._on_task_progress_update)
            except Exception as e:
                logger.warning(f"Could not initialize task manager: {e}")

        # Process monitoring
        self.last_process_scan = datetime.now()
        self.process_scan_interval = timedelta(seconds=10)
        self.running = False

        # Ensure directories exist
        self.logs_dir.mkdir(parents=True, exist_ok=True)

        logger.info(f"Enhanced Dashboard Server initialized")
        logger.info(
            f"WebSocket support: {'Enabled' if WEBSOCKETS_AVAILABLE else 'Disabled'}"
        )
        logger.info(
            f"Task Manager support: {'Enabled' if TASK_MANAGER_AVAILABLE else 'Disabled'}"
        )

    def detect_claude_processes(self) -> Dict[str, Dict]:
        """Enhanced Claude/OpenCode process detection with detailed information"""
        claude_processes = {}

        # Multiple patterns to identify Claude/OpenCode processes
        claude_patterns = [
            r"opencode.*run",
            r"claude.*desktop",
            r"claude.*cli",
            r"anthropic.*claude",
            r"python.*opencode",
            r"node.*opencode",
            r"opencode-agent",
            r"\.vscode.*claude",
            r"cursor.*claude",
        ]

        try:
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

                    cmdline = " ".join(proc.info["cmdline"]).lower()
                    process_name = proc.info.get("name", "").lower()

                    # Check if this matches any Claude/OpenCode pattern
                    is_claude_process = False
                    process_type = "unknown"

                    for pattern in claude_patterns:
                        if re.search(pattern, cmdline) or re.search(
                            pattern, process_name
                        ):
                            is_claude_process = True
                            if "opencode" in pattern:
                                process_type = "opencode"
                            elif "claude" in pattern:
                                process_type = "claude"
                            elif "anthropic" in pattern:
                                process_type = "anthropic_claude"
                            elif "cursor" in pattern:
                                process_type = "cursor_claude"
                            break

                    if is_claude_process:
                        # Extract additional information
                        task_id = self._extract_task_id_from_cmdline(cmdline)
                        working_dir = self._get_process_working_dir(proc)

                        process_info = {
                            "pid": proc.info["pid"],
                            "type": process_type,
                            "status": proc.info.get("status", "unknown"),
                            "cmdline": " ".join(proc.info["cmdline"]),
                            "name": proc.info.get("name", ""),
                            "start_time": datetime.fromtimestamp(
                                proc.info["create_time"]
                            ).isoformat(),
                            "memory_usage": (
                                proc.info["memory_info"].rss
                                if proc.info["memory_info"]
                                else 0
                            ),
                            "memory_percent": self._safe_memory_percent(proc),
                            "cpu_percent": proc.info.get("cpu_percent", 0),
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
                        key = task_id if task_id else f"pid_{proc.info['pid']}"
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

        return claude_processes

    def _safe_memory_percent(self, proc):
        """Safely get memory percentage"""
        try:
            return proc.memory_percent()
        except:
            return 0.0

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

    def update_system_resources(self):
        """Update system resource information"""
        try:
            cpu_percent = psutil.cpu_percent(
                interval=0.1
            )  # Shorter interval for responsiveness
            memory = psutil.virtual_memory()
            disk = psutil.disk_usage("/")

            # Count active Claude processes
            active_processes = len(self.claude_processes)

            self.system_resources = {
                "cpu_usage": cpu_percent,
                "memory_usage": memory.percent,
                "memory_used": memory.used,
                "memory_total": memory.total,
                "disk_usage": disk.percent,
                "disk_used": disk.used,
                "disk_total": disk.total,
                "active_processes": active_processes,
                "claude_processes": len(
                    [
                        p
                        for p in self.claude_processes.values()
                        if p["status"] in ["running", "sleeping"]
                    ]
                ),
                "timestamp": datetime.now().isoformat(),
            }

        except Exception as e:
            logger.error(f"Error updating system resources: {e}")

    def load_tasks(self):
        """Load tasks from tasks.json file"""
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

    def update_agents_from_processes(self) -> bool:
        """Update agent information using enhanced Claude process detection"""
        # Update Claude processes first
        self.claude_processes = self.detect_claude_processes()

        current_agents = {}

        # Process detected Claude/OpenCode processes
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
                        with open(log_file, "r") as f:
                            content = f.read()
                            if content.strip():
                                task = self.tasks.get(task_id, {})
                                agent = {
                                    "id": task_id,
                                    "status": (
                                        "completed"
                                        if "completed successfully" in content.lower()
                                        else "error"
                                    ),
                                    "type": task.get("type", "general"),
                                    "task": task.get("description", "Unknown task"),
                                    "progress": (
                                        100
                                        if "completed successfully" in content.lower()
                                        else 0
                                    ),
                                    "log_file": str(log_file),
                                }

                                if any(
                                    word in content.lower()
                                    for word in ["error", "failed", "exception"]
                                ):
                                    agent["status"] = "error"
                                    agent["error"] = self.extract_error_message(content)

                                current_agents[task_id] = agent
                    except Exception as e:
                        logger.error(f"Error reading log file {log_file}: {e}")

        # Update agents
        changed = len(current_agents) != len(self.agents)
        for agent_id, agent_data in current_agents.items():
            if agent_id not in self.agents or self.agents[agent_id] != agent_data:
                changed = True
                break

        self.agents = current_agents
        return changed

    def estimate_progress(self, agent_id: str) -> int:
        """Estimate task progress based on log content and runtime"""
        log_file = self.logs_dir / f"{agent_id}.log"
        if not log_file.exists():
            return 0

        try:
            with open(log_file, "r") as f:
                content = f.read()
                lines = len(content.splitlines())

                # Simple heuristic: more log lines = more progress
                # Cap at 90% unless explicitly completed
                if "completed successfully" in content.lower():
                    return 100
                elif lines > 100:
                    return min(90, 10 + (lines - 10) // 5)
                elif lines > 10:
                    return min(50, lines * 2)
                else:
                    return min(20, lines * 2)

        except Exception:
            return 0

    def extract_error_message(self, log_content: str) -> str:
        """Extract a meaningful error message from log content"""
        lines = log_content.splitlines()
        for line in reversed(lines):
            if any(word in line.lower() for word in ["error", "failed", "exception"]):
                return line.strip()[:100]
        return "Unknown error occurred"

    def broadcast_log_entry(self, file_path: str, line: str):
        """Broadcast a new log entry (stub for non-WebSocket mode)"""
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

        # In non-WebSocket mode, just log it
        logger.debug(f"Log entry: {log_entry}")

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

    def _on_task_status_change(self, task, old_status, new_status):
        """Handle task status changes from task manager"""
        logger.info(
            f"Task {task.id} status changed: {old_status.value} -> {new_status.value}"
        )

    def _on_task_progress_update(self, task, old_progress, new_progress):
        """Handle task progress updates from task manager"""
        logger.info(f"Task {task.id} progress: {old_progress}% -> {new_progress}%")

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

    def run_monitoring_loop(self):
        """Run the monitoring loop without WebSocket server"""
        self.running = True
        logger.info("Starting enhanced monitoring loop (no WebSocket)")

        # Initial data load
        self.load_tasks()
        self.update_system_resources()
        self.update_agents_from_processes()

        # Start file monitoring
        self.start_file_monitoring()

        # Start task manager if available
        if self.task_manager:
            try:
                self.task_manager.start()
                logger.info("Task manager started successfully")
            except Exception as e:
                logger.warning(f"Could not start task manager: {e}")

        try:
            while self.running:
                # Update system resources
                self.update_system_resources()

                # Update agents using enhanced Claude process detection
                agents_changed = self.update_agents_from_processes()

                if agents_changed:
                    logger.info(
                        f"Detected {len(self.agents)} agents, {len(self.claude_processes)} Claude processes"
                    )

                # Reload tasks from file
                self.load_tasks()

                # Print status summary periodically
                now = datetime.now()
                if now - self.last_process_scan >= self.process_scan_interval:
                    self.print_status_summary()
                    self.last_process_scan = now

                time.sleep(5)  # Update every 5 seconds

        except KeyboardInterrupt:
            logger.info("Monitoring loop interrupted")
        finally:
            self.shutdown()

    def print_status_summary(self):
        """Print a status summary to console"""
        print(f"\n=== Enhanced OpenCode Dashboard Status ===")
        print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"Project: {self.project_dir}")
        print(f"Active Claude Processes: {len(self.claude_processes)}")
        print(f"Active Agents: {len(self.agents)}")
        print(f"Tasks: {len(self.tasks)}")
        print(f"CPU: {self.system_resources.get('cpu_usage', 0):.1f}%")
        print(f"Memory: {self.system_resources.get('memory_usage', 0):.1f}%")

        if self.claude_processes:
            print(f"\nClaude Processes:")
            for proc_id, proc in self.claude_processes.items():
                print(
                    f"  {proc_id}: {proc['type']} - {proc['activity']} (PID: {proc['pid']})"
                )

        if self.agents:
            print(f"\nActive Agents:")
            for agent_id, agent in self.agents.items():
                print(
                    f"  {agent_id}: {agent['status']} - {agent['task']} ({agent['progress']}%)"
                )

        print("=" * 50)

    def shutdown(self):
        """Shutdown the server with cleanup"""
        logger.info("Shutting down enhanced dashboard server...")
        self.running = False

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
    """Main entry point for enhanced dashboard server"""
    import argparse

    parser = argparse.ArgumentParser(
        description="Enhanced OpenCode Agent Dashboard Server"
    )
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
    parser.add_argument(
        "--monitor-only",
        action="store_true",
        help="Run in monitoring mode only (no WebSocket server)",
    )

    args = parser.parse_args()

    server = EnhancedDashboardServer(args.project, args.port)

    # Handle shutdown gracefully
    def signal_handler(signum, frame):
        print("\nShutting down...")
        server.shutdown()
        exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Start the appropriate mode
    try:
        if args.monitor_only or not WEBSOCKETS_AVAILABLE:
            server.run_monitoring_loop()
        else:
            # WebSocket mode would go here when websockets is available
            logger.error("WebSocket mode not yet implemented in this version")
            server.run_monitoring_loop()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
