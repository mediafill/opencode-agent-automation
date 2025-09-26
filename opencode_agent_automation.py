#!/usr/bin/env python3
"""
OpenCode Agent Automation - Self-Contained Module
A complete, portable automation system for AI agent delegation
"""

import os
import sys
import json
import subprocess
import tempfile
from pathlib import Path
from typing import Dict, List, Optional, Any
import zipfile
import tarfile
import shutil
import hashlib

# Import structured logger
try:
    from scripts.logger import get_logger
    logger = get_logger('opencode-automation')
except ImportError:
    # Fallback to basic logging if structured logger not available
    import logging
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    logger = logging.getLogger('opencode-automation')

class OpenCodeAgentAutomation:
    """
    Self-contained OpenCode Agent Automation module.
    Everything needed for AI agent delegation in a single package.
    """

    def __init__(self, project_dir: Optional[str] = None, auto_setup: bool = True):
        self.project_dir = Path(project_dir or os.getcwd())
        self.claude_dir = self.project_dir / '.claude'
        self._embedded_files = self._get_embedded_files()

        if auto_setup:
            self._ensure_setup()

    def _get_embedded_files(self) -> Dict[str, str]:
        """Get all embedded files from the module"""
        # This would normally be populated by the packaging process
        # For now, return empty dict - files will be downloaded on demand
        return {}

    def _ensure_setup(self):
        """Ensure the system is properly set up"""
        if not self.claude_dir.exists():
            self.setup_project()

    def setup_project(self) -> Dict[str, Any]:
        """Set up the automation system in the current project"""
        try:
            # Create directory structure
            dirs = ['logs', 'tasks', 'agents', 'config', 'cache']
            for dir_name in dirs:
                (self.claude_dir / dir_name).mkdir(parents=True, exist_ok=True)

            # Create default configuration
            config = self._create_default_config()
            self._save_config(config)

            # Create default tasks
            tasks = self._create_default_tasks()
            self._save_tasks(tasks)

            # Download required scripts if not embedded
            self._download_required_files()

            return {
                'success': True,
                'message': f'Project setup complete in {self.project_dir}',
                'config': config
            }

        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }

    def _create_default_config(self) -> Dict[str, Any]:
        """Create default configuration based on project type"""
        project_type = self._detect_project_type()

        config = {
            'version': '2.0.0',
            'project_type': project_type,
            'max_concurrent_agents': 4,
            'agent_timeout': 900,
            'auto_restart': True,
            'log_level': 'INFO',
            'cache_enabled': True,
            'auto_delegate': True,
            'smart_defaults': True,
            'portable_mode': True
        }

        # Project-specific defaults
        if project_type == 'nodejs':
            config.update({
                'test_command': 'npm test',
                'lint_command': 'npm run lint',
                'build_command': 'npm run build'
            })
        elif project_type == 'python':
            config.update({
                'test_command': 'python -m pytest',
                'lint_command': 'python -m flake8',
                'build_command': 'python setup.py build'
            })

        return config

    def _detect_project_type(self) -> str:
        """Detect the project type automatically"""
        if (self.project_dir / 'package.json').exists():
            return 'nodejs'
        elif (self.project_dir / 'requirements.txt').exists() or \
             (self.project_dir / 'setup.py').exists() or \
             (self.project_dir / 'pyproject.toml').exists():
            return 'python'
        elif (self.project_dir / 'Cargo.toml').exists():
            return 'rust'
        elif (self.project_dir / 'go.mod').exists():
            return 'go'
        elif (self.project_dir / 'Gemfile').exists():
            return 'ruby'
        elif (self.project_dir / 'composer.json').exists():
            return 'php'
        else:
            return 'generic'

    def _create_default_tasks(self) -> Dict[str, Any]:
        """Create default task templates"""
        return {
            'version': '2.0.0',
            'tasks': [
                {
                    'id': 'setup',
                    'type': 'setup',
                    'priority': 'high',
                    'description': 'Initial project setup and configuration',
                    'status': 'completed',
                    'auto_generated': True
                },
                {
                    'id': 'production_readiness',
                    'type': 'production',
                    'priority': 'medium',
                    'description': 'Make application production ready',
                    'status': 'pending',
                    'auto_generated': True
                }
            ]
        }

    def _save_config(self, config: Dict[str, Any]):
        """Save configuration to file"""
        config_file = self.claude_dir / 'config.json'
        with open(config_file, 'w', encoding='utf-8') as f:
            json.dump(config, f, indent=2, ensure_ascii=False)

    def _save_tasks(self, tasks: Dict[str, Any]):
        """Save tasks to file"""
        tasks_file = self.claude_dir / 'tasks.json'
        with open(tasks_file, 'w', encoding='utf-8') as f:
            json.dump(tasks, f, indent=2, ensure_ascii=False)

    def _download_required_files(self):
        """Download required scripts and templates"""
        base_url = "https://raw.githubusercontent.com/mediafill/opencode-agent-automation/main"

        files_to_download = {
            'scripts/run_agents.sh': 'run_agents.sh',
            'scripts/delegate.py': 'delegate.py',
            'scripts/monitor.sh': 'monitor.sh',
            'templates/CLAUDE.md': 'CLAUDE.md',
            'templates/agentsync.md': 'agentsync.md'
        }

        for remote_path, local_name in files_to_download.items():
            local_path = self.claude_dir / local_name
            if not local_path.exists():
                url = f"{base_url}/{remote_path}"
                try:
                    self._download_file(url, local_path)
                    # Make scripts executable
                    if local_name.endswith('.sh') or local_name.endswith('.py'):
                        local_path.chmod(0o755)
                except Exception as e:
                    print(f"Warning: Could not download {local_name}: {e}")

    def _download_file(self, url: str, dest: Path):
        """Download a file from URL"""
        if sys.platform == 'win32':
            # Use powershell on Windows
            cmd = f'powershell -Command "Invoke-WebRequest -Uri \'{url}\' -OutFile \'{dest}\'"'
            subprocess.run(cmd, shell=True, check=True)
        else:
            # Use curl on Unix-like systems
            subprocess.run(['curl', '-fsSL', url, '-o', str(dest)], check=True)

    def delegate_task(self, task: str, **kwargs) -> Dict[str, Any]:
        """Delegate a task to OpenCode agents"""
        try:
            # Ensure setup
            self._ensure_setup()

            # Create task entry
            task_id = self._generate_task_id(task)
            task_entry = {
                'id': task_id,
                'description': task,
                'status': 'pending',
                'priority': kwargs.get('priority', 'medium'),
                'created_at': self._get_timestamp(),
                'type': self._classify_task(task)
            }

            # Add to tasks
            tasks = self.get_tasks()
            tasks['tasks'].append(task_entry)
            self._save_tasks(tasks)

            # Execute delegation
            result = self._execute_delegation(task, **kwargs)

            # Update task status
            task_entry['status'] = 'completed' if result['success'] else 'failed'
            task_entry['result'] = result
            self._save_tasks(tasks)

            return result

        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'task': task
            }

    def _generate_task_id(self, task: str) -> str:
        """Generate a unique task ID"""
        import hashlib
        hash_obj = hashlib.md5(task.encode())
        return f"task_{hash_obj.hexdigest()[:8]}"

    def _get_timestamp(self) -> str:
        """Get current timestamp"""
        from datetime import datetime
        return datetime.now().isoformat()

    def _classify_task(self, task: str) -> str:
        """Classify task type based on content"""
        task_lower = task.lower()

        if any(word in task_lower for word in ['test', 'testing', 'unit test']):
            return 'testing'
        elif any(word in task_lower for word in ['security', 'audit', 'vulnerability']):
            return 'security'
        elif any(word in task_lower for word in ['performance', 'optimize', 'speed']):
            return 'performance'
        elif any(word in task_lower for word in ['document', 'docs', 'readme']):
            return 'documentation'
        elif any(word in task_lower for word in ['production', 'deploy', 'monitoring']):
            return 'production'
        else:
            return 'general'

    def _execute_delegation(self, task: str, **kwargs) -> Dict[str, Any]:
        """Execute the actual task delegation"""
        try:
            # Check if OpenCode is available
            if not self._check_opencode():
                return {
                    'success': False,
                    'error': 'OpenCode not found. Please install from https://opencode.ai'
                }

            # For now, simulate delegation (would call actual OpenCode)
            # In real implementation, this would spawn OpenCode agents
            return {
                'success': True,
                'task': task,
                'message': f'Task delegated: {task}',
                'simulated': True  # Remove this in real implementation
            }

        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }

    def _check_opencode(self) -> bool:
        """Check if OpenCode is available"""
        try:
            result = subprocess.run(['opencode', '--version'],
                                  capture_output=True, text=True, timeout=5)
            return result.returncode == 0
        except:
            return False

    def get_tasks(self) -> Dict[str, Any]:
        """Get all tasks"""
        tasks_file = self.claude_dir / 'tasks.json'
        if tasks_file.exists():
            try:
                with open(tasks_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except:
                pass

        return {'version': '2.0.0', 'tasks': []}

    def get_status(self) -> Dict[str, Any]:
        """Get system status"""
        return {
            'project_dir': str(self.project_dir),
            'claude_dir': str(self.claude_dir),
            'setup_complete': self.claude_dir.exists(),
            'opencode_available': self._check_opencode(),
            'tasks_count': len(self.get_tasks()['tasks']),
            'config': self.get_config()
        }

    def get_config(self) -> Dict[str, Any]:
        """Get current configuration"""
        config_file = self.claude_dir / 'config.json'
        if config_file.exists():
            try:
                with open(config_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except:
                pass

        return self._create_default_config()

    def export_config(self, output_file: Optional[str] = None) -> str:
        """Export configuration and tasks"""
        data = {
            'config': self.get_config(),
            'tasks': self.get_tasks(),
            'exported_at': self._get_timestamp()
        }

        if output_file:
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            return f"Configuration exported to {output_file}"
        else:
            return json.dumps(data, indent=2, ensure_ascii=False)

    def import_config(self, config_data: str, input_file: Optional[str] = None) -> Dict[str, Any]:
        """Import configuration and tasks"""
        try:
            if input_file:
                with open(input_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
            else:
                data = json.loads(config_data)

            if 'config' in data:
                self._save_config(data['config'])
            if 'tasks' in data:
                self._save_tasks(data['tasks'])

            return {
                'success': True,
                'message': 'Configuration imported successfully'
            }

        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }

    def cleanup(self) -> Dict[str, Any]:
        """Clean up the automation system"""
        try:
            if self.claude_dir.exists():
                shutil.rmtree(self.claude_dir)

            return {
                'success': True,
                'message': 'Cleanup completed successfully'
            }

        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }

# CLI interface
def main():
    """Command line interface for the self-contained module"""
    import argparse

    parser = argparse.ArgumentParser(description='OpenCode Agent Automation - Self-Contained Module')
    parser.add_argument('action', choices=['setup', 'delegate', 'status', 'export', 'import', 'cleanup'],
                       help='Action to perform')
    parser.add_argument('--task', help='Task for delegation')
    parser.add_argument('--file', help='File for import/export')
    parser.add_argument('--project-dir', help='Project directory')

    args = parser.parse_args()

    try:
        automation = OpenCodeAgentAutomation(args.project_dir)

        if args.action == 'setup':
            result = automation.setup_project()
            print(json.dumps(result, indent=2))

        elif args.action == 'delegate':
            if not args.task:
                print("Error: --task required for delegation")
                sys.exit(1)
            result = automation.delegate_task(args.task)
            print(json.dumps(result, indent=2))

        elif args.action == 'status':
            result = automation.get_status()
            print(json.dumps(result, indent=2))

        elif args.action == 'export':
            result = automation.export_config(args.file)
            if args.file:
                print(result)
            else:
                print(result)

        elif args.action == 'import':
            if not args.file:
                print("Error: --file required for import")
                sys.exit(1)
            result = automation.import_config("", args.file)
            print(json.dumps(result, indent=2))

        elif args.action == 'cleanup':
            result = automation.cleanup()
            print(json.dumps(result, indent=2))

    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()