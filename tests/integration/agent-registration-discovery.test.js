import { jest } from "@jest/globals";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("Agent Registration and Discovery Integration Tests", () => {
  let testProjectDir;
  let claudeDir;
  let orchestratorProcess;
  let agentProcess1;
  let agentProcess2;
  let mockPsutil;

  beforeAll(async () => {
    testProjectDir = path.join(
      os.tmpdir(),
      "agent-registration-test-" + Date.now(),
    );
    claudeDir = path.join(testProjectDir, ".claude");

    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(path.join(claudeDir, "logs"), { recursive: true });
    await fs.mkdir(path.join(claudeDir, "vector_db"), { recursive: true });
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
      // Ignore if directory doesn't exist
    }

    // Mock psutil for process discovery
    mockPsutil = {
      process_iter: jest.fn(),
    };

    jest.doMock("psutil", () => mockPsutil);
  });

  afterEach(async () => {
    // Clean up processes
    const processes = [orchestratorProcess, agentProcess1, agentProcess2];
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

    // Clean up any created files
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

  describe("Agent Discovery and Auto-Registration", () => {
    test("should discover running OpenCode agents automatically", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "master_agent_orchestrator.py",
      );

      // Mock psutil to return fake opencode processes
      mockPsutil.process_iter.mockReturnValue([
        {
          info: {
            pid: 12345,
            name: "python3",
            cmdline: ["python3", "/path/to/opencode", "run", "some_command"],
            create_time: Date.now() / 1000,
          },
        },
        {
          info: {
            pid: 12346,
            name: "node",
            cmdline: ["node", "/path/to/opencode.js", "execute"],
            create_time: Date.now() / 1000,
          },
        },
        {
          info: {
            pid: 12347,
            name: "python3",
            cmdline: ["python3", "orchestrator.py"], // Should be ignored
            create_time: Date.now() / 1000,
          },
        },
      ]);

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
orchestrator.discover_slave_agents()

result = {
  'discovered_agents_count': len(orchestrator.slave_agents),
  'agent_ids': list(orchestrator.slave_agents.keys()),
  'agent_pids': [agent.process_info['pid'] for agent in orchestrator.slave_agents.values()]
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
      expect(result.discovered_agents_count).toBe(2); // Should discover 2 agents, ignore orchestrator
      expect(result.agent_ids).toHaveLength(2);
      expect(result.agent_pids).toEqual(expect.arrayContaining([12345, 12346]));
    });

    test("should handle process discovery errors gracefully", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "master_agent_orchestrator.py",
      );

      // Mock psutil to throw errors
      mockPsutil.process_iter.mockImplementation(() => {
        throw new Error("Process discovery failed");
      });

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

try:
  orchestrator.discover_slave_agents()
  success = True
except Exception as e:
  success = False

result = {
  'discovery_success': success,
  'agents_count': len(orchestrator.slave_agents)
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
      expect(result.discovery_success).toBe(true); // Should not crash
      expect(result.agents_count).toBe(0); // Should have no agents due to error
    });
  });

  describe("Agent Registration Protocol", () => {
    test("should successfully register multiple agents with different capabilities", async () => {
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

# Register multiple agents with different capabilities
agents_data = [
  {'id': 'test_agent_1', 'capabilities': ['testing', 'debugging']},
  {'id': 'test_agent_2', 'capabilities': ['analysis', 'refactoring']},
  {'id': 'test_agent_3', 'capabilities': ['documentation', 'performance']}
]

registration_results = []
for agent_data in agents_data:
  success = orchestrator.register_slave_agent(agent_data['id'], agent_data['capabilities'])
  registration_results.append({
    'agent_id': agent_data['id'],
    'success': success,
    'capabilities': agent_data['capabilities']
  })

result = {
  'registration_results': registration_results,
  'total_registered': len(orchestrator.slave_agents),
  'all_capabilities': {}
}

for agent_id, agent in orchestrator.slave_agents.items():
  result['all_capabilities'][agent_id] = list(agent.capabilities)

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
      expect(result.total_registered).toBe(3);
      expect(result.registration_results.every((r) => r.success)).toBe(true);

      // Check that capabilities are stored correctly
      expect(result.all_capabilities["test_agent_1"]).toEqual([
        "testing",
        "debugging",
      ]);
      expect(result.all_capabilities["test_agent_2"]).toEqual([
        "analysis",
        "refactoring",
      ]);
      expect(result.all_capabilities["test_agent_3"]).toEqual([
        "documentation",
        "performance",
      ]);
    });

    test("should enforce maximum agent limits", async () => {
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
orchestrator.max_slave_agents = 2

# Try to register more agents than the limit
registration_attempts = []
for i in range(4):
  agent_id = f'limit_test_agent_{i+1}'
  success = orchestrator.register_slave_agent(agent_id, ['testing'])
  registration_attempts.append({
    'agent_id': agent_id,
    'success': success,
    'attempt_number': i + 1
  })

result = {
  'registration_attempts': registration_attempts,
  'total_registered': len(orchestrator.slave_agents),
  'successful_registrations': registration_attempts.filter(r => r.success).length,
  'failed_registrations': registration_attempts.filter(r => !r.success).length
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
      expect(result.total_registered).toBe(2);
      expect(result.successful_registrations).toBe(2);
      expect(result.failed_registrations).toBe(2);

      // First two should succeed, last two should fail
      expect(result.registration_attempts[0].success).toBe(true);
      expect(result.registration_attempts[1].success).toBe(true);
      expect(result.registration_attempts[2].success).toBe(false);
      expect(result.registration_attempts[3].success).toBe(false);
    });

    test("should handle agent re-registration attempts", async () => {
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

# Register agent once
first_registration = orchestrator.register_slave_agent('re_register_agent', ['testing'])

# Try to register the same agent again with different capabilities
second_registration = orchestrator.register_slave_agent('re_register_agent', ['analysis', 'debugging'])

# Check agent capabilities weren't overwritten
original_capabilities = list(orchestrator.slave_agents['re_register_agent'].capabilities)

result = {
  'first_registration': first_registration,
  'second_registration': second_registration,
  'agent_count': len(orchestrator.slave_agents),
  'original_capabilities': original_capabilities
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
      expect(result.first_registration).toBe(true);
      expect(result.second_registration).toBe(false); // Should fail
      expect(result.agent_count).toBe(1);
      expect(result.original_capabilities).toEqual(["testing"]); // Should keep original capabilities
    });
  });

  describe("Agent Lifecycle Management", () => {
    test("should track agent registration and unregistration", async () => {
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
orchestrator.register_slave_agent('lifecycle_agent_1', ['testing'])
orchestrator.register_slave_agent('lifecycle_agent_2', ['analysis'])

count_after_registration = len(orchestrator.slave_agents)

# Unregister one agent
orchestrator.unregister_slave_agent('lifecycle_agent_1')

count_after_unregistration = len(orchestrator.slave_agents)

# Try to unregister non-existent agent
orchestrator.unregister_slave_agent('non_existent_agent')

final_count = len(orchestrator.slave_agents)

result = {
  'count_after_registration': count_after_registration,
  'count_after_unregistration': count_after_unregistration,
  'final_count': final_count,
  'remaining_agent_ids': list(orchestrator.slave_agents.keys())
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
      expect(result.count_after_registration).toBe(2);
      expect(result.count_after_unregistration).toBe(1);
      expect(result.final_count).toBe(1);
      expect(result.remaining_agent_ids).toEqual(["lifecycle_agent_2"]);
    });

    test("should handle agent unregistration with active tasks", async () => {
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
orchestrator.register_slave_agent('busy_agent', ['testing'])
orchestrator.slave_agents['busy_agent'].status = AgentStatus.BUSY
orchestrator.slave_agents['busy_agent'].current_task = 'active_task_123'
orchestrator.task_assignments['active_task_123'] = 'busy_agent'

task_assignments_before = dict(orchestrator.task_assignments)
agent_status_before = orchestrator.slave_agents['busy_agent'].status.value

# Unregister agent with active task
orchestrator.unregister_slave_agent('busy_agent')

result = {
  'task_assignments_before': task_assignments_before,
  'task_assignments_after': orchestrator.task_assignments,
  'agent_status_before': agent_status_before,
  'agent_still_exists': 'busy_agent' in orchestrator.slave_agents
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
      expect(result.task_assignments_before).toEqual({
        active_task_123: "busy_agent",
      });
      expect(result.task_assignments_after).toEqual({}); // Task assignment should be removed
      expect(result.agent_still_exists).toBe(false);
    });
  });

  describe("Agent Status Synchronization", () => {
    test("should maintain consistent agent state across operations", async () => {
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

# Register agent and verify initial state
orchestrator.register_slave_agent('state_agent', ['testing', 'analysis'])

initial_state = {
  'status': orchestrator.slave_agents['state_agent'].status.value,
  'capabilities': list(orchestrator.slave_agents['state_agent'].capabilities),
  'health_score': orchestrator.slave_agents['state_agent'].health_score,
  'current_task': orchestrator.slave_agents['state_agent'].current_task
}

# Modify agent state
orchestrator.slave_agents['state_agent'].status = AgentStatus.BUSY
orchestrator.slave_agents['state_agent'].current_task = 'test_task_456'
orchestrator.slave_agents['state_agent'].health_score = 85

modified_state = {
  'status': orchestrator.slave_agents['state_agent'].status.value,
  'capabilities': list(orchestrator.slave_agents['state_agent'].capabilities),
  'health_score': orchestrator.slave_agents['state_agent'].health_score,
  'current_task': orchestrator.slave_agents['state_agent'].current_task
}

result = {
  'initial_state': initial_state,
  'modified_state': modified_state,
  'state_consistency': initial_state['capabilities'] == modified_state['capabilities']
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
      expect(result.initial_state.status).toBe("ready");
      expect(result.modified_state.status).toBe("busy");
      expect(result.modified_state.current_task).toBe("test_task_456");
      expect(result.modified_state.health_score).toBe(85);
      expect(result.state_consistency).toBe(true); // Capabilities should remain the same
    });

    test("should provide accurate agent counts and statistics", async () => {
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

# Register agents with different states
orchestrator.register_slave_agent('ready_agent', ['testing'])
orchestrator.register_slave_agent('busy_agent', ['analysis'])
orchestrator.register_slave_agent('unhealthy_agent', ['debugging'])

orchestrator.slave_agents['ready_agent'].status = AgentStatus.READY
orchestrator.slave_agents['ready_agent'].health_score = 90

orchestrator.slave_agents['busy_agent'].status = AgentStatus.BUSY
orchestrator.slave_agents['busy_agent'].health_score = 85
orchestrator.slave_agents['busy_agent'].current_task = 'busy_task'

orchestrator.slave_agents['unhealthy_agent'].status = AgentStatus.UNAVAILABLE
orchestrator.slave_agents['unhealthy_agent'].health_score = 40

# Get system status
system_status = orchestrator.get_system_status()

result = {
  'system_status': system_status,
  'expected_total': 3,
  'expected_healthy': 2,  // ready_agent and busy_agent
  'expected_busy': 1,
  'expected_unhealthy': 1
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
      expect(result.system_status.total_agents).toBe(result.expected_total);
      expect(result.system_status.healthy_agents).toBe(result.expected_healthy);
      expect(result.system_status.busy_agents).toBe(result.expected_busy);
      expect(result.system_status.unhealthy_agents).toBe(
        result.expected_unhealthy,
      );
      expect(result.system_status.system_health).toBeGreaterThan(0);
    });
  });

  describe("End-to-End Agent Registration Flow", () => {
    test("should complete full agent registration and status reporting cycle", async () => {
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

# Keep orchestrator running
try:
  while True:
    time.sleep(1)
except KeyboardInterrupt:
  orchestrator.stop()
      `,
        ],
        {
          cwd: testProjectDir,
          detached: true,
          stdio: "ignore",
        },
      );

      // Wait for orchestrator to start
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Start agent
      agentProcess1 = spawn(
        "python3",
        [
          "-c",
          `
import sys
sys.path.insert(0, '${path.dirname(agentScript)}')
from slave_agent_wrapper import SlaveAgentWrapper
import time

agent = SlaveAgentWrapper(
  agent_id='e2e_test_agent',
  project_dir='${testProjectDir}',
  capabilities=['testing', 'analysis']
)

if agent.initialize():
  agent.start()
  time.sleep(3)  # Let agent run briefly
  agent.stop()
else:
  print("Agent initialization failed")
      `,
        ],
        {
          cwd: testProjectDir,
          stdio: "pipe",
        },
      );

      let agentStdout = "";
      agentProcess1.stdout.on("data", (data) => {
        agentStdout += data.toString();
      });

      await new Promise((resolve) => {
        agentProcess1.on("close", (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      // Check that agent was registered with orchestrator
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
  'agent_registered': 'e2e_test_agent' in orchestrator.slave_agents,
  'agent_capabilities': list(orchestrator.slave_agents.get('e2e_test_agent', {}).capabilities) if 'e2e_test_agent' in orchestrator.slave_agents else [],
  'total_agents': len(orchestrator.slave_agents)
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
      expect(checkResult.agent_capabilities).toEqual(["testing", "analysis"]);
      expect(checkResult.total_agents).toBeGreaterThanOrEqual(1);
    });
  });
});
