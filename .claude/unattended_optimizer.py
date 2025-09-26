#!/usr/bin/env python3
"""
Unattended System Optimizer
Runs delegations and monitors progress without requiring user interaction
"""

import subprocess
import os
import sys
import time
import json
from pathlib import Path
from datetime import datetime
import threading

class UnattendedOptimizer:
    def __init__(self):
        self.project_dir = Path.cwd()
        self.claude_dir = self.project_dir / '.claude'
        self.max_agents = int(os.getenv('MAX_CONCURRENT_AGENTS', '5'))
        self.tasks_completed = []
        self.tasks_failed = []

    def run_delegation(self, objective, task_id):
        """Run a delegation task in the background"""
        try:
            print(f"\n🚀 Starting delegation {task_id}: {objective[:50]}...")

            # Set environment variable for max agents
            env = os.environ.copy()
            env['MAX_CONCURRENT_AGENTS'] = str(self.max_agents)

            # Run the delegation
            result = subprocess.run(
                [str(self.claude_dir / 'launch.sh'), 'delegate', objective],
                env=env,
                capture_output=True,
                text=True,
                timeout=600  # 10 minute timeout
            )

            if result.returncode == 0:
                print(f"✅ Delegation {task_id} completed successfully")
                self.tasks_completed.append(task_id)
            else:
                print(f"❌ Delegation {task_id} failed: {result.stderr}")
                self.tasks_failed.append(task_id)

            return result.returncode == 0

        except subprocess.TimeoutExpired:
            print(f"⏱️ Delegation {task_id} timed out")
            self.tasks_failed.append(task_id)
            return False
        except Exception as e:
            print(f"❌ Error in delegation {task_id}: {e}")
            self.tasks_failed.append(task_id)
            return False

    def monitor_agents(self):
        """Monitor agent count and enforce limits"""
        try:
            # Import agent manager
            sys.path.insert(0, str(self.claude_dir))
            from agent_manager import AgentManager

            manager = AgentManager()

            while True:
                processes = manager.get_opencode_processes()

                if len(processes) > self.max_agents:
                    print(f"\n⚠️ Found {len(processes)} agents (limit: {self.max_agents})")
                    manager.stop_excess_agents()

                time.sleep(30)  # Check every 30 seconds

        except KeyboardInterrupt:
            print("\n👋 Monitoring stopped")
        except Exception as e:
            print(f"❌ Monitor error: {e}")

    def run_optimization_tasks(self):
        """Run all optimization tasks"""

        tasks = [
            {
                'id': 'portability',
                'objective': 'Create one-line installer script for easy portability. Build auto-configuration system with smart defaults. Package all components into self-contained module. Add import/export functionality. Create simple API for external projects. Ensure zero-configuration setup in any directory'
            },
            {
                'id': 'master_slave',
                'objective': 'Enhance master-slave agent architecture with: agent supervisor that monitors health, automatic restart of failed agents, task retry mechanism, agent pool management, resource usage tracking, performance metrics collection'
            },
            {
                'id': 'easy_install',
                'objective': 'Create install.sh script that: downloads all Claude automation files, sets up directory structure, configures environment, creates uninstall script, adds to PATH if requested, validates installation'
            }
        ]

        print("=" * 60)
        print("🤖 UNATTENDED SYSTEM OPTIMIZATION")
        print("=" * 60)
        print(f"Max concurrent agents: {self.max_agents}")
        print(f"Tasks to run: {len(tasks)}")
        print("=" * 60)

        # Start agent monitor in background thread
        monitor_thread = threading.Thread(target=self.monitor_agents, daemon=True)
        monitor_thread.start()

        # Run each task
        for task in tasks:
            success = self.run_delegation(task['objective'], task['id'])

            if not success:
                print(f"⚠️ Retrying task {task['id']}...")
                time.sleep(5)
                self.run_delegation(task['objective'], task['id'])

            # Wait between tasks to avoid overload
            time.sleep(10)

        # Final summary
        print("\n" + "=" * 60)
        print("📊 OPTIMIZATION SUMMARY")
        print("=" * 60)
        print(f"✅ Completed: {len(self.tasks_completed)} tasks")
        print(f"❌ Failed: {len(self.tasks_failed)} tasks")

        if self.tasks_completed:
            print("\nCompleted tasks:")
            for task_id in self.tasks_completed:
                print(f"  ✓ {task_id}")

        if self.tasks_failed:
            print("\nFailed tasks:")
            for task_id in self.tasks_failed:
                print(f"  ✗ {task_id}")

        print("=" * 60)

        # Check final agent status
        sys.path.insert(0, str(self.claude_dir))
        from agent_manager import AgentManager
        manager = AgentManager()
        processes = manager.get_opencode_processes()

        print(f"\n📊 Final agent count: {len(processes)} (limit: {self.max_agents})")

        if len(processes) > self.max_agents:
            print("🧹 Cleaning up excess agents...")
            manager.stop_excess_agents()

        return len(self.tasks_failed) == 0

def main():
    """Main entry point"""
    optimizer = UnattendedOptimizer()

    try:
        success = optimizer.run_optimization_tasks()
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n👋 Optimization cancelled by user")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Fatal error: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()