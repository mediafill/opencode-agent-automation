#!/usr/bin/env python3
"""
OpenCode Agent System Integration Checker
Ensures OpenCode uses the .claude master-slave multi-agent system
"""

import os
import sys
import json
from pathlib import Path

class AgentSystemChecker:
    """Checks if OpenCode should use the agent system"""

    def __init__(self, project_root=None):
        self.project_root = Path(project_root or ".")
        self.claude_dir = self.project_root / ".claude"

    def should_use_agent_system(self):
        """Check if agent system should be used"""
        checks = {
            "claude_directory_exists": self.claude_dir.exists(),
            "master_orchestrator_exists": (self.claude_dir / "master_agent_orchestrator.py").exists(),
            "orchestrator_config_exists": (self.claude_dir / "orchestrator_config.json").exists(),
            "agent_system_enabled": self._check_config_enables_agent_system(),
            "master_slave_required": self._check_master_slave_required()
        }

        # All checks must pass
        return all(checks.values()), checks

    def _check_config_enables_agent_system(self):
        """Check if config enables agent system"""
        config_file = self.claude_dir / "orchestrator_config.json"
        if not config_file.exists():
            return False

        try:
            with open(config_file, 'r') as f:
                config = json.load(f)
            return config.get("enforce_agent_system", False)
        except:
            return False

    def _check_master_slave_required(self):
        """Check if master-slave system is required"""
        config_file = self.claude_dir / "orchestrator_config.json"
        if not config_file.exists():
            return False

        try:
            with open(config_file, 'r') as f:
                config = json.load(f)
            return config.get("master_slave_required", False)
        except:
            return False

    def get_agent_system_command(self, objective):
        """Get the command to run through agent system"""
        if not self.should_use_agent_system()[0]:
            return None

        return f"python3 .claude/master_agent_orchestrator.py delegate '{objective}'"

def main():
    """CLI interface for checking agent system"""
    checker = AgentSystemChecker()

    should_use, checks = checker.should_use_agent_system()

    print("OpenCode Agent System Check")
    print("=" * 40)

    for check_name, result in checks.items():
        status = "✓" if result else "✗"
        print(f"{status} {check_name.replace('_', ' ').title()}: {result}")

    print()
    print(f"Agent System Required: {'YES' if should_use else 'NO'}")

    if len(sys.argv) > 1:
        objective = " ".join(sys.argv[1:])
        command = checker.get_agent_system_command(objective)
        if command:
            print(f"\nRecommended Command: {command}")
        else:
            print(f"\nUse direct OpenCode: opencode run '{objective}'")

if __name__ == "__main__":
    main()