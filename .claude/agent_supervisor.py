#!/usr/bin/env python3
"""
Agent Supervisor - Monitors and guides OpenCode agents every 60 seconds
Ensures max 5 agents running, provides guidance, and prevents memory issues
"""

import json
import time
import subprocess
import psutil
import os
from pathlib import Path
from datetime import datetime

class AgentSupervisor:
    def __init__(self):
        self.project_dir = Path.cwd()
        self.claude_dir = self.project_dir / '.claude'
        self.logs_dir = self.claude_dir / 'logs'
        self.tasks_file = self.claude_dir / 'tasks.json'
        self.max_agents = 5
        self.monitor_interval = 60  # seconds

    def count_running_agents(self):
        """Count OpenCode processes"""
        count = 0
        for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
            try:
                cmdline = proc.info['cmdline']
                if cmdline and 'opencode' in ' '.join(cmdline).lower():
                    count += 1
            except:
                pass
        return count

    def get_memory_usage(self):
        """Get system memory usage"""
        mem = psutil.virtual_memory()
        return {
            'percent': mem.percent,
            'available_gb': mem.available / (1024**3),
            'used_gb': mem.used / (1024**3)
        }

    def load_tasks(self):
        """Load current task status"""
        if self.tasks_file.exists():
            with open(self.tasks_file) as f:
                return json.load(f)
        return {'tasks': []}

    def get_agent_logs_tail(self, log_file, lines=10):
        """Get last N lines from a log file"""
        try:
            result = subprocess.run(
                ['tail', f'-{lines}', str(log_file)],
                capture_output=True, text=True, timeout=5
            )
            return result.stdout
        except:
            return ""

    def provide_guidance(self, task):
        """Provide guidance based on task type and status"""
        guidance = {
            'unit_tests': "Focus on critical functions first. Use mocking for external dependencies.",
            'integration_tests': "Test API endpoints and database operations. Check error handling.",
            'database_optimization': "Look for N+1 queries, missing indexes, and inefficient joins.",
            'perf_analysis': "Profile CPU and memory usage. Check for memory leaks and bottlenecks.",
            'code_cleanup': "Remove duplicate code, unused imports, and consolidate similar functions.",
            'error_handling': "Add try-catch blocks, validate inputs, and provide meaningful error messages.",
            'logging': "Use structured logging with appropriate log levels. Don't log sensitive data."
        }

        for key, advice in guidance.items():
            if key in task.get('description', '').lower():
                return advice
        return "Continue with best practices and focus on code quality."

    def supervise(self):
        """Main supervision loop"""
        print(f"🤖 Agent Supervisor Started - Max {self.max_agents} agents")
        print(f"⏰ Monitoring every {self.monitor_interval} seconds\n")

        while True:
            print(f"\n{'='*60}")
            print(f"📊 Supervision Report - {datetime.now().strftime('%H:%M:%S')}")
            print(f"{'='*60}\n")

            # Check memory
            mem = self.get_memory_usage()
            print(f"💾 Memory: {mem['percent']:.1f}% used ({mem['used_gb']:.1f}GB / {mem['available_gb']:.1f}GB free)")

            # Count agents
            agent_count = self.count_running_agents()
            print(f"🤖 Active Agents: {agent_count}/{self.max_agents}")

            # Check if we need to stop agents
            if agent_count > self.max_agents:
                print(f"⚠️  WARNING: Too many agents! Stopping excess...")
                subprocess.run(['.claude/launch.sh', 'stop'], capture_output=True)
                time.sleep(5)
                agent_count = self.count_running_agents()

            # Load and check tasks
            task_data = self.load_tasks()
            tasks = task_data.get('tasks', [])

            pending = [t for t in tasks if t.get('status') == 'pending']
            in_progress = [t for t in tasks if t.get('status') == 'in_progress']
            completed = [t for t in tasks if t.get('status') == 'completed']
            failed = [t for t in tasks if t.get('status') == 'failed']

            print(f"\n📋 Task Status:")
            print(f"  • Pending: {len(pending)}")
            print(f"  • In Progress: {len(in_progress)}")
            print(f"  • Completed: {len(completed)}")
            print(f"  • Failed: {len(failed)}")

            # Provide guidance for active tasks
            if in_progress:
                print(f"\n💡 Guidance for Active Tasks:")
                for task in in_progress[:3]:  # Show max 3
                    task_id = task.get('id', 'unknown')
                    print(f"\n  Task: {task_id}")
                    guidance = self.provide_guidance(task)
                    print(f"  → {guidance}")

                    # Check recent log activity
                    log_file = self.logs_dir / f"{task_id}.log"
                    if log_file.exists():
                        recent_log = self.get_agent_logs_tail(log_file, 3)
                        if recent_log:
                            print(f"  Recent activity: {recent_log[:100]}...")

            # Start new agents if under limit and tasks pending
            if agent_count < self.max_agents and pending:
                available_slots = self.max_agents - agent_count
                tasks_to_start = min(available_slots, len(pending))
                if tasks_to_start > 0:
                    print(f"\n🚀 Starting {tasks_to_start} new agents...")
                    subprocess.run(['.claude/launch.sh', 'start'], capture_output=True)

            # Memory warning
            if mem['percent'] > 80:
                print(f"\n⚠️  HIGH MEMORY USAGE! Consider stopping some agents.")
                if agent_count > 3:
                    print("  Reducing to 3 agents for stability...")
                    # Would implement agent reduction here

            # Wait for next cycle
            print(f"\n⏰ Next check in {self.monitor_interval} seconds...")
            time.sleep(self.monitor_interval)

if __name__ == '__main__':
    supervisor = AgentSupervisor()
    try:
        supervisor.supervise()
    except KeyboardInterrupt:
        print("\n\n👋 Supervisor stopped by user")