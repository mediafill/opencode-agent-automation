#!/usr/bin/env python3
"""
OpenCode Agent Dashboard WebSocket Server
Provides real-time data to the web dashboard
"""

import asyncio
import websockets
import json
import os
import time
import psutil
import subprocess
import threading
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Set, Optional
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

try:
    from logger import StructuredLogger
    logger = StructuredLogger(__name__)
except ImportError:
    import logging
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

class LogFileHandler(FileSystemEventHandler):
    """Handles log file changes and broadcasts updates"""
    
    def __init__(self, server):
        self.server = server
        self.last_positions = {}
    
    def on_modified(self, event):
        if event.is_directory or not event.src_path.endswith('.log'):
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
                            self.server.broadcast_log_entry(file_path, line)
        
        except Exception as e:
            logger.error(f"Error processing log file {file_path}: {e}")

class DashboardServer:
    """WebSocket server for the OpenCode agent dashboard"""
    
    def __init__(self, project_dir: str = None, port: int = 8080):
        self.project_dir = Path(project_dir or os.getcwd())
        self.claude_dir = self.project_dir / '.claude'
        self.logs_dir = self.claude_dir / 'logs'
        self.tasks_file = self.claude_dir / 'tasks.json'
        self.port = port
        
        # WebSocket connections
        self.clients: Set[websockets.WebSocketServerProtocol] = set()
        
        # Data storage
        self.agents = {}
        self.tasks = {}
        self.logs = []
        self.system_resources = {}
        
        # File monitoring
        self.observer = Observer()
        self.log_handler = LogFileHandler(self)
        
        # Ensure directories exist
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        
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
            'type': 'full_status',
            'agents': list(self.agents.values()),
            'tasks': list(self.tasks.values()),
            'logs': self.logs[-100:],  # Last 100 logs
            'resources': self.system_resources
        }
        await self.send_to_client(websocket, status_data)
        
    def load_tasks(self):
        """Load tasks from tasks.json file"""
        try:
            if self.tasks_file.exists():
                with open(self.tasks_file, 'r') as f:
                    data = json.load(f)
                    tasks_list = data.get('tasks', [])
                    
                    # Convert to dict keyed by ID and add runtime status
                    for task in tasks_list:
                        task_id = task.get('id')
                        if task_id:
                            # Check if task is currently running
                            status = self.get_task_runtime_status(task_id)
                            task['runtime_status'] = status
                            self.tasks[task_id] = task
                            
        except Exception as e:
            logger.error(f"Error loading tasks: {e}")
            
    def get_task_runtime_status(self, task_id: str) -> str:
        """Get runtime status of a task by checking processes and logs"""
        # Check if there's a running process for this task
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
        
    def update_system_resources(self):
        """Update system resource information"""
        try:
            cpu_percent = psutil.cpu_percent(interval=1)
            memory = psutil.virtual_memory()
            disk = psutil.disk_usage('/')
            
            # Count active OpenCode processes
            active_processes = 0
            for proc in psutil.process_iter(['pid', 'cmdline']):
                try:
                    cmdline = ' '.join(proc.info['cmdline'] or [])
                    if 'opencode run' in cmdline.lower():
                        active_processes += 1
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
            
            self.system_resources = {
                'cpu_usage': cpu_percent,
                'memory_usage': memory.percent,
                'memory_used': memory.used,
                'memory_total': memory.total,
                'disk_usage': disk.percent,
                'disk_used': disk.used,
                'disk_total': disk.total,
                'active_processes': active_processes,
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Error updating system resources: {e}")
            
    def update_agents_from_processes(self):
        """Update agent information from running processes and logs"""
        current_agents = {}
        
        # Find running OpenCode processes
        for proc in psutil.process_iter(['pid', 'cmdline', 'create_time', 'memory_info']):
            try:
                cmdline = ' '.join(proc.info['cmdline'] or [])
                if 'opencode run' in cmdline.lower():
                    # Extract task info from command line
                    agent_id = f"agent_{proc.info['pid']}"
                    
                    # Try to match with existing tasks
                    task_desc = "Unknown task"
                    task_type = "general"
                    
                    for task_id, task in self.tasks.items():
                        if task_id in cmdline:
                            task_desc = task.get('description', task_desc)
                            task_type = task.get('type', task_type)
                            agent_id = task_id
                            break
                    
                    current_agents[agent_id] = {
                        'id': agent_id,
                        'pid': proc.info['pid'],
                        'status': 'running',
                        'type': task_type,
                        'task': task_desc,
                        'start_time': datetime.fromtimestamp(proc.info['create_time']).isoformat(),
                        'memory_usage': proc.info['memory_info'].rss if proc.info['memory_info'] else 0,
                        'progress': self.estimate_progress(agent_id)
                    }
                    
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        
        # Check for completed tasks in logs
        if self.logs_dir.exists():
            for log_file in self.logs_dir.glob('*.log'):
                task_id = log_file.stem
                if task_id not in current_agents:
                    # Check if this task was completed
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
                                    'progress': 100 if 'completed successfully' in content.lower() else 0
                                }
                                
                                if any(word in content.lower() for word in ['error', 'failed', 'exception']):
                                    agent['status'] = 'error'
                                    agent['error'] = self.extract_error_message(content)
                                
                                current_agents[task_id] = agent
                    except Exception as e:
                        logger.error(f"Error reading log file {log_file}: {e}")
        
        # Update agents and broadcast changes
        changed = False
        for agent_id, agent_data in current_agents.items():
            if agent_id not in self.agents or self.agents[agent_id] != agent_data:
                self.agents[agent_id] = agent_data
                changed = True
                asyncio.create_task(self.broadcast({
                    'type': 'agent_update',
                    'agent': agent_data
                }))
        
        # Remove agents that are no longer active
        for agent_id in list(self.agents.keys()):
            if agent_id not in current_agents:
                del self.agents[agent_id]
                changed = True
                
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
                # Cap at 90% unless explicitly completed
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
        
    def broadcast_log_entry(self, file_path: str, line: str):
        """Broadcast a new log entry to all clients"""
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
            
        # Broadcast to clients
        asyncio.create_task(self.broadcast({
            'type': 'log_entry',
            'log': log_entry
        }))
        
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
            
    async def handle_client_message(self, websocket, message):
        """Handle incoming client messages"""
        try:
            data = json.loads(message)
            msg_type = data.get('type')
            
            if msg_type == 'request_status':
                await self.send_full_status(websocket)
            elif msg_type == 'ping':
                await self.send_to_client(websocket, {'type': 'pong'})
                
        except Exception as e:
            logger.error(f"Error handling client message: {e}")
            
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
            self.observer.schedule(self.log_handler, str(self.logs_dir), recursive=False)
            self.observer.start()
            logger.info(f"Started monitoring {self.logs_dir}")
            
    def stop_file_monitoring(self):
        """Stop file monitoring"""
        self.observer.stop()
        self.observer.join()
        
    async def periodic_updates(self):
        """Periodic updates for system resources and agent status"""
        while True:
            try:
                # Update system resources
                self.update_system_resources()
                await self.broadcast({
                    'type': 'resource_update',
                    'resources': self.system_resources
                })
                
                # Update agents
                self.update_agents_from_processes()
                
                # Reload tasks
                self.load_tasks()
                
                await asyncio.sleep(5)  # Update every 5 seconds
                
            except Exception as e:
                logger.error(f"Error in periodic updates: {e}")
                await asyncio.sleep(5)
                
    async def start_server(self):
        """Start the WebSocket server"""
        logger.info(f"Starting dashboard server on port {self.port}")
        
        # Initial data load
        self.load_tasks()
        self.update_system_resources()
        self.update_agents_from_processes()
        
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
            ping_timeout=10
        )
        
        logger.info(f"Dashboard server started at ws://localhost:{self.port}/ws")
        logger.info(f"Monitoring project: {self.project_dir}")
        
        await start_server
        
    def shutdown(self):
        """Shutdown the server"""
        logger.info("Shutting down dashboard server...")
        self.stop_file_monitoring()

def main():
    """Main entry point"""
    import argparse
    import signal
    
    parser = argparse.ArgumentParser(description='OpenCode Agent Dashboard Server')
    parser.add_argument('--port', '-p', type=int, default=8080,
                       help='WebSocket server port (default: 8080)')
    parser.add_argument('--project', type=str, default='.',
                       help='Project directory path')
    
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

if __name__ == '__main__':
    main()