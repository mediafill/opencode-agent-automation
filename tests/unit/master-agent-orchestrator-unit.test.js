import { jest } from "@jest/globals";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("MasterAgentOrchestrator Unit Tests", () => {
  let testProjectDir;
  let claudeDir;
  let orchestratorProcess;
  let mockVectorDb;
  let mockPsutil;

  beforeAll(async () => {
    testProjectDir = path.join(
      os.tmpdir(),
      "master-orchestrator-test-" + Date.now(),
    );
    claudeDir = path.join(testProjectDir, ".claude");

    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(path.join(claudeDir, "logs"), { recursive: true });
    await fs.mkdir(path.join(claudeDir, "vector_db"), { recursive: true });
  });

  beforeEach(async () => {
    // Reset any config files
    const configFile = path.join(claudeDir, "master_orchestrator_config.json");
    const messageQueueFile = path.join(claudeDir, "message_queue.json");

    try {
      await fs.unlink(configFile);
    } catch (e) {
      // Ignore if file doesn't exist
    }
    try {
      await fs.unlink(messageQueueFile);
    } catch (e) {
      // Ignore if file doesn't exist
    }

    // Mock external dependencies
    mockVectorDb = {
      store_task_history: jest.fn().mockResolvedValue("doc_id"),
      query_similar_solutions: jest.fn().mockResolvedValue([]),
    };

    mockPsutil = {
      process_iter: jest.fn().mockReturnValue([]),
    };

    // Mock the imports
    jest.doMock("vector_database", () => ({
      VectorDatabase: jest.fn().mockImplementation(() => mockVectorDb),
    }));

    jest.doMock("psutil", () => mockPsutil);
  });

  afterEach(async () => {
    if (orchestratorProcess && !orchestratorProcess.killed) {
      orchestratorProcess.kill("SIGTERM");
      await new Promise((resolve) => {
        orchestratorProcess.on("close", resolve);
      });
    }

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

  describe("Initialization and Configuration", () => {
    test("should initialize with default configuration", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "master_agent_orchestrator.py",
      );

      orchestratorScript = spawn(
        "python3",
        [
          "-c",
          `
import sys
sys.path.insert(0, '${path.dirname(orchestratorScript)}')
from master_agent_orchestrator import MasterAgentOrchestrator
import json

# Test initialization
orchestrator = MasterAgentOrchestrator('${testProjectDir}')

# Verify default configuration
config = {
  'health_check_interval': orchestrator.health_check_interval,
  'agent_timeout': orchestrator.agent_timeout,
  'max_slave_agents': orchestrator.max_slave_agents,
  'master_id': orchestrator.master_id
}

print(json.dumps(config))
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

      const config = JSON.parse(stdout.trim());
      expect(config.health_check_interval).toBe(30);
      expect(config.agent_timeout).toBe(120);
      expect(config.max_slave_agents).toBe(10);
      expect(config.master_id).toMatch(/^master_[a-f0-9]{8}$/);
    });

    test("should load configuration from file", async () => {
      const configFile = path.join(
        claudeDir,
        "master_orchestrator_config.json",
      );
      const customConfig = {
        health_check_interval: 60,
        agent_timeout: 300,
        max_slave_agents: 5,
        master_id: "test_master_123",
      };

      await fs.writeFile(configFile, JSON.stringify(customConfig, null, 2));

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

config = {
  'health_check_interval': orchestrator.health_check_interval,
  'agent_timeout': orchestrator.agent_timeout,
  'max_slave_agents': orchestrator.max_slave_agents
}

print(json.dumps(config))
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

      const config = JSON.parse(stdout.trim());
      expect(config.health_check_interval).toBe(60);
      expect(config.agent_timeout).toBe(300);
      expect(config.max_slave_agents).toBe(5);
    });

    test("should create required directories", async () => {
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
import os

orchestrator = MasterAgentOrchestrator('${testProjectDir}')

# Check directories exist
dirs_exist = {
  'claude_dir': os.path.exists(orchestrator.claude_dir),
  'logs_dir': os.path.exists(os.path.join(orchestrator.claude_dir, 'logs')),
  'vector_db_dir': os.path.exists(os.path.join(orchestrator.claude_dir, 'vector_db'))
}

print(str(dirs_exist))
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

      const dirsExist = eval(stdout.trim());
      expect(dirsExist.claude_dir).toBe(true);
      expect(dirsExist.logs_dir).toBe(true);
      expect(dirsExist.vector_db_dir).toBe(true);
    });
  });

  describe("Agent Registration and Management", () => {
    test("should register slave agents successfully", async () => {
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

# Test agent registration
capabilities = ['testing', 'analysis']
success = orchestrator.register_slave_agent('test_agent_1', capabilities)

result = {
  'success': success,
  'agent_count': len(orchestrator.slave_agents),
  'agent_registered': 'test_agent_1' in orchestrator.slave_agents,
  'agent_capabilities': list(orchestrator.slave_agents.get('test_agent_1', {}).capabilities) if 'test_agent_1' in orchestrator.slave_agents else []
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
      expect(result.success).toBe(true);
      expect(result.agent_count).toBe(1);
      expect(result.agent_registered).toBe(true);
      expect(result.agent_capabilities).toEqual(["testing", "analysis"]);
    });

    test("should reject registration when at max capacity", async () => {
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

# Register agents up to limit
orchestrator.register_slave_agent('agent_1', [])
orchestrator.register_slave_agent('agent_2', [])

# Try to register one more
success = orchestrator.register_slave_agent('agent_3', [])

result = {
  'success': success,
  'agent_count': len(orchestrator.slave_agents)
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
      expect(result.success).toBe(false);
      expect(result.agent_count).toBe(2);
    });

    test("should prevent duplicate agent registration", async () => {
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

# Register same agent twice
success1 = orchestrator.register_slave_agent('duplicate_agent', ['testing'])
success2 = orchestrator.register_slave_agent('duplicate_agent', ['analysis'])

result = {
  'success1': success1,
  'success2': success2,
  'agent_count': len(orchestrator.slave_agents)
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
      expect(result.success1).toBe(true);
      expect(result.success2).toBe(false);
      expect(result.agent_count).toBe(1);
    });

    test("should unregister agents correctly", async () => {
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

# Register and then unregister agent
orchestrator.register_slave_agent('test_agent', ['testing'])
agent_count_before = len(orchestrator.slave_agents)

orchestrator.unregister_slave_agent('test_agent')
agent_count_after = len(orchestrator.slave_agents)

result = {
  'count_before': agent_count_before,
  'count_after': agent_count_after,
  'agent_still_exists': 'test_agent' in orchestrator.slave_agents
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
      expect(result.count_before).toBe(1);
      expect(result.count_after).toBe(0);
      expect(result.agent_still_exists).toBe(false);
    });
  });

  describe("Task Assignment and Load Balancing", () => {
    test("should assign tasks to available agents", async () => {
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

# Register a ready agent
orchestrator.register_slave_agent('ready_agent', ['testing'])
orchestrator.slave_agents['ready_agent'].status = AgentStatus.READY

# Assign a task
task_data = {'description': 'Test task', 'type': 'testing'}
assigned_agent = orchestrator.assign_task_to_agent('task_123', task_data)

result = {
  'assigned_agent': assigned_agent,
  'agent_status': orchestrator.slave_agents['ready_agent'].status.value,
  'current_task': orchestrator.slave_agents['ready_agent'].current_task,
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
      expect(result.assigned_agent).toBe("ready_agent");
      expect(result.agent_status).toBe("busy");
      expect(result.current_task).toBe("task_123");
      expect(result.task_assignments).toEqual({ task_123: "ready_agent" });
    });

    test("should not assign tasks when no agents available", async () => {
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

# Register a busy agent
orchestrator.register_slave_agent('busy_agent', ['testing'])
orchestrator.slave_agents['busy_agent'].status = AgentStatus.BUSY

# Try to assign a task
task_data = {'description': 'Test task', 'type': 'testing'}
assigned_agent = orchestrator.assign_task_to_agent('task_456', task_data)

result = {
  'assigned_agent': assigned_agent,
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
      expect(result.assigned_agent).toBeNull();
      expect(result.task_assignments).toEqual({});
    });

    test("should use load balancer to select best agent", async () => {
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

# Register multiple agents with different health scores
orchestrator.register_slave_agent('healthy_agent', ['testing'])
orchestrator.register_slave_agent('unhealthy_agent', ['testing'])

orchestrator.slave_agents['healthy_agent'].status = AgentStatus.READY
orchestrator.slave_agents['healthy_agent'].health_score = 90

orchestrator.slave_agents['unhealthy_agent'].status = AgentStatus.READY
orchestrator.slave_agents['unhealthy_agent'].health_score = 50

# Assign task - should prefer healthy agent
task_data = {'description': 'Test task', 'type': 'testing'}
assigned_agent = orchestrator.assign_task_to_agent('task_789', task_data)

result = {
  'assigned_agent': assigned_agent,
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
      // Load balancer should prefer the healthier agent
      expect(result.assigned_agent).toBe("healthy_agent");
      expect(result.healthy_score).toBeGreaterThan(result.unhealthy_score);
    });
  });

  describe("Message Handling and Communication", () => {
    test("should handle task status updates correctly", async () => {
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
orchestrator.register_slave_agent('test_agent', ['testing'])
orchestrator.slave_agents['test_agent'].status = AgentStatus.BUSY
orchestrator.slave_agents['test_agent'].current_task = 'task_123'
orchestrator.task_assignments['task_123'] = 'test_agent'

# Simulate task completion message
message = AgentMessage(
  MessageType.TASK_STATUS_UPDATE,
  'test_agent',
  orchestrator.master_id,
  {
    'task_id': 'task_123',
    'status': 'completed',
    'message': 'Task completed successfully'
  }
)

orchestrator._handle_task_status_update(message)

result = {
  'agent_status': orchestrator.slave_agents['test_agent'].status.value,
  'current_task': orchestrator.slave_agents['test_agent'].current_task,
  'task_assignments': orchestrator.task_assignments,
  'completed_tasks': orchestrator.slave_agents['test_agent'].resource_usage['tasks_completed']
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
      expect(result.agent_status).toBe("ready");
      expect(result.current_task).toBeNull();
      expect(result.task_assignments).toEqual({});
      expect(result.completed_tasks).toBe(1);
    });

    test("should handle health check responses", async () => {
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
from datetime import datetime

orchestrator = MasterAgentOrchestrator('${testProjectDir}')

# Register agent
orchestrator.register_slave_agent('health_test_agent', ['testing'])

# Simulate health check response
message = AgentMessage(
  MessageType.HEALTH_CHECK,
  'health_test_agent',
  orchestrator.master_id,
  {
    'cpu_percent': 45.5,
    'memory_mb': 256.7,
    'timestamp': datetime.now().isoformat()
  }
)

orchestrator._handle_health_check(message)

result = {
  'health_score': orchestrator.slave_agents['health_test_agent'].health_score,
  'cpu_usage': orchestrator.slave_agents['health_test_agent'].resource_usage['cpu_percent'],
  'memory_usage': orchestrator.slave_agents['health_test_agent'].resource_usage['memory_mb']
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
      expect(result.health_score).toBeGreaterThan(0);
      expect(result.cpu_usage).toBe(45.5);
      expect(result.memory_usage).toBe(256.7);
    });

    test("should handle error reports from agents", async () => {
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

# Register agent with high health score
orchestrator.register_slave_agent('error_agent', ['testing'])
orchestrator.slave_agents['error_agent'].health_score = 100

# Simulate error report
message = AgentMessage(
  MessageType.ERROR_REPORT,
  'error_agent',
  orchestrator.master_id,
  {
    'error_type': 'runtime_error',
    'message': 'Task execution failed',
    'details': {'task_id': 'failed_task_123'}
  }
)

orchestrator._handle_error_report(message)

result = {
  'health_score_before_penalty': 100,
  'health_score_after_penalty': orchestrator.slave_agents['error_agent'].health_score
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
      expect(result.health_score_after_penalty).toBeLessThan(
        result.health_score_before_penalty,
      );
    });
  });

  describe("Health Monitoring and Auto-restart", () => {
    test("should monitor agent health and detect timeouts", async () => {
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
orchestrator.agent_timeout = 1  # 1 second timeout for testing

# Register agent and set old heartbeat
orchestrator.register_slave_agent('timeout_agent', ['testing'])
orchestrator.slave_agents['timeout_agent'].last_heartbeat = datetime.now() - timedelta(seconds=5)

# Run health check
orchestrator._perform_health_checks()

result = {
  'agent_status': orchestrator.slave_agents['timeout_agent'].status.value,
  'health_score': orchestrator.slave_agents['timeout_agent'].health_score
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
      expect(result.agent_status).toBe("unavailable");
      expect(result.health_score).toBe(0);
    });

    test("should clean up failed agents", async () => {
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

# Register agents - one healthy, one failed
orchestrator.register_slave_agent('healthy_agent', ['testing'])
orchestrator.register_slave_agent('failed_agent', ['testing'])

orchestrator.slave_agents['healthy_agent'].health_score = 80
orchestrator.slave_agents['failed_agent'].health_score = 0
orchestrator.slave_agents['failed_agent'].status = AgentStatus.FAILED

agent_count_before = len(orchestrator.slave_agents)
orchestrator._cleanup_failed_agents()
agent_count_after = len(orchestrator.slave_agents)

result = {
  'count_before': agent_count_before,
  'count_after': agent_count_after,
  'healthy_agent_exists': 'healthy_agent' in orchestrator.slave_agents,
  'failed_agent_exists': 'failed_agent' in orchestrator.slave_agents
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
      expect(result.count_before).toBe(2);
      expect(result.count_after).toBe(1);
      expect(result.healthy_agent_exists).toBe(true);
      expect(result.failed_agent_exists).toBe(false);
    });
  });

  describe("System Status and Reporting", () => {
    test("should provide comprehensive system status", async () => {
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
orchestrator.slave_agents['busy_agent'].current_task = 'task_123'

orchestrator.slave_agents['unhealthy_agent'].status = AgentStatus.UNAVAILABLE
orchestrator.slave_agents['unhealthy_agent'].health_score = 30

# Add task assignment
orchestrator.task_assignments['task_123'] = 'busy_agent'

# Get system status
status = orchestrator.get_system_status()

print(json.dumps(status))
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

      const status = JSON.parse(stdout.trim());
      expect(status.master_id).toMatch(/^master_[a-f0-9]{8}$/);
      expect(status.total_agents).toBe(3);
      expect(status.healthy_agents).toBe(2); // ready_agent and busy_agent
      expect(status.busy_agents).toBe(1);
      expect(status.unhealthy_agents).toBe(1);
      expect(status.active_tasks).toBe(1);
      expect(status.system_health).toBeGreaterThan(0);
    });
  });
});
