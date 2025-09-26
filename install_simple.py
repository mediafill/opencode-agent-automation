#!/usr/bin/env python3
"""
OpenCode Agent System - Simple Installer
Installs the minimal agent system for any project
"""

import os
import sys
import json
import shutil
from pathlib import Path
from typing import Dict, Any

class SimpleAgentInstaller:
    """Simple installer for the OpenCode agent system"""

    def __init__(self, project_root: str = "."):
        self.project_root = Path(project_root).resolve()
        self.agent_dir = self.project_root / ".opencode"
        self.templates_dir = Path(__file__).parent / "templates"

    def install(self, force: bool = False) -> bool:
        """Install the agent system"""
        print("🚀 Installing OpenCode Agent System...")

        # Check if already installed
        if self.agent_dir.exists() and not force:
            print("❌ Agent system already installed. Use --force to reinstall.")
            return False

        # Create directory structure
        self.agent_dir.mkdir(exist_ok=True)
        (self.agent_dir / "logs").mkdir(exist_ok=True)

        # Install core files
        self._install_core_files()
        self._install_config_files()
        self._install_scripts()

        # Create integration files
        self._create_project_integration()

        print("✅ Agent system installed successfully!")
        print(f"📁 Agent directory: {self.agent_dir}")
        print("🔧 Run 'python3 .opencode/init.py' to initialize")

        return True

    def _install_core_files(self):
        """Install core agent files"""
        core_files = {
            "agent_orchestrator.py": self._create_simple_orchestrator(),
            "task_manager.py": self._create_simple_task_manager(),
            "agent_pool.py": self._create_simple_agent_pool(),
            "communication.py": self._create_simple_communication(),
        }

        for filename, content in core_files.items():
            filepath = self.agent_dir / filename
            with open(filepath, 'w') as f:
                f.write(content)
            print(f"  ✓ Created {filename}")

    def _install_config_files(self):
        """Install configuration files"""
        config_files = {
            "config.json": {
                "version": "1.0.0",
                "max_agents": 4,
                "auto_start": True,
                "log_level": "INFO",
                "task_timeout": 300,
                "enable_monitoring": True
            },
            "agents.json": {
                "registered_agents": [],
                "active_tasks": {},
                "system_status": "ready"
            }
        }

        for filename, content in config_files.items():
            filepath = self.agent_dir / filename
            with open(filepath, 'w') as f:
                json.dump(content, f, indent=2)
            print(f"  ✓ Created {filename}")

    def _install_scripts(self):
        """Install utility scripts"""
        scripts = {
            "init.py": self._create_init_script(),
            "run_task.py": self._create_run_task_script(),
            "status.py": self._create_status_script(),
        }

        for filename, content in scripts.items():
            filepath = self.agent_dir / filename
            with open(filepath, 'w') as f:
                f.write(content)
            print(f"  ✓ Created {filename}")

    def _create_project_integration(self):
        """Create project integration files"""
        # Create a simple API file for the project to import
        api_content = f'''"""
OpenCode Agent System API
Import this to use agents in your project
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from .agent_orchestrator import AgentOrchestrator

# Global orchestrator instance
_orchestrator = None

def get_orchestrator():
    """Get the global agent orchestrator"""
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = AgentOrchestrator()
    return _orchestrator

def run_task(objective: str, **kwargs):
    """Run a task using the agent system"""
    orchestrator = get_orchestrator()
    return orchestrator.run_task(objective, **kwargs)

def get_status():
    """Get system status"""
    orchestrator = get_orchestrator()
    return orchestrator.get_status()

def get_task_result(task_id: str):
    """Get task result"""
    orchestrator = get_orchestrator()
    return orchestrator.get_task_result(task_id)

# Convenience functions
def add_tests(files=None):
    """Add tests to the project"""
    files = files or ["**/*.py"]
    return run_task(f"Add comprehensive unit tests for {{files}}")

def optimize_performance():
    """Optimize performance"""
    return run_task("Optimize application performance")

def add_monitoring():
    """Add monitoring and logging"""
    return run_task("Add monitoring, logging, and error handling")

def make_production_ready():
    """Make application production ready"""
    return run_task("Make application production ready with security, monitoring, and optimization")

def improve_code_quality():
    """Improve code quality"""
    return run_task("Improve code quality with linting, formatting, and best practices")

def add_security():
    """Add security measures"""
    return run_task("Add security measures and vulnerability fixes")
'''

        api_file = self.agent_dir / "__init__.py"
        with open(api_file, 'w') as f:
            f.write(api_content)
        print("  ✓ Created __init__.py (API)")

    def _create_simple_orchestrator(self) -> str:
        """Create simplified orchestrator"""
        return '''"""
Simple Agent Orchestrator
Coordinates agent execution for tasks
"""

import json
import time
import threading
import subprocess
import uuid
from pathlib import Path
from typing import Dict, Any, Optional
from datetime import datetime

class AgentOrchestrator:
    """Simple agent orchestrator for task execution"""

    def __init__(self, config_path: Optional[str] = None):
        self.agent_dir = Path(__file__).parent
        self.config_path = config_path or self.agent_dir / "config.json"
        self.agents_path = self.agent_dir / "agents.json"
        self.logs_dir = self.agent_dir / "logs"

        self.config = self._load_config()
        self.agents = self._load_agents()
        self.running_tasks = {}
        self.task_results = {}

        # Start background monitoring
        self.monitor_thread = threading.Thread(target=self._monitor_tasks, daemon=True)
        self.monitor_thread.start()

    def _load_config(self) -> Dict[str, Any]:
        """Load configuration"""
        if self.config_path.exists():
            with open(self.config_path, 'r') as f:
                return json.load(f)
        return {
            "max_agents": 4,
            "auto_start": True,
            "task_timeout": 300,
            "enable_monitoring": True
        }

    def _load_agents(self) -> Dict[str, Any]:
        """Load agents data"""
        if self.agents_path.exists():
            with open(self.agents_path, 'r') as f:
                return json.load(f)
        return {
            "registered_agents": [],
            "active_tasks": {},
            "system_status": "ready"
        }

    def _save_agents(self):
        """Save agents data"""
        with open(self.agents_path, 'w') as f:
            json.dump(self.agents, f, indent=2)

    def run_task(self, objective: str, **kwargs) -> str:
        """Run a task using agents"""
        task_id = str(uuid.uuid4())[:8]

        # Create task
        task = {
            "id": task_id,
            "objective": objective,
            "status": "running",
            "created_at": datetime.now().isoformat(),
            "kwargs": kwargs
        }

        self.running_tasks[task_id] = task
        self.agents["active_tasks"][task_id] = task
        self._save_agents()

        # Start task in background
        thread = threading.Thread(target=self._execute_task, args=(task,))
        thread.daemon = True
        thread.start()

        return task_id

    def _execute_task(self, task: Dict[str, Any]):
        """Execute a task using opencode"""
        task_id = task["id"]
        objective = task["objective"]

        try:
            # Prepare command
            cmd = ["opencode", "run", objective]

            # Add any additional arguments
            if task.get("kwargs"):
                # Could extend command based on kwargs
                pass

            # Execute
            log_file = self.logs_dir / f"task_{task_id}.log"
            with open(log_file, 'w') as log:
                result = subprocess.run(
                    cmd,
                    cwd=self.agent_dir.parent,  # Project root
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    timeout=self.config.get("task_timeout", 300)
                )

            # Update task status
            task["status"] = "completed" if result.returncode == 0 else "failed"
            task["return_code"] = result.returncode
            task["completed_at"] = datetime.now().isoformat()

        except subprocess.TimeoutExpired:
            task["status"] = "timeout"
            task["error"] = "Task timed out"
        except Exception as e:
            task["status"] = "error"
            task["error"] = str(e)

        # Save results
        self.task_results[task_id] = task
        if task_id in self.running_tasks:
            del self.running_tasks[task_id]

        self.agents["active_tasks"][task_id] = task
        self._save_agents()

    def get_status(self) -> Dict[str, Any]:
        """Get system status"""
        return {
            "system_status": self.agents.get("system_status", "unknown"),
            "running_tasks": len(self.running_tasks),
            "completed_tasks": len(self.task_results),
            "registered_agents": len(self.agents.get("registered_agents", [])),
            "active_tasks": self.agents.get("active_tasks", {})
        }

    def get_task_result(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Get task result"""
        return self.task_results.get(task_id)

    def _monitor_tasks(self):
        """Monitor running tasks"""
        while True:
            try:
                # Clean up old completed tasks (keep last 100)
                if len(self.task_results) > 100:
                    oldest = sorted(self.task_results.keys())[:-100]
                    for task_id in oldest:
                        del self.task_results[task_id]

                time.sleep(10)  # Check every 10 seconds
            except Exception:
                time.sleep(30)  # On error, wait longer

    def list_tasks(self) -> Dict[str, Any]:
        """List all tasks"""
        return {
            "running": self.running_tasks,
            "completed": self.task_results
        }
'''

    def _create_simple_task_manager(self) -> str:
        """Create simplified task manager"""
        return '''"""
Simple Task Manager
Manages task queuing and execution
"""

import json
import time
from typing import Dict, List, Any
from pathlib import Path

class TaskManager:
    """Simple task manager"""

    def __init__(self, agent_dir: Path):
        self.agent_dir = agent_dir
        self.tasks_file = agent_dir / "tasks.json"
        self.tasks = self._load_tasks()

    def _load_tasks(self) -> List[Dict[str, Any]]:
        """Load tasks from file"""
        if self.tasks_file.exists():
            try:
                with open(self.tasks_file, 'r') as f:
                    data = json.load(f)
                    return data.get("tasks", [])
            except:
                pass
        return []

    def _save_tasks(self):
        """Save tasks to file"""
        data = {
            "tasks": self.tasks,
            "updated_at": time.time()
        }
        with open(self.tasks_file, 'w') as f:
            json.dump(data, f, indent=2)

    def add_task(self, objective: str, priority: str = "medium") -> str:
        """Add a task to the queue"""
        import uuid
        task_id = str(uuid.uuid4())[:8]

        task = {
            "id": task_id,
            "objective": objective,
            "priority": priority,
            "status": "queued",
            "created_at": time.time()
        }

        self.tasks.append(task)
        self._save_tasks()
        return task_id

    def get_next_task(self) -> Dict[str, Any]:
        """Get next task to execute"""
        # Simple priority: high > medium > low
        priority_order = {"high": 0, "medium": 1, "low": 2}

        queued_tasks = [t for t in self.tasks if t["status"] == "queued"]
        if not queued_tasks:
            return None

        # Sort by priority then by creation time
        queued_tasks.sort(key=lambda t: (priority_order.get(t.get("priority", "medium"), 1), t["created_at"]))

        return queued_tasks[0]

    def update_task_status(self, task_id: str, status: str):
        """Update task status"""
        for task in self.tasks:
            if task["id"] == task_id:
                task["status"] = status
                task["updated_at"] = time.time()
                self._save_tasks()
                break

    def get_task_status(self, task_id: str) -> Dict[str, Any]:
        """Get task status"""
        for task in self.tasks:
            if task["id"] == task_id:
                return task
        return None
'''

    def _create_simple_agent_pool(self) -> str:
        """Create simplified agent pool"""
        return '''"""
Simple Agent Pool
Manages agent instances
"""

import json
import uuid
from typing import Dict, List, Any
from pathlib import Path

class AgentPool:
    """Simple agent pool manager"""

    def __init__(self, agent_dir: Path):
        self.agent_dir = agent_dir
        self.pool_file = agent_dir / "agent_pool.json"
        self.agents = self._load_pool()

    def _load_pool(self) -> Dict[str, Any]:
        """Load agent pool"""
        if self.pool_file.exists():
            try:
                with open(self.pool_file, 'r') as f:
                    return json.load(f)
            except:
                pass
        return {"agents": [], "max_agents": 4}

    def _save_pool(self):
        """Save agent pool"""
        with open(self.pool_file, 'w') as f:
            json.dump(self.agents, f, indent=2)

    def register_agent(self, agent_type: str, capabilities: List[str]) -> str:
        """Register a new agent"""
        agent_id = str(uuid.uuid4())[:8]

        agent = {
            "id": agent_id,
            "type": agent_type,
            "capabilities": capabilities,
            "status": "available",
            "created_at": json.dumps(None)  # Will be set by json
        }

        self.agents["agents"].append(agent)
        self._save_pool()
        return agent_id

    def get_available_agent(self, required_capabilities: List[str] = None) -> Dict[str, Any]:
        """Get an available agent"""
        available_agents = [a for a in self.agents["agents"] if a["status"] == "available"]

        if not available_agents:
            return None

        if required_capabilities:
            # Find agent with matching capabilities
            for agent in available_agents:
                if all(cap in agent.get("capabilities", []) for cap in required_capabilities):
                    return agent
            return None

        return available_agents[0]

    def update_agent_status(self, agent_id: str, status: str):
        """Update agent status"""
        for agent in self.agents["agents"]:
            if agent["id"] == agent_id:
                agent["status"] = status
                self._save_pool()
                break

    def list_agents(self) -> List[Dict[str, Any]]:
        """List all agents"""
        return self.agents["agents"]
'''

    def _create_simple_communication(self) -> str:
        """Create simplified communication system"""
        return '''"""
Simple Communication System
Handles agent communication
"""

import json
import time
from typing import Dict, Any
from pathlib import Path

class CommunicationManager:
    """Simple communication manager"""

    def __init__(self, agent_dir: Path):
        self.agent_dir = agent_dir
        self.messages_file = agent_dir / "messages.json"
        self.messages = self._load_messages()

    def _load_messages(self) -> List[Dict[str, Any]]:
        """Load messages"""
        if self.messages_file.exists():
            try:
                with open(self.messages_file, 'r') as f:
                    return json.load(f)
            except:
                pass
        return []

    def _save_messages(self):
        """Save messages"""
        with open(self.messages_file, 'w') as f:
            json.dump(self.messages, f, indent=2)

    def send_message(self, from_agent: str, to_agent: str, message_type: str, payload: Dict[str, Any]):
        """Send message between agents"""
        message = {
            "id": f"{int(time.time())}_{from_agent}_{to_agent}",
            "from": from_agent,
            "to": to_agent,
            "type": message_type,
            "payload": payload,
            "timestamp": time.time(),
            "status": "sent"
        }

        self.messages.append(message)
        self._save_messages()
        return message["id"]

    def get_messages(self, agent_id: str) -> List[Dict[str, Any]]:
        """Get messages for an agent"""
        return [m for m in self.messages if m["to"] == agent_id and m["status"] == "sent"]

    def mark_message_read(self, message_id: str):
        """Mark message as read"""
        for message in self.messages:
            if message["id"] == message_id:
                message["status"] = "read"
                self._save_messages()
                break

    def broadcast(self, from_agent: str, message_type: str, payload: Dict[str, Any]):
        """Broadcast message to all agents"""
        # In simple version, just log the broadcast
        message = {
            "id": f"broadcast_{int(time.time())}_{from_agent}",
            "from": from_agent,
            "type": f"broadcast_{message_type}",
            "payload": payload,
            "timestamp": time.time(),
            "status": "broadcast"
        }

        self.messages.append(message)
        self._save_messages()
        return message["id"]
'''

    def _create_init_script(self) -> str:
        """Create initialization script"""
        return '''#!/usr/bin/env python3
"""
Initialize the OpenCode Agent System
"""

import sys
import os
from pathlib import Path

def init_agent_system():
    """Initialize the agent system"""
    agent_dir = Path(__file__).parent

    print("🤖 Initializing OpenCode Agent System...")

    # Check if opencode is available
    try:
        import subprocess
        result = subprocess.run(["opencode", "--version"],
                              capture_output=True, text=True, timeout=10)
        if result.returncode != 0:
            print("⚠️  Warning: OpenCode CLI not found. Please install it first.")
            print("   Visit: https://opencode.ai for installation instructions.")
        else:
            print("✅ OpenCode CLI found")
    except FileNotFoundError:
        print("❌ OpenCode CLI not found. Please install it first.")
        return False
    except Exception as e:
        print(f"⚠️  Could not verify OpenCode CLI: {e}")

    # Create necessary directories
    logs_dir = agent_dir / "logs"
    logs_dir.mkdir(exist_ok=True)

    # Test basic functionality
    try:
        from .agent_orchestrator import AgentOrchestrator
        orchestrator = AgentOrchestrator()
        status = orchestrator.get_status()
        print(f"✅ Agent system initialized. Status: {status}")
        return True
    except Exception as e:
        print(f"❌ Failed to initialize agent system: {e}")
        return False

if __name__ == "__main__":
    success = init_agent_system()
    sys.exit(0 if success else 1)
'''

    def _create_run_task_script(self) -> str:
        """Create run task script"""
        return '''#!/usr/bin/env python3
"""
Run a task using the agent system
"""

import sys
import os
from pathlib import Path

def run_task():
    """Run a task"""
    if len(sys.argv) < 2:
        print("Usage: python3 .opencode/run_task.py 'your task objective'")
        sys.exit(1)

    objective = " ".join(sys.argv[1:])
    agent_dir = Path(__file__).parent

    try:
        from .agent_orchestrator import AgentOrchestrator
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
'''

    def _create_status_script(self) -> str:
        """Create status script"""
        return '''#!/usr/bin/env python3
"""
Check agent system status
"""

import sys
import os
from pathlib import Path

def show_status():
    """Show system status"""
    agent_dir = Path(__file__).parent

    try:
        from .agent_orchestrator import AgentOrchestrator
        orchestrator = AgentOrchestrator()

        status = orchestrator.get_status()

        print("🤖 OpenCode Agent System Status")
        print("=" * 40)
        print(f"System Status: {status.get('system_status', 'unknown')}")
        print(f"Running Tasks: {status.get('running_tasks', 0)}")
        print(f"Completed Tasks: {status.get('completed_tasks', 0)}")
        print(f"Registered Agents: {status.get('registered_agents', 0)}")

        active_tasks = status.get('active_tasks', {})
        if active_tasks:
            print("\n📋 Active Tasks:")
            for task_id, task in active_tasks.items():
                print(f"  {task_id}: {task.get('objective', 'unknown')} ({task.get('status', 'unknown')})")

    except Exception as e:
        print(f"❌ Error getting status: {e}")
        sys.exit(1)

if __name__ == "__main__":
    show_status()
'''

def main():
    """Main installer function"""
    import argparse

    parser = argparse.ArgumentParser(description="Install OpenCode Agent System")
    parser.add_argument("--force", "-f", action="store_true", help="Force reinstall")
    parser.add_argument("--project", "-p", default=".", help="Project directory")

    args = parser.parse_args()

    installer = SimpleAgentInstaller(args.project)
    success = installer.install(force=args.force)

    if success:
        print("\n🎉 Installation complete!")
        print("📖 Read README-SIMPLE.md for usage instructions")
        print("🚀 Run: python3 .opencode/init.py")
    else:
        print("\n❌ Installation failed!")
        sys.exit(1)

if __name__ == "__main__":
    main()