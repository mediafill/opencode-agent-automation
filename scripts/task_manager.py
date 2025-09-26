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
from typing import Dict, List, Optional, Callable, Union, Any, Set
from enum import Enum
import subprocess

try:
    from logger import StructuredLogger

    logger = StructuredLogger(__name__)
except ImportError:
    import logging

    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

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
        self.id = task_data.get("id", f"task_{int(time.time())}")
        self.type = task_data.get("type", "general")
        self.priority = TaskPriority[task_data.get("priority", "MEDIUM").upper()]
        self.description = task_data.get("description", "")
        self.files_pattern = task_data.get("files_pattern", "**/*")

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
        self.estimated_duration = task_data.get(
            "estimated_duration", 300
        )  # 5 minutes default

        # Callbacks
        self.on_status_change: Optional[Callable] = None
        self.on_progress_update: Optional[Callable] = None

    def to_dict(self) -> Dict:
        """Convert task to dictionary for serialization"""
        return {
            "id": self.id,
            "type": self.type,
            "priority": self.priority.name.lower(),
            "description": self.description,
            "files_pattern": self.files_pattern,
            "status": self.status.value,
            "progress": self.progress,
            "created_at": self.created_at.isoformat(),
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": (
                self.completed_at.isoformat() if self.completed_at else None
            ),
            "error": self.error,
            "retry_count": self.retry_count,
            "max_retries": self.max_retries,
            "estimated_duration": self.estimated_duration,
        }

    def update_status(self, status: TaskStatus, error: Optional[str] = None):
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
    """Priority queue for managing task execution order with optimized operations"""

    def __init__(self):
        self.tasks: List[Task] = []
        self.task_index: Dict[str, int] = {}  # For O(1) lookups
        self.lock = threading.Lock()

    def add_task(self, task: Task):
        """Add task to queue in priority order with O(log n) insertion"""
        with self.lock:
            # Use binary search to find the correct insertion point for priority ordering
            # Tasks are ordered by priority value (lower value = higher priority)
            # This ensures higher priority tasks are processed first
            left, right = 0, len(self.tasks)
            while left < right:
                mid = (left + right) // 2
                if task.priority.value > self.tasks[mid].priority.value:
                    right = mid
                else:
                    left = mid + 1

            # Insert at the correct position
            self.tasks.insert(left, task)
            # Update indices for all tasks after insertion point
            for i in range(left, len(self.tasks)):
                self.task_index[self.tasks[i].id] = i

            task.update_status(TaskStatus.QUEUED)

    def get_next_task(self) -> Optional[Task]:
        """Get the next task to execute - O(1) operation"""
        with self.lock:
            for task in self.tasks:
                if task.status == TaskStatus.QUEUED:
                    return task
            return None

    def remove_task(self, task_id: str) -> bool:
        """Remove task from queue - O(1) lookup, O(n) removal"""
        with self.lock:
            if task_id in self.task_index:
                index = self.task_index[task_id]
                removed_task = self.tasks.pop(index)

                # Update indices for remaining tasks
                del self.task_index[task_id]
                for i in range(index, len(self.tasks)):
                    self.task_index[self.tasks[i].id] = i

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
    """Central task management system with optimized caching"""

    def __init__(self, project_dir: Optional[str] = None, max_concurrent: int = 4):
        try:
            self.project_dir = Path(project_dir or ".")
            self.claude_dir = self.project_dir / ".claude"
            self.logs_dir = self.claude_dir / "logs"
            self.tasks_file = self.claude_dir / "tasks.json"
            self.status_file = self.claude_dir / "task_status.json"

            self.max_concurrent = max(1, min(max_concurrent, 10))  # Reasonable bounds
            self.queue = TaskQueue()
            self.running_tasks: Dict[str, Task] = {}
            self.completed_tasks: Dict[str, Task] = {}

            # Event callbacks
            self.status_callbacks: List[Callable] = []
            self.progress_callbacks: List[Callable] = []

            # Progress tracking
            self.progress_trackers: Dict[str, threading.Thread] = {}

            # Caching system for performance optimization
            self._tasks_cache: Optional[Dict] = None
            self._status_cache: Optional[Dict] = None
            self._cache_timestamps: Dict[str, float] = {}
            self._cache_ttl = 30  # Cache TTL in seconds
            self._cache_lock = threading.Lock()

            # Content caching for performance
            self._content_cache: Dict[str, str] = {}
            self._file_positions: Dict[str, int] = {}

            # Indexing system for fast lookups
            self._task_index: Dict[str, Task] = {}  # task_id -> Task
            self._status_index: Dict[str, Set[str]] = {}  # status -> set of task_ids
            self._priority_index: Dict[int, Set[str]] = (
                {}
            )  # priority_value -> set of task_ids
            self._index_lock = threading.Lock()

            # Ensure directories exist
            self.claude_dir.mkdir(exist_ok=True)
            self.logs_dir.mkdir(exist_ok=True)

            # Initialize running state
            self.is_running = False
            self.executor_thread = None

        except (OSError, ValueError, TypeError) as e:
            logger.error(f"Failed to initialize TaskManager: {e}")
            raise RuntimeError(f"TaskManager initialization failed: {e}")

    def add_status_callback(self, callback: Callable):
        """Add callback for status changes"""
        self.status_callbacks.append(callback)

    def add_progress_callback(self, callback: Callable):
        """Add callback for progress updates"""
        self.progress_callbacks.append(callback)

    def _notify_status_change(
        self, task: Task, old_status: TaskStatus, new_status: TaskStatus
    ):
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

    def _is_cache_valid(self, cache_key: str) -> bool:
        """Check if cache entry is still valid"""
        if cache_key not in self._cache_timestamps:
            return False
        return (time.time() - self._cache_timestamps[cache_key]) < self._cache_ttl

    def _get_cached_data(self, file_path: Path, cache_key: str) -> Optional[Dict]:
        """Get data from intelligent cache or load from file"""
        if not CACHE_AVAILABLE:
            # Fallback to basic caching if intelligent cache not available
            return self._get_basic_cached_data(file_path, cache_key)

        try:
            # Use intelligent cache with appropriate TTL based on cache type
            cache = get_cache()
            cache_type = 'task' if cache_key == 'tasks' else 'system'
            key = f"{cache_key}_{file_path.name}"

            # Try to get from cache first
            cached_data = cache.get(key)
            if cached_data is not None:
                return cached_data

            # Load from file and cache it
            if file_path.exists():
                with open(file_path, 'r') as f:
                    data = json.load(f)
                    cache.set(key, data, cache_type=cache_type)
                    return data
        except Exception as e:
            logger.warning(f"Error using intelligent cache for {cache_key}: {e}")
            # Fallback to basic caching
            return self._get_basic_cached_data(file_path, cache_key)

        return None

    def _get_basic_cached_data(self, file_path: Path, cache_key: str) -> Optional[Dict]:
        """Basic caching fallback when intelligent cache is not available"""
        with self._cache_lock:
            if self._is_cache_valid(cache_key):
                if cache_key == 'tasks':
                    return self._tasks_cache
                elif cache_key == 'status':
                    return self._status_cache

            # Load from file
            try:
                if file_path.exists():
                    with open(file_path, 'r') as f:
                        data = json.load(f)
                        self._cache_timestamps[cache_key] = time.time()
                        if cache_key == 'tasks':
                            self._tasks_cache = data
                        elif cache_key == 'status':
                            self._status_cache = data
                        return data
            except Exception as e:
                logger.error(f"Error loading {cache_key} from {file_path}: {e}")

            return None

    def _get_cached_content(self, task_id: str) -> Optional[str]:
        """Get cached content for a task"""
        return self._content_cache.get(task_id)

    def _update_cached_content(self, task_id: str, content: str):
        """Update cached content for a task"""
        self._content_cache[task_id] = content

    def _invalidate_cache(self, cache_key: str):
        """Invalidate specific cache entry in both intelligent and basic caches"""
        # Invalidate intelligent cache
        if CACHE_AVAILABLE:
            try:
                cache = get_cache()
                # Clear all entries with this cache_key prefix
                cache.clear(f"{cache_key}_")
            except Exception as e:
                logger.warning(f"Could not invalidate intelligent cache for {cache_key}: {e}")

        # Also invalidate basic cache as fallback
        with self._cache_lock:
            if cache_key == "tasks":
                self._tasks_cache = None
            elif cache_key == "status":
                self._status_cache = None
            if cache_key in self._cache_timestamps:
                del self._cache_timestamps[cache_key]

    def load_tasks_from_file(self) -> List[Task]:
        """Load tasks from tasks.json file with intelligent caching"""
        data = self._get_cached_data(self.tasks_file, "tasks")
        if data is None:
            return []

        tasks = []
        task_list = data.get("tasks", [])

        for task_data in task_list:
            task = Task(task_data)
            task.on_status_change = self._notify_status_change
            task.on_progress_update = self._notify_progress_update
            tasks.append(task)

        return tasks

    def save_task_status(self):
        """Save current task status to file and invalidate cache"""
        try:
            status_data = {
                "updated_at": datetime.now().isoformat(),
                "running_tasks": [
                    task.to_dict() for task in self.running_tasks.values()
                ],
                "queued_tasks": [
                    task.to_dict()
                    for task in self.queue.get_tasks_by_status(TaskStatus.QUEUED)
                ],
                "completed_tasks": [
                    task.to_dict() for task in self.completed_tasks.values()
                ],
            }

            with open(self.status_file, "w") as f:
                json.dump(status_data, f, indent=2)

            # Invalidate cache
            self._invalidate_cache("status")

        except Exception as e:
            logger.error(f"Error saving task status: {e}")

    def add_task(self, task_data: Dict) -> Task:
        """Add a new task and invalidate tasks cache"""
        task = Task(task_data)
        task.on_status_change = self._notify_status_change
        task.on_progress_update = self._notify_progress_update

        self.queue.add_task(task)
        self.save_task_status()

        # Invalidate tasks cache since we might save tasks too
        self._invalidate_cache("tasks")
        if CACHE_AVAILABLE:
            try:
                # Try to call invalidate_task_cache if it was imported
                globals().get("invalidate_task_cache", lambda: None)()
            except Exception as e:
                logger.warning(f"Could not invalidate external task cache: {e}")

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
        if (
            task
            and task.status == TaskStatus.FAILED
            and task.retry_count < task.max_retries
        ):
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

            cmd = ["opencode", "run", prompt]

            # Start the process
            with open(log_file, "w") as log:
                task.process = subprocess.Popen(
                    cmd, stdout=log, stderr=subprocess.STDOUT, cwd=str(self.project_dir)
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
        """Start tracking progress for a task with optimized incremental file reading"""

        def track_progress():
            last_mtime = 0
            file_position = self._file_positions.get(task.id, 0)

            while task.status == TaskStatus.RUNNING:
                try:
                    # Check if log file exists and has been modified
                    if task.log_file and task.log_file.exists():
                        current_mtime = task.log_file.stat().st_mtime
                        if current_mtime > last_mtime:
                            # File has been modified, read only new content incrementally
                            # This avoids re-reading the entire file on each check
                            with open(task.log_file, "r") as f:
                                f.seek(file_position)
                                new_content = f.read()
                                if new_content:
                                    file_position = f.tell()
                                    self._file_positions[task.id] = file_position

                                    # Get existing cached content and append new content
                                    existing_content = (
                                        self._get_cached_content(task.id) or ""
                                    )
                                    full_content = existing_content + new_content
                                    self._update_cached_content(task.id, full_content)

                                    lines = len(full_content.splitlines())

                                    # Estimate progress based on multiple heuristics
                                    if "completed successfully" in full_content.lower():
                                        task.update_progress(100)
                                        break
                                    elif (
                                        "error" in full_content.lower()
                                        or "failed" in full_content.lower()
                                    ):
                                        break
                                    else:
                                        # Estimate based on log lines and time elapsed
                                        if task.started_at:
                                            elapsed = (
                                                datetime.now() - task.started_at
                                            ).total_seconds()
                                            time_progress = min(
                                                90,
                                                (elapsed / task.estimated_duration)
                                                * 100,
                                            )
                                            line_progress = min(80, lines * 2)

                                            estimated_progress = max(
                                                time_progress, line_progress
                                            )
                                            task.update_progress(
                                                int(estimated_progress)
                                            )

                                last_mtime = current_mtime

                    time.sleep(15)  # Increased from 10 to 15 seconds

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
                                with open(task.log_file, "r") as f:
                                    content = f.read()
                                    lines = content.splitlines()
                                    for line in reversed(lines):
                                        if any(
                                            word in line.lower()
                                            for word in ["error", "failed", "exception"]
                                        ):
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
            list(self.running_tasks.values())
            + list(self.completed_tasks.values())
            + self.queue.get_all_tasks()
        )

        status_counts = {}
        for status in TaskStatus:
            status_counts[status.value] = len(
                [t for t in all_tasks if t.status == status]
            )

        return {
            "total_tasks": len(all_tasks),
            "running": len(self.running_tasks),
            "queued": len(self.queue.get_tasks_by_status(TaskStatus.QUEUED)),
            "completed": len(
                [t for t in all_tasks if t.status == TaskStatus.COMPLETED]
            ),
            "failed": len([t for t in all_tasks if t.status == TaskStatus.FAILED]),
            "status_breakdown": status_counts,
            "max_concurrent": self.max_concurrent,
        }


def main():
    """Test the task manager"""
    try:
        import argparse

        parser = argparse.ArgumentParser(description="OpenCode Task Manager")
        parser.add_argument("--project", "-p", default=".", help="Project directory")
        parser.add_argument(
            "--max-concurrent", "-m", type=int, default=4, help="Max concurrent tasks"
        )

        args = parser.parse_args()

        try:
            manager = TaskManager(args.project, args.max_concurrent)
        except Exception as e:
            logger.error(f"Failed to create TaskManager: {e}")
            return

        # Add some test tasks
        test_tasks = [
            {
                "id": f"test_task_1_{int(time.time())}",
                "type": "testing",
                "priority": "high",
                "description": "Run comprehensive tests",
                "files_pattern": "**/*.py",
            },
            {
                "id": f"test_task_2_{int(time.time())}",
                "type": "security",
                "priority": "medium",
                "description": "Security audit",
                "files_pattern": "**/*",
            },
        ]

        for task_data in test_tasks:
            try:
                manager.add_task(task_data)
            except Exception as e:
                logger.error(
                    f"Failed to add task {task_data.get('id', 'unknown')}: {e}"
                )
                continue

        # Add status callback for logging
        def status_callback(task, old_status, new_status):
            logger.info(
                f"Task {task.id} status: {old_status.value} -> {new_status.value}"
            )

        manager.add_status_callback(status_callback)

        try:
            manager.start()
            logger.info("Task manager started. Press Ctrl+C to stop.")

            while True:
                time.sleep(1)

        except KeyboardInterrupt:
            logger.info("Shutting down...")
            manager.stop()

    except Exception as e:
        logger.error(f"Fatal error in main: {e}")
        import sys

        sys.exit(1)


if __name__ == "__main__":
    main()
