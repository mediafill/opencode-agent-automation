#!/usr/bin/env python3
"""
OpenCode Agent Performance Profiler
Profiles application performance and identifies bottlenecks
"""

import cProfile
import pstats
import io
import time
import psutil
import threading
from pathlib import Path
import argparse
import sys
from datetime import datetime

class PerformanceProfiler:
    """Performance profiling and monitoring tool"""

    def __init__(self, output_dir: str = None):
        self.output_dir = Path(output_dir) if output_dir else Path.cwd() / "performance_reports"
        self.output_dir.mkdir(exist_ok=True)
        self.is_profiling = False
        self.profiler = None
        self.monitoring_thread = None
        self.system_stats = []

    def start_profiling(self, target_function, *args, **kwargs):
        """Start profiling a specific function"""
        print(f"Starting performance profiling...")
        self.profiler = cProfile.Profile()
        self.profiler.enable()
        self.is_profiling = True

        # Start system monitoring
        self.start_system_monitoring()

        try:
            # Run the target function
            result = target_function(*args, **kwargs)
            return result
        finally:
            self.stop_profiling()

    def stop_profiling(self):
        """Stop profiling and generate reports"""
        if not self.is_profiling:
            return

        self.is_profiling = False
        self.profiler.disable()

        # Stop system monitoring
        self.stop_system_monitoring()

        # Generate reports
        self.generate_reports()

    def start_system_monitoring(self):
        """Start monitoring system resources"""
        self.system_stats = []

        def monitor():
            while self.is_profiling:
                try:
                    stats = {
                        'timestamp': time.time(),
                        'cpu_percent': psutil.cpu_percent(interval=0.1),
                        'memory_percent': psutil.virtual_memory().percent,
                        'memory_used': psutil.virtual_memory().used,
                        'disk_io': (psutil.disk_io_counters().read_bytes + psutil.disk_io_counters().write_bytes) if psutil.disk_io_counters() else 0,
                        'network_io': sum(psutil.net_io_counters().bytes_sent + psutil.net_io_counters().bytes_recv for nic in psutil.net_io_counters(pernic=True).values()) if psutil.net_io_counters() else 0
                    }
                    self.system_stats.append(stats)
                    time.sleep(0.5)  # Sample every 0.5 seconds
                except Exception as e:
                    print(f"Error monitoring system: {e}")
                    break

        self.monitoring_thread = threading.Thread(target=monitor, daemon=True)
        self.monitoring_thread.start()

    def stop_system_monitoring(self):
        """Stop system monitoring"""
        if self.monitoring_thread and self.monitoring_thread.is_alive():
            self.monitoring_thread.join(timeout=2)

    def generate_reports(self):
        """Generate performance reports"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

        # Profile report
        profile_report = self.output_dir / f"profile_report_{timestamp}.txt"
        stream = io.StringIO()
        stats = pstats.Stats(self.profiler, stream=stream)
        stats.sort_stats('cumulative')
        stats.print_stats(50)  # Top 50 functions

        with open(profile_report, 'w') as f:
            f.write(f"Performance Profile Report - {datetime.now()}\n")
            f.write("=" * 60 + "\n\n")
            f.write("Top 50 functions by cumulative time:\n")
            f.write("-" * 40 + "\n")
            f.write(stream.getvalue())

        # System resources report
        system_report = self.output_dir / f"system_report_{timestamp}.csv"
        with open(system_report, 'w') as f:
            f.write("timestamp,cpu_percent,memory_percent,memory_used,disk_io,network_io\n")
            for stat in self.system_stats:
                f.write(f"{stat['timestamp']},{stat['cpu_percent']},{stat['memory_percent']},{stat['memory_used']},{stat['disk_io']},{stat['network_io']}\n")

        # Summary report
        summary_report = self.output_dir / f"summary_report_{timestamp}.txt"
        if self.system_stats:
            avg_cpu = sum(s['cpu_percent'] for s in self.system_stats) / len(self.system_stats)
            max_cpu = max(s['cpu_percent'] for s in self.system_stats)
            avg_memory = sum(s['memory_percent'] for s in self.system_stats) / len(self.system_stats)
            max_memory = max(s['memory_percent'] for s in self.system_stats)

            with open(summary_report, 'w') as f:
                f.write(f"Performance Summary Report - {datetime.now()}\n")
                f.write("=" * 60 + "\n\n")
                f.write(f"Monitoring duration: {len(self.system_stats) * 0.5:.1f} seconds\n")
                f.write(f"Samples collected: {len(self.system_stats)}\n\n")
                f.write("System Resource Usage:\n")
                f.write("-" * 25 + "\n")
                f.write(f"Average CPU usage: {avg_cpu:.1f}%\n")
                f.write(f"Peak CPU usage: {max_cpu:.1f}%\n")
                f.write(f"Average memory usage: {avg_memory:.1f}%\n")
                f.write(f"Peak memory usage: {max_memory:.1f}%\n\n")
                f.write("Reports generated:\n")
                f.write(f"- Profile report: {profile_report}\n")
                f.write(f"- System report: {system_report}\n")

        print(f"Performance reports generated in {self.output_dir}")
        print(f"- Profile: {profile_report}")
        print(f"- System: {system_report}")
        print(f"- Summary: {summary_report}")

def profile_dashboard_server(port: int = 8080, duration: int = 30):
    """Profile the dashboard server for a specified duration"""
    try:
        from dashboard_server import DashboardServer
    except ImportError:
        print("Error: Could not import DashboardServer. Make sure you're in the correct directory.")
        return

    profiler = PerformanceProfiler()

    def run_server():
        server = DashboardServer(port=port)
        # Run for specified duration
        time.sleep(duration)

    print(f"Profiling dashboard server on port {port} for {duration} seconds...")
    profiler.start_profiling(run_server)
    print("Profiling completed.")

def profile_task_manager(max_concurrent: int = 4, duration: int = 30):
    """Profile the task manager"""
    try:
        from task_manager import TaskManager
    except ImportError:
        print("Error: Could not import TaskManager. Make sure you're in the correct directory.")
        return

    profiler = PerformanceProfiler()

    def run_task_manager():
        manager = TaskManager(max_concurrent=max_concurrent)
        manager.start()
        time.sleep(duration)
        manager.stop()

    print(f"Profiling task manager (max_concurrent={max_concurrent}) for {duration} seconds...")
    profiler.start_profiling(run_task_manager)
    print("Profiling completed.")

def main():
    parser = argparse.ArgumentParser(description='OpenCode Agent Performance Profiler')
    parser.add_argument('--output-dir', '-o', default='performance_reports',
                       help='Output directory for reports')
    parser.add_argument('--target', '-t', choices=['dashboard', 'task_manager', 'custom'],
                       default='dashboard', help='Profiling target')
    parser.add_argument('--duration', '-d', type=int, default=30,
                       help='Profiling duration in seconds')
    parser.add_argument('--port', '-p', type=int, default=8080,
                       help='Port for dashboard server profiling')
    parser.add_argument('--max-concurrent', '-m', type=int, default=4,
                       help='Max concurrent tasks for task manager profiling')

    args = parser.parse_args()

    profiler = PerformanceProfiler(args.output_dir)

    if args.target == 'dashboard':
        profile_dashboard_server(args.port, args.duration)
    elif args.target == 'task_manager':
        profile_task_manager(args.max_concurrent, args.duration)
    else:
        print("Custom profiling not implemented yet. Use --target dashboard or task_manager")

if __name__ == '__main__':
    main()</content>
