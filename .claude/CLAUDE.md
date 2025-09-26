# CLAUDE.md - Claude Integration Guide

## Overview
This document provides Claude with comprehensive guidance on using the OpenCode Agent Automation system. When this file is present in a project's `.claude` directory, Claude can effectively coordinate with OpenCode agents and manage automated development tasks.

## System Architecture

### Core Components
- **Task Delegation System** (`delegate.py`) - Analyzes projects and generates appropriate tasks for OpenCode agents
- **Agent Runner** (`run_agents.sh`) - Manages parallel execution of multiple OpenCode agents
- **Monitor System** (`monitor.sh`) - Provides real-time status monitoring and reporting
- **Main Launcher** (`launch.sh`) - Central command interface for all operations
- **Task Registry** (`tasks.json`) - Centralized task tracking and status management
- **Agent Coordination** (`agentsync.md`) - Multi-agent coordination protocols

## Claude's Role and Capabilities

### Primary Responsibilities
1. **Strategic Planning** - Analyze user requirements and break down complex objectives
2. **Task Coordination** - Work with the delegation system to create appropriate task lists
3. **Progress Monitoring** - Use monitoring tools to track agent progress and results
4. **Quality Assurance** - Review agent outputs and ensure objectives are met
5. **Problem Resolution** - Handle agent failures, conflicts, and integration issues

### When to Use OpenCode Agents
Use the automation system for:
- **Production Readiness**: Security audits, performance optimization, monitoring setup
- **Code Quality**: Adding tests, documentation, linting, formatting
- **Feature Development**: Implementing well-defined features across multiple files
- **Refactoring**: Large-scale code improvements and modernization
- **Analysis Tasks**: Code audits, dependency updates, vulnerability scanning

### When NOT to Use Agents
Handle directly as Claude:
- **Complex Architecture Decisions** - Require human-level reasoning
- **User Interface Design** - Need creative and user experience considerations
- **Business Logic Definition** - Require domain knowledge and stakeholder input
- **Debugging Complex Issues** - Need interactive problem-solving
- **Code Reviews** - Require contextual understanding and judgment

## Command Reference

### Basic Operations

#### Start Agent System
```bash
.claude/launch.sh start
```
- Reads tasks from `tasks.json`
- Spawns OpenCode agents for each pending task
- Runs tasks in parallel (respects concurrency limits)

#### Check Status
```bash
.claude/launch.sh status
```
- Shows running agents and their status
- Displays task completion progress
- Lists recent log entries

#### Monitor in Real-time
```bash
.claude/launch.sh monitor watch
```
- Continuous monitoring with auto-refresh
- Live agent status updates
- Resource usage tracking

#### Delegate New Objective
```bash
.claude/launch.sh delegate "make application production ready"
```
- Analyzes project structure automatically
- Generates appropriate task list based on objective
- Starts agents immediately

#### View Logs
```bash
.claude/launch.sh logs
```
- Tail all agent logs in real-time
- Useful for debugging and progress tracking

#### Stop All Agents
```bash
.claude/launch.sh stop
```
- Gracefully stops all running agents
- Use when needing to pause or reset work

### Advanced Operations

#### Generate HTML Dashboard
```bash
.claude/monitor.sh dashboard
```
- Creates web-based monitoring interface
- Auto-refreshes every 5 seconds
- Visual progress tracking and resource monitoring

#### Get Summary Report
```bash
.claude/monitor.sh summary
```
- Comprehensive completion report
- Error summaries and failure analysis
- Performance metrics

#### Clean Old Logs
```bash
.claude/monitor.sh clean
```
- Removes logs older than 7 days
- Helps manage disk space

## Task Management

### Task JSON Structure
```json
{
  "created_at": "2024-01-01T00:00:00Z",
  "total_tasks": 5,
  "tasks": [
    {
      "id": "security_1234567890",
      "type": "security",
      "priority": "high",
      "description": "Audit code for security vulnerabilities: SQL injection, XSS, CSRF, authentication issues",
      "files_pattern": "**/*.{py,js,php,rb}",
      "status": "pending"
    }
  ]
}
```

### Task Types and Priorities
- **Security** (High) - Vulnerability scans, authentication, authorization
- **Performance** (High/Medium) - Optimization, caching, database tuning
- **Testing** (High/Medium) - Unit tests, integration tests, coverage
- **Documentation** (Low/Medium) - API docs, README updates, comments
- **Refactoring** (Medium) - Code cleanup, modernization, standards compliance
- **Analysis** (Medium) - Code quality, dependency audits, metrics

### Task Status Flow
1. **pending** - Task created, waiting for agent assignment
2. **in_progress** - Agent actively working on task
3. **completed** - Task finished successfully
4. **blocked** - Task cannot proceed (dependency or error)
5. **failed** - Task completed with errors

## Best Practices for Claude

### 1. Pre-Delegation Analysis
Before using agents, Claude should:
```bash
# Analyze project structure
python3 .claude/delegate.py --analyze-only "your objective here"

# Check current status
.claude/launch.sh status

# Review existing tasks
cat .claude/tasks.json
```

### 2. Objective Formulation
Write clear, specific objectives:
- ✅ Good: "Add comprehensive unit tests with 80% coverage for the authentication module"
- ✅ Good: "Implement security audit focusing on input validation and SQL injection prevention" 
- ❌ Avoid: "Make it better"
- ❌ Avoid: "Fix everything"

### 3. Progress Monitoring
Regularly check progress:
```bash
# Quick status check
.claude/launch.sh status

# Detailed monitoring
.claude/monitor.sh watch

# Check for errors
grep -r "Error\|Failed" .claude/logs/
```

### 4. Result Integration
After agents complete:
1. **Review Results** - Check logs and changes made
2. **Test Integration** - Ensure changes work together
3. **Resolve Conflicts** - Handle any merge conflicts or issues
4. **Update Documentation** - Reflect changes in project docs

### 5. Error Handling
When agents fail:
```bash
# Check what failed
.claude/monitor.sh summary

# Review error logs
grep -A 5 -B 5 "Error" .claude/logs/*.log

# Restart failed tasks
.claude/launch.sh delegate "retry failed tasks"
```

## Integration Workflows

### Workflow 1: Production Readiness
```bash
# Step 1: Analyze current state
.claude/launch.sh status

# Step 2: Delegate comprehensive production prep
.claude/launch.sh delegate "make application production ready with security, monitoring, and performance optimization"

# Step 3: Monitor progress
.claude/monitor.sh watch

# Step 4: Review and integrate results
.claude/monitor.sh summary
```

### Workflow 2: Code Quality Improvement
```bash
# Delegate quality improvements
.claude/launch.sh delegate "improve code quality with testing, documentation, and linting"

# Monitor specific to quality metrics
.claude/monitor.sh status

# Review quality improvements
grep -r "coverage\|test\|lint" .claude/logs/
```

### Workflow 3: Feature Development
```bash
# For well-defined features
.claude/launch.sh delegate "implement user authentication with JWT tokens and password hashing"

# Track feature completion
.claude/launch.sh status

# Ensure feature integration
.claude/monitor.sh summary
```

## Configuration Management

### Environment Variables
Edit `.claude/config.env`:
```bash
# Agent settings
MAX_CONCURRENT_AGENTS=4    # Parallel agent limit
AGENT_TIMEOUT=900          # 15 minutes per task
AUTO_RESTART=true          # Restart failed agents

# OpenCode settings  
OPENCODE_MODEL="default"   # Model selection
OPENCODE_QUIET=true        # Reduce output verbosity

# Task priorities
HIGH_PRIORITY_FIRST=true   # Process high priority tasks first
```

### Log Management
- Logs stored in `.claude/logs/`
- One log file per agent/task
- Auto-cleanup after 7 days
- Use `tail -f .claude/logs/*.log` for real-time monitoring

## Troubleshooting Guide

### Common Issues

#### 1. Agents Not Starting
```bash
# Check dependencies
opencode --version
python3 --version

# Check configuration
cat .claude/config.env

# Try manual start
.claude/run_agents.sh start
```

#### 2. Tasks Stuck in Pending
```bash
# Check task format
python3 -m json.tool .claude/tasks.json

# Restart delegation
.claude/launch.sh delegate "retry pending tasks"
```

#### 3. High Resource Usage
```bash
# Monitor resources
.claude/monitor.sh watch

# Reduce concurrency
echo "MAX_CONCURRENT_AGENTS=2" >> .claude/config.env
```

#### 4. Conflicting Changes
```bash
# Check git status
git status

# Review agent changes
git diff

# Resolve conflicts manually if needed
```

## Security Considerations

### Safe Practices
- ✅ Review all agent changes before committing
- ✅ Use version control to track automated changes
- ✅ Monitor resource usage to prevent abuse
- ✅ Regularly update OpenCode and dependencies

### Avoid
- ❌ Running agents on sensitive/production systems without review
- ❌ Delegating tasks that require human judgment
- ❌ Ignoring error logs and failed tasks
- ❌ Running too many concurrent agents on limited resources

## Performance Tips

### Optimization
- **Concurrent Agents**: Adjust `MAX_CONCURRENT_AGENTS` based on system resources
- **Task Granularity**: Break large objectives into smaller, focused tasks
- **File Patterns**: Use specific file patterns to limit agent scope
- **Timeouts**: Set reasonable timeouts for complex tasks

### Resource Management
- Monitor CPU and memory usage during agent execution
- Clean old logs regularly to manage disk space
- Use SSD storage for better I/O performance with multiple agents
- Consider running on systems with adequate RAM (8GB+ recommended)

## Examples and Use Cases

### Example 1: New Project Setup
```bash
# Initial setup for a new Python project
.claude/launch.sh delegate "set up Python project with testing, linting, CI/CD, and documentation"
```

### Example 2: Security Hardening
```bash
# Comprehensive security review
.claude/launch.sh delegate "perform security audit and implement fixes for authentication, input validation, and data protection"
```

### Example 3: Performance Optimization
```bash
# Performance improvement
.claude/launch.sh delegate "analyze and optimize application performance focusing on database queries and API response times"
```

### Example 4: Legacy Code Modernization
```bash
# Modernize old codebase
.claude/launch.sh delegate "modernize legacy code with current best practices, add tests, and improve maintainability"
```

## Support and Debugging

### Log Analysis
Use these commands to analyze agent behavior:
```bash
# Error summary
grep -r "ERROR\|FAILED" .claude/logs/ | head -10

# Task completion status
grep -r "completed successfully" .claude/logs/ | wc -l

# Most recent activity
tail -20 .claude/logs/*.log

# Agent performance
grep -r "Task.*completed" .claude/logs/ | awk '{print $1}' | sort | uniq -c
```

### Performance Monitoring
```bash
# System resource usage
.claude/monitor.sh watch

# Agent process monitoring  
ps aux | grep opencode

# Disk usage
du -sh .claude/logs/
```

This guide enables Claude to effectively coordinate with OpenCode agents while maintaining oversight and quality control throughout the automated development process.