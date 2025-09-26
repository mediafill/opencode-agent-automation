# OpenCode Agent Automation System

A sophisticated multi-agent orchestration system that automates software development tasks using the OpenCode CLI. This system coordinates multiple AI agents to execute complex development workflows, manage tasks, and maintain system health.

## 🚀 Features

- **Multi-Agent Orchestration**: Coordinate multiple AI agents for complex tasks
- **Task Management**: Queue, monitor, and track task execution
- **Health Monitoring**: Real-time system and agent health checks
- **Scalable Architecture**: Support for multiple concurrent tasks
- **Comprehensive Logging**: Detailed execution logs and status tracking
- **Configuration Management**: Flexible configuration system
- **Background Processing**: Asynchronous task execution

## 📋 Table of Contents

- [Quick Start](#quick-start)
- [Installation](#installation)
- [Usage](#usage)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## 🏃 Quick Start

### Prerequisites

- Python 3.8+
- [OpenCode CLI](https://opencode.ai) installed and configured

### Basic Usage

1. **Initialize the system:**

   ```bash
   python3 .claude/init.py
   ```

2. **Run a task:**

   ```bash
   python3 .claude/run_task.py "Create a Python function to calculate fibonacci numbers"
   ```

3. **Check system status:**
   ```bash
   python3 .claude/status.py
   ```

## 📦 Installation

### Option 1: Direct Installation

1. Clone or download this repository
2. Ensure OpenCode CLI is installed:
   ```bash
   opencode --version
   ```
3. Initialize the agent system:
   ```bash
   python3 .claude/init.py
   ```

### Option 2: As Part of a Project

Add the `.claude/` directory to your project root and initialize:

```bash
# Copy the .opencode directory to your project
cp -r .opencode /path/to/your/project/

# Initialize
cd /path/to/your/project
python3 .opencode/init.py
```

## 💻 Usage

### Command Line Interface

#### Initialize System

```bash
python3 .opencode/init.py
```

#### Run Tasks

```bash
# Simple task
python3 .opencode/run_task.py "analyze code quality"

# Complex task with multiple objectives
python3 .opencode/run_task.py "refactor the authentication module and add unit tests"
```

#### Check Status

```bash
python3 .opencode/status.py
```

### Programmatic Usage

```python
from .opencode.agent_orchestrator import AgentOrchestrator

# Initialize orchestrator
orchestrator = AgentOrchestrator()

# Run a task
task_id = orchestrator.run_task("Create a REST API endpoint")

# Check status
status = orchestrator.get_status()
print(f"Running tasks: {status['running_tasks']}")

# Get result
result = orchestrator.get_task_result(task_id)
```

## 🏗️ Architecture

### Core Components

```
.claude/
├── master_agent_orchestrator.py    # Main orchestration logic
├── enhanced_task_queue.py         # Task management
├── communication_manager.py       # Inter-agent communication
├── health_monitor.py              # System health monitoring
├── config.json                    # System configuration
├── agents.json                    # Agent and task state
├── logs/                          # Execution logs
└── init.py                       # System initialization
```

### Agent Hierarchy

The system implements a master-slave architecture:

- **Agent Orchestrator**: Central coordinator managing task distribution
- **Task Manager**: Handles task queuing, execution, and monitoring
- **Communication Layer**: Manages inter-agent messaging
- **Agent Pool**: Manages available agents and their capabilities

For detailed multi-agent architecture, see [AGENTS.md](AGENTS.md).

## ⚙️ Configuration

### config.json

```json
{
  "version": "1.0.0",
  "max_agents": 4,
  "auto_start": true,
  "log_level": "INFO",
  "task_timeout": 300,
  "enable_monitoring": true
}
```

### Configuration Options

- `max_agents`: Maximum number of concurrent agents (default: 4)
- `auto_start`: Automatically start agents on system initialization
- `task_timeout`: Maximum execution time per task in seconds (default: 300)
- `enable_monitoring`: Enable background health monitoring
- `log_level`: Logging verbosity (DEBUG, INFO, WARNING, ERROR)

## 📚 API Reference

### AgentOrchestrator

#### Methods

- `run_task(objective: str, **kwargs) -> str`
  - Execute a task with the given objective
  - Returns task ID

- `get_status() -> Dict[str, Any]`
  - Get current system status
  - Returns status information

- `get_task_result(task_id: str) -> Optional[Dict[str, Any]]`
  - Get result of a completed task
  - Returns task result or None

- `list_tasks() -> Dict[str, Any]`
  - List all running and completed tasks
  - Returns task lists

## 🔧 Troubleshooting

### Common Issues

#### OpenCode CLI Not Found

```
❌ OpenCode CLI not found. Please install it first.
```

**Solution**: Install OpenCode CLI from [opencode.ai](https://opencode.ai)

#### Task Timeout

```
Task timed out
```

**Solution**: Increase `task_timeout` in `config.json` or break complex tasks into smaller steps

#### System Initialization Failed

```
❌ Failed to initialize agent system
```

**Solution**:

1. Check Python version (3.8+ required)
2. Verify file permissions
3. Check logs in `.claude/logs/`

### Logs and Debugging

- Task execution logs: `.claude/logs/task_{task_id}.log`
- Enable debug logging by setting `log_level: "DEBUG"` in `config.json`

### Performance Tuning

- Adjust `max_agents` based on system resources
- Monitor system load with `python3 .opencode/status.py`
- Use task timeouts to prevent hanging processes

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Run tests and ensure system works
5. Submit a pull request

### Development Setup

```bash
# Install development dependencies
pip install -r requirements-dev.txt

# Run tests
python -m pytest

# Check code quality
python -m flake8 .claude/
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙋 Support

- **Documentation**: See [AGENTS.md](AGENTS.md) for detailed agent architecture
- **Issues**: Report bugs and request features on GitHub
- **Discussions**: Join community discussions for questions and help

## 🔄 Version History

- **v1.0.0**: Initial release with basic agent orchestration
  - Task management and execution
  - Health monitoring
  - Configuration system
  - CLI interface

---

**Built with ❤️ using OpenCode**</content>
<parameter name="filePath">README.md
