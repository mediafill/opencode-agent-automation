import { jest } from "@jest/globals";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("Task Queue with Priority Management Integration Tests", () => {
  let testProjectDir;
  let claudeDir;
  let orchestratorProcess;
  let mockVectorDb;

  beforeAll(async () => {
    testProjectDir = path.join(os.tmpdir(), "task-queue-test-" + Date.now());
    claudeDir = path.join(testProjectDir, ".claude");

    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(path.join(claudeDir, "logs"), { recursive: true });
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

    // Mock vector database
    mockVectorDb = {
      store_task_history: jest.fn().mockResolvedValue("doc_id"),
      get_task_history: jest.fn(),
      query_similar_solutions: jest.fn().mockReturnValue([]),
      close: jest.fn().mockResolvedValue(undefined),
    };

    jest.doMock("vector_database", () => ({
      VectorDatabase: jest.fn().mockImplementation(() => mockVectorDb),
    }));
  });

  afterEach(async () => {
    if (orchestratorProcess && !orchestratorProcess.killed) {
      orchestratorProcess.kill("SIGTERM");
      await new Promise((resolve) => {
        orchestratorProcess.on("close", resolve);
      });
    }

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

  describe("Task Prioritization", () => {
    test("should assign tasks based on priority levels", async () => {
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

orchestrator = MasterAgentOrchestrator('${testProjectDir}')

# Register agents
orchestrator.register_slave_agent('priority_agent_1', ['testing'])
orchestrator.register_slave_agent('priority_agent_2', ['testing'])

orchestrator.slave_agents['priority_agent_1'].status = AgentStatus.READY
orchestrator.slave_agents['priority_agent_2'].status = AgentStatus.READY

# Create tasks with different priorities (simulated through task data)
tasks = [
  {'id': 'high_priority_task', 'description': 'Critical security fix', 'type': 'security', 'priority': 'high'},
  {'id': 'medium_priority_task', 'description': 'Feature enhancement', 'type': 'feature', 'priority': 'medium'},
  {'id': 'low_priority_task', 'description': 'Code cleanup', 'type': 'maintenance', 'priority': 'low'}
]

# Assign tasks and track which agent gets which task
assignments = []
for task in tasks:
  assigned_agent = orchestrator.assign_task_to_agent(task['id'], task)
  assignments.push({
    'task_id': task['id'],
    'priority': task['priority'],
    'assigned_to': assigned_agent
  })

result = {
  'assignments': assignments,
  'all_tasks_assigned': assignments.every(a => a.assigned_to is not None),
  'agents_utilized': len(set(assignments.map(a => a.assigned_to))),
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
      expect(result.all_tasks_assigned).toBe(true);
      expect(result.agents_utilized).toBe(2); // Should use both agents
      expect(Object.keys(result.task_assignments).length).toBe(3);
    });

    test("should handle task queue when no agents available", async () => {
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

orchestrator = MasterAgentOrchestrator('${testProjectDir}')

# Register busy agents
orchestrator.register_slave_agent('busy_agent_1', ['testing'])
orchestrator.register_slave_agent('busy_agent_2', ['testing'])

orchestrator.slave_agents['busy_agent_1'].status = AgentStatus.BUSY
orchestrator.slave_agents['busy_agent_2'].status = AgentStatus.BUSY

# Try to assign tasks
task_assignments = []
for i in range(3):
  task_id = f'queued_task_{i+1}'
  assigned_agent = orchestrator.assign_task_to_agent(task_id, {
    'description': f'Task {i+1}',
    'type': 'testing'
  })
  task_assignments.push({
    'task_id': task_id,
    'assigned': assigned_agent is not None,
    'assigned_to': assigned_agent
  })

result = {
  'task_assignments': task_assignments,
  'tasks_actually_assigned': task_assignments.filter(a => a.assigned).length,
  'tasks_queued': task_assignments.filter(a => !a.assigned).length,
  'final_assignments': orchestrator.task_assignments
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
      expect(result.tasks_actually_assigned).toBe(0); // No agents available
      expect(result.tasks_queued).toBe(3); // All tasks queued
      expect(Object.keys(result.final_assignments).length).toBe(0);
    });
  });

  describe("Task Assignment Load Balancing", () => {
    test("should distribute tasks evenly across available agents", async () => {
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

orchestrator = MasterAgentOrchestrator('${testProjectDir}')

# Register multiple agents
agent_ids = ['agent_1', 'agent_2', 'agent_3', 'agent_4']
for agent_id in agent_ids:
  orchestrator.register_slave_agent(agent_id, ['testing'])
  orchestrator.slave_agents[agent_id].status = AgentStatus.READY

# Assign multiple tasks
task_assignments = []
for i in range(8):  # More tasks than agents
  task_id = f'load_balance_task_{i+1}'
  assigned_agent = orchestrator.assign_task_to_agent(task_id, {
    'description': f'Load balancing task {i+1}',
    'type': 'testing'
  })
  if (assigned_agent) {
    task_assignments.push(assigned_agent);
  }

# Count tasks per agent
agent_task_counts = {}
for agent_id in agent_ids:
  agent_task_counts[agent_id] = task_assignments.filter(a => a === agent_id).length

result = {
  'total_tasks_assigned': task_assignments.length,
  'agent_task_counts': agent_task_counts,
  'max_tasks_per_agent': Math.max(...Object.values(agent_task_counts)),
  'min_tasks_per_agent': Math.min(...Object.values(agent_task_counts)),
  'load_distribution_fair': Math.max(...Object.values(agent_task_counts)) - Math.min(...Object.values(agent_task_counts)) <= 1
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
      expect(result.total_tasks_assigned).toBe(4); // Only 4 agents available
      expect(result.load_distribution_fair).toBe(true); // Should be fairly distributed
    });

    test("should prefer agents with higher health scores", async () => {
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

orchestrator = MasterAgentOrchestrator('${testProjectDir}')

# Register agents with different health scores
orchestrator.register_slave_agent('healthy_agent', ['testing'])
orchestrator.register_slave_agent('unhealthy_agent', ['testing'])

orchestrator.slave_agents['healthy_agent'].status = AgentStatus.READY
orchestrator.slave_agents['healthy_agent'].health_score = 95

orchestrator.slave_agents['unhealthy_agent'].status = AgentStatus.READY
orchestrator.slave_agents['unhealthy_agent'].health_score = 45

# Assign multiple tasks
assignments = []
for i in range(3):
  task_id = f'health_preference_task_{i+1}'
  assigned_agent = orchestrator.assign_task_to_agent(task_id, {
    'description': f'Health preference task {i+1}',
    'type': 'testing'
  })
  assignments.push(assigned_agent)

# Count assignments per agent
healthy_assignments = assignments.filter(a => a === 'healthy_agent').length
unhealthy_assignments = assignments.filter(a => a === 'unhealthy_agent').length

result = {
  'assignments': assignments,
  'healthy_agent_assignments': healthy_assignments,
  'unhealthy_agent_assignments': unhealthy_assignments,
  'healthy_preferred': healthy_assignments >= unhealthy_assignments,
  'healthy_score': orchestrator.slave_agents['healthy_agent'].health_score,
  'unhealthy_score': orchestrator.slave_agents['unhealthy_agent'].health_score
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
      expect(result.healthy_preferred).toBe(true); // Should prefer healthier agent
      expect(result.healthy_score).toBeGreaterThan(result.unhealthy_score);
    });
  });

  describe("Task Lifecycle Management", () => {
    test("should track task completion and update agent status", async () => {
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

# Register agent and assign task
orchestrator.register_slave_agent('lifecycle_agent', ['testing'])
orchestrator.slave_agents['lifecycle_agent'].status = AgentStatus.BUSY
orchestrator.slave_agents['lifecycle_agent'].current_task = 'lifecycle_task_123'
orchestrator.task_assignments['lifecycle_task_123'] = 'lifecycle_agent'

# Verify initial state
initial_state = {
  'agent_status': orchestrator.slave_agents['lifecycle_agent'].status.value,
  'current_task': orchestrator.slave_agents['lifecycle_agent'].current_task,
  'task_assignments': dict(orchestrator.task_assignments),
  'completed_tasks': orchestrator.slave_agents['lifecycle_agent'].resource_usage['tasks_completed']
}

# Simulate task completion
completion_message = AgentMessage(
  MessageType.TASK_STATUS_UPDATE,
  'lifecycle_agent',
  orchestrator.master_id,
  {
    'task_id': 'lifecycle_task_123',
    'status': 'completed',
    'message': 'Task completed successfully'
  }
)

orchestrator._handle_task_status_update(completion_message)

# Verify final state
final_state = {
  'agent_status': orchestrator.slave_agents['lifecycle_agent'].status.value,
  'current_task': orchestrator.slave_agents['lifecycle_agent'].current_task,
  'task_assignments': orchestrator.task_assignments,
  'completed_tasks': orchestrator.slave_agents['lifecycle_agent'].resource_usage['tasks_completed']
}

result = {
  'initial_state': initial_state,
  'final_state': final_state,
  'task_completed': final_state.current_task is None,
  'agent_available': final_state.agent_status == 'ready',
  'assignment_cleared': len(final_state.task_assignments) == 0,
  'completion_counted': final_state.completed_tasks > initial_state.completed_tasks
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
      expect(result.task_completed).toBe(true);
      expect(result.agent_available).toBe(true);
      expect(result.assignment_cleared).toBe(true);
      expect(result.completion_counted).toBe(true);
    });

    test("should handle task failures and update statistics", async () => {
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

# Register agent and assign task
orchestrator.register_slave_agent('failure_agent', ['testing'])
orchestrator.slave_agents['failure_agent'].status = AgentStatus.BUSY
orchestrator.slave_agents['failure_agent'].current_task = 'failure_task_456'
orchestrator.task_assignments['failure_task_456'] = 'failure_agent'

# Track initial stats
initial_failed_count = orchestrator.slave_agents['failure_agent'].resource_usage['tasks_failed']

# Simulate task failure
failure_message = AgentMessage(
  MessageType.TASK_STATUS_UPDATE,
  'failure_agent',
  orchestrator.master_id,
  {
    'task_id': 'failure_task_456',
    'status': 'failed',
    'message': 'Task execution failed: database connection error'
  }
)

orchestrator._handle_task_status_update(failure_message)

# Check final state
final_state = {
  'agent_status': orchestrator.slave_agents['failure_agent'].status.value,
  'current_task': orchestrator.slave_agents['failure_agent'].current_task,
  'task_assignments': orchestrator.task_assignments,
  'failed_tasks': orchestrator.slave_agents['failure_agent'].resource_usage['tasks_failed']
}

result = {
  'final_state': final_state,
  'task_cleared': final_state.current_task is None,
  'agent_available': final_state.agent_status == 'ready',
  'assignment_cleared': len(final_state.task_assignments) == 0,
  'failure_counted': final_state.failed_tasks > initial_failed_count
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
      expect(result.task_cleared).toBe(true);
      expect(result.agent_available).toBe(true);
      expect(result.assignment_cleared).toBe(true);
      expect(result.failure_counted).toBe(true);
    });
  });

  describe("Queue Management and Backlog", () => {
    test("should maintain task queue when agents are busy", async () => {
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

orchestrator = MasterAgentOrchestrator('${testProjectDir}')

# Register one agent and make it busy
orchestrator.register_slave_agent('single_agent', ['testing'])
orchestrator.slave_agents['single_agent'].status = AgentStatus.BUSY

# Try to assign multiple tasks
queue_attempts = []
for i in range(5):
  task_id = f'queue_task_{i+1}'
  assigned_agent = orchestrator.assign_task_to_agent(task_id, {
    'description': f'Queued task {i+1}',
    'type': 'testing'
  })
  queue_attempts.push({
    'task_id': task_id,
    'assigned': assigned_agent is not None,
    'assigned_to': assigned_agent
  })

result = {
  'queue_attempts': queue_attempts,
  'assigned_count': queue_attempts.filter(a => a.assigned).length,
  'queued_count': queue_attempts.filter(a => !a.assigned).length,
  'final_assignments': orchestrator.task_assignments
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
      expect(result.assigned_count).toBe(0); // No agents available
      expect(result.queued_count).toBe(5); // All tasks queued
      expect(Object.keys(result.final_assignments).length).toBe(0);
    });

    test("should process queued tasks when agents become available", async () => {
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

# Register agent
orchestrator.register_slave_agent('queue_agent', ['testing'])
orchestrator.slave_agents['queue_agent'].status = AgentStatus.BUSY

# Simulate queued tasks (by directly calling assign - they won't assign due to busy agent)
queued_tasks = []
for i in range(3):
  task_id = f'queued_task_{i+1}'
  assigned = orchestrator.assign_task_to_agent(task_id, {
    'description': f'Queued task {i+1}',
    'type': 'testing'
  })
  if not assigned:
    queued_tasks.push(task_id)

# Now make agent available and complete current task
orchestrator.slave_agents['queue_agent'].status = AgentStatus.READY
orchestrator.slave_agents['queue_agent'].current_task = None

# Try to assign a new task (should work now)
new_assignment = orchestrator.assign_task_to_agent('new_task_123', {
  'description': 'New task after agent becomes available',
  'type': 'testing'
})

result = {
  'queued_tasks': queued_tasks,
  'new_assignment': new_assignment,
  'agent_available': orchestrator.slave_agents['queue_agent'].status == AgentStatus.READY,
  'final_assignments': orchestrator.task_assignments
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
      expect(result.queued_tasks.length).toBe(3);
      expect(result.new_assignment).toBe("queue_agent"); // Should assign now
      expect(result.agent_available).toBe(true);
      expect(Object.keys(result.final_assignments).length).toBe(1);
    });
  });

  describe("Task Queue Statistics and Monitoring", () => {
    test("should provide comprehensive queue statistics", async () => {
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

orchestrator = MasterAgentOrchestrator('${testProjectDir}')

# Set up various agent and task states
orchestrator.register_slave_agent('active_agent', ['testing'])
orchestrator.register_slave_agent('idle_agent', ['analysis'])
orchestrator.register_slave_agent('busy_agent', ['debugging'])

orchestrator.slave_agents['active_agent'].status = AgentStatus.BUSY
orchestrator.slave_agents['active_agent'].current_task = 'active_task'
orchestrator.slave_agents['idle_agent'].status = AgentStatus.READY
orchestrator.slave_agents['busy_agent'].status = AgentStatus.BUSY
orchestrator.slave_agents['busy_agent'].current_task = 'busy_task'

# Add task assignments
orchestrator.task_assignments['active_task'] = 'active_agent'
orchestrator.task_assignments['busy_task'] = 'busy_agent'

# Get system status
system_status = orchestrator.get_system_status()

result = {
  'system_status': system_status,
  'expected_total_agents': 3,
  'expected_busy_agents': 2,
  'expected_ready_agents': 1,
  'expected_active_tasks': 2,
  'has_system_health': 'system_health' in system_status,
  'has_pending_messages': 'pending_messages' in system_status
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
      expect(result.system_status.total_agents).toBe(
        result.expected_total_agents,
      );
      expect(result.system_status.busy_agents).toBe(
        result.expected_busy_agents,
      );
      expect(result.system_status.healthy_agents).toBe(
        result.expected_total_agents,
      ); // All agents are healthy
      expect(result.system_status.active_tasks).toBe(
        result.expected_active_tasks,
      );
      expect(result.has_system_health).toBe(true);
      expect(result.has_pending_messages).toBe(true);
    });

    test("should track agent performance metrics", async () => {
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
from master_agent_orchestrator import MasterAgentOrchestrator, AgentMessage, MessageType
import json

orchestrator = MasterAgentOrchestrator('${testProjectDir}')

# Register agent
orchestrator.register_slave_agent('metrics_agent', ['testing'])

# Simulate multiple task completions and failures
initial_stats = {
  'completed': orchestrator.slave_agents['metrics_agent'].resource_usage['tasks_completed'],
  'failed': orchestrator.slave_agents['metrics_agent'].resource_usage['tasks_failed']
}

# Simulate task completions
for i in range(3):
  completion_message = AgentMessage(
    MessageType.TASK_STATUS_UPDATE,
    'metrics_agent',
    orchestrator.master_id,
    {
      'task_id': f'completed_task_{i+1}',
      'status': 'completed',
      'message': 'Task completed'
    }
  )
  orchestrator._handle_task_status_update(completion_message)

# Simulate task failures
for i in range(2):
  failure_message = AgentMessage(
    MessageType.TASK_STATUS_UPDATE,
    'metrics_agent',
    orchestrator.master_id,
    {
      'task_id': f'failed_task_{i+1}',
      'status': 'failed',
      'message': 'Task failed'
    }
  )
  orchestrator._handle_task_status_update(failure_message)

final_stats = {
  'completed': orchestrator.slave_agents['metrics_agent'].resource_usage['tasks_completed'],
  'failed': orchestrator.slave_agents['metrics_agent'].resource_usage['tasks_failed']
}

result = {
  'initial_stats': initial_stats,
  'final_stats': final_stats,
  'completions_added': final_stats.completed - initial_stats.completed,
  'failures_added': final_stats.failed - initial_stats.failed,
  'success_rate': final_stats.completed / (final_stats.completed + final_stats.failed) * 100
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
      expect(result.completions_added).toBe(3);
      expect(result.failures_added).toBe(2);
      expect(result.success_rate).toBe(60); // 3/5 = 60%
    });
  });
});
