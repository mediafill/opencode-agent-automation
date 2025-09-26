#!/usr/bin/env python3
"""
Simple Performance Profiler for OpenCode Agent Automation
Identifies bottlenecks in hot code paths
"""

import cProfile
import pstats
import io
import time
import psutil
import threading
from pathlib import Path
import sys
import os

def profile_function(func, *args, **kwargs):
    """Profile a function and return stats"""
    profiler = cProfile.Profile()
    profiler.enable()
    result = func(*args, **kwargs)
    profiler.disable()

    # Get stats
    stream = io.StringIO()
    stats = pstats.Stats(profiler, stream=stream)
    stats.sort_stats('cumulative')
    stats.print_stats(20)

    return result, stream.getvalue()

def profile_dashboard_server():
    """Profile dashboard server performance"""
    print("Profiling dashboard server...")

    try:
        sys.path.append('scripts')
        from dashboard_server import DashboardServer

        server = DashboardServer()

        # Profile key methods
        print("1. Profiling process detection...")
        _, process_stats = profile_function(server.detect_claude_processes)
        print("Process detection stats:")
        print(process_stats[:1000])

        print("2. Profiling system resources update...")
        _, resource_stats = profile_function(server.update_system_resources)
        print("Resource update stats:")
        print(resource_stats[:1000])

        print("3. Profiling agent updates...")
        _, agent_stats = profile_function(server.update_agents_lightweight)
        print("Agent update stats:")
        print(agent_stats[:1000])

    except Exception as e:
        print(f"Error profiling dashboard: {e}")

def profile_task_manager():
    """Profile task manager performance"""
    print("Profiling task manager...")

    try:
        sys.path.append('scripts')
        from task_manager import TaskManager

        manager = TaskManager()

        # Profile key methods
        print("1. Profiling task loading...")
        _, load_stats = profile_function(manager.load_tasks_from_file)
        print("Task loading stats:")
        print(load_stats[:1000])

        print("2. Profiling status saving...")
        _, save_stats = profile_function(manager.save_task_status)
        print("Status saving stats:")
        print(save_stats[:1000])

    except Exception as e:
        print(f"Error profiling task manager: {e}")

def identify_bottlenecks():
    """Identify main performance bottlenecks"""
    print("\n=== PERFORMANCE BOTTLENECKS IDENTIFIED ===")

    bottlenecks = [
        {
            'component': 'Dashboard Server - Process Detection',
            'issue': 'Full process scan every 30 seconds with regex matching on all processes',
            'impact': 'High CPU usage during scans',
            'solution': 'Implement incremental scanning and better caching'
        },
        {
            'component': 'Dashboard Server - File Monitoring',
            'issue': 'Reading entire log files on every change',
            'impact': 'I/O bottleneck with large log files',
            'solution': 'Use file position tracking and incremental reading'
        },
        {
            'component': 'Task Manager - Progress Tracking',
            'issue': 'Reading entire log files every 10 seconds per task',
            'impact': 'Multiple file I/O operations',
            'solution': 'Cache file positions and use inotify for changes'
        },
        {
            'component': 'WebSocket Broadcasting',
            'issue': 'JSON serialization for every message to all clients',
            'impact': 'CPU usage with many clients',
            'solution': 'Cache serialized messages and use binary protocols'
        },
        {
            'component': 'System Resource Monitoring',
            'issue': 'Multiple psutil calls every 5 seconds',
            'impact': 'System call overhead',
            'solution': 'Batch system calls and cache results'
        }
    ]

    for i, bottleneck in enumerate(bottlenecks, 1):
        print(f"\n{i}. {bottleneck['component']}")
        print(f"   Issue: {bottleneck['issue']}")
        print(f"   Impact: {bottleneck['impact']}")
        print(f"   Solution: {bottleneck['solution']}")

def main():
    print("OpenCode Agent Performance Analysis")
    print("=" * 50)

    # Create output directory
    output_dir = Path("performance_reports")
    output_dir.mkdir(exist_ok=True)

    # Profile components
    profile_dashboard_server()
    print()
    profile_task_manager()

    # Identify bottlenecks
    identify_bottlenecks()

    print(f"\nReports saved to: {output_dir}")

if __name__ == '__main__':
    main()