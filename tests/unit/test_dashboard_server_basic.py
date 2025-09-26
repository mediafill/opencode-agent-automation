#!/usr/bin/env python3
"""
Basic unit tests for dashboard_server.py functionality
Tests core features without complex WebSocket mocking
"""

import unittest
import unittest.mock
import tempfile
import json
from pathlib import Path
from datetime import datetime

# Import from parent directory  
import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'scripts'))

from dashboard_server import DashboardServer, LogFileHandler


class TestDashboardServerBasic(unittest.TestCase):
    """Test basic DashboardServer functionality"""
    
    def setUp(self):
        """Set up test fixtures"""
        self.temp_dir = tempfile.mkdtemp()
        self.project_dir = Path(self.temp_dir)
        self.server = DashboardServer(str(self.project_dir), port=8080)
        self.addCleanup(self.cleanup)

    def cleanup(self):
        """Clean up test fixtures"""
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_dashboard_server_initialization(self):
        """Test dashboard server initialization"""
        self.assertEqual(self.server.project_dir, self.project_dir)
        self.assertEqual(self.server.port, 8080)
        self.assertTrue(self.server.claude_dir.exists())
        self.assertTrue(self.server.logs_dir.exists())
        self.assertEqual(len(self.server.clients), 0)
        self.assertEqual(len(self.server.agents), 0)
        self.assertEqual(len(self.server.tasks), 0)

    def test_dashboard_server_default_initialization(self):
        """Test dashboard server initialization with defaults"""
        server = DashboardServer()
        self.assertEqual(server.project_dir, Path.cwd())
        self.assertEqual(server.port, 8080)

    def test_load_tasks_from_file(self):
        """Test loading tasks from tasks.json file"""
        tasks_data = {
            'tasks': [
                {'id': 'task1', 'type': 'testing', 'description': 'Test task 1'},
                {'id': 'task2', 'type': 'security', 'description': 'Test task 2'}
            ]
        }
        
        with open(self.server.tasks_file, 'w') as f:
            json.dump(tasks_data, f)
        
        self.server.load_tasks()
        
        self.assertEqual(len(self.server.tasks), 2)
        self.assertIn('task1', self.server.tasks)
        self.assertIn('task2', self.server.tasks)

    def test_load_tasks_file_not_found(self):
        """Test loading tasks when file doesn't exist"""
        self.server.load_tasks()
        self.assertEqual(len(self.server.tasks), 0)

    def test_load_tasks_invalid_json(self):
        """Test loading tasks with invalid JSON"""
        with open(self.server.tasks_file, 'w') as f:
            f.write("invalid json content")
        
        # Should not crash
        self.server.load_tasks()
        self.assertEqual(len(self.server.tasks), 0)

    def test_get_task_runtime_status_running(self):
        """Test getting runtime status for running task"""
        self.server.tasks['task1'] = {
            'id': 'task1',
            'status': 'queued',
            'created_at': datetime.now().isoformat()
        }
        
        self.server.agents['task1'] = {
            'task_id': 'task1',
            'status': 'running',
            'pid': 123
        }
        
        status = self.server.get_task_runtime_status('task1')
        self.assertEqual(status, 'running')

    def test_get_task_runtime_status_completed(self):
        """Test getting runtime status for completed task"""
        self.server.tasks['task1'] = {
            'id': 'task1',
            'status': 'completed',
            'created_at': datetime.now().isoformat(),
            'completed_at': datetime.now().isoformat()
        }
        
        status = self.server.get_task_runtime_status('task1')
        self.assertEqual(status, 'completed')

    def test_get_task_runtime_status_not_found(self):
        """Test getting runtime status for non-existent task"""
        status = self.server.get_task_runtime_status('nonexistent')
        self.assertEqual(status, 'unknown')

    def test_extract_task_id_from_cmdline(self):
        """Test extracting task ID from command line"""
        # Test with task ID in command
        cmdline = "opencode --task-id=task_123 /path/to/file.py"
        task_id = self.server._extract_task_id_from_cmdline(cmdline)
        self.assertEqual(task_id, 'task_123')
        
        # Test with agent ID pattern
        cmdline = "node /usr/bin/opencode agent_456"
        task_id = self.server._extract_task_id_from_cmdline(cmdline)
        self.assertEqual(task_id, 'agent_456')
        
        # Test with no identifiable task ID
        cmdline = "python script.py"
        task_id = self.server._extract_task_id_from_cmdline(cmdline)
        self.assertIsNone(task_id)

    def test_estimate_process_activity(self):
        """Test estimating process activity level"""
        # High CPU usage
        process_info = {'cpu_percent': 80, 'memory_info': {'rss': 100000000}}
        activity = self.server._estimate_process_activity(process_info)
        self.assertEqual(activity, 'high')
        
        # Medium CPU usage
        process_info = {'cpu_percent': 25, 'memory_info': {'rss': 50000000}}
        activity = self.server._estimate_process_activity(process_info)
        self.assertEqual(activity, 'medium')
        
        # Low CPU usage
        process_info = {'cpu_percent': 2, 'memory_info': {'rss': 10000000}}
        activity = self.server._estimate_process_activity(process_info)
        self.assertEqual(activity, 'low')

    def test_estimate_progress_with_log_file(self):
        """Test estimating progress from log files"""
        agent_id = 'test_agent'
        log_file = self.server.logs_dir / f"{agent_id}.log"
        
        # Create log file with progress indicators
        log_content = """
        INFO: Starting task
        INFO: Processing file 1 of 10
        INFO: Processing file 5 of 10
        INFO: Processing file 8 of 10
        """
        log_file.write_text(log_content)
        
        progress = self.server.estimate_progress(agent_id)
        self.assertGreater(progress, 0)
        self.assertLessEqual(progress, 100)

    def test_estimate_progress_no_log_file(self):
        """Test estimating progress when no log file exists"""
        progress = self.server.estimate_progress('nonexistent_agent')
        self.assertEqual(progress, 0)

    def test_extract_error_message(self):
        """Test extracting error messages from log content"""
        log_content = """
        INFO: Starting process
        ERROR: File not found: /path/to/missing/file.txt
        INFO: Continuing with next task
        """
        
        error_msg = self.server.extract_error_message(log_content)
        self.assertIn("File not found", error_msg)

    def test_extract_error_message_no_errors(self):
        """Test extracting error message when no errors exist"""
        log_content = """
        INFO: Starting process
        INFO: Task completed successfully
        """
        
        error_msg = self.server.extract_error_message(log_content)
        self.assertEqual(error_msg, "Unknown error")

    def test_extract_log_level(self):
        """Test extracting log levels from log lines"""
        self.assertEqual(self.server.extract_log_level("ERROR: Something failed"), "error")
        self.assertEqual(self.server.extract_log_level("WARNING: Be careful"), "warning") 
        self.assertEqual(self.server.extract_log_level("INFO: Information"), "info")
        self.assertEqual(self.server.extract_log_level("DEBUG: Debug info"), "debug")
        self.assertEqual(self.server.extract_log_level("No level here"), "info")

    def test_get_agent_recent_logs(self):
        """Test getting recent logs for an agent"""
        agent_id = 'test_agent'
        log_file = self.server.logs_dir / f"{agent_id}.log"
        
        # Create log file
        log_content = "INFO: Log entry 1\nERROR: Log entry 2\nINFO: Log entry 3"
        log_file.write_text(log_content)
        
        logs = self.server.get_agent_recent_logs(agent_id)
        self.assertEqual(len(logs), 3)
        self.assertIn('timestamp', logs[0])
        self.assertIn('level', logs[0])
        self.assertIn('message', logs[0])

    def test_get_agent_recent_logs_no_file(self):
        """Test getting recent logs when no log file exists"""
        logs = self.server.get_agent_recent_logs('nonexistent_agent')
        self.assertEqual(len(logs), 0)

    def test_is_safe_to_kill(self):
        """Test checking if a process is safe to kill"""
        # Test with valid agent PID
        self.server.agents['test_agent'] = {'pid': 12345, 'status': 'running'}
        self.assertTrue(self.server.is_safe_to_kill(12345))
        
        # Test with system PID (should be unsafe)
        self.assertFalse(self.server.is_safe_to_kill(1))  # init process
        
        # Test with unknown PID
        self.assertFalse(self.server.is_safe_to_kill(99999))


class TestLogFileHandler(unittest.TestCase):
    """Test LogFileHandler functionality"""
    
    def setUp(self):
        """Set up test fixtures"""
        self.mock_server = unittest.mock.Mock()
        self.handler = LogFileHandler(self.mock_server)

    def test_log_file_handler_initialization(self):
        """Test LogFileHandler initialization"""
        self.assertEqual(self.handler.server, self.mock_server)

    def test_on_modified_calls_process_log_file(self):
        """Test that on_modified calls process_log_file for log files"""
        mock_event = unittest.mock.Mock()
        mock_event.src_path = "/path/to/agent.log"
        mock_event.is_directory = False
        
        with unittest.mock.patch.object(self.handler, 'process_log_file') as mock_process:
            self.handler.on_modified(mock_event)
            mock_process.assert_called_once_with("/path/to/agent.log")

    def test_on_modified_ignores_non_log_files(self):
        """Test that on_modified ignores non-log files"""
        mock_event = unittest.mock.Mock()
        mock_event.src_path = "/path/to/data.txt"
        mock_event.is_directory = False
        
        with unittest.mock.patch.object(self.handler, 'process_log_file') as mock_process:
            self.handler.on_modified(mock_event)
            mock_process.assert_not_called()

    def test_on_modified_ignores_directories(self):
        """Test that on_modified ignores directory changes"""
        mock_event = unittest.mock.Mock()
        mock_event.src_path = "/path/to/logs/"
        mock_event.is_directory = True
        
        with unittest.mock.patch.object(self.handler, 'process_log_file') as mock_process:
            self.handler.on_modified(mock_event)
            mock_process.assert_not_called()


class TestDashboardServerErrorHandling(unittest.TestCase):
    """Test error handling and edge cases in DashboardServer"""
    
    def setUp(self):
        """Set up error handling test fixtures"""
        self.temp_dir = tempfile.mkdtemp()
        self.project_dir = Path(self.temp_dir)
        self.server = DashboardServer(str(self.project_dir))
        self.addCleanup(self.cleanup)

    def cleanup(self):
        """Clean up error handling test fixtures"""
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_missing_logs_directory(self):
        """Test behavior when logs directory is missing"""
        # Remove logs directory
        import shutil
        shutil.rmtree(self.server.logs_dir)
        
        # Should recreate directory or handle gracefully
        logs = self.server.get_agent_recent_logs('test_agent')
        self.assertEqual(len(logs), 0)

    def test_corrupted_log_files(self):
        """Test handling of corrupted log files"""
        agent_id = 'test_agent'
        log_file = self.server.logs_dir / f"{agent_id}.log"
        
        # Create binary log file (should not crash)
        log_file.write_bytes(b'\x00\x01\x02\x03\x04\x05')
        
        # Should handle gracefully
        logs = self.server.get_agent_recent_logs(agent_id)

    def test_file_system_permission_errors(self):
        """Test handling of file system permission errors"""
        # Make logs directory read-only
        self.server.logs_dir.chmod(0o444)
        
        try:
            # Should handle gracefully
            logs = self.server.get_agent_recent_logs('test_agent')
            self.assertEqual(len(logs), 0)
        finally:
            # Restore permissions
            self.server.logs_dir.chmod(0o755)


if __name__ == '__main__':
    unittest.main()