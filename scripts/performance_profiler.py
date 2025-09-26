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
try:
    from intelligent_cache import (
        get_cache, cache_system_operation, cache_process_operation,
        invalidate_system_cache
    )
    CACHE_AVAILABLE = True
except ImportError:
    CACHE_AVAILABLE = False


class PerformanceProfiler:
    """Performance profiling and monitoring tool"""

    def __init__(self, output_dir: Optional[str] = None):
        self.output_dir = (
            Path(output_dir) if output_dir else Path.cwd() / "performance_reports"
        )
        self.output_dir.mkdir(exist_ok=True)
        self.is_profiling = False
        self.profiler = None
        self.monitoring_thread = None
        self.system_stats = []
        # Cache for network monitoring optimization
        self._net_interfaces = None
        self._last_net_time = 0

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
        if self.profiler:
            self.profiler.disable()

        # Stop system monitoring
        self.stop_system_monitoring()

        # Generate reports
        self.generate_reports()

    def start_system_monitoring(self):
        """Start monitoring system resources with intelligent caching"""
        self.system_stats = []

        def monitor():
            while self.is_profiling:
                try:
                    current_time = time.time()

                    # Use cached system operations to reduce expensive psutil calls
                    if CACHE_AVAILABLE:
                        # Cache CPU usage (expensive operation)
                        cpu_percent = cache_system_operation(
                            lambda: psutil.cpu_percent(interval=0.1), "cpu_percent"
                        )

                        # Cache memory info (expensive operation)
                        memory_info = cache_system_operation(
                            lambda: psutil.virtual_memory(), "virtual_memory"
                        )
                        memory_percent = memory_info.percent
                        memory_used = memory_info.used

                        # Cache disk I/O (expensive operation)
                        disk_io = cache_system_operation(
                            self._get_disk_io, "disk_io"
                        )

                        # Cache network I/O with existing throttling
                        network_io = cache_system_operation(
                            self._get_network_io, "network_io"
                        )
                    else:
                        # Fallback to direct calls if cache not available
                        cpu_percent = psutil.cpu_percent(interval=0.1)
                        memory_info = psutil.virtual_memory()
                        memory_percent = memory_info.percent
                        memory_used = memory_info.used
                        disk_io = self._get_disk_io()
                        network_io = self._get_network_io()

                    stats = {
                        "timestamp": current_time,
                        "cpu_percent": cpu_percent,
                        "memory_percent": memory_percent,
                        "memory_used": memory_used,
                        "disk_io": disk_io,
                        "network_io": network_io,
                    }
                    self.system_stats.append(stats)
                    time.sleep(1.0)
                except Exception as e:
                    print(f"Error monitoring system: {e}")
                    break

        self.monitoring_thread = threading.Thread(target=monitor, daemon=True)
        self.monitoring_thread.start()

    def _get_disk_io(self):
        """Get disk I/O counters safely"""
        disk_counters = psutil.disk_io_counters()
        return (
            (disk_counters.read_bytes + disk_counters.write_bytes)
            if disk_counters
            else 0
        )

    def _get_network_io(self):
        """Get network I/O with intelligent caching and throttling"""
        # Cache network interfaces to avoid repeated expensive calls
        if not hasattr(self, "_net_interfaces"):
            self._net_interfaces = psutil.net_io_counters(pernic=True)
            self._last_net_time = time.time()

        # Only refresh network stats every 2 seconds to reduce overhead
        current_time = time.time()
        if current_time - self._last_net_time > 2.0:
            self._net_interfaces = psutil.net_io_counters(pernic=True)
            self._last_net_time = current_time

        # Calculate network IO more efficiently
        return (
            sum(
                (iface.bytes_sent + iface.bytes_recv)
                for iface in self._net_interfaces.values()
                if hasattr(iface, "bytes_sent") and hasattr(iface, "bytes_recv")
            )
            if self._net_interfaces
            else 0
        )

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
        stats.sort_stats("cumulative")
        stats.print_stats(50)  # Top 50 functions

        with open(profile_report, "w") as f:
            f.write(f"Performance Profile Report - {datetime.now()}\n")
            f.write("=" * 60 + "\n\n")
            f.write("Top 50 functions by cumulative time:\n")
            f.write("-" * 40 + "\n")
            f.write(stream.getvalue())

        # System resources report
        system_report = self.output_dir / f"system_report_{timestamp}.csv"
        with open(system_report, "w") as f:
            f.write(
                "timestamp,cpu_percent,memory_percent,memory_used,disk_io,network_io\n"
            )
            for stat in self.system_stats:
                f.write(
                    f"{stat['timestamp']},{stat['cpu_percent']},"
                    f"{stat['memory_percent']},{stat['memory_used']},"
                    f"{stat['disk_io']},{stat['network_io']}\n"
                )

        # Summary report
        summary_report = self.output_dir / f"summary_report_{timestamp}.txt"
        if self.system_stats:
            avg_cpu = sum(s["cpu_percent"] for s in self.system_stats) / len(
                self.system_stats
            )
            max_cpu = max(s["cpu_percent"] for s in self.system_stats)
            avg_memory = sum(s["memory_percent"] for s in self.system_stats) / len(
                self.system_stats
            )
            max_memory = max(s["memory_percent"] for s in self.system_stats)

            with open(summary_report, "w") as f:
                f.write(f"Performance Summary Report - {datetime.now()}\n")
                f.write("=" * 60 + "\n\n")
                f.write(
                    f"Monitoring duration: {len(self.system_stats) * 1.0:.1f} seconds\n"
                )
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
        print(
            "Error: Could not import DashboardServer. Make sure you're in the correct directory."
        )
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
        print(
            "Error: Could not import TaskManager. Make sure you're in the correct directory."
        )
        return

    profiler = PerformanceProfiler()

    def run_task_manager():
        manager = TaskManager(max_concurrent=max_concurrent)
        manager.start()
        time.sleep(duration)
        manager.stop()

    print(
        f"Profiling task manager (max_concurrent={max_concurrent}) for {duration} seconds..."
    )
    profiler.start_profiling(run_task_manager)
    print("Profiling completed.")


def main():
    parser = argparse.ArgumentParser(description="OpenCode Agent Performance Profiler")
    parser.add_argument(
        "--output-dir",
        "-o",
        default="performance_reports",
        help="Output directory for reports",
    )
    parser.add_argument(
        "--target",
        "-t",
        choices=["dashboard", "task_manager", "custom"],
        default="dashboard",
        help="Profiling target",
    )
    parser.add_argument(
        "--duration", "-d", type=int, default=30, help="Profiling duration in seconds"
    )
    parser.add_argument(
        "--port",
        "-p",
        type=int,
        default=8080,
        help="Port for dashboard server profiling",
    )
    parser.add_argument(
        "--max-concurrent",
        "-m",
        type=int,
        default=4,
        help="Max concurrent tasks for task manager profiling",
    )

    args = parser.parse_args()

    profiler = PerformanceProfiler(args.output_dir)

    if args.target == "dashboard":
        profile_dashboard_server(args.port, args.duration)
    elif args.target == "task_manager":
        profile_task_manager(args.max_concurrent, args.duration)
    else:
        print(
            "Custom profiling not implemented yet. Use --target dashboard or task_manager"
        )


if __name__ == "__main__":
    main()
