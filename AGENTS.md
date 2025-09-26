# AGENTS.md - OpenCode Multi-Agent System Integration Guide

## Overview

This document ensures that OpenCode properly utilizes the `.claude` delegation master-slave multi-agent system for all automated development tasks. When this file is present, OpenCode agents must coordinate through the established master-slave architecture rather than operating independently.

## System Architecture

### Core Components

#### 🏗️ Master-Slave Architecture

- **Master Agent Orchestrator** (`master_agent_orchestrator.py`) - Central coordination hub
- **Slave Agent Wrapper** (`slave_agent_wrapper.py`) - Individual agent execution containers
- **Agent Lifecycle Manager** (`agent_lifecycle_manager.py`) - Agent spawning and termination
- **Communication Manager** (`communication_manager.py`) - Inter-agent messaging
- **Distributed Coordinator** (`distributed_coordinator.py`) - Cross-system coordination

#### 🎯 Task Management System

- **Enhanced Task Queue** (`enhanced_task_queue.py`) - Priority-based task distribution
- **Task Status Manager** - Real-time task tracking and reporting
- **Resource Allocator** - Dynamic resource assignment to agents

#### 📊 Monitoring & Health

- **Health Monitor** (`health_monitor.py`) - Agent health checking
- **Enhanced Health Monitoring** (`enhanced_health_monitoring.py`) - Advanced diagnostics
- **Background Monitor** (`background_monitor.sh`) - System-level monitoring

### Agent Hierarchy

```
┌─────────────────┐
│   MASTER AGENT  │ ← Central coordinator, task delegation
│  (Orchestrator) │
└─────────┬───────┘
          │
    ┌─────┴─────┐
    │           │
┌───▼───┐   ┌───▼───┐
│COORDINATOR│ │SUPERVISOR│ ← Task supervision, progress tracking
│  AGENT   │ │  AGENT   │
└───┬─────┘   └─────┘
    │
    ┌─────┴─────┐
    │           │
┌───▼───┐   ┌───▼───┐
│ SLAVE │   │ SLAVE │ ← Actual task execution
│AGENT 1│   │AGENT 2│
└───────┘   └───────┘
```

## Integration Requirements

### 🔧 OpenCode Agent Integration

All OpenCode agents **MUST** integrate with the master-slave system through:

#### 1. Agent Registration

```python
# Every OpenCode agent must register with the master orchestrator
from .claude.master_agent_orchestrator import MasterAgentOrchestrator

orchestrator = MasterAgentOrchestrator()
agent_id = orchestrator.register_agent({
    "type": "opencode_agent",
    "capabilities": ["code_generation", "analysis", "testing"],
    "resource_requirements": {"cpu": 1, "memory": "2GB"}
})
```

#### 2. Task Execution Protocol

```python
# Agents must request task assignments from master
task = orchestrator.request_task(agent_id)

# Execute task with progress reporting
orchestrator.update_task_progress(task.id, 50, "Processing...")

# Report completion
orchestrator.complete_task(task.id, result)
```

#### 3. Communication Channels

- **Message Queue** (`message_queue.json`) - Async communication
- **Task Status** (`task_status.json`) - Real-time status updates
- **Vector Database** - Knowledge sharing between agents

### 📋 Required Integration Points

#### For All OpenCode Agents:

1. **Import master orchestrator** on startup
2. **Register with master** before accepting tasks
3. **Report status updates** every 30 seconds
4. **Handle master commands** (pause, resume, terminate)
5. **Share results** through vector database
6. **Clean shutdown** via orchestrator

#### For OpenCode CLI:

```bash
# Must check for .claude directory and master orchestrator
if [ -d ".claude" ] && [ -f ".claude/master_agent_orchestrator.py" ]; then
    # Use master-slave system
    python3 .claude/master_agent_orchestrator.py delegate "$OBJECTIVE"
else
    # Fallback to direct execution (not recommended)
    opencode run "$OBJECTIVE"
fi
```

## Configuration Management

### Master Orchestrator Config (`master_orchestrator_config.json`)

```json
{
  "health_check_interval": 30,
  "agent_timeout": 120,
  "max_slave_agents": 10,
  "master_id": "master_b4804562",
  "auto_scaling": true,
  "load_balancing": "round_robin"
}
```

### Agent Pool Config (`orchestrator_config.json`)

```json
{
  "auto_delegate": true,
  "max_concurrent_agents": 4,
  "monitor_interval": 5,
  "auto_retry_failed": true,
  "spawn_method": "launch_script"
}
```

## Agent Lifecycle

### 1. Agent Registration

```python
# Agent startup sequence
agent = SlaveAgentWrapper({
    "id": f"slave_{uuid.uuid4().hex[:8]}",
    "role": AgentRole.SLAVE,
    "capabilities": ["python", "javascript", "testing"],
    "master_endpoint": "localhost:8080"
})

# Register with master
master.register_slave_agent(agent)
```

### 2. Task Assignment

```python
# Master assigns tasks based on:
# - Agent capabilities
# - Current workload
# - Task priority
# - Resource availability

task = master.assign_task_to_agent(agent_id, task_data)
```

### 3. Execution Monitoring

```python
# Continuous health monitoring
while task.status == "running":
    health = agent.report_health()
    master.update_agent_health(agent_id, health)
    time.sleep(30)
```

### 4. Result Aggregation

```python
# Agents report results to master
result = agent.execute_task(task)
master.submit_task_result(task.id, result)

# Master aggregates and validates results
final_result = master.aggregate_results([result1, result2, result3])
```

## Communication Protocols

### Inter-Agent Communication

- **Direct Messaging**: Point-to-point agent communication
- **Broadcast**: Master-to-all-agents notifications
- **Pub/Sub**: Event-driven communication
- **Vector DB**: Knowledge sharing and context passing

### Message Types

- `TASK_ASSIGNMENT` - New task assignment
- `STATUS_UPDATE` - Progress reporting
- `HEALTH_CHECK` - Agent health status
- `RESOURCE_REQUEST` - Resource allocation requests
- `COORDINATE_REQUEST` - Inter-agent coordination

## Resource Management

### Dynamic Resource Allocation

```python
# Master monitors system resources
resources = master.monitor_system_resources()

# Allocates based on:
# - CPU availability
# - Memory usage
# - Disk I/O capacity
# - Network bandwidth

allocation = master.allocate_resources_for_task(task, resources)
```

### Load Balancing

- **Round Robin**: Equal distribution
- **Least Loaded**: Send to least busy agent
- **Capability Based**: Match tasks to specialized agents
- **Priority Based**: High priority tasks get preferred agents

## Error Handling & Recovery

### Agent Failure Recovery

```python
# Master detects failed agent
failed_agent = master.detect_failed_agent(agent_id)

# Automatic recovery:
# 1. Mark agent as unhealthy
# 2. Reassign running tasks
# 3. Spawn replacement agent
# 4. Resume interrupted work

recovery_plan = master.create_recovery_plan(failed_agent)
master.execute_recovery_plan(recovery_plan)
```

### Task Failure Handling

- **Retry Logic**: Automatic retry with exponential backoff
- **Task Splitting**: Break failed tasks into smaller units
- **Alternative Agents**: Route to agents with different capabilities
- **Human Escalation**: Notify user for complex failures

## Performance Optimization

### Caching Strategy

- **Intelligent Cache** (`intelligent_cache.py`) - Multi-level caching
- **Vector Database** - Semantic caching of results
- **Task Result Cache** - Avoid duplicate work

### Parallel Execution

- **Concurrent Agents**: Up to configured maximum
- **Task Dependencies**: Respect prerequisite relationships
- **Resource Pooling**: Shared resource management

## Security & Access Control

### Agent Permissions

```python
permissions = {
    AgentRole.MASTER: [
        AgentPermission.TASK_ASSIGNMENT,
        AgentPermission.AGENT_MANAGEMENT,
        AgentPermission.SYSTEM_MONITORING,
        AgentPermission.RESOURCE_ALLOCATION
    ],
    AgentRole.SLAVE: [
        AgentPermission.TASK_EXECUTION
    ]
}
```

### Secure Communication

- **Encrypted Channels**: All inter-agent communication
- **Authentication**: Agent-to-master verification
- **Authorization**: Role-based access control
- **Audit Logging**: All agent actions logged

## Monitoring & Observability

### Real-time Dashboards

- **Agent Status Dashboard** - Live agent monitoring
- **Task Progress Dashboard** - Visual progress tracking
- **Resource Usage Dashboard** - System resource monitoring
- **Performance Metrics** - Throughput and efficiency metrics

### Logging & Tracing

- **Structured Logging** - Consistent log format across agents
- **Distributed Tracing** - End-to-end request tracing
- **Performance Profiling** - Agent performance analysis
- **Error Aggregation** - Centralized error reporting

## Deployment & Scaling

### Auto-scaling

```python
# Master monitors workload
workload = master.analyze_current_workload()

if workload > threshold:
    # Spawn additional agents
    new_agents = master.scale_up(workload)
elif workload < threshold:
    # Reduce agent count
    master.scale_down(workload)
```

### Geographic Distribution

- **Multi-region Deployment** - Agents across different locations
- **Load Balancing** - Geographic traffic distribution
- **Data Synchronization** - Cross-region data consistency

## Integration Testing

### Agent Communication Tests

```python
def test_agent_registration():
    master = MasterAgentOrchestrator()
    agent = SlaveAgentWrapper({"id": "test_agent"})

    # Test registration
    result = master.register_agent(agent)
    assert result.success == True

def test_task_assignment():
    # Test task assignment workflow
    task = master.assign_task_to_agent(agent_id, task_data)
    assert task.status == "assigned"
```

### System Integration Tests

- **End-to-End Workflows** - Complete task execution cycles
- **Failure Scenarios** - Agent failure and recovery testing
- **Performance Testing** - Load testing with multiple agents
- **Concurrency Testing** - Race condition prevention

## Troubleshooting

### Common Issues

#### Agent Registration Failures

```bash
# Check master orchestrator status
python3 .claude/master_agent_orchestrator.py status

# Verify agent configuration
cat .claude/orchestrator_config.json

# Check logs
tail -f .claude/logs/master_orchestrator.log
```

#### Task Assignment Problems

```bash
# Check task queue status
python3 .claude/enhanced_task_queue.py status

# Verify agent capabilities
python3 .claude/agent_manager.py list-agents

# Check resource availability
python3 .claude/health_monitor.py resources
```

#### Communication Issues

```bash
# Test inter-agent communication
python3 .claude/communication_manager.py test

# Check message queue
cat .claude/message_queue.json

# Verify network connectivity
ping localhost
```

## Best Practices

### Agent Development

1. **Always register** with master orchestrator on startup
2. **Report health** regularly to master
3. **Handle signals** for graceful shutdown
4. **Use structured logging** for consistent monitoring
5. **Implement timeouts** for all operations
6. **Validate inputs** and handle errors gracefully

### Master Orchestrator Usage

1. **Monitor agent health** continuously
2. **Balance load** across available agents
3. **Handle failures** automatically when possible
4. **Scale resources** based on demand
5. **Maintain audit logs** of all operations
6. **Provide metrics** for system monitoring

### System Administration

1. **Regular backups** of configuration and state
2. **Monitor resource usage** to prevent bottlenecks
3. **Update agents** regularly for security and features
4. **Test recovery procedures** regularly
5. **Document custom configurations** and procedures

## Future Enhancements

### Planned Features

- **AI-Powered Task Routing** - ML-based agent assignment
- **Predictive Scaling** - Anticipate resource needs
- **Advanced Fault Tolerance** - Multi-master configurations
- **Cross-Platform Support** - Windows/Linux/Mac compatibility
- **Cloud Integration** - AWS/GCP/Azure deployment support

### Research Areas

- **Swarm Intelligence** - Emergent agent behaviors
- **Federated Learning** - Distributed model training
- **Quantum Computing Integration** - Next-generation processing
- **Blockchain-based Coordination** - Decentralized orchestration

---

## Compliance Checklist

**OpenCode agents MUST verify these before operation:**

- [ ] Master orchestrator is running and accessible
- [ ] Agent successfully registered with master
- [ ] Communication channels established
- [ ] Health monitoring active
- [ ] Resource allocation confirmed
- [ ] Logging and monitoring configured
- [ ] Error handling and recovery tested
- [ ] Security protocols implemented
- [ ] Performance benchmarks met

**Failure to comply will result in agent isolation and manual intervention required.**</content>
<parameter name="filePath">AGENTS.md
