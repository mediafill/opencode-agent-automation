import { jest } from "@jest/globals";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("Load Balancing Algorithm Tests", () => {
  let testProjectDir;
  let claudeDir;
  let orchestratorProcess;

  beforeAll(async () => {
    testProjectDir = path.join(
      os.tmpdir(),
      "load-balancing-test-" + Date.now(),
    );
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

  describe("Load Balancer Selection Algorithm", () => {
    test("should prioritize agents by health score and availability", async () => {
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

# Create agents with different health scores and availability
orchestrator.register_slave_agent('healthy_idle', ['testing'])
orchestrator.register_slave_agent('healthy_busy', ['testing'])
orchestrator.register_slave_agent('unhealthy_idle', ['testing'])
orchestrator.register_slave_agent('unhealthy_busy', ['testing'])

# Configure agents
orchestrator.slave_agents['healthy_idle'].status = AgentStatus.READY
orchestrator.slave_agents['healthy_idle'].health_score = 95

orchestrator.slave_agents['healthy_busy'].status = AgentStatus.BUSY
orchestrator.slave_agents['healthy_busy'].health_score = 90

orchestrator.slave_agents['unhealthy_idle'].status = AgentStatus.READY
orchestrator.slave_agents['unhealthy_idle'].health_score = 45

orchestrator.slave_agents['unhealthy_busy'].status = AgentStatus.BUSY
orchestrator.slave_agents['unhealthy_busy'].health_score = 40

# Test load balancer selection
available_agents = [
  agent for agent in orchestrator.slave_agents.values()
  if agent.is_healthy() and agent.status == AgentStatus.READY
]

selected_agent = orchestrator.load_balancer(available_agents)

result = {
  'available_agents': len(available_agents),
  'selected_agent_id': selected_agent.agent_id if selected_agent else None,
  'selected_agent_health': selected_agent.health_score if selected_agent else 0,
  'healthy_idle_available': 'healthy_idle' in [a.agent_id for a in available_agents],
  'unhealthy_idle_available': 'unhealthy_idle' in [a.agent_id for a in available_agents],
  'selection_prioritizes_health': selected_agent and selected_agent.health_score >= 90
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
      expect(result.available_agents).toBe(2); // healthy_idle and unhealthy_idle
      expect(result.selected_agent_id).toBe("healthy_idle");
      expect(result.selection_prioritizes_health).toBe(true);
    });

    test("should prefer idle agents over busy ones with same health", async () => {
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

# Create agents with same health but different availability
orchestrator.register_slave_agent('idle_agent', ['testing'])
orchestrator.register_slave_agent('busy_agent', ['testing'])

orchestrator.slave_agents['idle_agent'].status = AgentStatus.READY
orchestrator.slave_agents['idle_agent'].health_score = 80

orchestrator.slave_agents['busy_agent'].status = AgentStatus.BUSY
orchestrator.slave_agents['busy_agent'].health_score = 80

# Test load balancer with mixed availability
all_agents = list(orchestrator.slave_agents.values())
selected_agent = orchestrator.load_balancer(all_agents)

result = {
  'selected_agent_id': selected_agent.agent_id if selected_agent else None,
  'selected_agent_status': selected_agent.status.value if selected_agent else None,
  'idle_preferred': selected_agent and selected_agent.status == AgentStatus.READY,
  'both_same_health': orchestrator.slave_agents['idle_agent'].health_score == orchestrator.slave_agents['busy_agent'].health_score
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
      expect(result.idle_preferred).toBe(true);
      expect(result.selected_agent_id).toBe("idle_agent");
    });

    test("should handle empty agent list gracefully", async () => {
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

# Test load balancer with empty list
selected_agent = orchestrator.load_balancer([])

result = {
  'selected_agent': selected_agent,
  'handles_empty_list': selected_agent is None
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
      expect(result.handles_empty_list).toBe(true);
      expect(result.selected_agent).toBeNull();
    });
  });

  describe("Load Distribution Analysis", () => {
    test("should achieve balanced task distribution over time", async () => {
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
from master_agent_orchestrator import MasterAgentOrchestrator, AgentStatus, AgentMessage, MessageType
import json

orchestrator = MasterAgentOrchestrator('${testProjectDir}')

# Create multiple agents with similar capabilities
agent_ids = ['agent_1', 'agent_2', 'agent_3', 'agent_4']
for agent_id in agent_ids:
  orchestrator.register_slave_agent(agent_id, ['testing'])
  orchestrator.slave_agents[agent_id].status = AgentStatus.READY
  orchestrator.slave_agents[agent_id].health_score = 85  # Similar health

# Assign multiple tasks sequentially
assignments = []
for i in range(12):  # More tasks than agents
  task_id = f'task_{i+1}'
  assigned_agent = orchestrator.assign_task_to_agent(task_id, {
    'description': f'Task {i+1} for load balancing',
    'type': 'testing'
  })
  if assigned_agent:
    assignments.push(assigned_agent)

# Complete all tasks to reset agents to READY
for i, agent_id in enumerate(assignments):
  task_id = f'task_{i+1}'
  completion_message = AgentMessage(
    MessageType.TASK_STATUS_UPDATE,
    agent_id,
    orchestrator.master_id,
    {
      'task_id': task_id,
      'status': 'completed',
      'message': 'Task completed'
    }
  )
  orchestrator._handle_task_status_update(completion_message)

# Count final assignments per agent
assignment_counts = {}
for agent_id in agent_ids:
  assignment_counts[agent_id] = assignments.filter(a => a === agent_id).length

result = {
  'total_assignments': assignments.length,
  'assignment_counts': assignment_counts,
  'max_assignments': Math.max(...Object.values(assignment_counts)),
  'min_assignments': Math.min(...Object.values(assignment_counts)),
  'distribution_fair': Math.max(...Object.values(assignment_counts)) - Math.min(...Object.values(assignment_counts)) <= 1,
  'all_agents_utilized': Object.values(assignment_counts).every(count => count > 0)
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
      expect(result.total_assignments).toBe(4); // Limited by agent count
      expect(result.distribution_fair).toBe(true);
      expect(result.all_agents_utilized).toBe(true);
    });

    test("should adapt to changing agent health conditions", async () => {
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

# Create agents with initially similar health
orchestrator.register_slave_agent('adapting_agent_1', ['testing'])
orchestrator.register_slave_agent('adapting_agent_2', ['testing'])

orchestrator.slave_agents['adapting_agent_1'].status = AgentStatus.READY
orchestrator.slave_agents['adapting_agent_1'].health_score = 80

orchestrator.slave_agents['adapting_agent_2'].status = AgentStatus.READY
orchestrator.slave_agents['adapting_agent_2'].health_score = 80

# First assignment - should be balanced
first_assignment = orchestrator.assign_task_to_agent('first_task', {
  'description': 'First task with equal health',
  'type': 'testing'
})

# Simulate health degradation of first agent
orchestrator.slave_agents['adapting_agent_1'].health_score = 30  # Much lower health

# Complete first task
orchestrator.slave_agents[first_assignment].status = AgentStatus.READY
orchestrator.slave_agents[first_assignment].current_task = None

# Second assignment - should prefer healthier agent
second_assignment = orchestrator.assign_task_to_agent('second_task', {
  'description': 'Second task with unequal health',
  'type': 'testing'
})

result = {
  'first_assignment': first_assignment,
  'second_assignment': second_assignment,
  'adapts_to_health_change': second_assignment !== first_assignment,
  'prefers_healthier_agent': second_assignment === 'adapting_agent_2',
  'health_scores': {
    'agent_1': orchestrator.slave_agents['adapting_agent_1'].health_score,
    'agent_2': orchestrator.slave_agents['adapting_agent_2'].health_score
  }
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
      expect(result.adapts_to_health_change).toBe(true);
      expect(result.prefers_healthier_agent).toBe(true);
    });
  });

  describe("Load Balancer Performance Characteristics", () => {
    test("should maintain consistent performance with varying agent counts", async () => {
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
import time

orchestrator = MasterAgentOrchestrator('${testProjectDir}')

# Test with different numbers of agents
test_scenarios = [
  {'agent_count': 1, 'task_count': 3},
  {'agent_count': 3, 'task_count': 6},
  {'agent_count': 5, 'task_count': 10}
]

performance_results = []
for scenario in test_scenarios:
  # Clean up previous agents
  orchestrator.slave_agents.clear()
  
  # Create agents
  for i in range(scenario.agent_count):
    agent_id = f'perf_agent_{i+1}'
    orchestrator.register_slave_agent(agent_id, ['testing'])
    orchestrator.slave_agents[agent_id].status = AgentStatus.READY
    orchestrator.slave_agents[agent_id].health_score = 80
  
  # Measure assignment time
  start_time = time.time()
  assignments = 0
  
  for i in range(scenario.task_count):
    task_id = f'perf_task_{i+1}'
    assigned = orchestrator.assign_task_to_agent(task_id, {
      'description': f'Performance task {i+1}',
      'type': 'testing'
    })
    if assigned:
      assignments += 1
  
  end_time = time.time()
  duration = end_time - start_time
  
  performance_results.push({
    'agent_count': scenario.agent_count,
    'task_count': scenario.task_count,
    'assignments_made': assignments,
    'duration_seconds': duration,
    'assignments_per_second': assignments / duration if duration > 0 else 0
  })

result = {
  'performance_results': performance_results,
  'scales_with_agent_count': performance_results.length === 3,
  'maintains_reasonable_performance': performance_results.every(r => r.assignments_per_second > 10)
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
      expect(result.scales_with_agent_count).toBe(true);
      expect(result.maintains_reasonable_performance).toBe(true);
    });

    test("should handle concurrent load balancer access", async () => {
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
import threading
import time

orchestrator = MasterAgentOrchestrator('${testProjectDir}')

# Create agents
for i in range(5):
  agent_id = f'concurrent_agent_{i+1}'
  orchestrator.register_slave_agent(agent_id, ['testing'])
  orchestrator.slave_agents[agent_id].status = AgentStatus.READY

# Simulate concurrent task assignments
results = {'assignments': [], 'errors': 0}

def concurrent_assignment(task_num):
  try:
    task_id = f'concurrent_task_{task_num}'
    assigned = orchestrator.assign_task_to_agent(task_id, {
      'description': f'Concurrent task {task_num}',
      'type': 'testing'
    })
    results['assignments'].append(assigned)
  except Exception as e:
    results['errors'] += 1

# Start multiple threads
threads = []
for i in range(10):
  thread = threading.Thread(target=concurrent_assignment, args=(i+1,))
  threads.append(thread)
  thread.start()

# Wait for all threads
for thread in threads:
  thread.join()

result = {
  'concurrent_assignments_attempted': 10,
  'successful_assignments': results['assignments'].filter(a => a is not None).length,
  'errors_encountered': results['errors'],
  'handles_concurrency': results['errors'] === 0,
  'respects_agent_limits': results['assignments'].filter(a => a is not None).length <= 5
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
      expect(result.handles_concurrency).toBe(true);
      expect(result.respects_agent_limits).toBe(true);
    });
  });
});
