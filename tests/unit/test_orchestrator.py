#!/usr/bin/env python3
"""
Comprehensive unit tests for orchestrator.py
Tests all core functions and classes with edge cases
"""

import unittest
import unittest.mock as mock
import tempfile
import json
import os
from pathlib import Path
from datetime import datetime, timedelta
import sys

# Import from parent directory
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / '.claude'))

try:
    from orchestrator import OpenCodeOrchestrator
except ImportError:
    # Fallback for direct execution
    sys.path.insert(0, str(Path(__file__).parent.parent.parent.absolute() / '.claude'))
    from orchestrator import OpenCodeOrchestrator


class TestOpenCodeOrchestrator(unittest.TestCase):
    """Test OpenCodeOrchestrator class functionality"""

    def setUp(self):
        """Set up test fixtures"""
        self.temp_dir = tempfile.mkdtemp()
        self.project_dir = Path(self.temp_dir)
        # Ensure .claude directory exists
        self.claude_dir = self.project_dir / '.claude'
        self.claude_dir.mkdir(exist_ok=True)
        self.orchestrator = OpenCodeOrchestrator(str(self.project_dir))
        self.addCleanup(self.cleanup)

    def cleanup(self):
        """Clean up test fixtures"""
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_orchestrator_initialization(self):
        """Test orchestrator initialization"""
        self.assertEqual(self.orchestrator.project_dir, self.project_dir)
        self.assertTrue(self.orchestrator.claude_dir.exists())
        self.assertTrue(self.orchestrator.tasks_file.exists())
        self.assertTrue(self.orchestrator.logs_dir.exists())
        self.assertTrue(self.orchestrator.config_file.exists())
        self.assertIsInstance(self.orchestrator.auto_delegate_patterns, dict)
        self.assertIsInstance(self.orchestrator.config, dict)

    def test_load_config_creates_default(self):
        """Test loading config creates default when file doesn't exist"""
        # Remove config file if it exists
        if self.orchestrator.config_file.exists():
            self.orchestrator.config_file.unlink()

        config = self.orchestrator._load_config()

        expected_keys = ['auto_delegate', 'max_concurrent_agents', 'monitor_interval', 'auto_retry_failed', 'delegation_history']
        for key in expected_keys:
            self.assertIn(key, config)

        self.assertTrue(config['auto_delegate'])
        self.assertEqual(config['max_concurrent_agents'], 4)
        self.assertEqual(config['monitor_interval'], 5)
        self.assertTrue(config['auto_retry_failed'])
        self.assertEqual(config['delegation_history'], [])

    def test_load_config_existing_file(self):
        """Test loading config from existing file"""
        test_config = {
            'auto_delegate': False,
            'max_concurrent_agents': 8,
            'monitor_interval': 10,
            'auto_retry_failed': False,
            'delegation_history': [{'test': 'data'}]
        }

        with open(self.orchestrator.config_file, 'w') as f:
            json.dump(test_config, f)

        config = self.orchestrator._load_config()

        self.assertEqual(config, test_config)

    def test_save_config(self):
        """Test saving config to file"""
        test_config = {'test_key': 'test_value'}
        self.orchestrator._save_config(test_config)

        with open(self.orchestrator.config_file, 'r') as f:
            saved_config = json.load(f)

        self.assertEqual(saved_config, test_config)

    def test_analyze_request_auto_delegate_patterns(self):
        """Test analyzing requests for auto-delegation patterns"""
        # Test security pattern
        should_delegate, task_type, keywords = self.orchestrator.analyze_request("Please audit the security of this code")
        self.assertTrue(should_delegate)
        self.assertEqual(task_type, 'security')
        self.assertIn('security', keywords)

        # Test testing pattern
        should_delegate, task_type, keywords = self.orchestrator.analyze_request("Run comprehensive unit tests")
        self.assertTrue(should_delegate)
        self.assertEqual(task_type, 'testing')
        self.assertIn('test', keywords)

        # Test bug pattern
        should_delegate, task_type, keywords = self.orchestrator.analyze_request("Fix this critical bug in the system")
        self.assertTrue(should_delegate)
        self.assertEqual(task_type, 'bugs')
        self.assertIn('bug', keywords)

        # Test performance pattern
        should_delegate, task_type, keywords = self.orchestrator.analyze_request("Optimize the performance of this slow function")
        self.assertTrue(should_delegate)
        self.assertEqual(task_type, 'performance')
        self.assertIn('performance', keywords)

    def test_analyze_request_no_match(self):
        """Test analyzing requests that don't match any patterns"""
        should_delegate, task_type, keywords = self.orchestrator.analyze_request("Please explain how this code works")
        self.assertFalse(should_delegate)
        self.assertIsNone(task_type)
        self.assertEqual(keywords, [])

    def test_analyze_request_case_insensitive(self):
        """Test that pattern matching is case insensitive"""
        should_delegate, task_type, keywords = self.orchestrator.analyze_request("PERFORM SECURITY AUDIT")
        self.assertTrue(should_delegate)
        self.assertEqual(task_type, 'security')

    def test_analyze_request_multiple_keywords(self):
        """Test analyzing requests with multiple matching keywords"""
        should_delegate, task_type, keywords = self.orchestrator.analyze_request("Test the security of this application")
        self.assertTrue(should_delegate)
        self.assertEqual(task_type, 'testing')  # First matching pattern
        self.assertIn('test', keywords)
        self.assertIn('security', keywords)

    @mock.patch('subprocess.run')
    def test_delegate_task_success(self, mock_run):
        """Test successful task delegation"""
        mock_run.return_value = mock.Mock(returncode=0, stdout="Success", stderr="")

        result = self.orchestrator.delegate_task("Test security audit")

        self.assertTrue(result['delegated'])
        self.assertEqual(result['task_type'], 'security')
        self.assertIn('security', result['matched_keywords'])
        self.assertEqual(result['return_code'], 0)
        self.assertEqual(result['stdout'], "Success")
        self.assertEqual(result['stderr'], "")

        # Check delegation was logged
        self.assertEqual(len(self.orchestrator.config['delegation_history']), 1)
        delegation = self.orchestrator.config['delegation_history'][0]
        self.assertEqual(delegation['objective'], "Test security audit")
        self.assertEqual(delegation['task_type'], 'security')

    @mock.patch('subprocess.run')
    def test_delegate_task_failure(self, mock_run):
        """Test task delegation failure"""
        mock_run.return_value = mock.Mock(returncode=1, stdout="", stderr="Error occurred")

        result = self.orchestrator.delegate_task("Invalid task")

        self.assertTrue(result['delegated'])
        self.assertEqual(result['return_code'], 1)
        self.assertEqual(result['stderr'], "Error occurred")

    @mock.patch('subprocess.run')
    def test_delegate_task_auto_delegate_disabled(self, mock_run):
        """Test delegation when auto-delegate is disabled"""
        self.orchestrator.config['auto_delegate'] = False

        result = self.orchestrator.delegate_task("Please explain this code")

        self.assertFalse(result['delegated'])
        self.assertIn('Auto-delegation disabled', result['reason'])
        mock_run.assert_not_called()

    @mock.patch('subprocess.run')
    def test_delegate_task_force_override(self, mock_run):
        """Test forced delegation overrides auto-delegate setting"""
        self.orchestrator.config['auto_delegate'] = False
        mock_run.return_value = mock.Mock(returncode=0, stdout="Success", stderr="")

        result = self.orchestrator.delegate_task("Test security audit", force=True)

        self.assertTrue(result['delegated'])
        mock_run.assert_called_once()

    @mock.patch('subprocess.run')
    def test_monitor_agents_continuous_true(self, mock_run):
        """Test monitoring agents continuously"""
        # Mock successful status check
        mock_run.return_value = mock.Mock(returncode=0, stdout="agents running", stderr="")

        result = self.orchestrator.monitor_agents(continuous=True)

        # Should return when agents stop running
        mock_run.return_value = mock.Mock(returncode=0, stdout="no agents running", stderr="")
        result = self.orchestrator.monitor_agents(continuous=False)

        self.assertIn('timestamp', result)
        self.assertIn('output', result)
        self.assertFalse(result['agents_running'])

    @mock.patch('subprocess.run')
    def test_monitor_agents_continuous_false(self, mock_run):
        """Test monitoring agents once"""
        mock_run.return_value = mock.Mock(returncode=0, stdout="status output", stderr="")

        result = self.orchestrator.monitor_agents(continuous=False)

        self.assertIn('timestamp', result)
        self.assertEqual(result['output'], "status output")
        self.assertFalse(result['agents_running'])  # "agents running" not in output

    @mock.patch('subprocess.run')
    def test_get_recommendations_with_failing_tests(self, mock_run):
        """Test getting recommendations when tests are failing"""
        # Mock npm test failure
        mock_run.return_value = mock.Mock(returncode=1)

        # Create package.json to trigger npm test check
        package_json = self.project_dir / 'package.json'
        package_json.write_text('{"scripts": {"test": "jest"}}')

        recommendations = self.orchestrator.get_recommendations()

        self.assertIn("Fix all failing unit tests and integration tests", recommendations)

    @mock.patch('subprocess.run')
    def test_get_recommendations_missing_readme(self, mock_run):
        """Test getting recommendations when README is missing"""
        # Mock successful npm commands
        mock_run.return_value = mock.Mock(returncode=0, stdout="")

        recommendations = self.orchestrator.get_recommendations()

        self.assertIn("Create comprehensive README documentation", recommendations)

    @mock.patch('subprocess.run')
    def test_get_recommendations_with_vulnerabilities(self, mock_run):
        """Test getting recommendations when security vulnerabilities exist"""
        # Mock npm audit with vulnerabilities
        mock_run.return_value = mock.Mock(returncode=0, stdout="2 vulnerabilities")

        # Create package-lock.json to trigger audit check
        package_lock = self.project_dir / 'package-lock.json'
        package_lock.write_text('{"dependencies": {}}')

        recommendations = self.orchestrator.get_recommendations()

        self.assertIn("Perform security audit and fix all vulnerabilities", recommendations)

    def test_get_recommendations_default(self):
        """Test getting default recommendations"""
        recommendations = self.orchestrator.get_recommendations()

        expected_recs = [
            "Improve code quality with linting, formatting, and best practices",
            "Make application production ready with monitoring and error handling"
        ]

        for rec in expected_recs:
            self.assertIn(rec, recommendations)

    def test_create_delegation_plan_testing(self):
        """Test creating delegation plan for testing objective"""
        objective = "Create comprehensive unit tests for all functions"
        tasks = self.orchestrator.create_delegation_plan(objective)

        expected_tasks = [
            "Create unit tests for all core functions with 80% coverage",
            "Build integration tests for API endpoints",
            "Set up continuous integration testing pipeline",
            "Add end-to-end tests for critical user flows"
        ]

        for task in expected_tasks:
            self.assertIn(task, tasks)

    def test_create_delegation_plan_bug_fixing(self):
        """Test creating delegation plan for bug fixing objective"""
        objective = "Fix all bugs in the application"
        tasks = self.orchestrator.create_delegation_plan(objective)

        expected_tasks = [
            "Analyze codebase for syntax errors and fix them",
            "Review error logs and fix runtime errors",
            "Test all features and fix broken functionality",
            "Add error handling for edge cases"
        ]

        for task in expected_tasks:
            self.assertIn(task, tasks)

    def test_create_delegation_plan_production(self):
        """Test creating delegation plan for production readiness"""
        objective = "Make this application production ready"
        tasks = self.orchestrator.create_delegation_plan(objective)

        expected_tasks = [
            "Add comprehensive error handling and recovery",
            "Implement structured logging throughout application",
            "Set up monitoring and alerting systems",
            "Add health check endpoints",
            "Optimize performance for production load"
        ]

        for task in expected_tasks:
            self.assertIn(task, tasks)

    def test_create_delegation_plan_security(self):
        """Test creating delegation plan for security objective"""
        objective = "Perform security audit and improvements"
        tasks = self.orchestrator.create_delegation_plan(objective)

        expected_tasks = [
            "Audit code for security vulnerabilities",
            "Implement input validation and sanitization",
            "Add authentication and authorization checks",
            "Review and fix dependency vulnerabilities"
        ]

        for task in expected_tasks:
            self.assertIn(task, tasks)

    def test_create_delegation_plan_no_match(self):
        """Test creating delegation plan for objective with no specific patterns"""
        objective = "Refactor this code for better readability"
        tasks = self.orchestrator.create_delegation_plan(objective)

        self.assertEqual(tasks, [objective])


class TestOpenCodeOrchestratorEdgeCases(unittest.TestCase):
    """Test edge cases and error handling in OpenCodeOrchestrator"""

    def setUp(self):
        """Set up test fixtures"""
        self.temp_dir = tempfile.mkdtemp()
        self.project_dir = Path(self.temp_dir)
        # Ensure .claude directory exists
        self.claude_dir = self.project_dir / '.claude'
        self.claude_dir.mkdir(exist_ok=True)
        self.orchestrator = OpenCodeOrchestrator(str(self.project_dir))
        self.addCleanup(self.cleanup)

    def cleanup(self):
        """Clean up test fixtures"""
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_config_file_corruption(self):
        """Test handling of corrupted config file"""
        # Write invalid JSON
        with open(self.orchestrator.config_file, 'w') as f:
            f.write("invalid json content")

        # Should create default config
        config = self.orchestrator._load_config()
        self.assertIsInstance(config, dict)
        self.assertIn('auto_delegate', config)

    def test_config_file_permission_denied(self):
        """Test handling of config file permission issues"""
        # Make config directory read-only
        self.orchestrator.config_file.parent.chmod(0o444)

        try:
            # Should not crash
            config = self.orchestrator._load_config()
            self.assertIsInstance(config, dict)
        finally:
            # Restore permissions
            self.orchestrator.config_file.parent.chmod(0o755)

    @mock.patch('subprocess.run')
    def test_subprocess_command_failure(self, mock_run):
        """Test handling of subprocess command failures"""
        mock_run.side_effect = Exception("Command failed")

        # Should not crash
        result = self.orchestrator.delegate_task("Test task")
        self.assertTrue(result['delegated'])
        self.assertIn('return_code', result)

    def test_analyze_request_empty_string(self):
        """Test analyzing empty request string"""
        should_delegate, task_type, keywords = self.orchestrator.analyze_request("")
        self.assertFalse(should_delegate)
        self.assertIsNone(task_type)
        self.assertEqual(keywords, [])

    def test_analyze_request_none_input(self):
        """Test analyzing None input"""
        should_delegate, task_type, keywords = self.orchestrator.analyze_request(None)
        self.assertFalse(should_delegate)
        self.assertIsNone(task_type)
        self.assertEqual(keywords, [])

    def test_delegation_history_persistence(self):
        """Test that delegation history persists across orchestrator instances"""
        # Add a delegation
        self.orchestrator.config['delegation_history'].append({
            'timestamp': datetime.now().isoformat(),
            'objective': 'test objective',
            'task_type': 'testing'
        })
        self.orchestrator._save_config(self.orchestrator.config)

        # Create new instance
        new_orchestrator = OpenCodeOrchestrator(str(self.project_dir))

        # Should load the history
        self.assertEqual(len(new_orchestrator.config['delegation_history']), 1)
        self.assertEqual(new_orchestrator.config['delegation_history'][0]['objective'], 'test objective')

    def test_monitor_agents_with_exception(self):
        """Test monitoring agents when subprocess raises exception"""
        with mock.patch('subprocess.run', side_effect=Exception("Network error")):
            # Should not crash
            result = self.orchestrator.monitor_agents(continuous=False)
            self.assertIn('timestamp', result)
            self.assertIn('output', result)

    def test_get_recommendations_with_missing_commands(self):
        """Test getting recommendations when external commands are not available"""
        with mock.patch('subprocess.run', side_effect=FileNotFoundError("npm not found")):
            # Should not crash
            recommendations = self.orchestrator.get_recommendations()
            self.assertIsInstance(recommendations, list)
            self.assertGreater(len(recommendations), 0)


class TestOpenCodeOrchestratorIntegration(unittest.TestCase):
    """Integration tests for OpenCodeOrchestrator"""

    def setUp(self):
        """Set up integration test fixtures"""
        self.temp_dir = tempfile.mkdtemp()
        self.project_dir = Path(self.temp_dir)
        # Ensure .claude directory exists
        self.claude_dir = self.project_dir / '.claude'
        self.claude_dir.mkdir(exist_ok=True)
        self.orchestrator = OpenCodeOrchestrator(str(self.project_dir))
        self.addCleanup(self.cleanup)

    def cleanup(self):
        """Clean up integration test fixtures"""
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    @mock.patch('subprocess.run')
    def test_full_delegation_workflow(self, mock_run):
        """Test complete delegation workflow"""
        mock_run.return_value = mock.Mock(returncode=0, stdout="Task completed successfully", stderr="")

        # Analyze request
        should_delegate, task_type, keywords = self.orchestrator.analyze_request("Run security audit on the codebase")
        self.assertTrue(should_delegate)
        self.assertEqual(task_type, 'security')

        # Delegate task
        result = self.orchestrator.delegate_task("Run security audit on the codebase")
        self.assertTrue(result['delegated'])
        self.assertEqual(result['task_type'], 'security')

        # Check history was updated
        self.assertEqual(len(self.orchestrator.config['delegation_history']), 1)

        # Monitor agents
        monitor_result = self.orchestrator.monitor_agents(continuous=False)
        self.assertIn('timestamp', monitor_result)

        # Get recommendations
        recommendations = self.orchestrator.get_recommendations()
        self.assertIsInstance(recommendations, list)

    def test_config_persistence_across_operations(self):
        """Test that config changes persist across operations"""
        original_auto_delegate = self.orchestrator.config['auto_delegate']

        # Modify config
        self.orchestrator.config['auto_delegate'] = not original_auto_delegate
        self.orchestrator._save_config(self.orchestrator.config)

        # Create new instance
        new_orchestrator = OpenCodeOrchestrator(str(self.project_dir))

        # Config should be persisted
        self.assertEqual(new_orchestrator.config['auto_delegate'], not original_auto_delegate)



if __name__ == '__main__':
    unittest.main()
