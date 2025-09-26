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

try:
    from intelligent_cache import (
        get_cache, cache_file_operation, cache_process_operation,
        invalidate_file_cache, invalidate_process_cache
    )
    CACHE_AVAILABLE = True
except ImportError:
    CACHE_AVAILABLE = False

try:
    from intelligent_cache import (
        get_cache, cache_file_operation, cache_process_operation,
        invalidate_file_cache, invalidate_process_cache
    )
    CACHE_AVAILABLE = True
except ImportError:
    CACHE_AVAILABLE = False

class OpenCodeOrchestrator:
    """Main orchestrator for managing OpenCode agents"""

    def __init__(self, project_dir: Optional[str] = None):
        try:
            self.project_dir = Path(project_dir or os.getcwd())
            self.claude_dir = self.project_dir / '.claude'
            self.tasks_file = self.claude_dir / 'tasks.json'
            self.logs_dir = self.claude_dir / 'logs'
            self.config_file = self.claude_dir / 'orchestrator_config.json'
        except (OSError, ValueError) as e:
            print(f"Error initializing paths: {e}")
            # Fallback to current directory
            self.project_dir = Path.cwd()
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
        """Load orchestrator configuration with intelligent caching"""
        if CACHE_AVAILABLE:
            try:
                # Use intelligent cache for config loading
                cache = get_cache()
                cache_key = f"config_{self.config_file.name}"

                cached_config = cache.get(cache_key)
                if cached_config is not None:
                    return cached_config

                # Load from file and cache it
                if self.config_file.exists():
                    with open(self.config_file, 'r', encoding='utf-8') as f:
                        config = json.load(f)
                        # Validate config structure
                        if not isinstance(config, dict):
                            raise ValueError("Config file must contain a JSON object")
                        cache.set(cache_key, config, cache_type='config')
                        return config
            except Exception as e:
                print(f"Warning: Error using intelligent cache for config: {e}")
                # Fall back to direct loading

        # Fallback to original implementation
        try:
            if self.config_file.exists():
                with open(self.config_file, 'r', encoding='utf-8') as f:
                    config = json.load(f)
                    # Validate config structure
                    if not isinstance(config, dict):
                        raise ValueError("Config file must contain a JSON object")
                    return config
        except (json.JSONDecodeError, IOError, OSError, ValueError) as e:
            print(f"Warning: Error loading config file {self.config_file}: {e}")
            print("Using default configuration")
        except Exception as e:
            print(f"Unexpected error loading config: {e}")
            print("Using default configuration")

        # Default configuration
        default_config = {
            'auto_delegate': True,
            'max_concurrent_agents': 4,
            'monitor_interval': 5,
            'auto_retry_failed': True,
            'delegation_history': []
        }

        try:
            self._save_config(default_config)
        except Exception as e:
            print(f"Warning: Could not save default config: {e}")

        return default_config

    def _save_config(self, config: Dict):
        """Save orchestrator configuration"""
        try:
            with open(self.config_file, 'w', encoding='utf-8') as f:
                json.dump(config, f, indent=2, ensure_ascii=False)
        except (IOError, OSError, TypeError) as e:
            print(f"Error saving config to {self.config_file}: {e}")
        except Exception as e:
            print(f"Unexpected error saving config: {e}")

    def analyze_request(self, request: str) -> Tuple[bool, str, List[str]]:
        """
        Analyze a user request to determine if it should be auto-delegated with caching

        Returns:
            (should_delegate, task_type, matched_keywords)
        """
        if CACHE_AVAILABLE:
            try:
                # Cache analysis results for similar requests
                cache = get_cache()
                cache_key = f"analysis_{hash(request) % 10000}"  # Simple hash-based key

                cached_result = cache.get(cache_key)
                if cached_result is not None:
                    return tuple(cached_result)

                # Perform analysis and cache result
                result = self._analyze_request_uncached(request)
                cache.set(cache_key, list(result), cache_type='process')
                return result
            except Exception as e:
                print(f"Warning: Error using cache for request analysis: {e}")
                # Fall back to direct analysis

        return self._analyze_request_uncached(request)

    def _analyze_request_uncached(self, request: str) -> Tuple[bool, str, List[str]]:
        """Uncached version of request analysis"""
        try:
            if not isinstance(request, str) or not request.strip():
                return (False, "unknown", [])

            request_lower = request.lower()

            for task_type, keywords in self.auto_delegate_patterns.items():
                try:
                    matched = [kw for kw in keywords if kw in request_lower]
                    if matched:
                        return (True, task_type, matched)
                except (TypeError, AttributeError) as e:
                    print(f"Warning: Error processing keywords for {task_type}: {e}")
                    continue

            return (False, "general", [])

        except Exception as e:
            print(f"Error analyzing request: {e}")
            return (False, "unknown", [])

    def delegate_task(self, objective: str, force: bool = False) -> Dict:
        """
        Delegate a task to OpenCode agents

        Args:
            objective: The task objective to delegate
            force: Force delegation even if auto-delegate is disabled

        Returns:
            Dict with delegation results
        """
        try:
            if not isinstance(objective, str) or not objective.strip():
                return {
                    'delegated': False,
                    'reason': 'Invalid objective: must be a non-empty string'
                }

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

            try:
                self.config['delegation_history'].append(delegation_entry)
                self._save_config(self.config)
            except Exception as e:
                print(f"Warning: Could not save delegation history: {e}")

            # Execute delegation
            try:
                launch_script = self.claude_dir / 'launch.sh'
                if not launch_script.exists():
                    return {
                        'delegated': False,
                        'reason': f'Launch script not found: {launch_script}'
                    }

                cmd = [
                    str(launch_script),
                    'delegate',
                    objective
                ]

                result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

                return {
                    'delegated': True,
                    'task_type': task_type,
                    'matched_keywords': keywords,
                    'return_code': result.returncode,
                    'stdout': result.stdout,
                    'stderr': result.stderr
                }

            except subprocess.TimeoutExpired:
                return {
                    'delegated': False,
                    'reason': 'Delegation command timed out'
                }
            except (subprocess.SubprocessError, OSError) as e:
                return {
                    'delegated': False,
                    'reason': f'Failed to execute delegation command: {e}'
                }

        except Exception as e:
            return {
                'delegated': False,
                'reason': f'Unexpected error during delegation: {e}'
            }

    def monitor_agents(self, continuous: bool = False) -> Dict:
        """
        Monitor running OpenCode agents

        Args:
            continuous: If True, continuously monitor until all agents complete

        Returns:
            Dict with current agent status
        """
        try:
            while True:
                try:
                    # Get status
                    launch_script = self.claude_dir / 'launch.sh'
                    if not launch_script.exists():
                        return {
                            'timestamp': datetime.now().isoformat(),
                            'error': f'Launch script not found: {launch_script}',
                            'agents_running': False
                        }

                    cmd = [str(launch_script), 'status']
                    result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)

                    # Parse status (simplified for now)
                    status = {
                        'timestamp': datetime.now().isoformat(),
                        'output': result.stdout,
                        'agents_running': 'agents running' in result.stdout.lower(),
                        'return_code': result.returncode
                    }

                    if result.stderr:
                        status['stderr'] = result.stderr

                    if not continuous or not status['agents_running']:
                        return status

                    time.sleep(self.config.get('monitor_interval', 5))

                except subprocess.TimeoutExpired:
                    return {
                        'timestamp': datetime.now().isoformat(),
                        'error': 'Status command timed out',
                        'agents_running': False
                    }
                except (subprocess.SubprocessError, OSError) as e:
                    return {
                        'timestamp': datetime.now().isoformat(),
                        'error': f'Failed to get status: {e}',
                        'agents_running': False
                    }
                except Exception as e:
                    return {
                        'timestamp': datetime.now().isoformat(),
                        'error': f'Unexpected error monitoring agents: {e}',
                        'agents_running': False
                    }

        except KeyboardInterrupt:
            return {
                'timestamp': datetime.now().isoformat(),
                'error': 'Monitoring interrupted by user',
                'agents_running': False
            }
        except Exception as e:
            return {
                'timestamp': datetime.now().isoformat(),
                'error': f'Fatal error in monitoring: {e}',
                'agents_running': False
            }

    def get_recommendations(self, context: Optional[str] = None) -> List[str]:
        """
        Get recommendations for what to delegate based on current project state with caching

        Returns:
            List of recommended delegation objectives
        """
        if CACHE_AVAILABLE:
            try:
                # Cache recommendations based on project state
                cache = get_cache()
                # Create a cache key based on project files that affect recommendations
                cache_key_parts = []
                if os.path.exists('package.json'):
                    cache_key_parts.append('package_json')
                if os.path.exists('package-lock.json'):
                    cache_key_parts.append('package_lock')
                if os.path.exists('README.md'):
                    cache_key_parts.append('readme')
                cache_key = f"recommendations_{'_'.join(cache_key_parts)}"

                cached_recommendations = cache.get(cache_key)
                if cached_recommendations is not None:
                    return cached_recommendations

                # Generate recommendations and cache them
                recommendations = self._get_recommendations_uncached(context)
                cache.set(cache_key, recommendations, cache_type='process')
                return recommendations
            except Exception as e:
                print(f"Warning: Error using cache for recommendations: {e}")
                # Fall back to direct generation

        return self._get_recommendations_uncached(context)

    def _get_recommendations_uncached(self, context: Optional[str] = None) -> List[str]:
        """Uncached version of recommendations generation"""
        recommendations = []

        try:
            # Check for failing tests with caching
            if os.path.exists('package.json'):
                try:
                    def run_npm_test():
                        test_result = subprocess.run(['npm', 'test'], capture_output=True, timeout=30)
                        return test_result.returncode != 0

                    if CACHE_AVAILABLE:
                        test_failed = cache_process_operation(run_npm_test, 'npm_test')
                    else:
                        test_failed = run_npm_test()

                    if test_failed:
                        recommendations.append("Fix all failing unit tests and integration tests")
                except (subprocess.TimeoutExpired, subprocess.SubprocessError, OSError) as e:
                    print(f"Warning: Could not check test status: {e}")

            # Check for missing documentation
            try:
                if not os.path.exists('README.md'):
                    recommendations.append("Create comprehensive README documentation")
            except OSError as e:
                print(f"Warning: Could not check for README: {e}")

            # Check for security issues with caching
            if os.path.exists('package-lock.json'):
                try:
                    def run_npm_audit():
                        audit_result = subprocess.run(['npm', 'audit'], capture_output=True, timeout=30)
                        return b'vulnerabilities' in audit_result.stdout

                    if CACHE_AVAILABLE:
                        has_vulnerabilities = cache_process_operation(run_npm_audit, 'npm_audit')
                    else:
                        has_vulnerabilities = run_npm_audit()

                    if has_vulnerabilities:
                        recommendations.append("Perform security audit and fix all vulnerabilities")
                except (subprocess.TimeoutExpired, subprocess.SubprocessError, OSError) as e:
                    print(f"Warning: Could not check security audit: {e}")

            # Always include these recommendations
            recommendations.extend([
                "Improve code quality with linting, formatting, and best practices",
                "Make application production ready with monitoring and error handling"
            ])

        except Exception as e:
            print(f"Error generating recommendations: {e}")
            # Return basic recommendations even if checks fail
            recommendations = [
                "Improve code quality with linting, formatting, and best practices",
                "Make application production ready with monitoring and error handling"
            ]

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
    try:
        parser = argparse.ArgumentParser(description='OpenCode Agent Orchestrator')
        parser.add_argument('action', choices=['delegate', 'monitor', 'recommend', 'plan', 'analyze'],
                           help='Action to perform')
        parser.add_argument('objective', nargs='?', help='Objective for delegation or planning')
        parser.add_argument('--continuous', action='store_true', help='Continuous monitoring')
        parser.add_argument('--force', action='store_true', help='Force delegation')

        args = parser.parse_args()

        try:
            orchestrator = OpenCodeOrchestrator()
        except Exception as e:
            print(f"Error initializing orchestrator: {e}")
            sys.exit(1)

        if args.action == 'delegate':
            if not args.objective:
                print("Error: Objective required for delegation")
                sys.exit(1)

            try:
                result = orchestrator.delegate_task(args.objective, args.force)
                print(json.dumps(result, indent=2))
            except Exception as e:
                print(f"Error delegating task: {e}")
                sys.exit(1)

        elif args.action == 'monitor':
            try:
                status = orchestrator.monitor_agents(args.continuous)
                print(json.dumps(status, indent=2))
            except Exception as e:
                print(f"Error monitoring agents: {e}")
                sys.exit(1)

        elif args.action == 'recommend':
            try:
                recommendations = orchestrator.get_recommendations()
                print("Recommended delegations:")
                for i, rec in enumerate(recommendations, 1):
                    print(f"{i}. {rec}")
            except Exception as e:
                print(f"Error getting recommendations: {e}")
                sys.exit(1)

        elif args.action == 'plan':
            if not args.objective:
                print("Error: Objective required for planning")
                sys.exit(1)

            try:
                tasks = orchestrator.create_delegation_plan(args.objective)
                print(f"Delegation plan for: {args.objective}")
                for i, task in enumerate(tasks, 1):
                    print(f"{i}. {task}")
            except Exception as e:
                print(f"Error creating delegation plan: {e}")
                sys.exit(1)

        elif args.action == 'analyze':
            if not args.objective:
                print("Error: Objective required for analysis")
                sys.exit(1)

            try:
                should_delegate, task_type, keywords = orchestrator.analyze_request(args.objective)
                print(f"Should auto-delegate: {should_delegate}")
                print(f"Task type: {task_type}")
                print(f"Matched keywords: {keywords}")
            except Exception as e:
                print(f"Error analyzing request: {e}")
                sys.exit(1)

    except KeyboardInterrupt:
        print("\nOperation cancelled by user")
        sys.exit(0)
    except SystemExit:
        # Re-raise SystemExit to maintain exit codes
        raise
    except Exception as e:
        print(f"Fatal error: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()