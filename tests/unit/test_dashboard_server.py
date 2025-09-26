#!/usr/bin/env python3
"""
Comprehensive unit tests for dashboard_server.py
Tests WebSocket server, process monitoring, file handling, and task management integration
"""

import unittest
import unittest.mock as mock
import asyncio
import tempfile
import json
import psutil
from pathlib import Path
from datetime import datetime
from unittest.async_case import IsolatedAsyncioTestCase

# Import from parent directory
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'scripts'))

try:
    from dashboard_server import DashboardServer, LogFileHandler
except ImportError:
    # Fallback for direct execution
    sys.path.insert(0, str(Path(__file__).parent.parent.parent.absolute()))
    from scripts.dashboard_server import DashboardServer, LogFileHandler


class TestLogFileHandler(unittest.TestCase):
    """Test LogFileHandler functionality"""
    
    def setUp(self):
        """Set up test fixtures"""
        self.mock_server = mock.Mock()
        self.handler = LogFileHandler(self.mock_server)

    def test_log_file_handler_initialization(self):
        """Test LogFileHandler initialization"""
        self.assertEqual(self.handler.server, self.mock_server)

    def test_on_modified_calls_process_log_file(self):
        """Test that on_modified calls process_log_file for log files"""
        mock_event = mock.Mock()
        mock_event.src_path = "/path/to/agent.log"
        mock_event.is_directory = False
        
        with mock.patch.object(self.handler, 'process_log_file') as mock_process:
            self.handler.on_modified(mock_event)
            mock_process.assert_called_once_with("/path/to/agent.log")

    def test_on_modified_ignores_non_log_files(self):
        """Test that on_modified ignores non-log files"""
        mock_event = mock.Mock()
        mock_event.src_path = "/path/to/data.txt"
        mock_event.is_directory = False
        
        with mock.patch.object(self.handler, 'process_log_file') as mock_process:
            self.handler.on_modified(mock_event)
            mock_process.assert_not_called()

    def test_on_modified_ignores_directories(self):
        """Test that on_modified ignores directory changes"""
        mock_event = mock.Mock()
        mock_event.src_path = "/path/to/logs/"
        mock_event.is_directory = True
        
        with mock.patch.object(self.handler, 'process_log_file') as mock_process:
            self.handler.on_modified(mock_event)
            mock_process.assert_not_called()

    @mock.patch('pathlib.Path.exists')
    @mock.patch('builtins.open', mock.mock_open(read_data="INFO: Test log entry\nERROR: Test error"))
    def test_process_log_file_reads_and_broadcasts(self, mock_exists):
        """Test that process_log_file reads file and broadcasts entries"""
        mock_exists.return_value = True
        
        self.handler.process_log_file("/path/to/test.log")
        
        # Should call broadcast_log_entry for each line
        self.assertEqual(self.mock_server.broadcast_log_entry.call_count, 2)


class TestDashboardServer(IsolatedAsyncioTestCase):
    """Test DashboardServer functionality"""
    
    def setUp(self):
        """Set up test fixtures"""
        self.temp_dir = tempfile.mkdtemp()
        self.project_dir = Path(self.temp_dir)
        
        # Mock websockets module if not available
        self.websockets_patcher = mock.patch('dashboard_server.WEBSOCKETS_AVAILABLE', True)
        self.websockets_patcher.start()
        
        # Mock task manager availability
        self.task_manager_patcher = mock.patch('dashboard_server.TASK_MANAGER_AVAILABLE', False)
        self.task_manager_patcher.start()
        
        self.server = DashboardServer(str(self.project_dir), port=8080)
        self.addCleanup(self.cleanup)

    def cleanup(self):
        """Clean up test fixtures"""
        self.websockets_patcher.stop()
        self.task_manager_patcher.stop()
        self.server.shutdown()
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

    async def test_register_client(self):
        """Test registering a WebSocket client"""
        mock_websocket = mock.AsyncMock()
        
        with mock.patch.object(self.server, 'send_full_status') as mock_send:
            await self.server.register(mock_websocket)
            
        self.assertIn(mock_websocket, self.server.clients)
        mock_send.assert_called_once_with(mock_websocket)

    async def test_unregister_client(self):
        """Test unregistering a WebSocket client"""
        mock_websocket = mock.AsyncMock()
        self.server.clients.add(mock_websocket)
        
        await self.server.unregister(mock_websocket)
        
        self.assertNotIn(mock_websocket, self.server.clients)

    async def test_send_to_client_success(self):
        """Test sending data to a client successfully"""
        mock_websocket = mock.AsyncMock()
        test_data = {'type': 'test', 'message': 'hello'}
        
        await self.server.send_to_client(mock_websocket, test_data)
        
        mock_websocket.send.assert_called_once_with(json.dumps(test_data))

    async def test_send_to_client_connection_closed(self):
        """Test handling connection closed during send"""
        mock_websocket = mock.AsyncMock()
        mock_websocket.send.side_effect = mock.Mock(side_effect=Exception("ConnectionClosed"))
        
        with mock.patch.object(self.server, 'unregister') as mock_unregister:
            await self.server.send_to_client(mock_websocket, {'test': 'data'})

    async def test_broadcast_to_all_clients(self):
        """Test broadcasting data to all connected clients"""
        mock_client1 = mock.AsyncMock()
        mock_client2 = mock.AsyncMock()
        
        self.server.clients.add(mock_client1)
        self.server.clients.add(mock_client2)
        
        test_data = {'type': 'broadcast', 'message': 'test'}
        await self.server.broadcast(test_data)
        
        expected_message = json.dumps(test_data)
        mock_client1.send.assert_called_once_with(expected_message)
        mock_client2.send.assert_called_once_with(expected_message)

    async def test_broadcast_no_clients(self):
        """Test broadcasting when no clients are connected"""
        # Should not raise any errors
        await self.server.broadcast({'test': 'data'})

    async def test_broadcast_removes_disconnected_clients(self):
        """Test that broadcasting removes clients that disconnect"""
        mock_client1 = mock.AsyncMock()
        mock_client2 = mock.AsyncMock()
        
        # Client 1 will disconnect during broadcast
        mock_client1.send.side_effect = Exception("ConnectionClosed")
        
        self.server.clients.add(mock_client1)
        self.server.clients.add(mock_client2)
        
        await self.server.broadcast({'test': 'data'})
        
        # Client 1 should be removed, client 2 should remain
        self.assertNotIn(mock_client1, self.server.clients)
        self.assertIn(mock_client2, self.server.clients)

    async def test_send_full_status(self):
        """Test sending full status to a client"""
        mock_websocket = mock.AsyncMock()
        
        # Add some test data
        self.server.agents = {'agent1': {'id': 'agent1', 'status': 'running'}}
        self.server.tasks = {'task1': {'id': 'task1', 'status': 'completed'}}
        self.server.logs = [{'timestamp': '2023-01-01', 'message': 'test'}]
        self.server.system_resources = {'cpu': 50, 'memory': 70}
        self.server.claude_processes = {'proc1': {'pid': 123, 'name': 'claude'}}
        
        await self.server.send_full_status(mock_websocket)
        
        # Verify the call was made with correct structure
        mock_websocket.send.assert_called_once()
        call_args = mock_websocket.send.call_args[0][0]
        status_data = json.loads(call_args)
        
        self.assertEqual(status_data['type'], 'full_status')
        self.assertIn('agents', status_data)
        self.assertIn('tasks', status_data)
        self.assertIn('logs', status_data)
        self.assertIn('resources', status_data)
        self.assertIn('claude_processes', status_data)

    def test_task_status_change_callback(self):
        """Test task status change callback"""
        mock_task = mock.Mock()
        mock_task.id = 'test_task'
        
        with mock.patch.object(self.server, 'broadcast') as mock_broadcast:
            self.server._on_task_status_change(mock_task, 'old_status', 'new_status')

    def test_task_progress_update_callback(self):
        """Test task progress update callback"""
        mock_task = mock.Mock()
        mock_task.id = 'test_task'
        
        with mock.patch.object(self.server, 'broadcast') as mock_broadcast:
            self.server._on_task_progress_update(mock_task, 50, 75)

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
        # tasks.json doesn't exist
        self.server.load_tasks()
        
        # Should not crash, tasks should be empty
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
        # Add mock task to tasks
        self.server.tasks['task1'] = {
            'id': 'task1',
            'status': 'queued',
            'created_at': datetime.now().isoformat()
        }
        
        # Add mock process to agents
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

    @mock.patch('psutil.process_iter')
    def test_detect_claude_processes(self, mock_process_iter):
        """Test detecting Claude processes"""
        # Mock process data
        mock_proc = mock.Mock()
        mock_proc.pid = 12345
        mock_proc.name.return_value = 'node'
        mock_proc.cmdline.return_value = ['node', '/usr/local/bin/opencode', 'task123']
        mock_proc.status.return_value = 'running'
        mock_proc.create_time.return_value = 1640995200
        mock_proc.cpu_percent.return_value = 15.5
        mock_proc.memory_info.return_value = mock.Mock(rss=104857600, vms=209715200)
        
        mock_process_iter.return_value = [mock_proc]
        
        with mock.patch.object(self.server, '_get_process_working_dir', return_value='/test/dir'):
            processes = self.server.detect_claude_processes()
        
        self.assertEqual(len(processes), 1)
        self.assertIn('12345', processes)
        
        process_info = processes['12345']
        self.assertEqual(process_info['pid'], 12345)
        self.assertEqual(process_info['name'], 'node')
        self.assertIn('opencode', process_info['cmdline'])

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

    def test_get_process_working_dir(self):
        """Test getting process working directory"""
        mock_proc = mock.Mock()
        mock_proc.cwd.return_value = '/test/working/dir'
        
        working_dir = self.server._get_process_working_dir(mock_proc)
        self.assertEqual(working_dir, '/test/working/dir')

    def test_get_process_working_dir_access_denied(self):
        """Test getting process working directory with access denied"""
        mock_proc = mock.Mock()
        mock_proc.cwd.side_effect = psutil.AccessDenied()
        
        working_dir = self.server._get_process_working_dir(mock_proc)
        self.assertIsNone(working_dir)

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

    @mock.patch('psutil.cpu_percent')
    @mock.patch('psutil.virtual_memory')
    @mock.patch('psutil.disk_usage')
    def test_update_system_resources(self, mock_disk, mock_memory, mock_cpu):
        """Test updating system resource information"""
        mock_cpu.return_value = 45.2
        mock_memory.return_value = mock.Mock(percent=67.8, available=2147483648)
        mock_disk.return_value = mock.Mock(percent=82.3, free=107374182400)
        
        self.server.update_system_resources()
        
        resources = self.server.system_resources
        self.assertEqual(resources['cpu_percent'], 45.2)
        self.assertEqual(resources['memory_percent'], 67.8)
        self.assertEqual(resources['disk_percent'], 82.3)

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
        # Test various log levels
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

    @mock.patch('psutil.Process')
    def test_kill_process_safely_success(self, mock_process_class):
        """Test safely killing a process successfully"""
        mock_process = mock.Mock()
        mock_process.terminate.return_value = None
        mock_process.wait.return_value = None
        mock_process_class.return_value = mock_process
        
        # Add to safe PIDs
        self.server.agents['test_agent'] = {'pid': 12345, 'status': 'running'}
        
        result = self.server.kill_process_safely(12345)
        self.assertTrue(result)
        mock_process.terminate.assert_called_once()

    @mock.patch('psutil.Process')
    def test_kill_process_safely_failure(self, mock_process_class):
        """Test safely killing a process that fails"""
        mock_process = mock.Mock()
        mock_process.terminate.side_effect = psutil.NoSuchProcess(12345)
        mock_process_class.return_value = mock_process
        
        result = self.server.kill_process_safely(12345)
        self.assertFalse(result)

    def test_start_file_monitoring(self):
        """Test starting file system monitoring"""
        with mock.patch.object(self.server.observer, 'start') as mock_start:
            self.server.start_file_monitoring()
            mock_start.assert_called_once()

    def test_stop_file_monitoring(self):
        """Test stopping file system monitoring"""
        with mock.patch.object(self.server.observer, 'stop') as mock_stop:
            with mock.patch.object(self.server.observer, 'join') as mock_join:
                self.server.stop_file_monitoring()
                mock_stop.assert_called_once()
                mock_join.assert_called_once()

    def test_broadcast_log_entry(self):
        """Test broadcasting log entry to clients"""
        with mock.patch.object(self.server, 'broadcast') as mock_broadcast:
            self.server.broadcast_log_entry('/path/to/agent.log', 'INFO: Test message')
            mock_broadcast.assert_called_once()

    async def test_handle_client_message_get_agent_logs(self):
        """Test handling client message to get agent logs"""
        mock_websocket = mock.AsyncMock()
        message = {'action': 'get_agent_logs', 'agent_id': 'test_agent'}
        
        with mock.patch.object(self.server, 'get_agent_recent_logs', return_value=[]) as mock_get_logs:
            await self.server.handle_client_message(mock_websocket, message)
            mock_get_logs.assert_called_once_with('test_agent')

    async def test_handle_client_message_kill_agent(self):
        """Test handling client message to kill an agent"""
        mock_websocket = mock.AsyncMock()
        message = {'action': 'kill_agent', 'agent_id': 'test_agent'}
        
        # Set up agent with PID
        self.server.agents['test_agent'] = {'pid': 12345, 'status': 'running'}
        
        with mock.patch.object(self.server, 'kill_process_safely', return_value=True) as mock_kill:
            await self.server.handle_client_message(mock_websocket, message)
            mock_kill.assert_called_once_with(12345)

    async def test_handle_client_message_invalid_action(self):
        """Test handling client message with invalid action"""
        mock_websocket = mock.AsyncMock()
        message = {'action': 'invalid_action'}
        
        # Should not crash
        await self.server.handle_client_message(mock_websocket, message)

    def test_shutdown(self):
        """Test server shutdown"""
        with mock.patch.object(self.server, 'stop_file_monitoring') as mock_stop_monitoring:
            self.server.shutdown()
            mock_stop_monitoring.assert_called_once()


class TestDashboardServerIntegration(IsolatedAsyncioTestCase):
    """Integration tests for DashboardServer"""
    
    def setUp(self):
        """Set up integration test fixtures"""
        self.temp_dir = tempfile.mkdtemp()
        self.project_dir = Path(self.temp_dir)
        
        # Mock websockets and task manager availability
        self.websockets_patcher = mock.patch('scripts.dashboard_server.WEBSOCKETS_AVAILABLE', True)
        self.websockets_patcher.start()
        self.task_manager_patcher = mock.patch('scripts.dashboard_server.TASK_MANAGER_AVAILABLE', False)
        self.task_manager_patcher.start()
        
        self.addCleanup(self.cleanup)

    def cleanup(self):
        """Clean up integration test fixtures"""
        self.websockets_patcher.stop()
        self.task_manager_patcher.stop()
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    async def test_full_client_connection_lifecycle(self):
        """Test complete client connection, interaction, and disconnection"""
        server = DashboardServer(str(self.project_dir))
        
        # Mock WebSocket client
        mock_client = mock.AsyncMock()
        
        # Test client connection
        await server.register(mock_client)
        self.assertEqual(len(server.clients), 1)
        
        # Test broadcasting to client
        await server.broadcast({'type': 'test', 'data': 'hello'})
        mock_client.send.assert_called()
        
        # Test client disconnection
        await server.unregister(mock_client)
        self.assertEqual(len(server.clients), 0)
        
        server.shutdown()

    async def test_task_and_process_monitoring(self):
        """Test integrated task and process monitoring"""
        server = DashboardServer(str(self.project_dir))
        
        # Create tasks file
        tasks_data = {
            'tasks': [
                {'id': 'task1', 'type': 'testing', 'priority': 'high', 'status': 'running'},
                {'id': 'task2', 'type': 'security', 'priority': 'medium', 'status': 'queued'}
            ]
        }
        
        with open(server.tasks_file, 'w') as f:
            json.dump(tasks_data, f)
        
        # Load tasks
        server.load_tasks()
        self.assertEqual(len(server.tasks), 2)
        
        # Update system resources
        with mock.patch('psutil.cpu_percent', return_value=50.0):
            with mock.patch('psutil.virtual_memory') as mock_mem:
                with mock.patch('psutil.disk_usage') as mock_disk:
                    mock_mem.return_value = mock.Mock(percent=60.0, available=1000000000)
                    mock_disk.return_value = mock.Mock(percent=70.0, free=2000000000)
                    
                    server.update_system_resources()
        
        self.assertIsNotNone(server.system_resources.get('cpu_percent'))
        self.assertIsNotNone(server.system_resources.get('memory_percent'))
        
        server.shutdown()


class TestDashboardServerErrorHandling(unittest.TestCase):
    """Test error handling and edge cases in DashboardServer"""
    
    def setUp(self):
        """Set up error handling test fixtures"""
        self.temp_dir = tempfile.mkdtemp()
        self.project_dir = Path(self.temp_dir)
        
        # Mock dependencies
        self.websockets_patcher = mock.patch('dashboard_server.WEBSOCKETS_AVAILABLE', True)
        self.websockets_patcher.start()
        self.task_manager_patcher = mock.patch('dashboard_server.TASK_MANAGER_AVAILABLE', False)
        self.task_manager_patcher.start()
        
        self.server = DashboardServer(str(self.project_dir))
        self.addCleanup(self.cleanup)

    def cleanup(self):
        """Clean up error handling test fixtures"""
        self.websockets_patcher.stop()
        self.task_manager_patcher.stop()
        self.server.shutdown()
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_missing_logs_directory(self):
        """Test behavior when logs directory is missing"""
        # Remove logs directory
        import shutil
        shutil.rmtree(self.server.logs_dir)
        
        # Should recreate directory
        logs = self.server.get_agent_recent_logs('test_agent')
        self.assertEqual(len(logs), 0)

    def test_corrupted_log_files(self):
        """Test handling of corrupted log files"""
        agent_id = 'test_agent'
        log_file = self.server.logs_dir / f"{agent_id}.log"
        
        # Create binary log file (should not crash)
        log_file.write_bytes(b'\x00\x01\x02\x03\x04\x05')
        
        logs = self.server.get_agent_recent_logs(agent_id)
        # Should handle gracefully
        
    @mock.patch('psutil.process_iter')
    def test_process_access_denied_errors(self, mock_process_iter):
        """Test handling of process access denied errors"""
        mock_proc = mock.Mock()
        mock_proc.pid = 12345
        mock_proc.name.side_effect = psutil.AccessDenied()
        mock_proc.cmdline.side_effect = psutil.AccessDenied()
        
        mock_process_iter.return_value = [mock_proc]
        
        # Should not crash
        processes = self.server.detect_claude_processes()
        # Should handle gracefully and continue

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