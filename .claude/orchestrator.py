#!/usr/bin/env python3
"""
Enhanced OpenCode Agent Orchestrator for Claude

This script provides Claude with advanced orchestration capabilities for managing
OpenCode agents. It ensures Claude acts primarily as an orchestrator, delegating
all implementation work to specialized agents.
"""

import json
import os
import subprocess
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import sys
import argparse

class OpenCodeOrchestrator:
    """Main orchestrator for managing OpenCode agents"""

    def __init__(self, project_dir: str = None):
        self.project_dir = Path(project_dir or os.getcwd())
        self.claude_dir = self.project_dir / '.claude'
        self.tasks_file = self.claude_dir / 'tasks.json'
        self.logs_dir = self.claude_dir / 'logs'
        self.config_file = self.claude_dir / 'orchestrator_config.json'

        # Auto-delegate patterns for Claude
        self.auto_delegate_patterns = {
            'testing': [
                'test', 'tests', 'unit test', 'integration test', 'test coverage',
                'test suite', 'testing framework', 'test failures', 'fix test'
            ],
            'bugs': [
                'bug', 'fix', 'error', 'issue', 'problem', 'crash', 'failure',
                'broken', 'not working', 'debug'
            ],
            'security': [
                'security', 'vulnerability', 'audit', 'secure', 'authentication',
                'authorization', 'encryption', 'sanitize'
            ],
            'performance': [
                'performance', 'optimize', 'slow', 'speed', 'cache', 'memory',
                'cpu', 'bottleneck'
            ],
            'documentation': [
                'document', 'docs', 'readme', 'api doc', 'comment', 'docstring'
            ],
            'refactoring': [
                'refactor', 'clean', 'improve', 'modernize', 'restructure',
                'organize', 'simplify'
            ],
            'production': [
                'production', 'deploy', 'monitoring', 'logging', 'error handling',
                'production ready'
            ]
        }

        # Load or create config
        self.config = self._load_config()

    def _load_config(self) -> Dict:
        """Load orchestrator configuration"""
        if self.config_file.exists():
            with open(self.config_file, 'r') as f:
                return json.load(f)

        # Default configuration
        default_config = {
            'auto_delegate': True,
            'max_concurrent_agents': 4,
            'monitor_interval': 5,
            'auto_retry_failed': True,
            'delegation_history': []
        }

        self._save_config(default_config)
        return default_config

    def _save_config(self, config: Dict):
        """Save orchestrator configuration"""
        with open(self.config_file, 'w') as f:
            json.dump(config, f, indent=2)

    def analyze_request(self, request: str) -> Tuple[bool, str, List[str]]:
        """
        Analyze a user request to determine if it should be auto-delegated

        Returns:
            (should_delegate, task_type, matched_keywords)
        """
        request_lower = request.lower()

        for task_type, keywords in self.auto_delegate_patterns.items():
            matched = [kw for kw in keywords if kw in request_lower]
            if matched:
                return (True, task_type, matched)

        return (False, None, [])

    def delegate_task(self, objective: str, force: bool = False) -> Dict:
        """
        Delegate a task to OpenCode agents

        Args:
            objective: The task objective to delegate
            force: Force delegation even if auto-delegate is disabled

        Returns:
            Dict with delegation results
        """
        # Check if we should auto-delegate
        should_delegate, task_type, keywords = self.analyze_request(objective)

        if not force and not self.config['auto_delegate'] and not should_delegate:
            return {
                'delegated': False,
                'reason': 'Auto-delegation disabled and no matching patterns'
            }

        # Log delegation
        delegation_entry = {
            'timestamp': datetime.now().isoformat(),
            'objective': objective,
            'task_type': task_type,
            'matched_keywords': keywords
        }

        self.config['delegation_history'].append(delegation_entry)
        self._save_config(self.config)

        # Execute delegation
        cmd = [
            str(self.claude_dir / 'launch.sh'),
            'delegate',
            objective
        ]

        result = subprocess.run(cmd, capture_output=True, text=True)

        return {
            'delegated': True,
            'task_type': task_type,
            'matched_keywords': keywords,
            'return_code': result.returncode,
            'stdout': result.stdout,
            'stderr': result.stderr
        }

    def monitor_agents(self, continuous: bool = False) -> Dict:
        """
        Monitor running OpenCode agents

        Args:
            continuous: If True, continuously monitor until all agents complete

        Returns:
            Dict with current agent status
        """
        while True:
            # Get status
            cmd = [str(self.claude_dir / 'launch.sh'), 'status']
            result = subprocess.run(cmd, capture_output=True, text=True)

            # Parse status (simplified for now)
            status = {
                'timestamp': datetime.now().isoformat(),
                'output': result.stdout,
                'agents_running': 'agents running' in result.stdout.lower()
            }

            if not continuous or not status['agents_running']:
                return status

            time.sleep(self.config['monitor_interval'])

    def get_recommendations(self, context: str = None) -> List[str]:
        """
        Get recommendations for what to delegate based on current project state

        Returns:
            List of recommended delegation objectives
        """
        recommendations = []

        # Check for failing tests
        if os.path.exists('package.json'):
            test_result = subprocess.run(['npm', 'test'], capture_output=True)
            if test_result.returncode != 0:
                recommendations.append("Fix all failing unit tests and integration tests")

        # Check for missing documentation
        if not os.path.exists('README.md'):
            recommendations.append("Create comprehensive README documentation")

        # Check for security issues
        if os.path.exists('package-lock.json'):
            audit_result = subprocess.run(['npm', 'audit'], capture_output=True)
            if b'vulnerabilities' in audit_result.stdout:
                recommendations.append("Perform security audit and fix all vulnerabilities")

        # Check for code quality
        recommendations.append("Improve code quality with linting, formatting, and best practices")

        # Production readiness
        recommendations.append("Make application production ready with monitoring and error handling")

        return recommendations

    def create_delegation_plan(self, high_level_objective: str) -> List[str]:
        """
        Break down a high-level objective into specific delegatable tasks

        Args:
            high_level_objective: The main objective to accomplish

        Returns:
            List of specific tasks to delegate
        """
        tasks = []

        objective_lower = high_level_objective.lower()

        # Testing related
        if 'test' in objective_lower:
            tasks.extend([
                "Create unit tests for all core functions with 80% coverage",
                "Build integration tests for API endpoints",
                "Set up continuous integration testing pipeline",
                "Add end-to-end tests for critical user flows"
            ])

        # Bug fixing
        if 'bug' in objective_lower or 'fix' in objective_lower:
            tasks.extend([
                "Analyze codebase for syntax errors and fix them",
                "Review error logs and fix runtime errors",
                "Test all features and fix broken functionality",
                "Add error handling for edge cases"
            ])

        # Production readiness
        if 'production' in objective_lower:
            tasks.extend([
                "Add comprehensive error handling and recovery",
                "Implement structured logging throughout application",
                "Set up monitoring and alerting systems",
                "Add health check endpoints",
                "Optimize performance for production load"
            ])

        # Security
        if 'security' in objective_lower:
            tasks.extend([
                "Audit code for security vulnerabilities",
                "Implement input validation and sanitization",
                "Add authentication and authorization checks",
                "Review and fix dependency vulnerabilities"
            ])

        return tasks if tasks else [high_level_objective]

def main():
    """CLI interface for the orchestrator"""
    parser = argparse.ArgumentParser(description='OpenCode Agent Orchestrator')
    parser.add_argument('action', choices=['delegate', 'monitor', 'recommend', 'plan', 'analyze'],
                       help='Action to perform')
    parser.add_argument('objective', nargs='?', help='Objective for delegation or planning')
    parser.add_argument('--continuous', action='store_true', help='Continuous monitoring')
    parser.add_argument('--force', action='store_true', help='Force delegation')

    args = parser.parse_args()

    orchestrator = OpenCodeOrchestrator()

    if args.action == 'delegate':
        if not args.objective:
            print("Error: Objective required for delegation")
            sys.exit(1)

        result = orchestrator.delegate_task(args.objective, args.force)
        print(json.dumps(result, indent=2))

    elif args.action == 'monitor':
        status = orchestrator.monitor_agents(args.continuous)
        print(json.dumps(status, indent=2))

    elif args.action == 'recommend':
        recommendations = orchestrator.get_recommendations()
        print("Recommended delegations:")
        for i, rec in enumerate(recommendations, 1):
            print(f"{i}. {rec}")

    elif args.action == 'plan':
        if not args.objective:
            print("Error: Objective required for planning")
            sys.exit(1)

        tasks = orchestrator.create_delegation_plan(args.objective)
        print(f"Delegation plan for: {args.objective}")
        for i, task in enumerate(tasks, 1):
            print(f"{i}. {task}")

    elif args.action == 'analyze':
        if not args.objective:
            print("Error: Objective required for analysis")
            sys.exit(1)

        should_delegate, task_type, keywords = orchestrator.analyze_request(args.objective)
        print(f"Should auto-delegate: {should_delegate}")
        print(f"Task type: {task_type}")
        print(f"Matched keywords: {keywords}")

if __name__ == '__main__':
    main()