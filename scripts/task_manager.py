#!/usr/bin/env python3
"""
OpenCode Agent Task Manager
Manages task lifecycle, queuing, and execution coordination
"""

import asyncio
import json
import time
import threading
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Callable, Union
from enum import Enum
import subprocess

try:
    from logger import StructuredLogger
    logger = StructuredLogger(__name__)
except ImportError:
    import logging
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

class TaskStatus(Enum):
    PENDING = "pending"
    QUEUED = "queued" 
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    RETRYING = "retrying"

class TaskPriority(Enum):
    LOW = 0
    MEDIUM = 1
    HIGH = 2
    CRITICAL = 3

class Task:
    """Represents a single task with full lifecycle management"""
    
    def __init__(self, task_data: Dict):
        self.id = task_data.get('id', f'task_{int(time.time())}')
        self.type = task_data.get('type', 'general')
        self.priority = TaskPriority[task_data.get('priority', 'MEDIUM').upper()]
        self.description = task_data.get('description', '')
        self.files_pattern = task_data.get('files_pattern', '**/*')
        
        # Execution state
        self.status = TaskStatus.PENDING
        self.progress = 0
        self.created_at = datetime.now()
        self.started_at: Optional[datetime] = None
        self.completed_at: Optional[datetime] = None
        self.error: Optional[str] = None
        self.retry_count = 0
        self.max_retries = 3
        
        # Process management
        self.process: Optional[subprocess.Popen] = None
        self.log_file: Optional[Path] = None
        self.estimated_duration = task_data.get('estimated_duration', 300)  # 5 minutes default
        
        # Callbacks
        self.on_status_change: Optional[Callable] = None
        self.on_progress_update: Optional[Callable] = None

    def to_dict(self) -> Dict:
        """Convert task to dictionary for serialization"""
        return {
            'id': self.id,
            'type': self.type,
            'priority': self.priority.name.lower(),
            'description': self.description,
            'files_pattern': self.files_pattern,
            'status': self.status.value,
            'progress': self.progress,
            'created_at': self.created_at.isoformat(),
            'started_at': self.started_at.isoformat() if self.started_at else None,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
            'error': self.error,
            'retry_count': self.retry_count,
            'max_retries': self.max_retries,
            'estimated_duration': self.estimated_duration
        }
    
    def update_status(self, status: TaskStatus, error: str = None):
        """Update task status and trigger callbacks"""
        old_status = self.status
        self.status = status
        
        if status == TaskStatus.RUNNING:
            self.started_at = datetime.now()
        elif status in [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED]:
            self.completed_at = datetime.now()
            if status == TaskStatus.FAILED:
                self.error = error
        
        if self.on_status_change and old_status != status:
            self.on_status_change(self, old_status, status)
    
    def update_progress(self, progress: int):
        """Update task progress"""
        old_progress = self.progress
        self.progress = max(0, min(100, progress))
        
        if self.on_progress_update and old_progress != self.progress:
            self.on_progress_update(self, old_progress, self.progress)

class TaskQueue:
    """Priority queue for managing task execution order"""
    
    def __init__(self):
        self.tasks: List[Task] = []
        self.lock = threading.Lock()
    
    def add_task(self, task: Task):
        """Add task to queue in priority order"""
        with self.lock:
            # Insert in priority order (higher priority first)
            inserted = False
            for i, existing_task in enumerate(self.tasks):
                if task.priority.value > existing_task.priority.value:
                    self.tasks.insert(i, task)
                    inserted = True
                    break
            
            if not inserted:
                self.tasks.append(task)
            
            task.update_status(TaskStatus.QUEUED)
    
    def get_next_task(self) -> Optional[Task]:
        """Get the next task to execute"""
        with self.lock:
            for task in self.tasks:
                if task.status == TaskStatus.QUEUED:
                    return task
            return None
    
    def remove_task(self, task_id: str) -> bool:
        """Remove task from queue"""
        with self.lock:
            for i, task in enumerate(self.tasks):
                if task.id == task_id:
                    del self.tasks[i]
                    return True
            return False
    
    def get_tasks_by_status(self, status: TaskStatus) -> List[Task]:
        """Get all tasks with specific status"""
        with self.lock:
            return [task for task in self.tasks if task.status == status]
    
    def get_all_tasks(self) -> List[Task]:
        """Get all tasks"""
        with self.lock:
            return self.tasks.copy()

class TaskManager:
    """Central task management system"""
    
    def __init__(self, project_dir: Optional[str] = None, max_concurrent: int = 4):
        self.project_dir = Path(project_dir or ".")
        self.claude_dir = self.project_dir / ".claude" 
        self.logs_dir = self.claude_dir / "logs"
        self.tasks_file = self.claude_dir / "tasks.json"
        self.status_file = self.claude_dir / "task_status.json"
        
        self.max_concurrent = max_concurrent
        self.queue = TaskQueue()
        self.running_tasks: Dict[str, Task] = {}
        self.completed_tasks: Dict[str, Task] = {}
        
        # Event callbacks
        self.status_callbacks: List[Callable] = []
        self.progress_callbacks: List[Callable] = []
        
        # Execution control
        self.is_running = False
        self.executor_thread: Optional[threading.Thread] = None
        
        # Progress tracking
        self.progress_trackers: Dict[str, threading.Thread] = {}
        
        # Ensure directories exist
        self.claude_dir.mkdir(exist_ok=True)
        self.logs_dir.mkdir(exist_ok=True)
    
    def add_status_callback(self, callback: Callable):
        """Add callback for status changes"""
        self.status_callbacks.append(callback)
    
    def add_progress_callback(self, callback: Callable):
        """Add callback for progress updates"""
        self.progress_callbacks.append(callback)
    
    def _notify_status_change(self, task: Task, old_status: TaskStatus, new_status: TaskStatus):
        """Notify all callbacks of status change"""
        for callback in self.status_callbacks:
            try:
                callback(task, old_status, new_status)
            except Exception as e:
                logger.error(f"Error in status callback: {e}")
    
    def _notify_progress_update(self, task: Task, old_progress: int, new_progress: int):
        """Notify all callbacks of progress update"""
        for callback in self.progress_callbacks:
            try:
                callback(task, old_progress, new_progress)
            except Exception as e:
                logger.error(f"Error in progress callback: {e}")
    
    def load_tasks_from_file(self) -> List[Task]:
        """Load tasks from tasks.json file"""
        tasks = []
        if self.tasks_file.exists():
            try:
                with open(self.tasks_file, 'r') as f:
                    data = json.load(f)
                    task_list = data.get('tasks', [])
                    
                    for task_data in task_list:
                        task = Task(task_data)
                        task.on_status_change = self._notify_status_change
                        task.on_progress_update = self._notify_progress_update
                        tasks.append(task)
                        
            except Exception as e:
                logger.error(f"Error loading tasks: {e}")
        
        return tasks
    
    def save_task_status(self):
        """Save current task status to file"""
        try:
            status_data = {
                'updated_at': datetime.now().isoformat(),
                'running_tasks': [task.to_dict() for task in self.running_tasks.values()],
                'queued_tasks': [task.to_dict() for task in self.queue.get_tasks_by_status(TaskStatus.QUEUED)],
                'completed_tasks': [task.to_dict() for task in self.completed_tasks.values()]
            }
            
            with open(self.status_file, 'w') as f:
                json.dump(status_data, f, indent=2)
                
        except Exception as e:
            logger.error(f"Error saving task status: {e}")
    
    def add_task(self, task_data: Dict) -> Task:
        """Add a new task"""
        task = Task(task_data)
        task.on_status_change = self._notify_status_change  
        task.on_progress_update = self._notify_progress_update
        
        self.queue.add_task(task)
        self.save_task_status()
        logger.info(f"Added task {task.id} to queue")
        
        return task
    
    def cancel_task(self, task_id: str) -> bool:
        """Cancel a task"""
        # Check running tasks
        if task_id in self.running_tasks:
            task = self.running_tasks[task_id]
            if task.process and task.process.poll() is None:
                task.process.terminate()
            task.update_status(TaskStatus.CANCELLED)
            del self.running_tasks[task_id]
            self.save_task_status()
            return True
        
        # Check queued tasks
        for task in self.queue.get_all_tasks():
            if task.id == task_id and task.status == TaskStatus.QUEUED:
                task.update_status(TaskStatus.CANCELLED)
                self.queue.remove_task(task_id)
                self.save_task_status()
                return True
        
        return False
    
    def retry_task(self, task_id: str) -> bool:
        """Retry a failed task"""
        task = self.completed_tasks.get(task_id)
        if task and task.status == TaskStatus.FAILED and task.retry_count < task.max_retries:
            task.retry_count += 1
            task.error = None
            task.progress = 0
            task.update_status(TaskStatus.RETRYING)
            
            # Re-queue the task
            self.queue.add_task(task)
            if task_id in self.completed_tasks:
                del self.completed_tasks[task_id]
            
            self.save_task_status()
            logger.info(f"Retrying task {task_id} (attempt {task.retry_count})")
            return True
        
        return False
    
    def start_task_execution(self, task: Task) -> bool:
        """Start executing a task"""
        try:
            log_file = self.logs_dir / f"{task.id}.log"
            task.log_file = log_file
            
            # Prepare the command
            prompt = f"""
Task: {task.description}
Type: {task.type}
Priority: {task.priority.name.lower()}
Files to examine: {task.files_pattern}

Please analyze the code and implement improvements.
"""
            
            cmd = ['opencode', 'run', prompt]
            
            # Start the process
            with open(log_file, 'w') as log:
                task.process = subprocess.Popen(
                    cmd,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    cwd=str(self.project_dir)
                )
            
            task.update_status(TaskStatus.RUNNING)
            self.running_tasks[task.id] = task
            
            # Start progress tracking
            self.start_progress_tracking(task)
            
            logger.info(f"Started task {task.id} (PID: {task.process.pid})")
            return True
            
        except Exception as e:
            task.update_status(TaskStatus.FAILED, str(e))
            logger.error(f"Failed to start task {task.id}: {e}")
            return False
    
    def start_progress_tracking(self, task: Task):
        """Start tracking progress for a task"""
        def track_progress():
            while task.status == TaskStatus.RUNNING:
                try:
                    # Estimate progress based on log file size and content
                    if task.log_file and task.log_file.exists():
                        with open(task.log_file, 'r') as f:
                            content = f.read()
                            lines = len(content.splitlines())
                            
                            # Simple heuristic for progress estimation
                            if 'completed successfully' in content.lower():
                                task.update_progress(100)
                                break
                            elif 'error' in content.lower() or 'failed' in content.lower():
                                break
                            else:
                                # Estimate based on log lines and time elapsed
                                if task.started_at:
                                    elapsed = (datetime.now() - task.started_at).total_seconds()
                                    time_progress = min(90, (elapsed / task.estimated_duration) * 100)
                                    line_progress = min(80, lines * 2)
                                    
                                    estimated_progress = max(time_progress, line_progress)
                                    task.update_progress(int(estimated_progress))
                    
                    time.sleep(5)  # Check every 5 seconds
                    
                except Exception as e:
                    logger.error(f"Error tracking progress for {task.id}: {e}")
                    break
        
        tracker_thread = threading.Thread(target=track_progress, daemon=True)
        tracker_thread.start()
        self.progress_trackers[task.id] = tracker_thread
    
    def check_running_tasks(self):
        """Check status of running tasks"""
        for task_id, task in list(self.running_tasks.items()):
            if task.process:
                return_code = task.process.poll()
                if return_code is not None:
                    # Process completed
                    if return_code == 0:
                        task.update_status(TaskStatus.COMPLETED)
                        task.update_progress(100)
                    else:
                        # Check log for error details
                        error_msg = "Process failed"
                        if task.log_file and task.log_file.exists():
                            try:
                                with open(task.log_file, 'r') as f:
                                    content = f.read()
                                    lines = content.splitlines()
                                    for line in reversed(lines):
                                        if any(word in line.lower() for word in ['error', 'failed', 'exception']):
                                            error_msg = line.strip()[:200]
                                            break
                            except Exception:
                                pass
                        
                        task.update_status(TaskStatus.FAILED, error_msg)
                    
                    # Move to completed
                    self.completed_tasks[task_id] = task
                    del self.running_tasks[task_id]
                    
                    # Clean up progress tracker
                    if task_id in self.progress_trackers:
                        del self.progress_trackers[task_id]
    
    def executor_loop(self):
        """Main executor loop"""
        while self.is_running:
            try:
                # Check running tasks
                self.check_running_tasks()
                
                # Start new tasks if slots available
                while len(self.running_tasks) < self.max_concurrent and self.is_running:
                    next_task = self.queue.get_next_task()
                    if next_task is None:
                        break
                    
                    if self.start_task_execution(next_task):
                        self.queue.remove_task(next_task.id)
                    
                    time.sleep(1)  # Small delay between starts
                
                # Save status periodically
                self.save_task_status()
                
                time.sleep(2)  # Main loop delay
                
            except Exception as e:
                logger.error(f"Error in executor loop: {e}")
                time.sleep(5)
    
    def start(self):
        """Start the task manager"""
        if self.is_running:
            return
        
        logger.info("Starting task manager")
        self.is_running = True
        
        # Load existing tasks
        tasks = self.load_tasks_from_file()
        for task in tasks:
            self.queue.add_task(task)
        
        # Start executor thread
        self.executor_thread = threading.Thread(target=self.executor_loop, daemon=True)
        self.executor_thread.start()
    
    def stop(self):
        """Stop the task manager"""
        if not self.is_running:
            return
        
        logger.info("Stopping task manager")
        self.is_running = False
        
        # Cancel running tasks
        for task in list(self.running_tasks.values()):
            if task.process and task.process.poll() is None:
                task.process.terminate()
            task.update_status(TaskStatus.CANCELLED)
        
        # Wait for executor thread
        if self.executor_thread and self.executor_thread.is_alive():
            self.executor_thread.join(timeout=10)
        
        self.save_task_status()
    
    def get_status_summary(self) -> Dict:
        """Get overall status summary"""
        all_tasks = (
            list(self.running_tasks.values()) +
            list(self.completed_tasks.values()) +
            self.queue.get_all_tasks()
        )
        
        status_counts = {}
        for status in TaskStatus:
            status_counts[status.value] = len([t for t in all_tasks if t.status == status])
        
        return {
            'total_tasks': len(all_tasks),
            'running': len(self.running_tasks),
            'queued': len(self.queue.get_tasks_by_status(TaskStatus.QUEUED)),
            'completed': len([t for t in all_tasks if t.status == TaskStatus.COMPLETED]),
            'failed': len([t for t in all_tasks if t.status == TaskStatus.FAILED]),
            'status_breakdown': status_counts,
            'max_concurrent': self.max_concurrent
        }

def main():
    """Test the task manager"""
    import argparse
    
    parser = argparse.ArgumentParser(description='OpenCode Task Manager')
    parser.add_argument('--project', '-p', default='.', help='Project directory')
    parser.add_argument('--max-concurrent', '-m', type=int, default=4, help='Max concurrent tasks')
    
    args = parser.parse_args()
    
    manager = TaskManager(args.project, args.max_concurrent)
    
    # Add some test tasks
    test_tasks = [
        {
            'id': f'test_task_1_{int(time.time())}',
            'type': 'testing',
            'priority': 'high',
            'description': 'Run comprehensive tests',
            'files_pattern': '**/*.py'
        },
        {
            'id': f'test_task_2_{int(time.time())}',
            'type': 'security',
            'priority': 'medium', 
            'description': 'Security audit',
            'files_pattern': '**/*'
        }
    ]
    
    for task_data in test_tasks:
        manager.add_task(task_data)
    
    # Add status callback for logging
    def status_callback(task, old_status, new_status):
        logger.info(f"Task {task.id} status: {old_status.value} -> {new_status.value}")
    
    manager.add_status_callback(status_callback)
    
    try:
        manager.start()
        logger.info("Task manager started. Press Ctrl+C to stop.")
        
        while True:
            time.sleep(1)
            
    except KeyboardInterrupt:
        logger.info("Shutting down...")
        manager.stop()

if __name__ == '__main__':
    main()