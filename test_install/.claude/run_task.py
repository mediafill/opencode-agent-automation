#!/usr/bin/env python3
"""
Run a task using the agent system
"""

import sys
from pathlib import Path

def run_task():
    """Run a task"""
    if len(sys.argv) < 2:
        print("Usage: python3 .opencode/run_task.py 'your task objective'")
        sys.exit(1)

    objective = " ".join(sys.argv[1:])
    agent_dir = Path(__file__).parent

    try:
        # Add current directory to path
        current_dir = str(agent_dir)
        if current_dir not in sys.path:
            sys.path.insert(0, current_dir)

        from agent_orchestrator import AgentOrchestrator
        orchestrator = AgentOrchestrator()

        print(f"🚀 Starting task: {objective}")
        task_id = orchestrator.run_task(objective)

        print(f"📋 Task ID: {task_id}")
        print("📊 Monitoring progress...")

        # Simple monitoring
        import time
        while True:
            status = orchestrator.get_status()
            running = status.get("running_tasks", 0)
            if running == 0:
                break
            print(f"  Running tasks: {running}")
            time.sleep(5)

        # Get result
        result = orchestrator.get_task_result(task_id)
        if result:
            status = result.get("status", "unknown")
            print(f"✅ Task completed with status: {status}")
            if status == "failed":
                print(f"❌ Return code: {result.get('return_code', 'unknown')}")
        else:
            print("⚠️  Task result not found")

    except Exception as e:
        print(f"❌ Error running task: {e}")
        sys.exit(1)

if __name__ == "__main__":
    run_task()
