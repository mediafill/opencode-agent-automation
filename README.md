# OpenCode Agent Automation System

🤖 **Automated AI agent delegation system for Claude and OpenCode integration**

Transform your development workflow with intelligent AI agents that work autonomously on your codebase.

## Features

- 🚀 **Automatic Task Detection** - Analyzes your project and generates appropriate tasks
- 🔄 **Parallel Execution** - Run multiple OpenCode agents concurrently
- 📊 **Progress Monitoring** - Real-time status and logging
- 🎯 **Smart Delegation** - Intelligently assigns tasks based on project context
- 🔧 **Easy Integration** - Works with any project type
- 📦 **No Dependencies** - Uses OpenCode's built-in capabilities

## Quick Install

### One-line install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/mediafill/opencode-agent-automation/main/install.sh | bash
```

### NPM install

```bash
npm install -g opencode-agent-automation
```

### Manual install

```bash
git clone https://github.com/mediafill/opencode-agent-automation
cd opencode-agent-automation
bash install.sh
```

## Prerequisites

- **OpenCode** - Install from [opencode.ai](https://opencode.ai)
- **Python 3.7+** - For task delegation script
- **Bash** - For shell scripts

Optional:
- **Claude CLI** - For enhanced integration
- **Node.js** - For NPM installation

## Usage

### Basic Commands

After installation, use the `agents` command in your project:

```bash
# Start all agents with default tasks
agents start

# Check agent status
agents status

# Stop all agents
agents stop

# View logs
agents logs

# Delegate specific objective
agents delegate "make the application production ready"
```

### Project Setup

1. Navigate to your project directory
2. Run the installer:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/mediafill/opencode-agent-automation/main/install.sh | bash
   ```
3. The installer will create a `.claude` directory with all necessary files

### Configuration

Edit `.claude/config.env` to customize:

```bash
# Maximum concurrent agents
MAX_CONCURRENT_AGENTS=4

# Agent timeout (seconds)
AGENT_TIMEOUT=900

# Auto restart failed agents
AUTO_RESTART=true

# OpenCode model selection
OPENCODE_MODEL="default"
```

### Task Definition

Create custom tasks in `.claude/tasks.json`:

```json
{
  "tasks": [
    {
      "id": "security_audit",
      "type": "security",
      "priority": "high",
      "description": "Audit code for security vulnerabilities",
      "status": "pending"
    },
    {
      "id": "add_tests",
      "type": "testing",
      "priority": "medium",
      "description": "Add unit tests for core functions",
      "status": "pending"
    }
  ]
}
```

## Examples

### Production Readiness

Make your application production-ready:

```bash
agents delegate "make the application production ready with security, testing, and monitoring"
```

This will automatically:
- Audit security vulnerabilities
- Add rate limiting and authentication
- Create comprehensive tests
- Add monitoring and logging
- Optimize performance
- Update documentation

### Add Testing

```bash
agents delegate "add comprehensive testing with 80% coverage"
```

### Security Audit

```bash
agents delegate "perform security audit and fix vulnerabilities"
```

### Documentation

```bash
agents delegate "create API documentation and update README"
```

## How It Works

1. **Project Analysis** - Detects project type, languages, and frameworks
2. **Task Generation** - Creates appropriate tasks based on objective
3. **Agent Spawning** - Launches OpenCode agents with specific prompts
4. **Parallel Execution** - Runs multiple agents concurrently
5. **Progress Monitoring** - Tracks and logs all agent activity
6. **Result Aggregation** - Collects and reports results

## Advanced Usage

### Custom Task Delegation

```python
from opencode_agent_automation import TaskDelegator

delegator = TaskDelegator(project_dir="/path/to/project")
tasks = delegator.generate_tasks("optimize database queries")
delegator.delegate("optimize database queries", max_concurrent=8)
```

### Monitoring API

```bash
# Get JSON status
curl http://localhost:8080/agents/status

# Stream logs
curl http://localhost:8080/agents/logs
```

## File Structure

```
your-project/
├── .claude/
│   ├── agentsync.md      # Agent coordination documentation
│   ├── tasks.json        # Task definitions
│   ├── config.env        # Configuration
│   ├── launch.sh         # Main launcher script
│   ├── run_agents.sh     # Agent runner
│   ├── delegate.py       # Task delegation system
│   └── logs/            # Agent logs
│       ├── agent_1.log
│       ├── agent_2.log
│       └── ...
```

## Troubleshooting

### OpenCode not found

Install OpenCode from [opencode.ai](https://opencode.ai):

```bash
npm install -g opencode
```

### Permission denied

Make scripts executable:

```bash
chmod +x .claude/*.sh
```

### Agents not starting

Check logs:

```bash
tail -f .claude/logs/*.log
```

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

- **Issues**: [GitHub Issues](https://github.com/mediafill/opencode-agent-automation/issues)
- **Discussions**: [GitHub Discussions](https://github.com/mediafill/opencode-agent-automation/discussions)
- **Documentation**: [Wiki](https://github.com/mediafill/opencode-agent-automation/wiki)

## Acknowledgments

- OpenCode team for the amazing AI coding agent
- Claude/Anthropic for the AI capabilities
- All contributors and users

---

**Made with ❤️ by the open source community**