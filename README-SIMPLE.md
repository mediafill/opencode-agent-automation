# OpenCode Agent System - Simple Edition

A simplified, portable agent system that can be easily integrated into any project.

## 🚀 Quick Install

### Option 1: Simple Script (Recommended)

```bash
# Download and run the installer
curl -fsSL https://raw.githubusercontent.com/opencode/agent-system/main/install-simple.sh | bash
```

### Option 2: Manual Install

```bash
# Clone or download the installer
python3 install_simple.py --project .
```

## 📦 What's Installed

After installation, you'll have:

- `.opencode/` directory with the agent system
- Simple orchestrator for task coordination
- Task manager for queuing and execution
- Agent pool for managing agent instances
- Communication system for agent coordination

## 🛠️ Usage

### Basic Usage

```python
# Import the agent system
from .opencode import run_task, get_status

# Run a task
task_id = run_task("add comprehensive unit tests")

# Check status
status = get_status()
print(f"Running tasks: {status['running_tasks']}")
```

### Convenience Functions

```python
from .opencode import add_tests, optimize_performance, add_monitoring

# Add tests to your project
add_tests()

# Optimize performance
optimize_performance()

# Add monitoring and logging
add_monitoring()
```

### Command Line Usage

```bash
# Initialize the system
python3 .opencode/init.py

# Run a task
python3 .opencode/run_task.py "add comprehensive tests"

# Check status
python3 .opencode/status.py
```

## 🏗️ Architecture

### Core Components

- **AgentOrchestrator**: Main coordinator that manages task execution
- **TaskManager**: Handles task queuing and status tracking
- **AgentPool**: Manages available agent instances
- **CommunicationManager**: Handles inter-agent messaging

### Directory Structure

```
.opencode/
├── __init__.py          # Main API
├── agent_orchestrator.py # Core orchestrator
├── task_manager.py      # Task management
├── agent_pool.py        # Agent pool management
├── communication.py     # Communication system
├── config.json          # Configuration
├── agents.json          # Agent registry
├── init.py             # Initialization script
├── run_task.py         # Task runner
├── status.py           # Status checker
└── logs/               # Log files
```

## ⚙️ Configuration

Edit `.opencode/config.json`:

```json
{
  "max_agents": 4,
  "auto_start": true,
  "task_timeout": 300,
  "enable_monitoring": true,
  "log_level": "INFO"
}
```

## 🔧 Integration Examples

### Python Project Integration

```python
# In your main.py or setup.py
from .opencode import get_orchestrator

def setup_project():
    orchestrator = get_orchestrator()
    # System is ready to use

def build_production():
    from .opencode import make_production_ready
    make_production_ready()
```

### CI/CD Integration

```yaml
# .github/workflows/test.yml
- name: Run Agent Tasks
  run: |
    python3 .opencode/run_task.py "run tests and generate coverage"
    python3 .opencode/run_task.py "check code quality"
```

### Development Workflow

```bash
# During development
python3 .opencode/run_task.py "add tests for new feature"
python3 .opencode/run_task.py "optimize database queries"
python3 .opencode/run_task.py "add error handling"
```

## 📊 Monitoring

### Status Checking

```python
from .opencode import get_status

status = get_status()
print(f"System: {status['system_status']}")
print(f"Running: {status['running_tasks']}")
print(f"Completed: {status['completed_tasks']}")
```

### Log Monitoring

```bash
# View recent logs
tail -f .opencode/logs/task_*.log

# Check specific task logs
cat .opencode/logs/task_abc123.log
```

## 🔄 Task Types

The system supports various task types:

- **Testing**: Unit tests, integration tests, coverage
- **Code Quality**: Linting, formatting, refactoring
- **Performance**: Optimization, caching, profiling
- **Security**: Audits, vulnerability fixes
- **Documentation**: API docs, README updates
- **Monitoring**: Logging, error handling, metrics

## 🐛 Troubleshooting

### Common Issues

**Agent system not found:**

```bash
# Reinstall the system
python3 install_simple.py --force
```

**OpenCode CLI not available:**

```bash
# Install OpenCode CLI first
# Visit: https://opencode.ai
```

**Tasks timing out:**

```json
// Increase timeout in config.json
{
  "task_timeout": 600
}
```

**Too many concurrent tasks:**

```json
// Reduce max agents in config.json
{
  "max_agents": 2
}
```

## 🔐 Security

- Tasks run in isolated subprocesses
- No direct access to host system
- Configurable resource limits
- Audit logging of all operations

## 📈 Performance

- Lightweight: Minimal dependencies
- Fast startup: < 1 second initialization
- Efficient: Background monitoring and cleanup
- Scalable: Configurable concurrent task limits

## 🤝 Contributing

The agent system is designed to be:

- **Simple**: Easy to understand and modify
- **Portable**: Works in any Python project
- **Extensible**: Easy to add new capabilities
- **Reliable**: Robust error handling and recovery

## 📄 License

MIT License - Free for all projects and use cases.</content>
<parameter name="filePath">README-SIMPLE.md
