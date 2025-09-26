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

    def generate_tasks(self, objective: str, use_opencode: bool = True) -> List[Dict]:
        """
        Generate tasks - tries OpenCode analysis first, falls back to simple tasks.
        Uses the same OpenCode calling mechanism as the agents themselves.
        """
        if use_opencode:
            try:
                print("Attempting OpenCode task generation...")
                tasks = self.generate_tasks_with_opencode_sync(objective)
                print(f"OpenCode generated {len(tasks)} tasks successfully")
                return tasks
            except Exception as e:
                print(f"Warning: OpenCode task generation failed: {e}")
                import traceback
                traceback.print_exc()
        
        # Fallback to simple task creation
        print("Falling back to simple task generation")
        return self.generate_simple_tasks(objective)

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

    def generate_tasks_with_opencode_sync(self, objective: str) -> List[Dict]:
        """
        Use OpenCode synchronously to generate intelligent tasks.
        Uses the same mechanism as run_opencode_agent but waits for response.
        """
        project_info = self.detect_project_type()
        
        # Create a prompt for OpenCode to analyze and generate tasks
        prompt = f"""
Analyze this development objective and break it down into 3-5 specific, actionable tasks:

OBJECTIVE: {objective}

PROJECT CONTEXT:
- Languages: {', '.join(project_info['languages']) if project_info['languages'] else 'Unknown'}
- Frameworks: {', '.join(project_info['frameworks']) if project_info['frameworks'] else 'Unknown'}  
- Has tests: {project_info['has_tests']}
- Project directory: {self.project_dir}

For each task, provide:
1. A task type (choose from: feature, testing, security, performance, documentation, frontend, backend)
2. Priority (high, medium, low) 
3. A specific description of what to implement
4. File patterns to focus on (like *.html, *.js, *.py, etc.)

Please respond with EXACTLY this format for each task:
TASK: [type] | [priority] | [description] | [file_pattern]

Example:
TASK: frontend | high | Complete the agent status dashboard with real-time updates | *.html,*.js,*.css
TASK: testing | medium | Add unit tests for dashboard functionality | *test*.js

Focus on the specific objective, not generic improvements.
"""

        try:
            print("Calling OpenCode for task generation...")
            # Run OpenCode and wait for response (same as agents but synchronous)
            result = subprocess.run(
                ['opencode', 'run', prompt],
                capture_output=True,
                text=True,
                timeout=60,  # Increase timeout for task generation
                cwd=str(self.project_dir)
            )

            print(f"OpenCode returned with code: {result.returncode}")
            
            if result.returncode == 0 and result.stdout:
                print("OpenCode response received, parsing tasks...")
                # Parse the structured response
                tasks = []
                lines = result.stdout.strip().split('\n')
                timestamp = int(time.time())
                
                print(f"Analyzing {len(lines)} lines from OpenCode response")
                
                for i, line in enumerate(lines):
                    if line.strip().startswith('TASK:'):
                        print(f"Found task line {i}: {line}")
                        try:
                            # Parse: TASK: type | priority | description | file_pattern
                            parts = line.replace('TASK:', '').strip().split(' | ')
                            if len(parts) >= 4:
                                task_type = parts[0].strip()
                                priority = parts[1].strip()
                                description = parts[2].strip()
                                files_pattern = parts[3].strip()
                                
                                task = {
                                    'id': f'{task_type}_{timestamp}_{len(tasks)}',
                                    'type': task_type,
                                    'priority': priority,
                                    'description': description,
                                    'files_pattern': files_pattern
                                }
                                tasks.append(task)
                                print(f"  Created task: {task['id']}")
                            else:
                                print(f"  Warning: Task line has {len(parts)} parts, expected 4+")
                        except Exception as parse_error:
                            print(f"  Warning: Could not parse task line: {parse_error}")
                            continue

                if tasks:
                    print(f"Successfully generated {len(tasks)} tasks using OpenCode analysis")
                    return tasks
                else:
                    print("Warning: No valid tasks found in OpenCode response")
                    print("Raw response:")
                    print(result.stdout)
                    
            else:
                print(f"Warning: OpenCode task generation failed (exit {result.returncode})")
                if result.stderr:
                    print(f"Error output: {result.stderr}")
                    
        except subprocess.TimeoutExpired:
            print("Warning: OpenCode task generation timed out after 60 seconds")
        except Exception as e:
            print(f"Warning: OpenCode task generation error: {e}")

        # Fallback to simple task creation
        return self.generate_simple_tasks(objective)

    def generate_simple_tasks(self, objective: str) -> List[Dict]:
        """Generate simple tasks when OpenCode analysis isn't available"""
        timestamp = int(time.time())
        
        # Create one main task that directly addresses the objective
        return [{
            'id': f'main_objective_{timestamp}',
            'type': 'feature',
            'priority': 'high', 
            'description': f'Implement: {objective}',
            'files_pattern': '**/*'
        }]

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