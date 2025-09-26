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

# Import structured logging
try:
    from logger import StructuredLogger
    logger = StructuredLogger(__name__)
except ImportError:
    # Fallback to basic logging if structured logger not available
    import logging
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

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
        """
        Analyze project directory to identify technology stack and development tools.
        
        Scans the project root for configuration files, test directories, and CI/CD setup
        to automatically determine the most appropriate task delegation strategy.
        
        Returns:
            Dict containing project characteristics:
            - type: Project classification (will be 'unknown' for now, reserved for future use)
            - languages: List of detected programming languages
            - frameworks: List of detected frameworks/platforms
            - has_tests: Boolean indicating presence of test directories
            - has_ci: Boolean indicating CI/CD pipeline configuration
        """
        project_info = {
            'type': 'unknown',
            'languages': [],
            'frameworks': [],
            'has_tests': False,
            'has_ci': False
        }

        # Map configuration files to their corresponding language/framework pairs
        # This allows us to automatically detect the technology stack without user input
        checks = {
            'package.json': ('javascript', 'node'),
            'requirements.txt': ('python', 'python'),
            'Gemfile': ('ruby', 'rails'),
            'go.mod': ('go', 'go'),
            'Cargo.toml': ('rust', 'rust'),
            'pom.xml': ('java', 'maven'),
            'composer.json': ('php', 'php'),
        }

        # Scan for each configuration file and record detected technologies
        for file, (lang, framework) in checks.items():
            if (self.project_dir / file).exists():
                project_info['languages'].append(lang)
                project_info['frameworks'].append(framework)

        # Detect test infrastructure by checking for common test directory patterns
        # This helps determine if testing tasks should be prioritized
        test_dirs = ['test', 'tests', 'spec', '__tests__']
        project_info['has_tests'] = any((self.project_dir / d).exists() for d in test_dirs)

        # Detect CI/CD setup to understand deployment maturity
        # This influences task priority for production readiness features
        ci_files = ['.github/workflows', '.gitlab-ci.yml', 'Jenkinsfile', '.travis.yml']
        project_info['has_ci'] = any((self.project_dir / f).exists() for f in ci_files)

        return project_info

    def generate_tasks(self, objective: str) -> List[Dict]:
        """
        Generate intelligent task list based on user objective and project analysis.
        
        This method implements the core business logic for task delegation by analyzing
        the user's objective statement and mapping it to appropriate development tasks.
        It uses keyword detection and contextual analysis to create a prioritized
        task queue that matches the project's specific needs.
        
        Args:
            objective: User's high-level goal or requirement description
            
        Returns:
            List of task dictionaries, each containing:
            - id: Unique task identifier with timestamp
            - type: Task category (e.g., 'security', 'testing', 'frontend')
            - priority: Urgency level ('high', 'medium', 'low')
            - description: Detailed task description for the agent
            - files_pattern: Glob pattern specifying which files to examine
        """
        project_info = self.detect_project_type()
        tasks = []

        # Convert objective to lowercase for case-insensitive keyword matching
        objective_lower = objective.lower()

        # Handle detailed objectives by creating custom implementation tasks
        # Long objectives (>8 words) likely contain specific, actionable requirements
        if len(objective.split()) > 8:  # Long, detailed objectives
            tasks.append({
                'id': f'custom_objective_{int(time.time())}',
                'type': 'custom',
                'priority': 'high',
                'description': f'Implement specific requirement: {objective}',
                'files_pattern': '**/*'
            })

        # Frontend/Dashboard tasks
        if any(word in objective_lower for word in ['frontend', 'dashboard', 'viewer', 'ui', 'interface', 'html', 'css', 'javascript']):
            tasks.extend([
                {
                    'id': f'frontend_implementation_{int(time.time())}',
                    'type': 'frontend',
                    'priority': 'high',
                    'description': f'Implement frontend component: {objective}',
                    'files_pattern': '**/*.{html,css,js,ts,vue,react}'
                },
                {
                    'id': f'frontend_styling_{int(time.time())}',
                    'type': 'frontend',
                    'priority': 'medium',
                    'description': 'Add responsive styling and improve user experience',
                    'files_pattern': '**/*.{css,scss,html}'
                }
            ])

        # Security tasks
        if any(word in objective_lower for word in ['security', 'secure', 'production', 'audit']):
            tasks.extend([
                {
                    'id': f'security_scan_{int(time.time())}',
                    'type': 'security',
                    'priority': 'high',
                    'description': 'Scan for common security vulnerabilities: SQL injection, XSS, CSRF, insecure dependencies',
                    'files_pattern': '**/*.{py,js,php,rb,ts,java}'
                },
                {
                    'id': f'auth_review_{int(time.time())}',
                    'type': 'security',
                    'priority': 'high',
                    'description': 'Review and strengthen authentication and authorization mechanisms',
                    'files_pattern': '**/auth/**/*,**/login/**/*,**/security/**/*'
                },
                {
                    'id': f'input_validation_{int(time.time())}',
                    'type': 'security',
                    'priority': 'high',
                    'description': 'Add comprehensive input validation and sanitization for all user inputs',
                    'files_pattern': '**/*.{py,js,php,rb,ts}'
                }
            ])

        # Error handling and logging tasks
        if any(word in objective_lower for word in ['error', 'logging', 'log', 'exception', 'handling']):
            tasks.extend([
                {
                    'id': f'error_handling_{int(time.time())}',
                    'type': 'reliability',
                    'priority': 'high',
                    'description': 'Add comprehensive error handling with try-catch blocks and graceful degradation',
                    'files_pattern': '**/*.{py,js,ts,java,rb,php}'
                },
                {
                    'id': f'logging_system_{int(time.time())}',
                    'type': 'monitoring',
                    'priority': 'medium',
                    'description': 'Implement structured logging with appropriate log levels (DEBUG, INFO, WARN, ERROR)',
                    'files_pattern': '**/*.{py,js,ts,java,rb,php}'
                },
                {
                    'id': f'monitoring_alerts_{int(time.time())}',
                    'type': 'monitoring',
                    'priority': 'medium',
                    'description': 'Add monitoring and alerting for critical application errors and performance issues',
                    'files_pattern': '**/*.{py,js,ts}'
                }
            ])

        # Testing tasks - BUT only if not part of a specific non-testing objective
        testing_context = any(word in objective_lower for word in ['unit test', 'integration test', 'test coverage', 'testing framework'])
        generic_test_mention = 'test' in objective_lower and not any(phrase in objective_lower for phrase in ['test the', 'test this', 'test our'])
        
        if testing_context or (generic_test_mention and len(objective.split()) < 5):
            tasks.extend([
                {
                    'id': f'unit_tests_{int(time.time())}',
                    'type': 'testing',
                    'priority': 'high',
                    'description': 'Create comprehensive unit tests for all core functions and classes with edge case coverage',
                    'files_pattern': '**/*.{py,js,ts,java,rb,php}'
                },
                {
                    'id': f'integration_tests_{int(time.time())}',
                    'type': 'testing',
                    'priority': 'medium',
                    'description': 'Build integration tests for API endpoints and database interactions',
                    'files_pattern': 'test/**/*,tests/**/*,**/*test*'
                },
                {
                    'id': f'test_coverage_{int(time.time())}',
                    'type': 'testing',
                    'priority': 'medium',
                    'description': 'Set up test coverage reporting and ensure minimum 80% coverage target',
                    'files_pattern': '**/*'
                }
            ])

        # Performance tasks
        if any(word in objective_lower for word in ['performance', 'optimize', 'speed', 'fast', 'cache']):
            tasks.extend([
                {
                    'id': f'perf_analysis_{int(time.time())}',
                    'type': 'performance',
                    'priority': 'high',
                    'description': 'Profile application performance and identify bottlenecks in hot code paths',
                    'files_pattern': '**/*.{py,js,ts,java}'
                },
                {
                    'id': f'database_optimization_{int(time.time())}',
                    'type': 'performance',
                    'priority': 'high',
                    'description': 'Optimize database queries: add indexes, fix N+1 queries, implement query caching',
                    'files_pattern': '**/*.{py,js,ts,sql}'
                },
                {
                    'id': f'caching_strategy_{int(time.time())}',
                    'type': 'performance',
                    'priority': 'medium',
                    'description': 'Implement intelligent caching for frequently accessed data and expensive operations',
                    'files_pattern': '**/*.{py,js,ts}'
                }
            ])

        # Documentation tasks
        if any(word in objective_lower for word in ['document', 'docs', 'readme', 'api']):
            tasks.extend([
                {
                    'id': f'api_docs_{int(time.time())}',
                    'type': 'documentation',
                    'priority': 'medium',
                    'description': 'Generate comprehensive API documentation with request/response examples and error codes',
                    'files_pattern': '**/*.{py,js,ts,md}'
                },
                {
                    'id': f'code_comments_{int(time.time())}',
                    'type': 'documentation',
                    'priority': 'low',
                    'description': 'Add clear, helpful comments to complex functions and business logic',
                    'files_pattern': '**/*.{py,js,ts,java,rb,php}'
                },
                {
                    'id': f'readme_update_{int(time.time())}',
                    'type': 'documentation',
                    'priority': 'low',
                    'description': 'Update README with current installation, usage, and contribution guidelines',
                    'files_pattern': 'README.md,docs/**/*'
                }
            ])

        # Code quality and refactoring
        if any(word in objective_lower for word in ['quality', 'refactor', 'clean', 'improve', 'standard']):
            tasks.extend([
                {
                    'id': f'code_standards_{int(time.time())}',
                    'type': 'quality',
                    'priority': 'medium',
                    'description': 'Apply consistent code formatting, naming conventions, and style guidelines',
                    'files_pattern': '**/*.{py,js,ts,java,rb,php}'
                },
                {
                    'id': f'linting_setup_{int(time.time())}',
                    'type': 'quality',
                    'priority': 'medium',
                    'description': 'Set up and configure linting tools (ESLint, PyLint, etc.) with team standards',
                    'files_pattern': '**/*'
                },
                {
                    'id': f'code_duplication_{int(time.time())}',
                    'type': 'refactoring',
                    'priority': 'low',
                    'description': 'Identify and eliminate code duplication by extracting reusable functions/components',
                    'files_pattern': '**/*.{py,js,ts,java,rb,php}'
                }
            ])

        # Feature development tasks
        if any(word in objective_lower for word in ['add', 'implement', 'create', 'build', 'feature']):
            # Extract feature name from objective
            feature_desc = objective.replace('add ', '').replace('implement ', '').replace('create ', '')
            tasks.extend([
                {
                    'id': f'feature_impl_{int(time.time())}',
                    'type': 'feature',
                    'priority': 'high',
                    'description': f'Implement core functionality for: {feature_desc}',
                    'files_pattern': '**/*.{py,js,ts,java,rb,php}'
                },
                {
                    'id': f'feature_tests_{int(time.time())}',
                    'type': 'testing',
                    'priority': 'high',
                    'description': f'Create comprehensive tests for the new feature: {feature_desc}',
                    'files_pattern': 'test/**/*,tests/**/*'
                }
            ])

        # Default fallback - but make it more specific
        if not tasks:
            # Try to extract more context from the objective
            if len(objective.split()) > 3:
                tasks = [
                    {
                        'id': f'objective_analysis_{int(time.time())}',
                        'type': 'analysis',
                        'priority': 'medium',
                        'description': f'Analyze codebase and implement: {objective}',
                        'files_pattern': '**/*.{py,js,ts,java,rb,php,md}'
                    }
                ]
            else:
                tasks = [
                    {
                        'id': f'general_improvement_{int(time.time())}',
                        'type': 'improvement',
                        'priority': 'medium',
                        'description': f'General codebase improvement focusing on: {objective}',
                        'files_pattern': '**/*'
                    }
                ]

        return tasks

    def generate_tasks_with_opencode(self, objective: str) -> List[Dict]:
        """
        Use OpenCode to intelligently analyze objectives and generate appropriate tasks.
        This replaces hardcoded keyword matching with AI-powered task analysis.
        """
        import tempfile
        import re
        
        project_info = self.detect_project_type()
        
        # Create a prompt for OpenCode to analyze the objective and generate tasks
        analysis_prompt = f"""
Analyze this development objective and break it down into specific, actionable tasks:

OBJECTIVE: {objective}

PROJECT CONTEXT:
- Languages: {', '.join(project_info['languages']) if project_info['languages'] else 'Unknown'}
- Frameworks: {', '.join(project_info['frameworks']) if project_info['frameworks'] else 'Unknown'}  
- Has tests: {project_info['has_tests']}
- Has CI/CD: {project_info['has_ci']}
- Project directory: {self.project_dir}

Generate 3-5 specific tasks that would accomplish this objective. For each task, provide:
- A unique ID (use format: tasktype_timestamp)
- Task type (choose from: feature, testing, security, performance, documentation, refactoring, monitoring, frontend, backend, api)
- Priority (high, medium, low)
- Detailed description of what needs to be done
- File pattern to focus on (use glob patterns like **/*.py, **/*.js, etc.)

Return ONLY a JSON array of tasks in this exact format:
[
  {{
    "id": "feature_123456",
    "type": "feature", 
    "priority": "high",
    "description": "Specific description of what to implement",
    "files_pattern": "**/*.{{js,html,css}}"
  }}
]

Focus on creating tasks that directly address the stated objective, not generic improvements.
"""

        try:
            # Run OpenCode with the analysis prompt
            result = subprocess.run(
                ['opencode', 'run', analysis_prompt],
                capture_output=True,
                text=True,
                timeout=60,
                cwd=str(self.project_dir)
            )

            if result.returncode == 0 and result.stdout:
                try:
                    # Extract JSON from OpenCode's response
                    output = result.stdout.strip()
                    
                    # Try to find JSON array in the output
                    json_match = re.search(r'\[.*?\]', output, re.DOTALL)
                    if json_match:
                        json_str = json_match.group(0)
                        tasks = json.loads(json_str)
                        
                        # Add timestamp to task IDs to ensure uniqueness
                        timestamp = int(time.time())
                        for task in tasks:
                            if 'id' in task and not str(timestamp) in task['id']:
                                base_id = task['id'].split('_')[0] if '_' in task['id'] else task.get('type', 'task')
                                task['id'] = f"{base_id}_{timestamp}"
                        
                        if hasattr(logger, 'info'):
                            logger.info(f"Generated {len(tasks)} tasks using OpenCode analysis")
                        else:
                            print(f"Generated {len(tasks)} tasks using OpenCode analysis")
                            
                        return tasks
                    else:
                        if hasattr(logger, 'warning'):
                            logger.warning("No JSON found in OpenCode response, falling back")
                        else:
                            print("Warning: No JSON found in OpenCode response, falling back")
                except json.JSONDecodeError as e:
                    if hasattr(logger, 'error'):
                        logger.error(f"Failed to parse OpenCode JSON response: {e}")
                    else:
                        print(f"Error: Failed to parse OpenCode JSON response: {e}")
            else:
                if hasattr(logger, 'warning'):
                    logger.warning(f"OpenCode analysis failed (exit {result.returncode})")
                else:
                    print(f"Warning: OpenCode analysis failed (exit {result.returncode})")
                    
        except subprocess.TimeoutExpired:
            if hasattr(logger, 'warning'):
                logger.warning("OpenCode analysis timed out")
            else:
                print("Warning: OpenCode analysis timed out")
        except Exception as e:
            if hasattr(logger, 'error'):
                logger.error(f"Error during OpenCode analysis: {e}")
            else:
                print(f"Error during OpenCode analysis: {e}")

        # Fallback to simple task creation if OpenCode analysis fails
        return [{
            'id': f'custom_objective_{int(time.time())}',
            'type': 'custom',
            'priority': 'high',
            'description': f'Implement objective: {objective}',
            'files_pattern': '**/*'
        }]

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