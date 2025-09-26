"""
Simple Task Manager
Manages task queuing and execution
"""

import json
import time
from typing import Dict, List, Any, Optional
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