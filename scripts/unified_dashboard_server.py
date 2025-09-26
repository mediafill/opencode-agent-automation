#!/usr/bin/env python3
"""
Unified OpenCode Agent Dashboard Server
Combines monitoring with WebSocket support when available
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
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# Try to import websockets, fallback gracefully if not available
try:
    import websockets
    from websockets import serve
    WEBSOCKETS_AVAILABLE = True
except ImportError:
    websockets = None
    serve = None
    WEBSOCKETS_AVAILABLE = False
    print("Warning: websockets not available. Install with: pip install websockets")
    print("Falling back to monitoring-only mode.")

try:
    from logger import StructuredLogger
    logger = StructuredLogger(__name__)
except ImportError:
    import logging
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    logger = logging.getLogger(__name__)

try:
    from task_manager import TaskManager, TaskStatus
    TASK_MANAGER_AVAILABLE = True
except ImportError:
    TaskManager = None
    TaskStatus = None
    TASK_MANAGER_AVAILABLE = False
    logger.warning("TaskManager not available, using basic task tracking")


class LogFileHandler(FileSystemEventHandler):
    """Handles log file changes and broadcasts updates"""
    
    def __init__(self, server):
        self.server = server
        self.last_positions = {}
    
    def on_modified(self, event):
        if event.is_directory or not str(event.src_path).endswith('.log'):
            return
        
        self.process_log_file(event.src_path)
    
    def process_log_file(self, file_path):
        """Process new lines in log file and broadcast"""
        try:
            with open(file_path, 'r') as f:
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
                            self.server.add_log_entry(file_path, line)
        
        except Exception as e:
            logger.error(f"Error processing log file {file_path}: {e}")


class UnifiedDashboardServer:
    """Unified dashboard server with optional WebSocket support"""
    
    def __init__(self, project_dir: Optional[str] = None, port: int = 8080):
        self.project_dir = Path(project_dir) if project_dir else Path.cwd()
        self.claude_dir = self.project_dir / '.claude'
        self.logs_dir = self.claude_dir / 'logs'
        self.tasks_file = self.claude_dir / 'tasks.json'
        self.port = port
        
        # WebSocket connections (if available)
        self.clients: Set = set()
        
        # Data storage
        self.agents = {}
        self.tasks = {}
        self.logs = []
        self.system_resources = {}
        self.claude_processes = {}
        
        # Performance optimization: reverse index for task_id -> process lookup
        self.task_process_index = {}  # task_id -> process_info
        
        # File monitoring
        self.observer = Observer()
        self.log_handler = LogFileHandler(self)
        
        # Task manager integration
        self.task_manager = None
        if TASK_MANAGER_AVAILABLE and TaskManager is not None:
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
        
        # File caching to avoid repeated JSON reads
        self.file_cache = {}  # file_path -> (data, timestamp)
        self.cache_ttl = timedelta(seconds=30)  # Cache for 30 seconds
        
        # Ensure directories exist
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        
    def cached_read_json(self, file_path: Path) -> Optional[Dict]:
        """Read JSON file with caching to avoid repeated disk I/O"""
        now = datetime.now()
        cache_key = str(file_path)
        
        # Check cache first
        if cache_key in self.file_cache:
            cached_data, cache_time = self.file_cache[cache_key]
            if now - cache_time < self.cache_ttl:
                return cached_data
        
        # Cache miss or expired, read from disk
        try:
            if file_path.exists():
                with open(file_path, 'r') as f:
                    data = json.load(f)
                    self.file_cache[cache_key] = (data, now)
                    return data
        except Exception as e:
            logger.error(f"Error reading {file_path}: {e}")
        
        return None
    
    def invalidate_cache(self, file_path: Path):
        """Invalidate cache for a specific file"""
        cache_key = str(file_path)
        if cache_key in self.file_cache:
            del self.file_cache[cache_key]
        
        logger.info(f"Unified Dashboard Server initialized")
        logger.info(f"Project directory: {self.project_dir}")
        logger.info(f"WebSocket support: {'Enabled' if WEBSOCKETS_AVAILABLE else 'Disabled'}")
        logger.info(f"Task Manager support: {'Enabled' if TASK_MANAGER_AVAILABLE else 'Disabled'}")

    def detect_claude_processes(self) -> Dict[str, Dict]:
        """Enhanced Claude/OpenCode process detection"""
        claude_processes = {}
        
        # Patterns to identify Claude/OpenCode processes
        claude_patterns = [
            r'opencode.*run',
            r'claude.*desktop',
            r'claude.*cli',
            r'anthropic.*claude',
            r'python.*opencode',
            r'node.*opencode',
            r'opencode-agent',
            r'\.vscode.*claude',
            r'cursor.*claude'
        ]
        
        try:
            for proc in psutil.process_iter(['pid', 'cmdline', 'create_time', 
                                           'memory_info', 'cpu_percent', 'status', 'name']):
                try:
                    if not proc.info['cmdline']:
                        continue
                        
                    cmdline = ' '.join(proc.info['cmdline']).lower()
                    process_name = proc.info.get('name', '').lower()
                    
                    # Check if this matches any Claude/OpenCode pattern
                    is_claude_process = False
                    process_type = 'unknown'
                    
                    for pattern in claude_patterns:
                        if re.search(pattern, cmdline) or re.search(pattern, process_name):
                            is_claude_process = True
                            if 'opencode' in pattern:
                                process_type = 'opencode'
                            elif 'claude' in pattern:
                                process_type = 'claude'
                            elif 'anthropic' in pattern:
                                process_type = 'anthropic_claude'
                            elif 'cursor' in pattern:
                                process_type = 'cursor_claude'
                            break
                    
                    if is_claude_process:
                        # Extract additional information
                        task_id = self._extract_task_id_from_cmdline(cmdline)
                        working_dir = self._get_process_working_dir(proc)
                        
                        process_info = {
                            'pid': proc.info['pid'],
                            'type': process_type,
                            'status': proc.info.get('status', 'unknown'),
                            'cmdline': ' '.join(proc.info['cmdline']),
                            'name': proc.info.get('name', ''),
                            'start_time': datetime.fromtimestamp(proc.info['create_time']).isoformat(),
                            'memory_usage': proc.info['memory_info'].rss if proc.info['memory_info'] else 0,
                            'memory_percent': self._safe_memory_percent(proc),
                            'cpu_percent': proc.info.get('cpu_percent', 0),
                            'task_id': task_id,
                            'working_dir': working_dir,
                            'is_opencode': 'opencode' in cmdline,
                            'is_claude_desktop': 'claude' in process_name and 'desktop' in cmdline,
                            'discovered_at': datetime.now().isoformat()
                        }
                        
                        # Estimate what this process is doing
                        process_info['activity'] = self._estimate_process_activity(process_info)
                        
                        # Use task_id if available, otherwise use PID
                        key = task_id if task_id else f"pid_{proc.info['pid']}"
                        claude_processes[key] = process_info
                        
                except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                    continue
                except Exception as e:
                    logger.debug(f"Error processing process info: {e}")
                    continue
                    
        except Exception as e:
            logger.error(f"Error during process iteration: {e}")
            
        # Update reverse index for fast task_id lookups
        self.task_process_index = {}
        for proc_id, proc_info in claude_processes.items():
            task_id = proc_info.get('task_id')
            if task_id:
                self.task_process_index[task_id] = proc_info
        
        return claude_processes
    
    def _safe_memory_percent(self, proc):
        """Safely get memory percentage"""
        try:
            return proc.memory_percent()
        except:
            return 0.0
    
    def _extract_task_id_from_cmdline(self, cmdline: str) -> Optional[str]:
        """Extract task ID from command line if present"""
        patterns = [
            r'task[_-]([a-zA-Z0-9_-]+)',
            r'--task[=\s]+([a-zA-Z0-9_-]+)',
            r'id[=:]([a-zA-Z0-9_-]+)'
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
        cmdline = process_info['cmdline'].lower()
        
        if 'run' in cmdline:
            return 'executing_task'
        elif 'test' in cmdline:
            return 'running_tests'
        elif 'build' in cmdline:
            return 'building'
        elif 'analyze' in cmdline:
            return 'analyzing_code'
        elif 'chat' in cmdline or 'interactive' in cmdline:
            return 'interactive_session'
        elif process_info['is_claude_desktop']:
            return 'desktop_app'
        else:
            return 'unknown_activity'
    
    def update_system_resources(self):
        """Update system resource information"""
        try:
            cpu_percent = psutil.cpu_percent(interval=0.1)
            memory = psutil.virtual_memory()
            disk = psutil.disk_usage('/')
            
            active_processes = len(self.claude_processes)
            
            self.system_resources = {
                'cpu_usage': cpu_percent,
                'memory_usage': memory.percent,
                'memory_used': memory.used,
                'memory_total': memory.total,
                'disk_usage': disk.percent,
                'disk_used': disk.used,
                'disk_total': disk.total,
                'active_processes': active_processes,
                'claude_processes': len([p for p in self.claude_processes.values() 
                                       if p['status'] in ['running', 'sleeping']]),
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Error updating system resources: {e}")
    
    def load_tasks(self):
        """Load tasks from tasks.json file with caching"""
        data = self.cached_read_json(self.tasks_file)
        if data:
            tasks_list = data.get('tasks', [])
            
            # Convert to dict keyed by ID and add runtime status
            for task in tasks_list:
                task_id = task.get('id')
                if task_id:
                    # Check if task is currently running
                    status = self.get_task_runtime_status(task_id)
                    task['runtime_status'] = status
                    self.tasks[task_id] = task
    
    def get_task_runtime_status(self, task_id: str) -> str:
        """Get runtime status of a task by checking processes and logs with O(1) lookup"""
        # First check if we have this task in our reverse index (O(1) lookup)
        if task_id in self.task_process_index:
            proc_info = self.task_process_index[task_id]
            if proc_info['status'] in ['running', 'sleeping']:
                return 'running'
            else:
                return 'stopped'
        
        # Check if there's a running process for this task using enhanced detection
        # Fallback to process grep for tasks not in our index
        try:
            result = subprocess.run(
                ['pgrep', '-f', f'opencode.*{task_id}'],
                capture_output=True, text=True
            )
            if result.returncode == 0 and result.stdout.strip():
                return 'running'
        except Exception:
            pass
            
        # Check log file for completion status
        log_file = self.logs_dir / f'{task_id}.log'
        if log_file.exists():
            try:
                with open(log_file, 'r') as f:
                    content = f.read()
                    if 'completed successfully' in content.lower():
                        return 'completed'
                    elif any(word in content.lower() for word in ['error', 'failed', 'exception']):
                        return 'error'
                    elif content.strip():  # Has content but not completed
                        return 'running'
            except Exception:
                pass
                
        return 'pending'
    
    def update_agents_from_processes(self) -> bool:
        """Update agent information using enhanced Claude process detection"""
        # Update Claude processes first
        self.claude_processes = self.detect_claude_processes()
        
        current_agents = {}
        
        # Process detected Claude/OpenCode processes
        for proc_id, proc_info in self.claude_processes.items():
            agent_id = proc_info.get('task_id', f"agent_{proc_info['pid']}")
            
            # Try to match with existing tasks
            task_desc = proc_info.get('activity', 'Unknown task')
            task_type = 'opencode' if proc_info['is_opencode'] else 'claude'
            
            for task_id, task in self.tasks.items():
                if task_id == agent_id or task_id in proc_info['cmdline']:
                    task_desc = task.get('description', task_desc)
                    task_type = task.get('type', task_type)
                    agent_id = task_id
                    break
            
            current_agents[agent_id] = {
                'id': agent_id,
                'pid': proc_info['pid'],
                'status': 'running' if proc_info['status'] in ['running', 'sleeping'] else 'stopped',
                'type': task_type,
                'task': task_desc,
                'start_time': proc_info['start_time'],
                'memory_usage': proc_info['memory_usage'],
                'memory_percent': proc_info['memory_percent'],
                'cpu_percent': proc_info['cpu_percent'],
                'progress': self.estimate_progress(agent_id),
                'activity': proc_info['activity'],
                'working_dir': proc_info['working_dir'],
                'is_claude_desktop': proc_info['is_claude_desktop'],
                'process_type': proc_info['type']
            }
        
        # Check for completed tasks in logs
        if self.logs_dir.exists():
            for log_file in self.logs_dir.glob('*.log'):
                task_id = log_file.stem
                if task_id not in current_agents:
                    try:
                        with open(log_file, 'r') as f:
                            content = f.read()
                            if content.strip():
                                task = self.tasks.get(task_id, {})
                                agent = {
                                    'id': task_id,
                                    'status': 'completed' if 'completed successfully' in content.lower() else 'error',
                                    'type': task.get('type', 'general'),
                                    'task': task.get('description', 'Unknown task'),
                                    'progress': 100 if 'completed successfully' in content.lower() else 0,
                                    'log_file': str(log_file)
                                }
                                
                                if any(word in content.lower() for word in ['error', 'failed', 'exception']):
                                    agent['status'] = 'error'
                                    agent['error'] = self.extract_error_message(content)
                                
                                current_agents[task_id] = agent
                    except Exception as e:
                        logger.error(f"Error reading log file {log_file}: {e}")
        
        # Check if agents changed
        changed = len(current_agents) != len(self.agents)
        if not changed:
            for agent_id, agent_data in current_agents.items():
                if agent_id not in self.agents or self.agents[agent_id] != agent_data:
                    changed = True
                    break
        
        self.agents = current_agents
        
        # Broadcast changes if WebSocket is available
        if changed and WEBSOCKETS_AVAILABLE and self.clients:
            asyncio.create_task(self.broadcast_agents_update())
        
        return changed
    
    def estimate_progress(self, agent_id: str) -> int:
        """Estimate task progress based on log content and runtime"""
        log_file = self.logs_dir / f'{agent_id}.log'
        if not log_file.exists():
            return 0
            
        try:
            with open(log_file, 'r') as f:
                content = f.read()
                lines = len(content.splitlines())
                
                # Simple heuristic: more log lines = more progress
                if 'completed successfully' in content.lower():
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
            if any(word in line.lower() for word in ['error', 'failed', 'exception']):
                return line.strip()[:100]
        return "Unknown error occurred"
    
    def add_log_entry(self, file_path: str, line: str):
        """Add a new log entry"""
        log_entry = {
            'time': datetime.now().isoformat(),
            'level': self.extract_log_level(line),
            'message': line,
            'agent': Path(file_path).stem
        }
        
        self.logs.append(log_entry)
        # Keep only last 1000 logs in memory
        if len(self.logs) > 1000:
            self.logs = self.logs[-1000:]
        
        # Broadcast to clients if WebSocket is available
        if WEBSOCKETS_AVAILABLE and self.clients:
            asyncio.create_task(self.broadcast_log_entry(log_entry))
    
    def extract_log_level(self, line: str) -> str:
        """Extract log level from log line"""
        line_lower = line.lower()
        if 'error' in line_lower:
            return 'error'
        elif 'warn' in line_lower:
            return 'warn'
        elif 'info' in line_lower:
            return 'info'
        elif 'debug' in line_lower:
            return 'debug'
        else:
            return 'info'
    
    def _on_task_status_change(self, task, old_status, new_status):
        """Handle task status changes from task manager"""
        logger.info(f"Task {task.id} status changed: {old_status.value} -> {new_status.value}")
        if WEBSOCKETS_AVAILABLE and self.clients:
            asyncio.create_task(self.broadcast_task_update(task.to_dict()))
    
    def _on_task_progress_update(self, task, old_progress, new_progress):
        """Handle task progress updates from task manager"""
        logger.info(f"Task {task.id} progress: {old_progress}% -> {new_progress}%")
        if WEBSOCKETS_AVAILABLE and self.clients:
            asyncio.create_task(self.broadcast_task_update(task.to_dict()))
    
    # WebSocket methods (only available if websockets is installed)
    async def register_client(self, websocket):
        """Register a new WebSocket client"""
        if not WEBSOCKETS_AVAILABLE:
            return
        
        self.clients.add(websocket)
        logger.info(f"Client connected. Total clients: {len(self.clients)}")
        
        # Send current status to new client
        await self.send_full_status(websocket)
    
    async def unregister_client(self, websocket):
        """Unregister a WebSocket client"""
        if not WEBSOCKETS_AVAILABLE:
            return
        
        self.clients.discard(websocket)
        logger.info(f"Client disconnected. Total clients: {len(self.clients)}")
    
    async def send_to_client(self, websocket, data):
        """Send data to a specific client"""
        if not WEBSOCKETS_AVAILABLE:
            return
        
        try:
            await websocket.send(json.dumps(data))
        except Exception as e:
            logger.error(f"Error sending to client: {e}")
            await self.unregister_client(websocket)
    
    async def broadcast(self, data):
        """Broadcast data to all connected clients"""
        if not WEBSOCKETS_AVAILABLE or not self.clients:
            return
            
        message = json.dumps(data)
        disconnected = set()
        
        for client in self.clients.copy():
            try:
                await client.send(message)
            except Exception as e:
                logger.error(f"Error broadcasting to client: {e}")
                disconnected.add(client)
        
        # Remove disconnected clients
        for client in disconnected:
            self.clients.discard(client)
    
    async def send_full_status(self, websocket):
        """Send complete current status to a client"""
        if not WEBSOCKETS_AVAILABLE:
            return
        
        status_data = {
            'type': 'full_status',
            'agents': list(self.agents.values()),
            'tasks': list(self.tasks.values()),
            'logs': self.logs[-100:],  # Last 100 logs
            'resources': self.system_resources,
            'claude_processes': list(self.claude_processes.values())
        }
        await self.send_to_client(websocket, status_data)
    
    async def broadcast_agents_update(self):
        """Broadcast agents update"""
        await self.broadcast({
            'type': 'agents_update',
            'agents': list(self.agents.values())
        })
    
    async def broadcast_log_entry(self, log_entry):
        """Broadcast new log entry"""
        await self.broadcast({
            'type': 'log_entry',
            'log': log_entry
        })
    
    async def broadcast_task_update(self, task):
        """Broadcast task update"""
        await self.broadcast({
            'type': 'task_update',
            'task': task
        })
    
    async def handle_client_message(self, websocket, message):
        """Handle incoming client messages"""
        if not WEBSOCKETS_AVAILABLE:
            return
        
        try:
            data = json.loads(message)
            msg_type = data.get('type')
            
            if msg_type == 'request_status':
                await self.send_full_status(websocket)
            elif msg_type == 'ping':
                await self.send_to_client(websocket, {'type': 'pong'})
            elif msg_type == 'request_claude_processes':
                await self.send_to_client(websocket, {
                    'type': 'claude_processes',
                    'processes': list(self.claude_processes.values())
                })
                
        except Exception as e:
            logger.error(f"Error handling client message: {e}")
            await self.send_to_client(websocket, {
                'type': 'error',
                'message': f"Error processing message: {str(e)}"
            })
    
    async def client_handler(self, websocket):
        """Handle WebSocket client connections"""
        if not WEBSOCKETS_AVAILABLE:
            return
        
        await self.register_client(websocket)
        try:
            async for message in websocket:
                await self.handle_client_message(websocket, message)
        except Exception as e:
            logger.error(f"WebSocket connection error: {e}")
        finally:
            await self.unregister_client(websocket)
    
    # File monitoring methods
    def start_file_monitoring(self):
        """Start monitoring log files for changes"""
        if self.logs_dir.exists():
            self.observer.schedule(self.log_handler, str(self.logs_dir), recursive=False)
            self.observer.start()
            logger.info(f"Started monitoring {self.logs_dir}")
    
    def stop_file_monitoring(self):
        """Stop file monitoring"""
        if self.observer.is_alive():
            self.observer.stop()
            self.observer.join()
    
    # Main operation methods
    async def start_websocket_server(self):
        """Start the WebSocket server"""
        if not WEBSOCKETS_AVAILABLE:
            logger.error("WebSocket server cannot start - websockets not available")
            return
        
        logger.info(f"Starting WebSocket server on port {self.port}")
        
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
        if serve is None:
            logger.error("WebSocket serve function not available")
            return
            
        server = serve(
            self.client_handler,
            "localhost",
            self.port,
            ping_interval=20,
            ping_timeout=10
        )
        
        logger.info(f"WebSocket server started at ws://localhost:{self.port}")
        logger.info(f"Monitoring project: {self.project_dir}")
        
        await server
    
    def run_monitoring_loop(self):
        """Run the monitoring loop without WebSocket server"""
        self.running = True
        logger.info("Starting monitoring loop (no WebSocket)")
        
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
                    logger.info(f"Detected {len(self.agents)} agents, {len(self.claude_processes)} Claude processes")
                
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
    
    async def periodic_updates(self):
        """Periodic updates for WebSocket mode"""
        while self.running:
            try:
                # Update system resources
                self.update_system_resources()
                if WEBSOCKETS_AVAILABLE and self.clients:
                    await self.broadcast({
                        'type': 'resource_update',
                        'resources': self.system_resources
                    })
                
                # Update agents using enhanced Claude process detection
                agents_changed = self.update_agents_from_processes()
                
                # Reload tasks from file
                self.load_tasks()
                
                # If task manager is available, sync with it
                if self.task_manager:
                    task_summary = self.task_manager.get_status_summary()
                    if WEBSOCKETS_AVAILABLE and self.clients:
                        await self.broadcast({
                            'type': 'task_manager_status',
                            'summary': task_summary
                        })
                
                await asyncio.sleep(5)  # Update every 5 seconds
                
            except Exception as e:
                logger.error(f"Error in periodic updates: {e}")
                await asyncio.sleep(5)
    
    def print_status_summary(self):
        """Print a status summary to console"""
        print(f"\n=== OpenCode Dashboard Status ===")
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
                print(f"  {proc_id}: {proc['type']} - {proc['activity']} (PID: {proc['pid']})")
        
        if self.agents:
            print(f"\nActive Agents:")
            for agent_id, agent in self.agents.items():
                print(f"  {agent_id}: {agent['status']} - {agent['task']} ({agent['progress']}%)")
        
        print("=" * 50)
    
    def shutdown(self):
        """Shutdown the server with cleanup"""
        logger.info("Shutting down dashboard server...")
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
    """Main entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Unified OpenCode Agent Dashboard Server')
    parser.add_argument('--port', '-p', type=int, default=8080,
                       help='WebSocket server port (default: 8080)')
    parser.add_argument('--project', type=str, default='.',
                       help='Project directory path')
    parser.add_argument('--monitor-only', action='store_true',
                       help='Run in monitoring mode only (no WebSocket server)')
    parser.add_argument('--websocket', action='store_true',
                       help='Force WebSocket mode (will fail if websockets not available)')
    
    args = parser.parse_args()
    
    server = UnifiedDashboardServer(args.project, args.port)
    
    # Handle shutdown gracefully
    def signal_handler(signum, frame):
        print("\nShutting down...")
        server.shutdown()
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # Decide which mode to run
    try:
        if args.websocket and not WEBSOCKETS_AVAILABLE:
            print("ERROR: --websocket specified but websockets not available")
            print("Install with: pip install websockets")
            sys.exit(1)
        elif args.monitor_only or not WEBSOCKETS_AVAILABLE:
            server.run_monitoring_loop()
        else:
            # WebSocket mode
            server.running = True
            asyncio.run(server.start_websocket_server())
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == '__main__':
    main()