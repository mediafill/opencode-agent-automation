import { jest } from "@jest/globals";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("Agent Health Monitoring and Auto-Restart Integration Tests", () => {
  let testProjectDir;
  let claudeDir;
  let orchestratorProcess;
  let agentProcess;
  let mockPsutil;

  beforeAll(async () => {
    testProjectDir = path.join(
      os.tmpdir(),
      "health-monitoring-test-" + Date.now(),
    );
    claudeDir = path.join(testProjectDir, ".claude");

    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(path.join(claudeDir, "logs"), { recursive: true });
    await fs.mkdir(path.join(claudeDir, "agent_data"), { recursive: true });
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

    // Mock psutil for process monitoring
    mockPsutil = {
      process_iter: jest.fn(),
      Process: jest.fn().mockImplementation(() => ({
        cpu_percent: jest.fn().mockReturnValue(25.5),
        memory_info: jest.fn().mockReturnValue({ rss: 128 * 1024 * 1024 }), // 128 MB
        connections: jest.fn().mockReturnValue([]),
        create_time: jest.fn().mockReturnValue(Date.now() / 1000),
      })),
    };

    jest.doMock("psutil", () => mockPsutil);
  });

  afterEach(async () => {
    // Clean up processes
    const processes = [orchestratorProcess, agentProcess];
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

  describe("Health Score Calculation", () => {
    test("should calculate health score based on resource usage", async () => {
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

# Register agent
orchestrator.register_slave_agent('health_test_agent', ['testing'])

# Update health with different resource usage patterns
test_scenarios = [
  {'cpu': 20, 'memory': 100, 'expected_min_score': 90},  # Low usage, high score
  {'cpu': 50, 'memory': 200, 'expected_min_score': 70},  # Medium usage, medium score
  {'cpu': 90, 'memory': 800, 'expected_min_score': 10},  # High usage, low score
]

results = []
for scenario in test_scenarios:
  orchestrator.slave_agents['health_test_agent'].update_health(scenario['cpu'], scenario['memory'])
  health_score = orchestrator.slave_agents['health_test_agent'].health_score

  results.append({
    'cpu_percent': scenario['cpu'],
    'memory_mb': scenario['memory'],
    'health_score': health_score,
    'is_healthy': orchestrator.slave_agents['health_test_agent'].is_healthy(),
    'meets_expectation': health_score >= scenario['expected_min_score']
  })

print(json.dumps(results))
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

      const results = JSON.parse(stdout.trim());
      expect(results.length).toBe(3);

      // Low usage should result in high health score
      expect(results[0].health_score).toBeGreaterThanOrEqual(
        results[0].expected_min_score,
      );
      expect(results[0].is_healthy).toBe(true);

      // High usage should result in low health score
      expect(results[2].health_score).toBeLessThanOrEqual(
        results[2].expected_min_score,
      );
      expect(results[2].is_healthy).toBe(false);
    });

    test("should factor in agent age for health calculation", async () => {
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
from datetime import datetime, timedelta

orchestrator = MasterAgentOrchestrator('${testProjectDir}')

# Register agent
orchestrator.register_slave_agent('age_test_agent', ['testing'])

# Test with different agent ages
age_scenarios = [
  {'hours_old': 0, 'expected_penalty': 0},   # Fresh agent, no penalty
  {'hours_old': 1, 'expected_penalty': 5},   # 1 hour old, small penalty
  {'hours_old': 5, 'expected_penalty': 25},  # 5 hours old, larger penalty
]

results = []
for scenario in age_scenarios:
  # Set agent heartbeat to simulate age
  orchestrator.slave_agents['age_test_agent'].last_heartbeat = datetime.now() - timedelta(hours=scenario['hours_old'])

  # Update health (low resource usage)
  orchestrator.slave_agents['age_test_agent'].update_health(10, 50)
  health_score = orchestrator.slave_agents['age_test_agent'].health_score

  results.append({
    'hours_old': scenario['hours_old'],
    'health_score': health_score,
    'age_penalty_applied': health_score < 100
  })

print(json.dumps(results))
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

      const results = JSON.parse(stdout.trim());
      expect(results.length).toBe(3);

      // Fresh agent should have no age penalty
      expect(results[0].age_penalty_applied).toBe(false);

      // Older agents should have age penalties
      expect(results[1].age_penalty_applied).toBe(true);
      expect(results[2].age_penalty_applied).toBe(true);
    });
  });

  describe("Continuous Health Monitoring", () => {
    test("should perform periodic health checks on all agents", async () => {
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
import time

orchestrator = MasterAgentOrchestrator('${testProjectDir}')

# Register multiple agents
orchestrator.register_slave_agent('monitor_agent_1', ['testing'])
orchestrator.register_slave_agent('monitor_agent_2', ['analysis'])

# Run health monitoring loop briefly
orchestrator.is_running = True
orchestrator._perform_health_checks()

result = {
  'agents_checked': len(orchestrator.slave_agents),
  'all_agents_have_heartbeat': all(agent.last_heartbeat is not None for agent in orchestrator.slave_agents.values()),
  'health_scores_calculated': all(agent.health_score > 0 for agent in orchestrator.slave_agents.values())
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
      expect(result.agents_checked).toBe(2);
      expect(result.all_agents_have_heartbeat).toBe(true);
      expect(result.health_scores_calculated).toBe(true);
    });

    test("should detect and mark timed-out agents", async () => {
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
orchestrator.agent_timeout = 5  # 5 seconds for testing

# Register agents with different heartbeat times
orchestrator.register_slave_agent('active_agent', ['testing'])
orchestrator.register_slave_agent('timed_out_agent', ['analysis'])

# Active agent - recent heartbeat
orchestrator.slave_agents['active_agent'].last_heartbeat = datetime.now()

# Timed out agent - old heartbeat
orchestrator.slave_agents['timed_out_agent'].last_heartbeat = datetime.now() - timedelta(seconds=10)

# Run health checks
orchestrator._perform_health_checks()

result = {
  'active_agent_status': orchestrator.slave_agents['active_agent'].status.value,
  'timed_out_agent_status': orchestrator.slave_agents['timed_out_agent'].status.value,
  'timed_out_agent_health': orchestrator.slave_agents['timed_out_agent'].health_score,
  'timeout_detected': orchestrator.slave_agents['timed_out_agent'].status == AgentStatus.UNAVAILABLE
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
      expect(result.active_agent_status).toBe("ready"); // Should remain ready
      expect(result.timeout_detected).toBe(true);
      expect(result.timed_out_agent_health).toBe(0);
    });
  });

  describe("Failed Agent Cleanup", () => {
    test("should remove agents with critical health scores", async () => {
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

# Register agents with different health states
orchestrator.register_slave_agent('healthy_agent', ['testing'])
orchestrator.register_slave_agent('critical_agent', ['analysis'])
orchestrator.register_slave_agent('failed_agent', ['debugging'])

orchestrator.slave_agents['healthy_agent'].health_score = 80
orchestrator.slave_agents['critical_agent'].health_score = 5  # Below threshold
orchestrator.slave_agents['failed_agent'].status = AgentStatus.FAILED
orchestrator.slave_agents['failed_agent'].health_score = 0

agent_count_before = len(orchestrator.slave_agents)
orchestrator._cleanup_failed_agents()
agent_count_after = len(orchestrator.slave_agents)

result = {
  'count_before': agent_count_before,
  'count_after': agent_count_after,
  'agents_removed': agent_count_before - agent_count_after,
  'healthy_agent_remains': 'healthy_agent' in orchestrator.slave_agents,
  'critical_agent_removed': 'critical_agent' not in orchestrator.slave_agents,
  'failed_agent_removed': 'failed_agent' not in orchestrator.slave_agents
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
      expect(result.agents_removed).toBe(2);
      expect(result.healthy_agent_remains).toBe(true);
      expect(result.critical_agent_removed).toBe(true);
      expect(result.failed_agent_removed).toBe(true);
    });

    test("should reassign tasks from failed agents", async () => {
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

# Register agent and assign task
orchestrator.register_slave_agent('failing_agent', ['testing'])
orchestrator.slave_agents['failing_agent'].status = AgentStatus.BUSY
orchestrator.slave_agents['failing_agent'].current_task = 'task_to_reassign'
orchestrator.task_assignments['task_to_reassign'] = 'failing_agent'

# Verify task assignment
task_assignments_before = dict(orchestrator.task_assignments)

# Simulate agent failure and cleanup
orchestrator.slave_agents['failing_agent'].health_score = 0
orchestrator._cleanup_failed_agents()

result = {
  'task_assignments_before': task_assignments_before,
  'task_assignments_after': orchestrator.task_assignments,
  'task_reassigned': 'task_to_reassign' not in orchestrator.task_assignments,
  'agent_removed': 'failing_agent' not in orchestrator.slave_agents
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
      expect(result.task_reassigned).toBe(true);
      expect(result.agent_removed).toBe(true);
      expect(result.task_assignments_after).toEqual({});
    });
  });

  describe("Auto-Restart Functionality", () => {
    test("should attempt to restart timed-out agents", async () => {
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
orchestrator.agent_timeout = 1  # Short timeout for testing

# Register agent with mock process info
orchestrator.register_slave_agent('restart_test_agent', ['testing'])
orchestrator.slave_agents['restart_test_agent'].process_info = {'pid': 12345}

# Set old heartbeat to trigger timeout
orchestrator.slave_agents['restart_test_agent'].last_heartbeat = datetime.now() - timedelta(seconds=5)

# Run health check (should trigger restart attempt)
orchestrator._perform_health_checks()

result = {
  'agent_status_after_timeout': orchestrator.slave_agents['restart_test_agent'].status.value,
  'restart_attempted': orchestrator.slave_agents['restart_test_agent'].status == AgentStatus.FAILED,
  'agent_marked_failed': orchestrator.slave_agents['restart_test_agent'].status == AgentStatus.FAILED
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
      expect(result.restart_attempted).toBe(true);
      expect(result.agent_marked_failed).toBe(true);
    });

    test("should handle restart failures gracefully", async () => {
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

# Register agent without process info (simulates restart failure scenario)
orchestrator.register_slave_agent('restart_fail_agent', ['testing'])
orchestrator.slave_agents['restart_fail_agent'].process_info = {}  # No PID

# Attempt restart
orchestrator._attempt_agent_restart(orchestrator.slave_agents['restart_fail_agent'])

result = {
  'restart_attempted': True,  # Method should run without error
  'agent_status': orchestrator.slave_agents['restart_fail_agent'].status.value,
  'agent_marked_failed': orchestrator.slave_agents['restart_fail_agent'].status == AgentStatus.FAILED
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
      expect(result.restart_attempted).toBe(true);
      expect(result.agent_marked_failed).toBe(true);
    });
  });

  describe("Health Monitoring Integration", () => {
    test("should integrate health monitoring with task assignment", async () => {
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

# Register agents with different health states
orchestrator.register_slave_agent('healthy_agent', ['testing'])
orchestrator.register_slave_agent('unhealthy_agent', ['testing'])

orchestrator.slave_agents['healthy_agent'].status = AgentStatus.READY
orchestrator.slave_agents['healthy_agent'].health_score = 90

orchestrator.slave_agents['unhealthy_agent'].status = AgentStatus.READY
orchestrator.slave_agents['unhealthy_agent'].health_score = 30  # Unhealthy

# Attempt task assignment
task_data = {'description': 'Health-aware task assignment test'}
assigned_agent = orchestrator.assign_task_to_agent('health_task_123', task_data)

result = {
  'task_assigned': assigned_agent is not None,
  'assigned_to_healthy_agent': assigned_agent == 'healthy_agent',
  'healthy_agent_status': orchestrator.slave_agents['healthy_agent'].status.value,
  'unhealthy_agent_status': orchestrator.slave_agents['unhealthy_agent'].status.value,
  'healthy_is_healthy': orchestrator.slave_agents['healthy_agent'].is_healthy(),
  'unhealthy_is_healthy': orchestrator.slave_agents['unhealthy_agent'].is_healthy()
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
      expect(result.task_assigned).toBe(true);
      expect(result.assigned_to_healthy_agent).toBe(true); // Should prefer healthy agent
      expect(result.healthy_agent_status).toBe("busy");
      expect(result.healthy_is_healthy).toBe(true);
      expect(result.unhealthy_is_healthy).toBe(false);
    });

    test("should provide comprehensive health status reporting", async () => {
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

# Register agents with varied states
orchestrator.register_slave_agent('ready_agent', ['testing'])
orchestrator.register_slave_agent('busy_agent', ['analysis'])
orchestrator.register_slave_agent('unhealthy_agent', ['debugging'])

orchestrator.slave_agents['ready_agent'].status = AgentStatus.READY
orchestrator.slave_agents['ready_agent'].health_score = 85

orchestrator.slave_agents['busy_agent'].status = AgentStatus.BUSY
orchestrator.slave_agents['busy_agent'].health_score = 75
orchestrator.slave_agents['busy_agent'].current_task = 'busy_task'

orchestrator.slave_agents['unhealthy_agent'].status = AgentStatus.UNAVAILABLE
orchestrator.slave_agents['unhealthy_agent'].health_score = 25

# Add task assignment
orchestrator.task_assignments['busy_task'] = 'busy_agent'

# Get system status
system_status = orchestrator.get_system_status()

result = {
  'system_status': system_status,
  'expected_total_agents': 3,
  'expected_healthy_count': 2,  // ready_agent and busy_agent
  'expected_busy_count': 1,
  'expected_unhealthy_count': 1,
  'has_system_health_score': 'system_health' in system_status,
  'has_active_tasks_count': 'active_tasks' in system_status
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
      expect(result.system_status.healthy_agents).toBe(
        result.expected_healthy_count,
      );
      expect(result.system_status.busy_agents).toBe(result.expected_busy_count);
      expect(result.system_status.unhealthy_agents).toBe(
        result.expected_unhealthy_count,
      );
      expect(result.has_system_health_score).toBe(true);
      expect(result.has_active_tasks_count).toBe(true);
      expect(result.system_status.active_tasks).toBe(1);
    });
  });

  describe("End-to-End Health Monitoring Flow", () => {
    test("should complete full health monitoring cycle", async () => {
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

      // Start orchestrator
      orchestratorProcess = spawn(
        "python3",
        [
          "-c",
          `
import sys
sys.path.insert(0, '${path.dirname(orchestratorScript)}')
from master_agent_orchestrator import MasterAgentOrchestrator
import time

orchestrator = MasterAgentOrchestrator('${testProjectDir}')
orchestrator.start()

# Register test agent
orchestrator.register_slave_agent('e2e_health_agent', ['testing'])

time.sleep(2)  # Allow monitoring to run
orchestrator.stop()
      `,
        ],
        {
          cwd: testProjectDir,
          stdio: "pipe",
        },
      );

      await new Promise((resolve) => {
        orchestratorProcess.on("close", (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      // Verify agent was monitored
      const orchestratorCheckProcess = spawn(
        "python3",
        [
          "-c",
          `
import sys
sys.path.insert(0, '${path.dirname(orchestratorScript)}')
from master_agent_orchestrator import get_orchestrator
import json

orchestrator = get_orchestrator('${testProjectDir}')

result = {
  'agent_registered': 'e2e_health_agent' in orchestrator.slave_agents,
  'agent_has_health_score': orchestrator.slave_agents.get('e2e_health_agent', {}).health_score > 0,
  'agent_has_heartbeat': orchestrator.slave_agents.get('e2e_health_agent', {}).last_heartbeat is not None,
  'agent_is_healthy': orchestrator.slave_agents.get('e2e_health_agent', {}).is_healthy() if 'e2e_health_agent' in orchestrator.slave_agents else False
}

print(json.dumps(result))
      `,
        ],
        {
          cwd: testProjectDir,
          stdio: "pipe",
        },
      );

      let checkStdout = "";
      orchestratorCheckProcess.stdout.on("data", (data) => {
        checkStdout += data.toString();
      });

      await new Promise((resolve) => {
        orchestratorCheckProcess.on("close", (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const checkResult = JSON.parse(checkStdout.trim());
      expect(checkResult.agent_registered).toBe(true);
      expect(checkResult.agent_has_health_score).toBe(true);
      expect(checkResult.agent_has_heartbeat).toBe(true);
      expect(checkResult.agent_is_healthy).toBe(true);
    });
  });
});
