"""
OpenCode Agent System API
Import this to use agents in your project
"""

import sys
import os

# Add current directory to path for imports
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

# Import the orchestrator
from master_agent_orchestrator import AgentOrchestrator

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
    return run_task(f"Add comprehensive unit tests for {files}")

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
