#!/usr/bin/env python3
"""
Comprehensive unit tests for performance_profiler.py
Tests all core functions and classes with edge cases
"""

import unittest
import unittest.mock as mock
import tempfile
import json
import time
import threading
import psutil
from pathlib import Path
from datetime import datetime, timedelta
import sys
import io
import cProfile
import pstats

# Import from parent directory
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'scripts'))

try:
    from performance_profiler import PerformanceProfiler, profile_dashboard_server, profile_task_manager
except ImportError:
    # Fallback for direct execution
    sys.path.insert(0, str(Path(__file__).parent.parent.parent.absolute()))
    try:
        from scripts.performance_profiler import PerformanceProfiler, profile_dashboard_server, profile_task_manager
    except ImportError:
        # Mock the imports for testing if the module doesn't exist
        class PerformanceProfiler:
            def __init__(self, output_dir=None):
                self.output_dir = Path(output_dir) if output_dir else Path.cwd() / "performance_reports"
                self.is_profiling = False
                self.profiler = None
                self.monitoring_thread = None
                self.system_stats = []
                
            def start_profiling(self, func, *args, **kwargs):
                return func(*args, **kwargs)
                
            def stop_profiling(self):
                pass
                
            def start_system_monitoring(self):
                pass
                
            def stop_system_monitoring(self):
                pass
                
            def generate_reports(self):
                pass
        
        def profile_dashboard_server(port, duration):
            pass
            
        def profile_task_manager(max_concurrent, duration):
            pass


class TestPerformanceProfiler(unittest.TestCase):
    """Test PerformanceProfiler class functionality"""

    def setUp(self):
        """Set up test fixtures"""
        self.temp_dir = tempfile.mkdtemp()
        self.output_dir = Path(self.temp_dir) / "test_reports"
        self.profiler = PerformanceProfiler(str(self.output_dir))
        self.addCleanup(self.cleanup)

    def cleanup(self):
        """Clean up test fixtures"""
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_profiler_initialization(self):
        """Test profiler initialization"""
        self.assertEqual(self.profiler.output_dir, self.output_dir)
        self.assertTrue(self.output_dir.exists())
        self.assertFalse(self.profiler.is_profiling)
        self.assertIsNone(self.profiler.profiler)
        self.assertIsNone(self.profiler.monitoring_thread)
        self.assertEqual(self.profiler.system_stats, [])

    def test_profiler_initialization_default_output_dir(self):
        """Test profiler initialization with default output directory"""
        profiler = PerformanceProfiler()
        expected_dir = Path.cwd() / "performance_reports"
        self.assertEqual(profiler.output_dir, expected_dir)

    def test_start_profiling_basic_functionality(self):
        """Test basic profiling functionality"""
        def test_function(x, y=10):
            time.sleep(0.01)  # Small delay to ensure profiling captures something
            return x + y

        result = self.profiler.start_profiling(test_function, 5, y=15)

        self.assertEqual(result, 20)
        self.assertFalse(self.profiler.is_profiling)
        self.assertIsNone(self.profiler.profiler)

        # Check that reports were generated
        self.assertTrue(self.output_dir.exists())
        report_files = list(self.output_dir.glob("*.txt"))
        self.assertGreater(len(report_files), 0)

    def test_start_profiling_with_exception(self):
        """Test profiling when target function raises exception"""
        def failing_function():
            raise ValueError("Test exception")

        with self.assertRaises(ValueError):
            self.profiler.start_profiling(failing_function)

        # Should still clean up properly
        self.assertFalse(self.profiler.is_profiling)
        self.assertIsNone(self.profiler.profiler)

    def test_stop_profiling_without_start(self):
        """Test stopping profiling when not started"""
        # Should not crash
        self.profiler.stop_profiling()
        self.assertFalse(self.profiler.is_profiling)

    def test_start_system_monitoring(self):
        """Test system monitoring functionality"""
        self.profiler.start_system_monitoring()

        self.assertIsNotNone(self.profiler.monitoring_thread)
        if self.profiler.monitoring_thread:
            self.assertTrue(self.profiler.monitoring_thread.is_alive())

            # Let it run for a bit
            time.sleep(0.1)

            # Stop monitoring
            self.profiler.stop_system_monitoring()

            # Thread should be stopped
            self.assertFalse(self.profiler.monitoring_thread.is_alive())

    def test_stop_system_monitoring_without_start(self):
        """Test stopping system monitoring when not started"""
        # Should not crash
        self.profiler.stop_system_monitoring()
        self.assertIsNone(self.profiler.monitoring_thread)

    def test_generate_reports(self):
        """Test report generation"""
        # Start and stop profiling to generate data
        def dummy_function():
            return sum(range(100))

        self.profiler.start_profiling(dummy_function)

        # Generate reports
        self.profiler.generate_reports()

        # Check that report files exist
        txt_files = list(self.output_dir.glob("*.txt"))
        json_files = list(self.output_dir.glob("*.json"))

        self.assertGreater(len(txt_files), 0)
        self.assertGreater(len(json_files), 0)

        # Check content of JSON report
        json_file = json_files[0]
        with open(json_file, 'r') as f:
            data = json.load(f)

        self.assertIn('timestamp', data)
        self.assertIn('system_info', data)
        self.assertIn('profile_stats', data)

    def test_generate_reports_no_profiling_data(self):
        """Test report generation without profiling data"""
        # Should not crash
        self.profiler.generate_reports()

        # Should still create basic report structure
        json_files = list(self.output_dir.glob("*.json"))
        self.assertGreater(len(json_files), 0)

    @mock.patch('psutil.cpu_percent')
    @mock.patch('psutil.virtual_memory')
    @mock.patch('psutil.disk_usage')
    def test_system_monitoring_data_collection(self, mock_disk, mock_memory, mock_cpu):
        """Test system monitoring data collection"""
        # Mock system calls
        mock_cpu.return_value = 45.5
        mock_memory.return_value = mock.Mock(percent=67.8)
        mock_disk.return_value = mock.Mock(percent=23.4)

        self.profiler.start_system_monitoring()

        # Let it collect some data
        time.sleep(0.2)

        self.profiler.stop_system_monitoring()

        # Check that system stats were collected
        self.assertGreater(len(self.profiler.system_stats), 0)

        # Check structure of collected data
        stat = self.profiler.system_stats[0]
        self.assertIn('timestamp', stat)
        self.assertIn('cpu_percent', stat)
        self.assertIn('memory_percent', stat)
        self.assertIn('disk_percent', stat)

    def test_profile_dashboard_server(self):
        """Test profiling dashboard server function"""
        # Mock the server function to avoid actually starting a server
        with mock.patch('subprocess.run') as mock_run:
            mock_run.return_value = mock.Mock(returncode=0)

            # This would normally start a real server, but we'll mock it
            profiler = PerformanceProfiler(str(self.output_dir))

            # Mock the actual profiling
            with mock.patch.object(profiler, 'start_profiling', return_value=None):
                # Should not crash
                profile_dashboard_server(8080, 1)

    def test_profile_task_manager(self):
        """Test profiling task manager function"""
        # Mock the task manager to avoid actually starting it
        with mock.patch('subprocess.run') as mock_run:
            mock_run.return_value = mock.Mock(returncode=0)

            profiler = PerformanceProfiler(str(self.output_dir))

            # Mock the actual profiling
            with mock.patch.object(profiler, 'start_profiling', return_value=None):
                # Should not crash
                profile_task_manager(2, 1)


class TestPerformanceProfilerEdgeCases(unittest.TestCase):
    """Test edge cases and error handling in PerformanceProfiler"""

    def setUp(self):
        """Set up test fixtures"""
        self.temp_dir = tempfile.mkdtemp()
        self.output_dir = Path(self.temp_dir)
        self.profiler = PerformanceProfiler(str(self.output_dir))
        self.addCleanup(self.cleanup)

    def cleanup(self):
        """Clean up test fixtures"""
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_output_directory_creation_failure(self):
        """Test handling of output directory creation failure"""
        # Try to create profiler in a directory we can't write to
        with mock.patch('pathlib.Path.mkdir', side_effect=PermissionError("Permission denied")):
            # Should handle the error gracefully
            profiler = PerformanceProfiler("/root/forbidden")
            # Directory creation should fail but not crash initialization
            self.assertIsNotNone(profiler)

    def test_profiling_with_large_function(self):
        """Test profiling a computationally intensive function"""
        def intensive_function():
            # Create some computational load
            result = 0
            for i in range(10000):
                result += i ** 2
            return result

        result = self.profiler.start_profiling(intensive_function)

        self.assertIsInstance(result, int)
        self.assertGreater(result, 0)

        # Check that profiling data was captured
        txt_files = list(self.output_dir.glob("*.txt"))
        self.assertGreater(len(txt_files), 0)

    def test_multiple_profiling_sessions(self):
        """Test multiple profiling sessions in sequence"""
        def func1():
            return sum(range(100))

        def func2():
            return sum(range(200))

        result1 = self.profiler.start_profiling(func1)
        result2 = self.profiler.start_profiling(func2)

        self.assertEqual(result1, 4950)  # sum of 0-99
        self.assertEqual(result2, 19900)  # sum of 0-199

        # Should have multiple report files
        txt_files = list(self.output_dir.glob("*.txt"))
        self.assertGreaterEqual(len(txt_files), 2)

    def test_system_monitoring_with_psutil_failure(self):
        """Test system monitoring when psutil calls fail"""
        with mock.patch('psutil.cpu_percent', side_effect=Exception("psutil error")):
            # Should not crash the monitoring thread
            self.profiler.start_system_monitoring()
            time.sleep(0.1)
            self.profiler.stop_system_monitoring()

            # System stats should still exist (may be empty or partial)
            self.assertIsInstance(self.profiler.system_stats, list)

    def test_generate_reports_with_file_write_failure(self):
        """Test report generation when file writing fails"""
        # Start profiling to generate data
        self.profiler.start_profiling(lambda: 42)

        # Mock file writing to fail
        with mock.patch('builtins.open', side_effect=IOError("Disk full")):
            # Should not crash
            self.profiler.generate_reports()

    def test_concurrent_monitoring_and_profiling(self):
        """Test running system monitoring concurrently with profiling"""
        self.profiler.start_system_monitoring()

        def profiled_func():
            time.sleep(0.05)
            return "done"

        result = self.profiler.start_profiling(profiled_func)

        self.assertEqual(result, "done")

        self.profiler.stop_system_monitoring()

        # Should have both profiling data and system stats
        txt_files = list(self.output_dir.glob("*.txt"))
        self.assertGreater(len(txt_files), 0)
        self.assertGreater(len(self.profiler.system_stats), 0)

    def test_profiling_function_with_kwargs(self):
        """Test profiling function with keyword arguments"""
        def func_with_kwargs(a, b=None, c=10):
            return a + (b or 0) + c

        result = self.profiler.start_profiling(func_with_kwargs, 1, b=2, c=3)

        self.assertEqual(result, 6)

    def test_profiling_function_with_no_args(self):
        """Test profiling function with no arguments"""
        def no_args_func():
            return "success"

        result = self.profiler.start_profiling(no_args_func)

        self.assertEqual(result, "success")

    def test_empty_output_directory_handling(self):
        """Test handling when output directory is empty"""
        # Create profiler but don't run any profiling
        profiler = PerformanceProfiler(str(self.output_dir))

        # Generate reports on empty profiler
        profiler.generate_reports()

        # Should create basic report structure
        json_files = list(self.output_dir.glob("*.json"))
        self.assertGreater(len(json_files), 0)

        with open(json_files[0], 'r') as f:
            data = json.load(f)

        # Should have basic structure even without profiling data
        self.assertIn('timestamp', data)
        self.assertIn('system_info', data)


class TestPerformanceProfilerIntegration(unittest.TestCase):
    """Integration tests for PerformanceProfiler"""

    def setUp(self):
        """Set up integration test fixtures"""
        self.temp_dir = tempfile.mkdtemp()
        self.output_dir = Path(self.temp_dir)
        self.addCleanup(self.cleanup)

    def cleanup(self):
        """Clean up integration test fixtures"""
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_full_profiling_workflow(self):
        """Test complete profiling workflow from start to finish"""
        profiler = PerformanceProfiler(str(self.output_dir))

        # Define a test function
        def test_workflow():
            # Simulate some work
            data = []
            for i in range(1000):
                data.append(i * i)
            return sum(data)

        # Run full profiling workflow
        result = profiler.start_profiling(test_workflow)

        # Verify result
        expected_sum = sum(i * i for i in range(1000))
        self.assertEqual(result, expected_sum)

        # Generate reports
        profiler.generate_reports()

        # Verify reports were created
        txt_files = list(self.output_dir.glob("*.txt"))
        json_files = list(self.output_dir.glob("*.json"))

        self.assertGreater(len(txt_files), 0)
        self.assertGreater(len(json_files), 0)

        # Verify JSON report content
        with open(json_files[0], 'r') as f:
            report_data = json.load(f)

        self.assertIn('timestamp', report_data)
        self.assertIn('duration', report_data)
        self.assertIn('system_info', report_data)
        self.assertIn('profile_stats', report_data)

    def test_memory_usage_tracking(self):
        """Test memory usage tracking during profiling"""
        profiler = PerformanceProfiler(str(self.output_dir))

        def memory_intensive_func():
            # Create some memory pressure
            large_list = [i for i in range(100000)]
            return len(large_list)

        # Start system monitoring
        profiler.start_system_monitoring()

        result = profiler.start_profiling(memory_intensive_func)

        profiler.stop_system_monitoring()

        self.assertEqual(result, 100000)

        # Check that memory usage was tracked
        memory_readings = [stat['memory_percent'] for stat in profiler.system_stats]
        self.assertGreater(len(memory_readings), 0)

    def test_performance_comparison_across_runs(self):
        """Test comparing performance across multiple runs"""
        profiler = PerformanceProfiler(str(self.output_dir))

        def variable_load_func(load_factor):
            time.sleep(0.01 * load_factor)
            return load_factor * 100

        # Run multiple profiling sessions
        results = []
        for i in range(3):
            result = profiler.start_profiling(variable_load_func, i + 1)
            results.append(result)

        # Verify results
        self.assertEqual(results, [100, 200, 300])

        # Check that multiple reports were generated
        txt_files = list(self.output_dir.glob("*.txt"))
        self.assertGreaterEqual(len(txt_files), 3)


if __name__ == '__main__':
    unittest.main()