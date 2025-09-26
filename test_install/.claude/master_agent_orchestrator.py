"""
Simple Agent Orchestrator
Coordinates agent execution for tasks
"""

import json
import time
import threading
import subprocess
import uuid
import re
import os
from pathlib import Path
from typing import Dict, Any, Optional
from datetime import datetime

class AgentOrchestrator:
    """Simple agent orchestrator for task execution"""

    def __init__(self, config_path: Optional[str] = None):
        self.agent_dir = Path(__file__).parent
        self.config_path = Path(config_path) if config_path else self.agent_dir / "config.json"
        self.agents_path = self.agent_dir / "agents.json"
        self.logs_dir = self.agent_dir / "logs"

        self.config = self._load_config()
        self.agents = self._load_agents()
        self.running_tasks = {}
        self.task_results = {}

        # Ensure logs directory exists
        self.logs_dir.mkdir(exist_ok=True)

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

    def _validate_objective(self, objective: str) -> bool:
        """Validate task objective for security"""
        if not isinstance(objective, str):
            return False
        
        # Check length limits
        if len(objective) > 1000:  # Reasonable limit
            return False
            
        # Check for dangerous characters that could be used for injection
        dangerous_patterns = [
            r'[;&|`$]',  # Shell metacharacters
            r'\.\.',    # Directory traversal
            r'rm\s',    # Dangerous commands
            r'sudo\s',  # Privilege escalation
            r'chmod\s', # Permission changes
            r'chown\s', # Ownership changes
        ]
        
        for pattern in dangerous_patterns:
            if re.search(pattern, objective, re.IGNORECASE):
                return False
                
        return True

    def _validate_path(self, path: Path, base_dir: Path) -> bool:
        """Validate file path for security"""
        try:
            # Resolve the path to handle symlinks and relative components
            resolved_path = path.resolve()
            base_resolved = base_dir.resolve()
            
            # Check if path is within base directory
            resolved_path_str = str(resolved_path)
            base_str = str(base_resolved)
            
            if not resolved_path_str.startswith(base_str):
                return False
                
            # Check for directory traversal attempts
            if '..' in path.parts:
                return False
                
            # Check for hidden files/directories (starting with .)
            for part in path.parts:
                if part.startswith('.') and part != '.' and part != '..':
                    # Allow .claude directory but not other hidden files
                    if part != '.claude':
                        return False
                        
            return True
        except Exception:
            return False

    def run_task(self, objective: str, **kwargs) -> str:
        """Run a task using agents"""
        # Validate objective for security
        if not self._validate_objective(objective):
            raise ValueError("Invalid task objective: contains potentially dangerous content")
            
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
            # Prepare command with validation
            if not isinstance(objective, str) or not objective.strip():
                raise ValueError("Invalid objective provided")
                
            cmd = ["opencode", "run", objective.strip()]

            # Add any additional arguments
            if task.get("kwargs"):
                # Could extend command based on kwargs
                pass

            # Execute with security measures
            log_file = self.logs_dir / f"task_{task_id}.log"
            
            # Validate log file path
            if not self._validate_path(log_file, self.agent_dir):
                raise ValueError(f"Invalid log file path: {log_file}")
                
            # Secure environment - only pass necessary variables
            secure_env = {
                'PATH': '/usr/local/bin:/usr/bin:/bin',  # Limited PATH
                'HOME': str(Path.home()),
                'USER': os.environ.get('USER', ''),
                'LANG': 'C.UTF-8',  # Safe locale
            }
            
            with open(log_file, 'w') as log:
                result = subprocess.run(
                    cmd,
                    cwd=self.agent_dir.parent,  # Project root
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    timeout=self.config.get("task_timeout", 300),
                    env=secure_env,  # Secure environment
                    preexec_fn=os.setsid,  # New process group for better control
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
