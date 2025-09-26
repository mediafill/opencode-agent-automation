#!/usr/bin/env python3
"""
OpenCode Agent Task Delegation System
Intelligently delegates tasks to OpenCode agents based on project context
"""

import os
import json
import sys
import subprocess
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

class TaskDelegator:
    """Manages task delegation to OpenCode agents"""

    def __init__(self, project_dir: str = None):
        self.project_dir = Path(project_dir or os.getcwd())
        self.claude_dir = self.project_dir / ".claude"
        self.tasks_file = self.claude_dir / "tasks.json"
        self.logs_dir = self.claude_dir / "logs"

        # Ensure directories exist
        self.claude_dir.mkdir(exist_ok=True)
        self.logs_dir.mkdir(exist_ok=True)

    def detect_project_type(self) -> Dict[str, any]:
        """Detect project type and technology stack"""
        project_info = {
            'type': 'unknown',
            'languages': [],
            'frameworks': [],
            'has_tests': False,
            'has_ci': False
        }

        # Check for common project files
        checks = {
            'package.json': ('javascript', 'node'),
            'requirements.txt': ('python', 'python'),
            'Gemfile': ('ruby', 'rails'),
            'go.mod': ('go', 'go'),
            'Cargo.toml': ('rust', 'rust'),
            'pom.xml': ('java', 'maven'),
            'composer.json': ('php', 'php'),
        }

        for file, (lang, framework) in checks.items():
            if (self.project_dir / file).exists():
                project_info['languages'].append(lang)
                project_info['frameworks'].append(framework)

        # Check for test directories
        test_dirs = ['test', 'tests', 'spec', '__tests__']
        project_info['has_tests'] = any((self.project_dir / d).exists() for d in test_dirs)

        # Check for CI/CD
        ci_files = ['.github/workflows', '.gitlab-ci.yml', 'Jenkinsfile', '.travis.yml']
        project_info['has_ci'] = any((self.project_dir / f).exists() for f in ci_files)

        return project_info

    def generate_tasks(self, objective: str) -> List[Dict]:
        """Generate task list based on objective and project context"""
        project_info = self.detect_project_type()
        tasks = []

        # Parse objective for keywords
        objective_lower = objective.lower()

        # Security tasks
        if any(word in objective_lower for word in ['security', 'secure', 'production', 'audit']):
            tasks.extend([
                {
                    'id': f'security_{int(time.time())}',
                    'type': 'security',
                    'priority': 'high',
                    'description': 'Audit code for security vulnerabilities: SQL injection, XSS, CSRF, authentication issues',
                    'files_pattern': '**/*.{py,js,php,rb}'
                },
                {
                    'id': f'deps_{int(time.time())}',
                    'type': 'security',
                    'priority': 'high',
                    'description': 'Check and update dependencies for known vulnerabilities',
                    'files_pattern': 'requirements.txt,package.json,Gemfile'
                }
            ])

        # Performance tasks
        if any(word in objective_lower for word in ['performance', 'optimize', 'speed', 'fast']):
            tasks.extend([
                {
                    'id': f'perf_{int(time.time())}',
                    'type': 'performance',
                    'priority': 'medium',
                    'description': 'Analyze and optimize performance bottlenecks, database queries, and API endpoints',
                    'files_pattern': '**/*.{py,js}'
                },
                {
                    'id': f'cache_{int(time.time())}',
                    'type': 'performance',
                    'priority': 'medium',
                    'description': 'Implement caching strategies for frequently accessed data',
                    'files_pattern': '**/*.{py,js}'
                }
            ])

        # Testing tasks
        if any(word in objective_lower for word in ['test', 'testing', 'coverage', 'quality']):
            tasks.extend([
                {
                    'id': f'test_{int(time.time())}',
                    'type': 'testing',
                    'priority': 'high',
                    'description': 'Write comprehensive unit tests for critical functions',
                    'files_pattern': '**/*.{py,js}'
                },
                {
                    'id': f'integration_{int(time.time())}',
                    'type': 'testing',
                    'priority': 'medium',
                    'description': 'Create integration tests for API endpoints',
                    'files_pattern': 'test/**/*'
                }
            ])

        # Documentation tasks
        if any(word in objective_lower for word in ['document', 'docs', 'readme', 'api']):
            tasks.extend([
                {
                    'id': f'docs_{int(time.time())}',
                    'type': 'documentation',
                    'priority': 'low',
                    'description': 'Create comprehensive API documentation with examples',
                    'files_pattern': '**/*.{py,js,md}'
                },
                {
                    'id': f'readme_{int(time.time())}',
                    'type': 'documentation',
                    'priority': 'low',
                    'description': 'Update README with installation, usage, and contribution guidelines',
                    'files_pattern': 'README.md'
                }
            ])

        # Default tasks if no specific keywords found
        if not tasks:
            tasks = [
                {
                    'id': f'analyze_{int(time.time())}',
                    'type': 'analysis',
                    'priority': 'medium',
                    'description': f'Analyze project and {objective}',
                    'files_pattern': '**/*'
                }
            ]

        return tasks

    def save_tasks(self, tasks: List[Dict]) -> None:
        """Save tasks to JSON file"""
        task_data = {
            'created_at': datetime.now().isoformat(),
            'total_tasks': len(tasks),
            'tasks': tasks
        }

        with open(self.tasks_file, 'w') as f:
            json.dump(task_data, f, indent=2)

        print(f"Saved {len(tasks)} tasks to {self.tasks_file}")

    def run_opencode_agent(self, task: Dict) -> subprocess.Popen:
        """Run OpenCode agent for a specific task"""
        log_file = self.logs_dir / f"{task['id']}.log"

        # Construct the prompt
        prompt = f"""
        Task: {task['description']}
        Type: {task['type']}
        Priority: {task['priority']}
        Files to examine: {task.get('files_pattern', '**/*')}

        Please analyze the code and implement improvements.
        """

        # Run OpenCode
        cmd = ['opencode', 'run', prompt]

        with open(log_file, 'w') as log:
            process = subprocess.Popen(
                cmd,
                stdout=log,
                stderr=subprocess.STDOUT,
                cwd=str(self.project_dir)
            )

        print(f"Started agent for task {task['id']} (PID: {process.pid})")
        return process

    def delegate(self, objective: str, max_concurrent: int = 4) -> None:
        """Main delegation function"""
        print(f"Analyzing project and generating tasks for: {objective}")

        # Generate tasks
        tasks = self.generate_tasks(objective)
        self.save_tasks(tasks)

        # Sort by priority
        priority_order = {'high': 0, 'medium': 1, 'low': 2}
        tasks.sort(key=lambda x: priority_order.get(x['priority'], 3))

        # Run tasks
        processes = []
        for task in tasks:
            # Wait if we're at max concurrent
            while len([p for p in processes if p.poll() is None]) >= max_concurrent:
                time.sleep(1)
                # Clean up completed processes
                processes = [p for p in processes if p.poll() is None]

            # Start new task
            process = self.run_opencode_agent(task)
            processes.append(process)
            time.sleep(2)  # Small delay between spawns

        # Wait for all to complete
        print(f"Waiting for {len(processes)} agents to complete...")
        for p in processes:
            p.wait()

        print("All agents completed!")


def main():
    """Main entry point"""
    import argparse

    parser = argparse.ArgumentParser(description='OpenCode Agent Task Delegator')
    parser.add_argument('objective', nargs='?',
                       default='make the application production ready',
                       help='Main objective for the agents')
    parser.add_argument('--project', '-p', default='.',
                       help='Project directory path')
    parser.add_argument('--max-concurrent', '-m', type=int, default=4,
                       help='Maximum concurrent agents')
    parser.add_argument('--analyze-only', '-a', action='store_true',
                       help='Only analyze and generate tasks, don\'t run')

    args = parser.parse_args()

    delegator = TaskDelegator(args.project)

    if args.analyze_only:
        project_info = delegator.detect_project_type()
        print("Project Analysis:")
        print(json.dumps(project_info, indent=2))

        tasks = delegator.generate_tasks(args.objective)
        print(f"\nGenerated {len(tasks)} tasks:")
        for task in tasks:
            print(f"  [{task['priority']}] {task['id']}: {task['description'][:60]}...")
    else:
        delegator.delegate(args.objective, args.max_concurrent)


if __name__ == '__main__':
    main()