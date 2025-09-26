# AgentSync - Multi-Agent Coordination System

## Purpose
AgentSync coordinates work between multiple AI agents working on your project. It manages task delegation, progress tracking, and ensures consistency across different development efforts.

## Core Responsibilities

### 1. Task Coordination
- Maintain central task registry for all active work
- Delegate tasks to appropriate agents (Claude Code, OpenCode, etc.)
- Track task dependencies and completion status
- Check in to ensure agents are running every 60 seconds
- Prevent duplicate work and conflicting changes

### 2. Context Management
- Maintain project-wide context and state
- Share relevant information between agents
- Track recent changes and their impacts
- Document decisions and implementation patterns

### 3. Communication Protocol
- Standardize communication between agents
- Maintain work logs and progress reports
- Facilitate handoffs between agents
- Report status updates to the primary agent

## Task Delegation Protocol

### For OpenCode Agent
```bash
# Run OpenCode in non-interactive mode
opencode run "<task_description>"
```

### Task Format
```json
{
  "id": "unique_task_id",
  "type": "feature|bugfix|refactor|review|security|testing|documentation",
  "priority": "high|medium|low",
  "assigned_to": "opencode",
  "description": "detailed task description",
  "dependencies": ["task_id1", "task_id2"],
  "status": "pending|in_progress|completed|blocked",
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

## Common Task Types

### Security & Production Readiness
- Audit code for vulnerabilities
- Implement rate limiting
- Add authentication/authorization
- Setup CSRF protection
- Input validation and sanitization

### Performance Optimization
- Database query optimization
- Implement caching strategies
- Code profiling and optimization
- Memory management improvements
- API response time reduction

### Testing & Quality
- Unit test creation
- Integration testing
- End-to-end testing
- Test coverage improvement
- Performance testing

### Documentation
- API documentation
- README updates
- Code comments
- Architecture documentation
- User guides

## Best Practices

1. **Always check for conflicting work before starting**
2. **Update task status immediately upon completion**
3. **Document all major decisions**
4. **Maintain backward compatibility**
5. **Test changes in isolation before integration**
6. **Use semantic versioning for releases**
7. **Keep logs detailed but concise**

## Integration Points

### With Claude Code
- Primary development agent
- Handles complex refactoring
- Manages production deployment
- Coordinates other agents

### With OpenCode
- Parallel task execution
- Code implementation
- Testing and validation
- Documentation generation

## Monitoring

Check agent status:
```bash
.claude/launch.sh status
```

View logs:
```bash
.claude/launch.sh logs
```

## Emergency Procedures

If agents are stuck or misbehaving:

1. Stop all agents:
   ```bash
   .claude/launch.sh stop
   ```

2. Check logs for errors:
   ```bash
   tail -100 .claude/logs/*.log | grep ERROR
   ```

3. Clear task queue:
   ```bash
   echo '{"tasks": []}' > .claude/tasks.json
   ```

4. Restart agents:
   ```bash
   .claude/launch.sh start
   ```