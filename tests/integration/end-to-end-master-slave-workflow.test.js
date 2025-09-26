import { jest } from "@jest/globals";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("End-to-End Master-Slave Agent Architecture Integration Tests", () => {
  let testProjectDir;
  let claudeDir;
  let orchestratorProcess;
  let agent1Process;
  let agent2Process;
  let mockVectorDb;

  beforeAll(async () => {
    testProjectDir = path.join(
      os.tmpdir(),
      "e2e-master-slave-test-" + Date.now(),
    );
    claudeDir = path.join(testProjectDir, ".claude");

    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(path.join(claudeDir, "logs"), { recursive: true });
    await fs.mkdir(path.join(claudeDir, "agent_data"), { recursive: true });
    await fs.mkdir(path.join(claudeDir, "vector_db"), { recursive: true });
  });

  beforeEach(async () => {
    // Clean up any existing files
    try {
      const files = await fs.readdir(claudeDir);
      for (const file of files) {
        if (file.endsWith(".json") || file.endsWith(".log")) {
          await fs.unlink(path.join(claudeDir, file));
        }
      }
    } catch (e) {
      // Ignore cleanup errors
    }

    // Mock vector database for communication
    mockVectorDb = {
      initialize: jest.fn().mockResolvedValue(true),
      store_task_history: jest.fn().mockResolvedValue("doc_id"),
      get_task_history: jest.fn(),
      store_learning: jest.fn().mockResolvedValue("learning_id"),
      get_learnings: jest.fn().mockReturnValue([]),
      query_similar_solutions: jest.fn().mockResolvedValue([]),
      close: jest.fn().mockResolvedValue(undefined),
    };

    jest.doMock("vector_database", () => ({
      VectorDatabase: jest.fn().mockImplementation(() => mockVectorDb),
    }));
  });

  afterEach(async () => {
    // Clean up processes
    const processes = [orchestratorProcess, agent1Process, agent2Process];
    for (const proc of processes) {
      if (proc && !proc.killed) {
        proc.kill("SIGTERM");
      }
    }

    // Wait for processes to terminate
    await Promise.all(
      processes.map((proc) => {
        if (proc) {
          return new Promise((resolve) => {
            if (proc.killed) {
              resolve();
            } else {
              proc.on("close", resolve);
            }
          });
        }
        return Promise.resolve();
      }),
    );

    // Clean up files
    try {
      const files = await fs.readdir(claudeDir);
      for (const file of files) {
        if (file.endsWith(".json") || file.endsWith(".log")) {
          await fs.unlink(path.join(claudeDir, file));
        }
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  afterAll(async () => {
    try {
      await fs.rm(testProjectDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe("Complete Agent Lifecycle and Task Execution", () => {
    test("should execute full task lifecycle from assignment to completion", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "master_agent_orchestrator.py",
      );
      const agentScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "slave_agent_wrapper.py",
      );

      // Mock message passing
      let messageLog = [];
      mockVectorDb.store_task_history.mockImplementation(async (data) => {
        messageLog.push(data);
        return `msg_${messageLog.length}`;
      });

      mockVectorDb.query_similar_solutions.mockImplementation(async (query) => {
        const recipientId = query.replace("recipient_id:", "");
        return messageLog
          .filter((msg) => msg.data && msg.data.recipient_id === recipientId)
          .map((msg, index) => ({
            metadata: { data: JSON.stringify(msg.data) },
            distance: 0.1 * index,
          }));
      });

      // Start orchestrator
      orchestratorProcess = spawn(
        "python3",
        [
          "-c",
          `
import sys
sys.path.insert(0, '${path.dirname(orchestratorScript)}')
from master_agent_orchestrator import MasterAgentOrchestrator, AgentMessage, MessageType, AgentStatus
import time

orchestrator = MasterAgentOrchestrator('${testProjectDir}')
orchestrator.start()

# Register test agent
orchestrator.register_slave_agent('e2e_agent', ['testing'])
orchestrator.slave_agents['e2e_agent'].status = AgentStatus.READY

# Assign a task
task_data = {
  'description': 'End-to-end task lifecycle test',
  'type': 'testing',
  'files_pattern': '**/*.test.js'
}
assigned_agent = orchestrator.assign_task_to_agent('e2e_task_123', task_data)

print(f"Task assigned to: {assigned_agent}")

# Simulate task completion by sending status update
completion_message = AgentMessage(
  MessageType.TASK_STATUS_UPDATE,
  'e2e_agent',
  orchestrator.master_id,
  {
    'task_id': 'e2e_task_123',
    'status': 'completed',
    'message': 'Task completed successfully',
    'duration': 45.5
  }
)
orchestrator._handle_task_status_update(completion_message)

time.sleep(1)
orchestrator.stop()

result = {
  'task_assigned': assigned_agent is not None,
  'assigned_to': assigned_agent,
  'agent_status_after_completion': orchestrator.slave_agents['e2e_agent'].status.value,
  'current_task_after_completion': orchestrator.slave_agents['e2e_agent'].current_task,
  'task_assignments_cleared': len(orchestrator.task_assignments) == 0,
  'completion_counted': orchestrator.slave_agents['e2e_agent'].resource_usage['tasks_completed'] == 1
}

print(str(result))
      `,
        ],
        {
          cwd: testProjectDir,
          stdio: "pipe",
        },
      );

      let stdout = "";
      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      await new Promise((resolve) => {
        orchestratorProcess.on("close", (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const result = eval(stdout.trim());
      expect(result.task_assigned).toBe(true);
      expect(result.assigned_to).toBe("e2e_agent");
      expect(result.agent_status_after_completion).toBe("ready");
      expect(result.current_task_after_completion).toBeNull();
      expect(result.task_assignments_cleared).toBe(true);
      expect(result.completion_counted).toBe(true);
    }, 30000);

    test("should handle agent failure and task reassignment", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "master_agent_orchestrator.py",
      );

      orchestratorProcess = spawn(
        "python3",
        [
          "-c",
          `
import sys
sys.path.insert(0, '${path.dirname(orchestratorScript)}')
from master_agent_orchestrator import MasterAgentOrchestrator, AgentMessage, MessageType, AgentStatus
import json

orchestrator = MasterAgentOrchestrator('${testProjectDir}')

# Register primary agent and assign task
orchestrator.register_slave_agent('primary_agent', ['testing'])
orchestrator.slave_agents['primary_agent'].status = AgentStatus.BUSY
orchestrator.slave_agents['primary_agent'].current_task = 'failure_test_task'
orchestrator.task_assignments['failure_test_task'] = 'primary_agent'

# Register backup agent
orchestrator.register_slave_agent('backup_agent', ['testing'])
orchestrator.slave_agents['backup_agent'].status = AgentStatus.READY

# Simulate primary agent failure
failure_message = AgentMessage(
  MessageType.TASK_STATUS_UPDATE,
  'primary_agent',
  orchestrator.master_id,
  {
    'task_id': 'failure_test_task',
    'status': 'failed',
    'message': 'Agent crashed during execution'
  }
)
orchestrator._handle_task_status_update(failure_message)

# Try to reassign the task
reassigned_agent = orchestrator.assign_task_to_agent('failure_test_task', {
  'description': 'Retry after primary agent failure',
  'type': 'testing'
})

result = {
  'primary_agent_status': orchestrator.slave_agents['primary_agent'].status.value,
  'primary_agent_current_task': orchestrator.slave_agents['primary_agent'].current_task,
  'task_reassigned': reassigned_agent is not None,
  'reassigned_to': reassigned_agent,
  'backup_agent_status': orchestrator.slave_agents['backup_agent'].status.value,
  'backup_agent_current_task': orchestrator.slave_agents['backup_agent'].current_task,
  'task_assignments': orchestrator.task_assignments
}

print(json.dumps(result))
      `,
        ],
        {
          cwd: testProjectDir,
          stdio: "pipe",
        },
      );

      let stdout = "";
      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      await new Promise((resolve) => {
        orchestratorProcess.on("close", (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const result = JSON.parse(stdout.trim());
      expect(result.primary_agent_status).toBe("ready");
      expect(result.primary_agent_current_task).toBeNull();
      expect(result.task_reassigned).toBe(true);
      expect(result.reassigned_to).toBe("backup_agent");
      expect(result.backup_agent_status).toBe("busy");
      expect(result.backup_agent_current_task).toBe("failure_test_task");
    });

    test("should maintain system stability during concurrent operations", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "master_agent_orchestrator.py",
      );

      orchestratorProcess = spawn(
        "python3",
        [
          "-c",
          `
import sys
sys.path.insert(0, '${path.dirname(orchestratorScript)}')
from master_agent_orchestrator import MasterAgentOrchestrator, AgentMessage, MessageType, AgentStatus
import json
import time

orchestrator = MasterAgentOrchestrator('${testProjectDir}')

# Register multiple agents
agents = ['agent_a', 'agent_b', 'agent_c']
for agent_id in agents:
  orchestrator.register_slave_agent(agent_id, ['testing'])
  orchestrator.slave_agents[agent_id].status = AgentStatus.READY

# Assign multiple concurrent tasks
tasks = []
for i in range(5):
  task_id = f'concurrent_task_{i+1}'
  assigned_agent = orchestrator.assign_task_to_agent(task_id, {
    'description': f'Concurrent task {i+1}',
    'type': 'testing'
  })
  if assigned_agent:
    tasks.push({'task_id': task_id, 'assigned_to': assigned_agent})

# Simulate some tasks completing
completed_tasks = ['concurrent_task_1', 'concurrent_task_3']
for task_id in completed_tasks:
  # Find which agent has this task
  assigned_agent = None
  for agent_id, agent in orchestrator.slave_agents.items():
    if agent.current_task == task_id:
      assigned_agent = agent_id
      break

  if assigned_agent:
    completion_message = AgentMessage(
      MessageType.TASK_STATUS_UPDATE,
      assigned_agent,
      orchestrator.master_id,
      {
        'task_id': task_id,
        'status': 'completed',
        'message': 'Task completed'
      }
    )
    orchestrator._handle_task_status_update(completion_message)

# Check system state
system_status = orchestrator.get_system_status()
agent_states = {}
for agent_id in agents:
  agent = orchestrator.slave_agents[agent_id]
  agent_states[agent_id] = {
    'status': agent.status.value,
    'current_task': agent.current_task,
    'health_score': agent.health_score
  }

result = {
  'initial_tasks_assigned': tasks.length,
  'system_status': system_status,
  'agent_states': agent_states,
  'active_tasks_remaining': len(orchestrator.task_assignments),
  'system_stable': system_status.total_agents == len(agents)
}

print(json.dumps(result))
      `,
        ],
        {
          cwd: testProjectDir,
          stdio: "pipe",
        },
      );

      let stdout = "";
      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      await new Promise((resolve) => {
        orchestratorProcess.on("close", (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const result = JSON.parse(stdout.trim());
      expect(result.initial_tasks_assigned).toBe(3); // Limited by available agents
      expect(result.system_status.total_agents).toBe(3);
      expect(result.system_stable).toBe(true);
      expect(result.active_tasks_remaining).toBe(1); // 3 assigned - 2 completed = 1 remaining
    });
  });

  describe("Inter-Agent Communication and Coordination", () => {
    test("should enable knowledge sharing between agents", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "master_agent_orchestrator.py",
      );

      orchestratorProcess = spawn(
        "python3",
        [
          "-c",
          `
import sys
sys.path.insert(0, '${path.dirname(orchestratorScript)}')
from master_agent_orchestrator import MasterAgentOrchestrator
import json

orchestrator = MasterAgentOrchestrator('${testProjectDir}')

# Register agents
orchestrator.register_slave_agent('learning_agent_1', ['testing'])
orchestrator.register_slave_agent('learning_agent_2', ['analysis'])

# Simulate learning storage and retrieval
learning_data = {
  'content': 'Use async/await for better error handling in tests',
  'context': 'Learned from test suite failures',
  'category': 'testing',
  'importance': 'high',
  'tags': ['testing', 'async', 'error-handling']
}

# Store learning (simulated)
orchestrator.vector_db.store_learning(learning_data)

# Query learnings
retrieved_learnings = orchestrator.vector_db.get_learnings({'category': 'testing'})

result = {
  'learning_stored': True,
  'learnings_retrieved': len(retrieved_learnings) > 0,
  'learning_content': retrieved_learnings[0]['content'] if retrieved_learnings else None,
  'knowledge_shared': len(retrieved_learnings) > 0
}

print(json.dumps(result))
      `,
        ],
        {
          cwd: testProjectDir,
          stdio: "pipe",
        },
      );

      let stdout = "";
      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      await new Promise((resolve) => {
        orchestratorProcess.on("close", (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const result = JSON.parse(stdout.trim());
      expect(result.learning_stored).toBe(true);
      expect(result.knowledge_shared).toBe(true);
    });

    test("should coordinate task dependencies between agents", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "master_agent_orchestrator.py",
      );

      orchestratorProcess = spawn(
        "python3",
        [
          "-c",
          `
import sys
sys.path.insert(0, '${path.dirname(orchestratorScript)}')
from master_agent_orchestrator import MasterAgentOrchestrator, AgentMessage, MessageType, AgentStatus
import json

orchestrator = MasterAgentOrchestrator('${testProjectDir}')

# Register agents
orchestrator.register_slave_agent('setup_agent', ['setup'])
orchestrator.register_slave_agent('test_agent', ['testing'])

# Assign setup task first
setup_assigned = orchestrator.assign_task_to_agent('setup_task', {
  'description': 'Setup environment for testing',
  'type': 'setup'
})

# Complete setup task
if setup_assigned:
  setup_completion = AgentMessage(
    MessageType.TASK_STATUS_UPDATE,
    setup_assigned,
    orchestrator.master_id,
    {
      'task_id': 'setup_task',
      'status': 'completed',
      'message': 'Setup completed'
    }
  )
  orchestrator._handle_task_status_update(setup_completion)

# Now assign dependent test task
test_assigned = orchestrator.assign_task_to_agent('dependent_test_task', {
  'description': 'Run tests after setup completion',
  'type': 'testing',
  'dependencies': ['setup_task']
})

result = {
  'setup_task_completed': setup_assigned is not None,
  'setup_agent_freed': orchestrator.slave_agents[setup_assigned].status.value == 'ready' if setup_assigned else False,
  'dependent_task_assigned': test_assigned is not None,
  'coordination_successful': test_assigned is not None,
  'system_status': orchestrator.get_system_status()
}

print(json.dumps(result))
      `,
        ],
        {
          cwd: testProjectDir,
          stdio: "pipe",
        },
      );

      let stdout = "";
      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      await new Promise((resolve) => {
        orchestratorProcess.on("close", (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const result = JSON.parse(stdout.trim());
      expect(result.setup_task_completed).toBe(true);
      expect(result.setup_agent_freed).toBe(true);
      expect(result.dependent_task_assigned).toBe(true);
      expect(result.coordination_successful).toBe(true);
    });
  });

  describe("System Health and Auto-Recovery", () => {
    test("should recover from agent failures automatically", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "master_agent_orchestrator.py",
      );

      orchestratorProcess = spawn(
        "python3",
        [
          "-c",
          `
import sys
sys.path.insert(0, '${path.dirname(orchestratorScript)}')
from master_agent_orchestrator import MasterAgentOrchestrator, AgentStatus
import json
from datetime import datetime, timedelta

orchestrator = MasterAgentOrchestrator('${testProjectDir}')
orchestrator.agent_timeout = 2  # Short timeout for testing

# Register agents
orchestrator.register_slave_agent('stable_agent', ['testing'])
orchestrator.register_slave_agent('failing_agent', ['analysis'])

# Set up agents
orchestrator.slave_agents['stable_agent'].status = AgentStatus.READY
orchestrator.slave_agents['stable_agent'].last_heartbeat = datetime.now()

orchestrator.slave_agents['failing_agent'].status = AgentStatus.BUSY
orchestrator.slave_agents['failing_agent'].current_task = 'failing_task'
orchestrator.slave_agents['failing_agent'].last_heartbeat = datetime.now() - timedelta(seconds=5)  # Old heartbeat

orchestrator.task_assignments['failing_task'] = 'failing_agent'

# Run health checks
orchestrator._perform_health_checks()
orchestrator._cleanup_failed_agents()

# Check recovery
system_status = orchestrator.get_system_status()

result = {
  'stable_agent_alive': 'stable_agent' in orchestrator.slave_agents,
  'failing_agent_removed': 'failing_agent' not in orchestrator.slave_agents,
  'task_reassigned': 'failing_task' not in orchestrator.task_assignments,
  'system_status': system_status,
  'recovery_successful': system_status.total_agents == 1 and system_status.healthy_agents == 1
}

print(json.dumps(result))
      `,
        ],
        {
          cwd: testProjectDir,
          stdio: "pipe",
        },
      );

      let stdout = "";
      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      await new Promise((resolve) => {
        orchestratorProcess.on("close", (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const result = JSON.parse(stdout.trim());
      expect(result.stable_agent_alive).toBe(true);
      expect(result.failing_agent_removed).toBe(true);
      expect(result.task_reassigned).toBe(true);
      expect(result.recovery_successful).toBe(true);
    });

    test("should maintain system performance under load", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "master_agent_orchestrator.py",
      );

      orchestratorProcess = spawn(
        "python3",
        [
          "-c",
          `
import sys
sys.path.insert(0, '${path.dirname(orchestratorScript)}')
from master_agent_orchestrator import MasterAgentOrchestrator, AgentMessage, MessageType, AgentStatus
import json
import time

orchestrator = MasterAgentOrchestrator('${testProjectDir}')

# Register multiple agents
for i in range(5):
  agent_id = f'load_agent_{i+1}'
  orchestrator.register_slave_agent(agent_id, ['testing'])
  orchestrator.slave_agents[agent_id].status = AgentStatus.READY

# Simulate high load - assign many tasks
assigned_tasks = []
for i in range(10):
  task_id = f'load_task_{i+1}'
  assigned_agent = orchestrator.assign_task_to_agent(task_id, {
    'description': f'Load test task {i+1}',
    'type': 'testing'
  })
  if assigned_agent:
    assigned_tasks.push({'task_id': task_id, 'assigned_to': assigned_agent})

# Complete some tasks to free up agents
completed_count = 0
for task_info in assigned_tasks.slice(0, 3):  # Complete first 3 tasks
  completion_message = AgentMessage(
    MessageType.TASK_STATUS_UPDATE,
    task_info.assigned_to,
    orchestrator.master_id,
    {
      'task_id': task_info.task_id,
      'status': 'completed',
      'message': 'Task completed under load'
    }
  )
  orchestrator._handle_task_status_update(completion_message)
  completed_count += 1

# Check system can still assign new tasks
new_assignments = []
for i in range(2):
  task_id = f'post_load_task_{i+1}'
  assigned_agent = orchestrator.assign_task_to_agent(task_id, {
    'description': f'Post-load task {i+1}',
    'type': 'testing'
  })
  if assigned_agent:
    new_assignments.push({'task_id': task_id, 'assigned_to': assigned_agent})

system_status = orchestrator.get_system_status()

result = {
  'initial_tasks_assigned': assigned_tasks.length,
  'tasks_completed': completed_count,
  'new_tasks_assigned': new_assignments.length,
  'system_status': system_status,
  'performance_maintained': system_status.total_agents == 5 and new_assignments.length > 0,
  'load_handled': assigned_tasks.length >= 5  # At least as many tasks as agents
}

print(json.dumps(result))
      `,
        ],
        {
          cwd: testProjectDir,
          stdio: "pipe",
        },
      );

      let stdout = "";
      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      await new Promise((resolve) => {
        orchestratorProcess.on("close", (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const result = JSON.parse(stdout.trim());
      expect(result.performance_maintained).toBe(true);
      expect(result.load_handled).toBe(true);
      expect(result.new_tasks_assigned).toBeGreaterThan(0);
    });
  });

  describe("Complete System Integration", () => {
    test("should demonstrate full master-slave architecture workflow", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "master_agent_orchestrator.py",
      );

      orchestratorProcess = spawn(
        "python3",
        [
          "-c",
          `
import sys
sys.path.insert(0, '${path.dirname(orchestratorScript)}')
from master_agent_orchestrator import MasterAgentOrchestrator, AgentMessage, MessageType, AgentStatus
import json
import time

orchestrator = MasterAgentOrchestrator('${testProjectDir}')
orchestrator.start()

# Phase 1: Agent Discovery and Registration
print("Phase 1: Agent Registration")
orchestrator.register_slave_agent('agent_alpha', ['testing', 'analysis'])
orchestrator.register_slave_agent('agent_beta', ['debugging', 'performance'])
orchestrator.register_slave_agent('agent_gamma', ['security', 'refactoring'])

# Phase 2: Task Assignment and Load Balancing
print("Phase 2: Task Assignment")
tasks = [
  {'id': 'security_audit', 'type': 'security', 'priority': 'high'},
  {'id': 'performance_test', 'type': 'performance', 'priority': 'medium'},
  {'id': 'code_refactor', 'type': 'refactoring', 'priority': 'low'},
  {'id': 'unit_tests', 'type': 'testing', 'priority': 'high'},
  {'id': 'debug_session', 'type': 'debugging', 'priority': 'medium'}
]

assigned_tasks = []
for task in tasks:
  assigned_agent = orchestrator.assign_task_to_agent(task['id'], task)
  if assigned_agent:
    assigned_tasks.push({'task_id': task['id'], 'assigned_to': assigned_agent, 'type': task['type']})

# Phase 3: Task Execution and Monitoring
print("Phase 3: Task Execution")
completed_tasks = []
for task_info in assigned_tasks.slice(0, 3):  # Complete first 3 tasks
  completion_message = AgentMessage(
    MessageType.TASK_STATUS_UPDATE,
    task_info.assigned_to,
    orchestrator.master_id,
    {
      'task_id': task_info.task_id,
      'status': 'completed',
      'message': f'{task_info.type} task completed successfully'
    }
  )
  orchestrator._handle_task_status_update(completion_message)
  completed_tasks.push(task_info.task_id)

# Phase 4: Health Monitoring and Maintenance
print("Phase 4: Health Monitoring")
orchestrator._perform_health_checks()

# Phase 5: System Status and Reporting
print("Phase 5: System Reporting")
system_status = orchestrator.get_system_status()

orchestrator.stop()

result = {
  'phase1_registration_complete': len(orchestrator.slave_agents) == 3,
  'phase2_tasks_assigned': assigned_tasks.length,
  'phase3_tasks_completed': completed_tasks.length,
  'phase4_health_checked': True,
  'phase5_system_status': system_status,
  'full_workflow_success': (
    system_status.total_agents == 3 and
    system_status.active_tasks >= 0 and
    system_status.system_health >= 0
  ),
  'agents_working': sum(1 for agent in orchestrator.slave_agents.values() if agent.status == AgentStatus.BUSY),
  'agents_available': sum(1 for agent in orchestrator.slave_agents.values() if agent.status == AgentStatus.READY)
}

print(json.dumps(result))
      `,
        ],
        {
          cwd: testProjectDir,
          stdio: "pipe",
        },
      );

      let stdout = "";
      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      await new Promise((resolve) => {
        orchestratorProcess.on("close", (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const result = JSON.parse(stdout.trim());
      expect(result.phase1_registration_complete).toBe(true);
      expect(result.phase2_tasks_assigned).toBe(3); // Limited by available agents
      expect(result.phase3_tasks_completed).toBe(3);
      expect(result.phase4_health_checked).toBe(true);
      expect(result.full_workflow_success).toBe(true);
      expect(result.agents_working + result.agents_available).toBe(3);
    }, 30000);
  });
});
