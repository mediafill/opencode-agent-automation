#!/usr/bin/env python3
"""
Graceful Agent Manager - Manage specific OpenCode agent instances
"""

import psutil
import subprocess
import json
import os
import signal
from pathlib import Path
from datetime import datetime

class AgentManager:
    def __init__(self):
        self.project_dir = Path.cwd()
        self.claude_dir = self.project_dir / '.claude'
        self.logs_dir = self.claude_dir / 'logs'
        self.pid_file = self.claude_dir / 'agent_pids.json'
        self.max_agents = int(os.getenv('MAX_CONCURRENT_AGENTS', '5'))

    def get_opencode_processes(self):
        """Get all OpenCode processes with details"""
        processes = []
        try:
            for proc in psutil.process_iter(['pid', 'name', 'cmdline', 'create_time', 'memory_info']):
                try:
                    cmdline = proc.info['cmdline']
                    if cmdline and 'opencode' in ' '.join(cmdline).lower():
                        # Skip grep, ps, and this script
                        if any(x in ' '.join(cmdline) for x in ['grep', 'ps aux', 'agent_manager']):
                            continue

                        processes.append({
                            'pid': proc.info['pid'],
                            'name': proc.info['name'],
                            'cmdline': ' '.join(cmdline[:50]),  # Truncate long commands
                            'created': datetime.fromtimestamp(proc.info['create_time']).strftime('%H:%M:%S'),
                            'memory_mb': proc.info['memory_info'].rss / 1024 / 1024
                        })
                except (psutil.NoSuchProcess, psutil.AccessDenied, AttributeError, KeyError) as e:
                    # Skip processes that disappear or have access issues
                    continue
                except Exception as e:
                    print(f"Warning: Error processing process info: {e}")
                    continue
        except Exception as e:
            print(f"Error iterating processes: {e}")
            return []
        return processes

    def list_agents(self):
        """List all running OpenCode agents"""
        processes = self.get_opencode_processes()

        print(f"📊 OpenCode Agent Status")
        print(f"{'='*60}")
        print(f"Total: {len(processes)} agents (Max: {self.max_agents})")

        if len(processes) > self.max_agents:
            print(f"⚠️  WARNING: Exceeding max limit by {len(processes) - self.max_agents} agents!")

        print(f"\n{'PID':<8} {'Started':<10} {'Memory':<10} {'Command'}")
        print(f"{'-'*60}")

        for proc in processes:
            status = "🔴" if len(processes) > self.max_agents else "🟢"
            print(f"{status} {proc['pid']:<6} {proc['created']:<10} {proc['memory_mb']:>7.1f}MB  {proc['cmdline'][:40]}")

        return processes

    def stop_agent(self, pid):
        """Gracefully stop a specific agent"""
        try:
            if not isinstance(pid, int) or pid <= 0:
                print(f"❌ Invalid PID: {pid}")
                return False

            process = psutil.Process(pid)

            # Check if process exists and is still running
            if not process.is_running():
                print(f"❌ Process {pid} is not running")
                return False

            # First try SIGTERM for graceful shutdown
            print(f"Sending SIGTERM to PID {pid}...")
            process.terminate()

            # Wait up to 5 seconds for graceful shutdown
            try:
                process.wait(timeout=5)
                print(f"✅ Agent {pid} stopped gracefully")
                return True
            except psutil.TimeoutExpired:
                # If still running, use SIGKILL
                print(f"Agent {pid} didn't stop gracefully, forcing...")
                try:
                    process.kill()
                    process.wait(timeout=2)
                    print(f"✅ Agent {pid} force stopped")
                    return True
                except Exception as e:
                    print(f"❌ Failed to force stop {pid}: {e}")
                    return False

        except psutil.NoSuchProcess:
            print(f"❌ Process {pid} not found")
            return False
        except psutil.AccessDenied:
            print(f"❌ Access denied to process {pid}")
            return False
        except Exception as e:
            print(f"❌ Error stopping {pid}: {e}")
            return False

    def stop_excess_agents(self):
        """Stop agents exceeding the max limit"""
        try:
            processes = self.get_opencode_processes()

            if len(processes) <= self.max_agents:
                print(f"✅ Agent count ({len(processes)}) within limit ({self.max_agents})")
                return

            # Sort by creation time (oldest first) or memory usage
            try:
                processes.sort(key=lambda x: x['memory_mb'], reverse=True)
            except (KeyError, TypeError) as e:
                print(f"Warning: Error sorting processes by memory: {e}, using default order")
                # Fall back to original order if sorting fails

            excess = len(processes) - self.max_agents
            print(f"⚠️  Stopping {excess} excess agents...")

            stopped_count = 0
            for proc in processes[:excess]:
                try:
                    if self.stop_agent(proc['pid']):
                        stopped_count += 1
                except Exception as e:
                    print(f"Error stopping agent {proc.get('pid', 'unknown')}: {e}")
                    continue

            print(f"✅ Stopped {stopped_count}/{excess} excess agents")

        except Exception as e:
            print(f"❌ Error in stop_excess_agents: {e}")

    def stop_all(self):
        """Stop all OpenCode agents gracefully"""
        try:
            processes = self.get_opencode_processes()

            if not processes:
                print("No OpenCode agents running")
                return

            print(f"Stopping {len(processes)} agents...")
            stopped_count = 0

            for proc in processes:
                try:
                    if self.stop_agent(proc['pid']):
                        stopped_count += 1
                except Exception as e:
                    print(f"Error stopping agent {proc.get('pid', 'unknown')}: {e}")
                    continue

            print(f"✅ Successfully stopped {stopped_count}/{len(processes)} agents")

        except Exception as e:
            print(f"❌ Error in stop_all: {e}")

    def monitor_and_enforce(self):
        """Monitor and enforce agent limit"""
        try:
            while True:
                try:
                    processes = self.get_opencode_processes()

                    if len(processes) > self.max_agents:
                        print(f"\n⚠️  Detected {len(processes)} agents (max: {self.max_agents})")
                        self.stop_excess_agents()

                    # Wait before next check
                    import time
                    time.sleep(10)

                except KeyboardInterrupt:
                    print("\n👋 Monitor stopped")
                    break
                except Exception as e:
                    print(f"Error in monitoring loop: {e}")
                    # Continue monitoring despite errors
                    import time
                    time.sleep(30)  # Wait longer after errors

        except Exception as e:
            print(f"❌ Fatal error in monitor_and_enforce: {e}")

def main():
    """CLI interface"""
    try:
        import argparse

        parser = argparse.ArgumentParser(description='OpenCode Agent Manager')
        parser.add_argument('action', choices=['list', 'stop', 'stop-excess', 'stop-all', 'monitor'],
                           help='Action to perform')
        parser.add_argument('--pid', type=int, help='Process ID for stop action')

        args = parser.parse_args()

        manager = AgentManager()

        if args.action == 'list':
            manager.list_agents()

        elif args.action == 'stop':
            if not args.pid:
                print("Error: --pid required for stop action")
                return
            manager.stop_agent(args.pid)

        elif args.action == 'stop-excess':
            manager.stop_excess_agents()

        elif args.action == 'stop-all':
            confirm = input("Stop ALL OpenCode agents? (y/n): ")
            if confirm.lower() == 'y':
                manager.stop_all()

        elif args.action == 'monitor':
            print(f"Monitoring agents (max: {manager.max_agents})...")
            print("Press Ctrl+C to stop")
            try:
                manager.monitor_and_enforce()
            except KeyboardInterrupt:
                print("\n👋 Monitor stopped")

    except KeyboardInterrupt:
        print("\n👋 Operation cancelled by user")
    except Exception as e:
        print(f"❌ Fatal error: {e}")
        import sys
        sys.exit(1)

if __name__ == '__main__':
    main()