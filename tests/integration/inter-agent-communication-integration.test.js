import { jest } from "@jest/globals";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("Inter-Agent Communication via Vector Database Integration Tests", () => {
  let testProjectDir;
  let claudeDir;
  let vectorDbDir;
  let orchestratorProcess;
  let agent1Process;
  let agent2Process;
  let mockVectorDb;

  beforeAll(async () => {
    testProjectDir = path.join(
      os.tmpdir(),
      "inter-agent-comm-test-" + Date.now(),
    );
    claudeDir = path.join(testProjectDir, ".claude");
    vectorDbDir = path.join(claudeDir, "vector_db");

    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(vectorDbDir, { recursive: true });
    await fs.mkdir(path.join(claudeDir, "logs"), { recursive: true });
    await fs.mkdir(path.join(claudeDir, "agent_data"), { recursive: true });
  });

  beforeEach(async () => {
    // Clean up any existing vector database files
    try {
      const files = await fs.readdir(vectorDbDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          await fs.unlink(path.join(vectorDbDir, file));
        }
      }
    } catch (e) {
      // Ignore if directory doesn't exist
    }

    // Clean up other files
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
      initialize: jest.fn().mockResolvedValue(true),
      store_task_history: jest.fn().mockResolvedValue("doc_id"),
      get_task_history: jest.fn(),
      store_learning: jest.fn().mockResolvedValue("learning_id"),
      get_learnings: jest.fn().mockReturnValue([]),
      query_similar_solutions: jest.fn().mockReturnValue([]),
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
      const files = await fs.readdir(vectorDbDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          await fs.unlink(path.join(vectorDbDir, file));
        }
      }
      const otherFiles = await fs.readdir(claudeDir);
      for (const file of otherFiles) {
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

  describe("Message Passing Infrastructure", () => {
    test("should send and receive messages between master and slave agents", async () => {
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

      // Mock vector database to simulate message passing
      let storedMessages = [];
      mockVectorDb.store_task_history.mockImplementation(async (data) => {
        storedMessages.push(data);
        return `msg_${storedMessages.length}`;
      });

      mockVectorDb.query_similar_solutions.mockImplementation(async (query) => {
        // Return messages addressed to the querying agent
        return storedMessages
          .filter(
            (msg) =>
              msg.data &&
              msg.data.recipient_id === query.replace("recipient_id:", ""),
          )
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
from master_agent_orchestrator import MasterAgentOrchestrator, AgentMessage, MessageType
import time

orchestrator = MasterAgentOrchestrator('${testProjectDir}')
orchestrator.start()

# Send a test message to agent
test_message = AgentMessage(
  MessageType.TASK_ASSIGNMENT,
  orchestrator.master_id,
  'test_agent_123',
  {
    'task_id': 'comm_test_task',
    'task_data': {'description': 'Test communication'}
  }
)
orchestrator._send_message(test_message)

time.sleep(2)  # Allow message processing
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

      // Verify message was stored
      expect(mockVectorDb.store_task_history).toHaveBeenCalled();
      expect(storedMessages.length).toBeGreaterThan(0);

      const storedMessage = storedMessages[0];
      expect(storedMessage.data.message_type).toBe("task_assignment");
      expect(storedMessage.data.sender_id).toMatch(/^master_[a-f0-9]{8}$/);
      expect(storedMessage.data.recipient_id).toBe("test_agent_123");
      expect(storedMessage.data.payload.task_id).toBe("comm_test_task");
    });

    test("should handle message TTL and expiration", async () => {
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
from datetime import datetime, timedelta

orchestrator = MasterAgentOrchestrator('${testProjectDir}')

# Create an expired message
expired_time = datetime.now() - timedelta(seconds=400)  # 400 seconds ago (TTL is 300)
expired_message = AgentMessage(
  MessageType.HEALTH_CHECK,
  'test_sender',
  orchestrator.master_id,
  {'test': 'data'}
)
expired_message.timestamp = expired_time
expired_message.ttl = 300

# Process the expired message
removed = orchestrator._process_message(expired_message)

result = {
  'message_removed': removed,
  'ttl_seconds': expired_message.ttl,
  'age_seconds': (datetime.now() - expired_message.timestamp).total_seconds()
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
      expect(result.message_removed).toBe(true); // Expired message should be removed
      expect(result.age_seconds).toBeGreaterThan(result.ttl_seconds);
    });
  });

  describe("Task Status Communication", () => {
    test("should communicate task status updates between agents", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "master_agent_orchestrator.py",
      );

      // Mock message storage and retrieval
      let messageHistory = [];
      mockVectorDb.store_task_history.mockImplementation(async (data) => {
        messageHistory.push(data);
        return `msg_${messageHistory.length}`;
      });

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
orchestrator.register_slave_agent('status_test_agent', ['testing'])
orchestrator.slave_agents['status_test_agent'].status = AgentStatus.BUSY
orchestrator.slave_agents['status_test_agent'].current_task = 'status_task_123'
orchestrator.task_assignments['status_task_123'] = 'status_test_agent'

# Simulate task completion message from agent
status_message = AgentMessage(
  MessageType.TASK_STATUS_UPDATE,
  'status_test_agent',
  orchestrator.master_id,
  {
    'task_id': 'status_task_123',
    'status': 'completed',
    'message': 'Task completed successfully',
    'duration': 45.5
  }
)

orchestrator._handle_task_status_update(status_message)

result = {
  'agent_status': orchestrator.slave_agents['status_test_agent'].status.value,
  'current_task': orchestrator.slave_agents['status_test_agent'].current_task,
  'task_assignments': orchestrator.task_assignments,
  'completed_tasks': orchestrator.slave_agents['status_test_agent'].resource_usage['tasks_completed'],
  'messages_sent': len(messageHistory)
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
      expect(result.messages_sent).toBeGreaterThan(0);
    });

    test("should handle task failure notifications", async () => {
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
orchestrator.register_slave_agent('failure_test_agent', ['testing'])
orchestrator.slave_agents['failure_test_agent'].status = AgentStatus.BUSY
orchestrator.slave_agents['failure_test_agent'].current_task = 'failure_task_456'
orchestrator.slave_agents['failure_test_agent'].health_score = 100
orchestrator.task_assignments['failure_task_456'] = 'failure_test_agent'

# Simulate task failure message
failure_message = AgentMessage(
  MessageType.TASK_STATUS_UPDATE,
  'failure_test_agent',
  orchestrator.master_id,
  {
    'task_id': 'failure_task_456',
    'status': 'failed',
    'message': 'Task execution failed: syntax error',
    'error_details': {'line': 42, 'error': 'SyntaxError'}
  }
)

orchestrator._handle_task_status_update(failure_message)

result = {
  'agent_status': orchestrator.slave_agents['failure_test_agent'].status.value,
  'current_task': orchestrator.slave_agents['failure_test_agent'].current_task,
  'task_assignments': orchestrator.task_assignments,
  'failed_tasks': orchestrator.slave_agents['failure_test_agent'].resource_usage['tasks_failed'],
  'health_score': orchestrator.slave_agents['failure_test_agent'].health_score
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
      expect(result.failed_tasks).toBe(1);
      expect(result.health_score).toBe(100); // Health score unchanged for task failure
    });
  });

  describe("Health Monitoring Communication", () => {
    test("should exchange health status between agents", async () => {
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
orchestrator.register_slave_agent('health_agent', ['testing'])

# Simulate health check response
health_message = AgentMessage(
  MessageType.HEALTH_CHECK,
  'health_agent',
  orchestrator.master_id,
  {
    'cpu_percent': 65.5,
    'memory_mb': 512.3,
    'disk_usage': {'percent': 78.2, 'free_gb': 25.1},
    'network_connections': 8,
    'timestamp': datetime.now().isoformat()
  }
)

orchestrator._handle_health_check(health_message)

result = {
  'health_score': orchestrator.slave_agents['health_agent'].health_score,
  'cpu_usage': orchestrator.slave_agents['health_agent'].resource_usage['cpu_percent'],
  'memory_usage': orchestrator.slave_agents['health_agent'].resource_usage['memory_mb'],
  'last_heartbeat_updated': orchestrator.slave_agents['health_agent'].last_heartbeat is not None
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
      expect(result.cpu_usage).toBe(65.5);
      expect(result.memory_usage).toBe(512.3);
      expect(result.last_heartbeat_updated).toBe(true);
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
error_message = AgentMessage(
  MessageType.ERROR_REPORT,
  'error_agent',
  orchestrator.master_id,
  {
    'error_type': 'runtime_error',
    'message': 'Database connection failed',
    'details': {
      'component': 'database_handler',
      'error_code': 'CONNECTION_TIMEOUT',
      'retry_count': 3
    }
  }
)

orchestrator._handle_error_report(error_message)

result = {
  'health_score_before_penalty': 100,
  'health_score_after_penalty': orchestrator.slave_agents['error_agent'].health_score,
  'penalty_applied': orchestrator.slave_agents['error_agent'].health_score < 100
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
      expect(result.penalty_applied).toBe(true);
      expect(result.health_score_after_penalty).toBeLessThan(
        result.health_score_before_penalty,
      );
    });
  });

  describe("Coordination and Control Messages", () => {
    test("should handle load balancing requests", async () => {
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

# Simulate load balancing request from agent
load_balance_message = AgentMessage(
  MessageType.LOAD_BALANCE_REQUEST,
  'busy_agent',
  orchestrator.master_id,
  {
    'reason': 'high_cpu_usage',
    'current_load': 85,
    'available_capacity': 15
  }
)

orchestrator._handle_load_balance_request(load_balance_message)

result = {
  'message_handled': True,  # Should not throw error
  'orchestrator_running': orchestrator.is_running
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
      expect(result.message_handled).toBe(true);
    });

    test("should handle resource requests from agents", async () => {
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

# Simulate resource request from agent
resource_message = AgentMessage(
  MessageType.RESOURCE_REQUEST,
  'resource_agent',
  orchestrator.master_id,
  {
    'resource_type': 'memory',
    'amount_requested': 1024,  # MB
    'priority': 'high',
    'reason': 'large_dataset_processing'
  }
)

orchestrator._handle_resource_request(resource_message)

result = {
  'message_handled': True,  # Should not throw error
  'resource_request_logged': True  # Handler exists and runs
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
      expect(result.message_handled).toBe(true);
      expect(result.resource_request_logged).toBe(true);
    });
  });

  describe("Message Persistence and Recovery", () => {
    test("should persist messages to local queue when vector DB unavailable", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "master_agent_orchestrator.py",
      );

      // Mock vector DB as unavailable
      mockVectorDb = null;

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
orchestrator.vector_db = None  # Simulate vector DB unavailable

# Send message (should use local queue)
test_message = AgentMessage(
  MessageType.TASK_ASSIGNMENT,
  orchestrator.master_id,
  'fallback_agent',
  {'task_id': 'fallback_task', 'task_data': {'test': 'data'}}
)

orchestrator._send_message(test_message)

result = {
  'message_queued_locally': len(orchestrator.message_queue) > 0,
  'queue_length': len(orchestrator.message_queue),
  'message_type': orchestrator.message_queue[0].message_type.value if orchestrator.message_queue else None
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
      expect(result.message_queued_locally).toBe(true);
      expect(result.queue_length).toBe(1);
      expect(result.message_type).toBe("task_assignment");
    });

    test("should load persisted messages on startup", async () => {
      const messageQueueFile = path.join(claudeDir, "message_queue.json");

      // Pre-populate message queue file
      const testMessages = [
        {
          message_id: "persisted_msg_1",
          message_type: "task_assignment",
          sender_id: "master_test",
          recipient_id: "agent_123",
          payload: { task_id: "startup_task", task_data: { test: "startup" } },
          timestamp: new Date().toISOString(),
          ttl: 300,
        },
      ];

      await fs.writeFile(
        messageQueueFile,
        JSON.stringify(testMessages, null, 2),
      );

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
orchestrator._load_message_queue()

result = {
  'messages_loaded': len(orchestrator.message_queue),
  'first_message_id': orchestrator.message_queue[0].message_id if orchestrator.message_queue else None,
  'first_message_type': orchestrator.message_queue[0].message_type.value if orchestrator.message_queue else None
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
      expect(result.messages_loaded).toBe(1);
      expect(result.first_message_id).toBe("persisted_msg_1");
      expect(result.first_message_type).toBe("task_assignment");
    });
  });

  describe("End-to-End Agent Communication Flow", () => {
    test("should complete full communication cycle between master and slave", async () => {
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

      // Mock vector database for communication
      let communicationLog = [];
      mockVectorDb.store_task_history.mockImplementation(async (data) => {
        communicationLog.push({ type: "sent", data });
        return `msg_${communicationLog.length}`;
      });

      mockVectorDb.query_similar_solutions.mockImplementation(async (query) => {
        // Return messages for the querying agent
        const recipientId = query.replace("recipient_id:", "");
        return communicationLog
          .filter(
            (entry) =>
              entry.data.data && entry.data.data.recipient_id === recipientId,
          )
          .map((entry, index) => ({
            metadata: { data: JSON.stringify(entry.data.data) },
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
from master_agent_orchestrator import MasterAgentOrchestrator, AgentMessage, MessageType
import time

orchestrator = MasterAgentOrchestrator('${testProjectDir}')
orchestrator.start()

# Register a test agent
orchestrator.register_slave_agent('e2e_agent', ['testing'])

# Assign a task
task_data = {'description': 'End-to-end communication test', 'type': 'testing'}
assigned_agent = orchestrator.assign_task_to_agent('e2e_task_123', task_data)

time.sleep(1)  # Allow processing
orchestrator.stop()

result = {
  'task_assigned': assigned_agent is not None,
  'assigned_to': assigned_agent,
  'messages_sent': communicationLog.length,
  'agent_registered': 'e2e_agent' in orchestrator.slave_agents
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
      expect(result.agent_registered).toBe(true);
      expect(result.messages_sent).toBeGreaterThan(0);
    });
  });
});
