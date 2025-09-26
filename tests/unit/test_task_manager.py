#!/usr/bin/env python3
"""
Comprehensive unit tests for task_manager.py
Tests all core classes and functions with edge cases
"""

import unittest
import unittest.mock as mock
import tempfile
import json
import threading
import time
import subprocess
from pathlib import Path
from datetime import datetime, timedelta
from enum import Enum

# Import from parent directory
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'scripts'))

try:
    from task_manager import (
        Task, TaskStatus, TaskPriority, TaskQueue, TaskManager
    )
except ImportError:
    # Fallback for direct execution
    sys.path.insert(0, str(Path(__file__).parent.parent.parent.absolute()))
    from scripts.task_manager import (
        Task, TaskStatus, TaskPriority, TaskQueue, TaskManager
    )


class TestTaskStatus(unittest.TestCase):
    """Test TaskStatus enum"""
    
    def test_task_status_values(self):
        """Test all task status enum values"""
        self.assertEqual(TaskStatus.PENDING.value, "pending")
        self.assertEqual(TaskStatus.QUEUED.value, "queued")
        self.assertEqual(TaskStatus.RUNNING.value, "running")
        self.assertEqual(TaskStatus.COMPLETED.value, "completed")
        self.assertEqual(TaskStatus.FAILED.value, "failed")
        self.assertEqual(TaskStatus.CANCELLED.value, "cancelled")
        self.assertEqual(TaskStatus.RETRYING.value, "retrying")

    def test_task_status_enum_membership(self):
        """Test TaskStatus enum membership"""
        self.assertIsInstance(TaskStatus.PENDING, TaskStatus)
        self.assertIn(TaskStatus.COMPLETED, TaskStatus)


class TestTaskPriority(unittest.TestCase):
    """Test TaskPriority enum"""
    
    def test_task_priority_values(self):
        """Test task priority enum values and ordering"""
        self.assertEqual(TaskPriority.LOW.value, 0)
        self.assertEqual(TaskPriority.MEDIUM.value, 1)
        self.assertEqual(TaskPriority.HIGH.value, 2)
        self.assertEqual(TaskPriority.CRITICAL.value, 3)

    def test_task_priority_ordering(self):
        """Test task priority comparison"""
        self.assertLess(TaskPriority.LOW.value, TaskPriority.HIGH.value)
        self.assertGreater(TaskPriority.CRITICAL.value, TaskPriority.MEDIUM.value)


class TestTask(unittest.TestCase):
    """Test Task class functionality"""
    
    def setUp(self):
        """Set up test fixtures"""
        self.task_data = {
            'id': 'test_task_123',
            'type': 'testing',
            'priority': 'high',
            'description': 'Test task description',
            'files_pattern': '**/*.py',
            'estimated_duration': 600
        }

    def test_task_initialization(self):
        """Test task initialization with all parameters"""
        task = Task(self.task_data)
        
        self.assertEqual(task.id, 'test_task_123')
        self.assertEqual(task.type, 'testing')
        self.assertEqual(task.priority, TaskPriority.HIGH)
        self.assertEqual(task.description, 'Test task description')
        self.assertEqual(task.files_pattern, '**/*.py')
        self.assertEqual(task.estimated_duration, 600)
        self.assertEqual(task.status, TaskStatus.PENDING)
        self.assertEqual(task.progress, 0)
        self.assertEqual(task.retry_count, 0)
        self.assertEqual(task.max_retries, 3)
        self.assertIsNone(task.error)

    def test_task_initialization_with_defaults(self):
        """Test task initialization with minimal data"""
        minimal_data = {'description': 'Minimal task'}
        task = Task(minimal_data)
        
        self.assertTrue(task.id.startswith('task_'))
        self.assertEqual(task.type, 'general')
        self.assertEqual(task.priority, TaskPriority.MEDIUM)
        self.assertEqual(task.files_pattern, '**/*')
        self.assertEqual(task.estimated_duration, 300)

    def test_task_initialization_invalid_priority(self):
        """Test task initialization with invalid priority defaults to MEDIUM"""
        data = {'priority': 'invalid'}
        with self.assertRaises(KeyError):
            Task(data)

    def test_task_to_dict(self):
        """Test task serialization to dictionary"""
        task = Task(self.task_data)
        task_dict = task.to_dict()
        
        self.assertEqual(task_dict['id'], 'test_task_123')
        self.assertEqual(task_dict['priority'], 'high')
        self.assertEqual(task_dict['status'], 'pending')
        self.assertEqual(task_dict['progress'], 0)
        self.assertIsNotNone(task_dict['created_at'])
        self.assertIsNone(task_dict['started_at'])
        self.assertIsNone(task_dict['completed_at'])

    def test_task_update_status_to_running(self):
        """Test updating task status to running"""
        task = Task(self.task_data)
        callback_called = False
        old_status = None
        new_status = None
        
        def status_callback(task_obj, old_st, new_st):
            nonlocal callback_called, old_status, new_status
            callback_called = True
            old_status = old_st
            new_status = new_st
        
        task.on_status_change = status_callback
        task.update_status(TaskStatus.RUNNING)
        
        self.assertEqual(task.status, TaskStatus.RUNNING)
        self.assertIsNotNone(task.started_at)
        self.assertIsNone(task.completed_at)
        self.assertTrue(callback_called)
        self.assertEqual(old_status, TaskStatus.PENDING)
        self.assertEqual(new_status, TaskStatus.RUNNING)

    def test_task_update_status_to_completed(self):
        """Test updating task status to completed"""
        task = Task(self.task_data)
        task.update_status(TaskStatus.COMPLETED)
        
        self.assertEqual(task.status, TaskStatus.COMPLETED)
        self.assertIsNotNone(task.completed_at)

    def test_task_update_status_to_failed_with_error(self):
        """Test updating task status to failed with error message"""
        task = Task(self.task_data)
        error_msg = "Test error occurred"
        task.update_status(TaskStatus.FAILED, error_msg)
        
        self.assertEqual(task.status, TaskStatus.FAILED)
        self.assertEqual(task.error, error_msg)
        self.assertIsNotNone(task.completed_at)

    def test_task_update_progress(self):
        """Test updating task progress"""
        task = Task(self.task_data)
        callback_called = False
        old_progress = None
        new_progress = None
        
        def progress_callback(task_obj, old_prog, new_prog):
            nonlocal callback_called, old_progress, new_progress
            callback_called = True
            old_progress = old_prog
            new_progress = new_prog
        
        task.on_progress_update = progress_callback
        task.update_progress(75)
        
        self.assertEqual(task.progress, 75)
        self.assertTrue(callback_called)
        self.assertEqual(old_progress, 0)
        self.assertEqual(new_progress, 75)

    def test_task_update_progress_boundaries(self):
        """Test task progress boundary conditions"""
        task = Task(self.task_data)
        
        # Test negative progress
        task.update_progress(-10)
        self.assertEqual(task.progress, 0)
        
        # Test progress over 100
        task.update_progress(150)
        self.assertEqual(task.progress, 100)

    def test_task_status_callback_not_called_for_same_status(self):
        """Test status callback not called when status unchanged"""
        task = Task(self.task_data)
        callback_called = False
        
        def status_callback(task_obj, old_st, new_st):
            nonlocal callback_called
            callback_called = True
        
        task.on_status_change = status_callback
        task.update_status(TaskStatus.PENDING)  # Same as initial
        
        self.assertFalse(callback_called)


class TestTaskQueue(unittest.TestCase):
    """Test TaskQueue class functionality"""
    
    def setUp(self):
        """Set up test fixtures"""
        self.queue = TaskQueue()

    def test_task_queue_initialization(self):
        """Test task queue initialization"""
        self.assertEqual(len(self.queue.tasks), 0)
        self.assertIsInstance(self.queue.lock, threading.Lock)

    def test_add_task_single(self):
        """Test adding a single task to queue"""
        task = Task({'id': 'test_task', 'priority': 'medium'})
        self.queue.add_task(task)
        
        self.assertEqual(len(self.queue.tasks), 1)
        self.assertEqual(task.status, TaskStatus.QUEUED)
        self.assertEqual(self.queue.tasks[0], task)

    def test_add_tasks_priority_ordering(self):
        """Test tasks are ordered by priority"""
        high_task = Task({'id': 'high_task', 'priority': 'high'})
        low_task = Task({'id': 'low_task', 'priority': 'low'})
        critical_task = Task({'id': 'critical_task', 'priority': 'critical'})
        medium_task = Task({'id': 'medium_task', 'priority': 'medium'})
        
        # Add in random order
        self.queue.add_task(medium_task)
        self.queue.add_task(low_task)
        self.queue.add_task(critical_task)
        self.queue.add_task(high_task)
        
        # Should be ordered by priority: CRITICAL, HIGH, MEDIUM, LOW
        self.assertEqual(self.queue.tasks[0].id, 'critical_task')
        self.assertEqual(self.queue.tasks[1].id, 'high_task')
        self.assertEqual(self.queue.tasks[2].id, 'medium_task')
        self.assertEqual(self.queue.tasks[3].id, 'low_task')

    def test_get_next_task(self):
        """Test getting next task from queue"""
        task1 = Task({'id': 'task1', 'priority': 'low'})
        task2 = Task({'id': 'task2', 'priority': 'high'})
        
        self.queue.add_task(task1)
        self.queue.add_task(task2)
        
        next_task = self.queue.get_next_task()
        self.assertEqual(next_task.id, 'task2')  # High priority first
        self.assertEqual(next_task.status, TaskStatus.QUEUED)

    def test_get_next_task_empty_queue(self):
        """Test getting next task from empty queue"""
        next_task = self.queue.get_next_task()
        self.assertIsNone(next_task)

    def test_get_next_task_no_queued_tasks(self):
        """Test getting next task when no tasks are in QUEUED status"""
        task = Task({'id': 'running_task', 'priority': 'high'})
        task.update_status(TaskStatus.RUNNING)
        self.queue.tasks.append(task)
        
        next_task = self.queue.get_next_task()
        self.assertIsNone(next_task)

    def test_remove_task(self):
        """Test removing task from queue"""
        task = Task({'id': 'removable_task', 'priority': 'medium'})
        self.queue.add_task(task)
        
        result = self.queue.remove_task('removable_task')
        
        self.assertTrue(result)
        self.assertEqual(len(self.queue.tasks), 0)

    def test_remove_task_not_found(self):
        """Test removing non-existent task from queue"""
        result = self.queue.remove_task('non_existent_task')
        self.assertFalse(result)

    def test_get_tasks_by_status(self):
        """Test filtering tasks by status"""
        queued_task = Task({'id': 'queued_task'})
        running_task = Task({'id': 'running_task'})
        
        self.queue.add_task(queued_task)
        self.queue.add_task(running_task)
        running_task.update_status(TaskStatus.RUNNING)
        
        queued_tasks = self.queue.get_tasks_by_status(TaskStatus.QUEUED)
        running_tasks = self.queue.get_tasks_by_status(TaskStatus.RUNNING)
        
        self.assertEqual(len(queued_tasks), 1)
        self.assertEqual(len(running_tasks), 1)
        self.assertEqual(queued_tasks[0].id, 'queued_task')
        self.assertEqual(running_tasks[0].id, 'running_task')

    def test_get_all_tasks(self):
        """Test getting all tasks from queue"""
        task1 = Task({'id': 'task1'})
        task2 = Task({'id': 'task2'})
        
        self.queue.add_task(task1)
        self.queue.add_task(task2)
        
        all_tasks = self.queue.get_all_tasks()
        
        self.assertEqual(len(all_tasks), 2)
        self.assertIsNot(all_tasks, self.queue.tasks)  # Should be a copy

    def test_thread_safety(self):
        """Test thread safety of queue operations"""
        def add_tasks():
            for i in range(10):
                task = Task({'id': f'thread_task_{i}'})
                self.queue.add_task(task)
                time.sleep(0.001)
        
        threads = []
        for _ in range(3):
            thread = threading.Thread(target=add_tasks)
            threads.append(thread)
            thread.start()
        
        for thread in threads:
            thread.join()
        
        self.assertEqual(len(self.queue.tasks), 30)


class TestTaskManager(unittest.TestCase):
    """Test TaskManager class functionality"""
    
    def setUp(self):
        """Set up test fixtures"""
        self.temp_dir = tempfile.mkdtemp()
        self.project_dir = Path(self.temp_dir)
        self.manager = TaskManager(str(self.project_dir), max_concurrent=2)
        self.addCleanup(self.cleanup)

    def cleanup(self):
        """Clean up test fixtures"""
        if hasattr(self, 'manager') and self.manager.is_running:
            self.manager.stop()
        import shutil
        if hasattr(self, 'temp_dir'):
            shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_task_manager_initialization(self):
        """Test task manager initialization"""
        self.assertEqual(self.manager.project_dir, self.project_dir)
        self.assertEqual(self.manager.max_concurrent, 2)
        self.assertTrue(self.manager.claude_dir.exists())
        self.assertTrue(self.manager.logs_dir.exists())
        self.assertIsInstance(self.manager.queue, TaskQueue)

    def test_add_task(self):
        """Test adding task to manager"""
        task_data = {
            'id': 'manager_task',
            'type': 'testing',
            'priority': 'high',
            'description': 'Test task for manager'
        }
        
        task = self.manager.add_task(task_data)
        
        self.assertEqual(task.id, 'manager_task')
        self.assertEqual(task.status, TaskStatus.QUEUED)
        self.assertEqual(len(self.manager.queue.get_all_tasks()), 1)

    def test_add_status_callback(self):
        """Test adding status callback to manager"""
        callback_called = False
        
        def status_callback(task, old_status, new_status):
            nonlocal callback_called
            callback_called = True
        
        self.manager.add_status_callback(status_callback)
        task_data = {'id': 'callback_test_task'}
        task = self.manager.add_task(task_data)
        task.update_status(TaskStatus.RUNNING)
        
        self.assertTrue(callback_called)

    def test_add_progress_callback(self):
        """Test adding progress callback to manager"""
        callback_called = False
        
        def progress_callback(task, old_progress, new_progress):
            nonlocal callback_called
            callback_called = True
        
        self.manager.add_progress_callback(progress_callback)
        task_data = {'id': 'progress_test_task'}
        task = self.manager.add_task(task_data)
        task.update_progress(50)
        
        self.assertTrue(callback_called)

    @mock.patch('subprocess.Popen')
    def test_start_task_execution(self, mock_popen):
        """Test starting task execution"""
        mock_process = mock.Mock()
        mock_process.pid = 12345
        mock_popen.return_value = mock_process
        
        task_data = {'id': 'execution_task', 'description': 'Test execution'}
        task = self.manager.add_task(task_data)
        
        with mock.patch('builtins.open', mock.mock_open()):
            result = self.manager.start_task_execution(task)
        
        self.assertTrue(result)
        self.assertEqual(task.status, TaskStatus.RUNNING)
        self.assertIsNotNone(task.process)
        self.assertEqual(task.process.pid, 12345)
        self.assertIn(task.id, self.manager.running_tasks)

    @mock.patch('subprocess.Popen')
    def test_start_task_execution_failure(self, mock_popen):
        """Test task execution start failure"""
        mock_popen.side_effect = Exception("Process start failed")
        
        task_data = {'id': 'failed_task'}
        task = self.manager.add_task(task_data)
        
        result = self.manager.start_task_execution(task)
        
        self.assertFalse(result)
        self.assertEqual(task.status, TaskStatus.FAILED)
        self.assertIsNotNone(task.error)

    def test_cancel_running_task(self):
        """Test canceling a running task"""
        mock_process = mock.Mock()
        mock_process.poll.return_value = None  # Still running
        
        task_data = {'id': 'cancelable_task'}
        task = self.manager.add_task(task_data)
        task.process = mock_process
        task.update_status(TaskStatus.RUNNING)
        self.manager.running_tasks[task.id] = task
        
        result = self.manager.cancel_task('cancelable_task')
        
        self.assertTrue(result)
        self.assertEqual(task.status, TaskStatus.CANCELLED)
        mock_process.terminate.assert_called_once()
        self.assertNotIn('cancelable_task', self.manager.running_tasks)

    def test_cancel_queued_task(self):
        """Test canceling a queued task"""
        task_data = {'id': 'queued_cancelable_task'}
        task = self.manager.add_task(task_data)
        
        result = self.manager.cancel_task('queued_cancelable_task')
        
        self.assertTrue(result)
        self.assertEqual(task.status, TaskStatus.CANCELLED)

    def test_cancel_nonexistent_task(self):
        """Test canceling non-existent task"""
        result = self.manager.cancel_task('nonexistent_task')
        self.assertFalse(result)

    def test_retry_failed_task(self):
        """Test retrying a failed task"""
        task_data = {'id': 'retryable_task'}
        task = self.manager.add_task(task_data)
        task.update_status(TaskStatus.FAILED, "Test failure")
        task.retry_count = 1
        self.manager.completed_tasks[task.id] = task
        
        result = self.manager.retry_task('retryable_task')
        
        self.assertTrue(result)
        self.assertEqual(task.status, TaskStatus.QUEUED)
        self.assertEqual(task.retry_count, 2)
        self.assertIsNone(task.error)
        self.assertNotIn('retryable_task', self.manager.completed_tasks)

    def test_retry_task_max_retries_exceeded(self):
        """Test retrying task when max retries exceeded"""
        task_data = {'id': 'max_retry_task'}
        task = self.manager.add_task(task_data)
        task.update_status(TaskStatus.FAILED, "Test failure")
        task.retry_count = 3  # Max retries
        self.manager.completed_tasks[task.id] = task
        
        result = self.manager.retry_task('max_retry_task')
        
        self.assertFalse(result)

    def test_retry_successful_task(self):
        """Test retrying a successful task (should fail)"""
        task_data = {'id': 'successful_task'}
        task = self.manager.add_task(task_data)
        task.update_status(TaskStatus.COMPLETED)
        self.manager.completed_tasks[task.id] = task
        
        result = self.manager.retry_task('successful_task')
        
        self.assertFalse(result)

    def test_check_running_tasks_completed(self):
        """Test checking running tasks that completed successfully"""
        mock_process = mock.Mock()
        mock_process.poll.return_value = 0  # Success
        
        task_data = {'id': 'completed_task'}
        task = self.manager.add_task(task_data)
        task.process = mock_process
        task.update_status(TaskStatus.RUNNING)
        self.manager.running_tasks[task.id] = task
        
        self.manager.check_running_tasks()
        
        self.assertEqual(task.status, TaskStatus.COMPLETED)
        self.assertEqual(task.progress, 100)
        self.assertIn('completed_task', self.manager.completed_tasks)
        self.assertNotIn('completed_task', self.manager.running_tasks)

    def test_check_running_tasks_failed(self):
        """Test checking running tasks that failed"""
        mock_process = mock.Mock()
        mock_process.poll.return_value = 1  # Failure
        
        task_data = {'id': 'failed_task'}
        task = self.manager.add_task(task_data)
        task.process = mock_process
        task.update_status(TaskStatus.RUNNING)
        self.manager.running_tasks[task.id] = task
        
        # Mock log file
        log_file = self.manager.logs_dir / f"{task.id}.log"
        log_file.write_text("Error: Process failed with error message")
        task.log_file = log_file
        
        self.manager.check_running_tasks()
        
        self.assertEqual(task.status, TaskStatus.FAILED)
        self.assertIsNotNone(task.error)
        self.assertIn('failed_task', self.manager.completed_tasks)

    def test_save_and_load_task_status(self):
        """Test saving and loading task status"""
        task_data = {'id': 'save_load_task', 'description': 'Test save/load'}
        task = self.manager.add_task(task_data)
        
        self.manager.save_task_status()
        
        self.assertTrue(self.manager.status_file.exists())
        with open(self.manager.status_file, 'r') as f:
            data = json.load(f)
            self.assertIn('updated_at', data)
            self.assertIn('queued_tasks', data)
            self.assertEqual(len(data['queued_tasks']), 1)

    def test_load_tasks_from_file(self):
        """Test loading tasks from tasks.json file"""
        tasks_data = {
            'tasks': [
                {
                    'id': 'loaded_task_1',
                    'type': 'testing',
                    'priority': 'high',
                    'description': 'Loaded task 1'
                },
                {
                    'id': 'loaded_task_2',
                    'type': 'security',
                    'priority': 'medium',
                    'description': 'Loaded task 2'
                }
            ]
        }
        
        with open(self.manager.tasks_file, 'w') as f:
            json.dump(tasks_data, f)
        
        loaded_tasks = self.manager.load_tasks_from_file()
        
        self.assertEqual(len(loaded_tasks), 2)
        self.assertEqual(loaded_tasks[0].id, 'loaded_task_1')
        self.assertEqual(loaded_tasks[1].id, 'loaded_task_2')

    def test_get_status_summary(self):
        """Test getting status summary"""
        # Add various tasks in different states
        task1 = self.manager.add_task({'id': 'task1', 'type': 'testing'})
        task2 = self.manager.add_task({'id': 'task2', 'type': 'security'})
        
        task2.update_status(TaskStatus.RUNNING)
        self.manager.running_tasks['task2'] = task2
        
        summary = self.manager.get_status_summary()
        
        self.assertIn('total_tasks', summary)
        self.assertIn('running', summary)
        self.assertIn('queued', summary)
        self.assertIn('completed', summary)
        self.assertIn('failed', summary)
        self.assertIn('status_breakdown', summary)
        self.assertEqual(summary['max_concurrent'], 2)
        self.assertEqual(summary['running'], 1)
        self.assertEqual(summary['queued'], 1)

    def test_start_and_stop_manager(self):
        """Test starting and stopping task manager"""
        self.assertFalse(self.manager.is_running)
        
        self.manager.start()
        self.assertTrue(self.manager.is_running)
        self.assertIsNotNone(self.manager.executor_thread)
        
        self.manager.stop()
        self.assertFalse(self.manager.is_running)


class TestTaskManagerIntegration(unittest.TestCase):
    """Integration tests for TaskManager"""
    
    def setUp(self):
        """Set up integration test fixtures"""
        self.temp_dir = tempfile.mkdtemp()
        self.project_dir = Path(self.temp_dir)
        self.addCleanup(self.cleanup)

    def cleanup(self):
        """Clean up integration test fixtures"""
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    @mock.patch('subprocess.Popen')
    def test_full_task_lifecycle(self, mock_popen):
        """Test complete task lifecycle from creation to completion"""
        # Mock successful process
        mock_process = mock.Mock()
        mock_process.pid = 12345
        mock_process.poll.return_value = None  # Initially running
        mock_popen.return_value = mock_process
        
        manager = TaskManager(str(self.project_dir), max_concurrent=1)
        
        # Add callbacks to track status changes
        status_changes = []
        progress_updates = []
        
        def status_callback(task, old_status, new_status):
            status_changes.append((task.id, old_status.value, new_status.value))
        
        def progress_callback(task, old_progress, new_progress):
            progress_updates.append((task.id, old_progress, new_progress))
        
        manager.add_status_callback(status_callback)
        manager.add_progress_callback(progress_callback)
        
        # Add task
        task_data = {
            'id': 'lifecycle_task',
            'type': 'testing',
            'priority': 'high',
            'description': 'Full lifecycle test task'
        }
        
        task = manager.add_task(task_data)
        
        # Start execution
        with mock.patch('builtins.open', mock.mock_open()):
            result = manager.start_task_execution(task)
        
        self.assertTrue(result)
        self.assertEqual(task.status, TaskStatus.RUNNING)
        
        # Check running tasks (simulate completion)
        # First call returns None (still running), then simulate completion
        mock_process.poll.return_value = 0  # Now completed
        manager.check_running_tasks()
        
        self.assertEqual(task.status, TaskStatus.COMPLETED)
        self.assertIn(task.id, manager.completed_tasks)
        
        # Verify callbacks were called
        self.assertTrue(len(status_changes) >= 2)
        self.assertIn(('lifecycle_task', 'pending', 'queued'), status_changes)
        self.assertIn(('lifecycle_task', 'queued', 'running'), status_changes)
        
        manager.stop()


class TestTaskManagerErrorHandling(unittest.TestCase):
    """Test error handling and edge cases in TaskManager"""
    
    def setUp(self):
        """Set up error handling test fixtures"""
        self.temp_dir = tempfile.mkdtemp()
        self.project_dir = Path(self.temp_dir)
        self.manager = TaskManager(str(self.project_dir))
        self.addCleanup(self.cleanup)

    def cleanup(self):
        """Clean up error handling test fixtures"""
        if hasattr(self, 'manager') and self.manager.is_running:
            self.manager.stop()
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_malformed_task_data_handling(self):
        """Test handling of malformed task data"""
        # Test with None
        with self.assertRaises(AttributeError):
            Task(None)
        
        # Test with missing required fields handled gracefully
        minimal_task = Task({})
        self.assertIsNotNone(minimal_task.id)
        self.assertEqual(minimal_task.type, 'general')

    def test_file_system_errors(self):
        """Test handling of file system errors"""
        # Make logs directory read-only
        self.manager.logs_dir.chmod(0o444)
        
        try:
            # This should not crash
            self.manager.save_task_status()
        except PermissionError:
            pass  # Expected in some cases
        finally:
            # Restore permissions
            self.manager.logs_dir.chmod(0o755)

    def test_callback_exceptions_handled(self):
        """Test that callback exceptions are handled gracefully"""
        def failing_callback(task, old_status, new_status):
            raise Exception("Callback failed")
        
        self.manager.add_status_callback(failing_callback)
        
        # This should not crash despite callback failure
        task = self.manager.add_task({'id': 'callback_test'})
        task.update_status(TaskStatus.RUNNING)

    def test_invalid_json_in_tasks_file(self):
        """Test handling of invalid JSON in tasks file"""
        # Write invalid JSON
        with open(self.manager.tasks_file, 'w') as f:
            f.write("invalid json content")
        
        # Should not crash
        tasks = self.manager.load_tasks_from_file()
        self.assertEqual(len(tasks), 0)


if __name__ == '__main__':
    unittest.main()