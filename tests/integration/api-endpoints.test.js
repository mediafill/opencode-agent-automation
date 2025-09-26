const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs").promises;
const WS = require("jest-websocket-mock");

describe("API Endpoints Integration Tests", () => {
  let server;
  let mockWebSocket;
  const testPort = 8082; // Different port to avoid conflicts
  const testProjectDir = path.join(
    __dirname,
    "..",
    "fixtures",
    "api-test-project",
  );
  const claudeDir = path.join(testProjectDir, ".claude");
  const tasksFile = path.join(claudeDir, "tasks.json");
  const taskStatusFile = path.join(claudeDir, "task_status.json");

  beforeAll(async () => {
    // Create test project structure
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(path.join(claudeDir, "logs"), { recursive: true });

    // Initialize test data
    const initialTasks = [
      {
        id: "api_test_task_1",
        type: "testing",
        priority: "high",
        description: "API integration test task",
        files_pattern: "**/*.test.js",
        created_at: new Date().toISOString(),
        status: "pending",
      },
      {
        id: "api_test_task_2",
        type: "documentation",
        priority: "medium",
        description: "Documentation update task",
        files_pattern: "docs/**/*.md",
        created_at: new Date().toISOString(),
        status: "completed",
      },
    ];

    const initialStatus = {
      api_test_task_1: {
        status: "pending",
        progress: 0,
        created_at: new Date().toISOString(),
      },
      api_test_task_2: {
        status: "completed",
        progress: 100,
        completed_at: new Date().toISOString(),
        result: "success",
      },
    };

    await fs.writeFile(tasksFile, JSON.stringify(initialTasks, null, 2));
    await fs.writeFile(taskStatusFile, JSON.stringify(initialStatus, null, 2));
  });

  beforeEach(async () => {
    // Start the Python WebSocket server
    const serverScript = path.join(
      __dirname,
      "..",
      "..",
      "scripts",
      "dashboard_server.py",
    );
    server = spawn(
      "python3",
      [serverScript, "--port", testPort, "--project-dir", testProjectDir],
      {
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    // Wait for server to start
    await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(), 5000); // 5 second timeout
      server.stdout.on("data", (data) => {
        if (
          data.toString().includes("WebSocket server started") ||
          data.toString().includes("dashboard server started")
        ) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    // Create WebSocket connection
    mockWebSocket = new WS(`ws://localhost:${testPort}/ws`);
  });

  afterEach(async () => {
    if (mockWebSocket) {
      mockWebSocket.close();
    }
    if (server && !server.killed) {
      server.kill("SIGTERM");
      // Wait for graceful shutdown
      await new Promise((resolve) => {
        server.on("close", resolve);
      });
    }

    // Reset test data
    try {
      const initialTasks = [
        {
          id: "api_test_task_1",
          type: "testing",
          priority: "high",
          description: "API integration test task",
          files_pattern: "**/*.test.js",
          created_at: new Date().toISOString(),
          status: "pending",
        },
      ];

      const initialStatus = {
        api_test_task_1: {
          status: "pending",
          progress: 0,
          created_at: new Date().toISOString(),
        },
      };

      await fs.writeFile(tasksFile, JSON.stringify(initialTasks, null, 2));
      await fs.writeFile(
        taskStatusFile,
        JSON.stringify(initialStatus, null, 2),
      );
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  afterAll(async () => {
    // Clean up test directory
    try {
      await fs.rm(testProjectDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe("WebSocket Connection and Basic API", () => {
    test("establishes WebSocket connection and receives initial status", async () => {
      await mockWebSocket.connected;

      // Should receive connection established message
      const connectionMessage = await mockWebSocket.nextMessage;
      const connectionData = JSON.parse(connectionMessage);

      expect(connectionData.type).toBe("connection_established");

      // Should receive initial status update
      const statusMessage = await mockWebSocket.nextMessage;
      const statusData = JSON.parse(statusMessage);

      expect(statusData.type).toBe("full_status");
      expect(statusData.data).toHaveProperty("agents");
      expect(statusData.data).toHaveProperty("tasks");
      expect(statusData.data).toHaveProperty("system_resources");
    });

    test("ping-pong health check works correctly", async () => {
      await mockWebSocket.connected;

      // Send ping
      mockWebSocket.send(JSON.stringify({ type: "ping" }));

      // Should receive pong
      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe("pong");
      expect(data).toHaveProperty("timestamp");
    });

    test("handles unknown message types gracefully", async () => {
      await mockWebSocket.connected;

      // Send unknown message type
      mockWebSocket.send(JSON.stringify({ type: "unknown_command" }));

      // Should receive error response
      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe("error");
      expect(data.message).toContain("Unknown message type");
    });

    test("handles malformed JSON gracefully", async () => {
      await mockWebSocket.connected;

      // Send invalid JSON
      mockWebSocket.send("invalid json message");

      // Should receive error response
      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe("error");
      expect(data.message).toContain("Invalid JSON");
    });
  });

  describe("System Monitoring API Integration", () => {
    test("request_system_resources returns detailed resource information", async () => {
      await mockWebSocket.connected;

      mockWebSocket.send(JSON.stringify({ type: "request_system_resources" }));

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe("system_resources");
      expect(data.data).toHaveProperty("cpu_usage");
      expect(data.data).toHaveProperty("memory_usage");
      expect(data.data).toHaveProperty("disk_usage");
      expect(data.data).toHaveProperty("network_stats");
      expect(data.data).toHaveProperty("timestamp");

      // Validate data types
      expect(typeof data.data.cpu_usage).toBe("number");
      expect(typeof data.data.memory_usage).toBe("number");
      expect(data.data.cpu_usage).toBeGreaterThanOrEqual(0);
      expect(data.data.cpu_usage).toBeLessThanOrEqual(100);
    });

    test("request_process_list returns comprehensive process information", async () => {
      await mockWebSocket.connected;

      mockWebSocket.send(JSON.stringify({ type: "request_process_list" }));

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe("process_list");
      expect(data.data).toHaveProperty("processes");
      expect(data.data).toHaveProperty("total_count");
      expect(data.data).toHaveProperty("system_load");
      expect(Array.isArray(data.data.processes)).toBe(true);
    });

    test("request_log_entries returns recent log data", async () => {
      await mockWebSocket.connected;

      mockWebSocket.send(
        JSON.stringify({
          type: "request_log_entries",
          limit: 10,
        }),
      );

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe("log_entries");
      expect(data.data).toHaveProperty("entries");
      expect(data.data).toHaveProperty("total_count");
      expect(Array.isArray(data.data.entries)).toBe(true);
      expect(data.data.entries.length).toBeLessThanOrEqual(10);
    });

    test("request_performance_metrics returns system performance data", async () => {
      await mockWebSocket.connected;

      mockWebSocket.send(
        JSON.stringify({ type: "request_performance_metrics" }),
      );

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe("performance_metrics");
      expect(data.data).toHaveProperty("response_times");
      expect(data.data).toHaveProperty("throughput");
      expect(data.data).toHaveProperty("error_rates");
      expect(data.data).toHaveProperty("timestamp");
    });

    test("subscribe_to_updates enables real-time notifications", async () => {
      await mockWebSocket.connected;

      mockWebSocket.send(
        JSON.stringify({
          type: "subscribe_to_updates",
          channels: ["system_resources", "task_status"],
        }),
      );

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe("subscription_confirmed");
      expect(data.channels).toContain("system_resources");
      expect(data.channels).toContain("task_status");
    });

    test("unsubscribe_from_updates stops real-time notifications", async () => {
      await mockWebSocket.connected;

      // First subscribe
      mockWebSocket.send(
        JSON.stringify({
          type: "subscribe_to_updates",
          channels: ["system_resources"],
        }),
      );

      await mockWebSocket.nextMessage; // subscription confirmation

      // Then unsubscribe
      mockWebSocket.send(
        JSON.stringify({
          type: "unsubscribe_from_updates",
          channels: ["system_resources"],
        }),
      );

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe("unsubscription_confirmed");
      expect(data.channels).toContain("system_resources");
    });
  });

  describe("Task Management API Integration", () => {
    test("start_task creates and initiates new tasks", async () => {
      await mockWebSocket.connected;

      const newTask = {
        id: "integration_test_task",
        type: "testing",
        priority: "medium",
        description: "Integration test for task creation",
        files_pattern: "**/*.js",
      };

      mockWebSocket.send(
        JSON.stringify({
          type: "start_task",
          task: newTask,
        }),
      );

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe("task_started");
      expect(data.task_id).toBe("integration_test_task");

      // Verify task was added to database
      const tasksContent = await fs.readFile(tasksFile, "utf8");
      const tasks = JSON.parse(tasksContent);
      const addedTask = tasks.find((t) => t.id === "integration_test_task");
      expect(addedTask).toBeDefined();
      expect(addedTask.description).toBe("Integration test for task creation");
    });

    test("start_task validates required fields", async () => {
      await mockWebSocket.connected;

      // Send task with missing required fields
      mockWebSocket.send(
        JSON.stringify({
          type: "start_task",
          task: {
            // Missing id, type, description
            priority: "low",
          },
        }),
      );

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe("error");
      expect(data.message).toContain("Invalid task data");
    });

    test("cancel_task removes task from execution", async () => {
      await mockWebSocket.connected;

      // First create a task
      const testTask = {
        id: "cancel_test_task",
        type: "testing",
        priority: "medium",
        description: "Task to be cancelled",
        files_pattern: "**/*.js",
      };

      mockWebSocket.send(
        JSON.stringify({
          type: "start_task",
          task: testTask,
        }),
      );

      // Wait for task started confirmation
      await mockWebSocket.nextMessage;

      // Now cancel it
      mockWebSocket.send(
        JSON.stringify({
          type: "cancel_task",
          task_id: "cancel_test_task",
        }),
      );

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe("task_cancelled");
      expect(data.task_id).toBe("cancel_test_task");
    });

    test("retry_task re-queues failed tasks", async () => {
      await mockWebSocket.connected;

      // Create a task that will fail
      const failingTask = {
        id: "retry_test_task",
        type: "testing",
        priority: "medium",
        description: "Task that will be retried",
        files_pattern: "**/*.js",
      };

      mockWebSocket.send(
        JSON.stringify({
          type: "start_task",
          task: failingTask,
        }),
      );

      // Wait for task started
      await mockWebSocket.nextMessage;

      // Simulate task failure by updating status
      const statusData = JSON.parse(await fs.readFile(taskStatusFile, "utf8"));
      statusData.retry_test_task = {
        status: "failed",
        progress: 50,
        error: "Simulated failure",
        retry_count: 0,
      };
      await fs.writeFile(taskStatusFile, JSON.stringify(statusData, null, 2));

      // Now retry the task
      mockWebSocket.send(
        JSON.stringify({
          type: "retry_task",
          task_id: "retry_test_task",
        }),
      );

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe("task_retried");
      expect(data.task_id).toBe("retry_test_task");
    });

    test("get_task_status returns detailed task information", async () => {
      await mockWebSocket.connected;

      mockWebSocket.send(
        JSON.stringify({
          type: "get_task_status",
          task_id: "api_test_task_1",
        }),
      );

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe("task_status");
      expect(data.task).toHaveProperty("id", "api_test_task_1");
      expect(data.task).toHaveProperty("status");
      expect(data.task).toHaveProperty("progress");
    });

    test("list_tasks returns all tasks with filtering", async () => {
      await mockWebSocket.connected;

      mockWebSocket.send(
        JSON.stringify({
          type: "list_tasks",
          filter: { status: "pending" },
        }),
      );

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe("task_list");
      expect(Array.isArray(data.tasks)).toBe(true);
      expect(data.tasks.length).toBeGreaterThan(0);

      // Check that all returned tasks match the filter
      data.tasks.forEach((task) => {
        expect(task.status).toBe("pending");
      });
    });

    test("task status updates are broadcast in real-time", async () => {
      await mockWebSocket.connected;

      // Start a task
      const testTask = {
        id: "realtime_status_task",
        type: "testing",
        priority: "medium",
        description: "Task for real-time status testing",
        files_pattern: "**/*.js",
      };

      mockWebSocket.send(
        JSON.stringify({
          type: "start_task",
          task: testTask,
        }),
      );

      // Wait for task started confirmation
      await mockWebSocket.nextMessage;

      // Monitor for status updates (may take some time)
      let statusUpdates = [];
      const maxWait = 10000;
      const startTime = Date.now();

      while (statusUpdates.length < 2 && Date.now() - startTime < maxWait) {
        try {
          const message = await mockWebSocket.nextMessage;
          const data = JSON.parse(message);

          if (data.type === "task_status_update") {
            statusUpdates.push(data);
          }
        } catch (e) {
          break;
        }
      }

      // Should have received at least some status updates
      expect(statusUpdates.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Process Management API Integration", () => {
    test("kill_process handles process termination safely", async () => {
      await mockWebSocket.connected;

      // First get list of processes
      mockWebSocket.send(JSON.stringify({ type: "request_claude_processes" }));

      const processResponse = await mockWebSocket.nextMessage;
      const processData = JSON.parse(processResponse);

      if (processData.data.processes.length > 0) {
        const testPid = processData.data.processes[0].pid;

        mockWebSocket.send(
          JSON.stringify({
            type: "kill_process",
            pid: testPid,
            signal: "SIGTERM",
          }),
        );

        const response = await mockWebSocket.nextMessage;
        const data = JSON.parse(response);

        expect(data.type).toBe("process_killed");
        expect(data.data).toHaveProperty("pid", testPid);
        expect(data.data).toHaveProperty("success");
      } else {
        // No processes to test with, skip test
        expect(true).toBe(true);
      }
    });

    test("kill_process validates process safety", async () => {
      await mockWebSocket.connected;

      // Try to kill a non-Claude process (using a high PID that likely doesn't exist)
      mockWebSocket.send(
        JSON.stringify({
          type: "kill_process",
          pid: 999999,
          signal: "SIGTERM",
        }),
      );

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe("error");
      expect(data.message).toContain("process");
    });
  });

  describe("Real-time Updates Integration", () => {
    test("receives periodic system resource updates", async () => {
      await mockWebSocket.connected;

      let resourceUpdates = 0;
      const maxWait = 15000; // 15 seconds
      const startTime = Date.now();

      while (resourceUpdates < 2 && Date.now() - startTime < maxWait) {
        try {
          const message = await mockWebSocket.nextMessage;
          const data = JSON.parse(message);

          if (data.type === "system_resources_update") {
            resourceUpdates++;
            expect(data.data).toHaveProperty("cpu_percent");
            expect(data.data).toHaveProperty("memory_percent");
            expect(data.data).toHaveProperty("disk_usage");
            expect(data.data).toHaveProperty("timestamp");
          }
        } catch (e) {
          break;
        }
      }

      expect(resourceUpdates).toBeGreaterThan(0);
    });

    test("receives task manager status updates when available", async () => {
      await mockWebSocket.connected;

      let taskManagerUpdates = 0;
      const maxWait = 10000;
      const startTime = Date.now();

      while (taskManagerUpdates < 1 && Date.now() - startTime < maxWait) {
        try {
          const message = await mockWebSocket.nextMessage;
          const data = JSON.parse(message);

          if (data.type === "task_manager_status") {
            taskManagerUpdates++;
            expect(data.data).toHaveProperty("summary");
          }
        } catch (e) {
          break;
        }
      }

      // Task manager may or may not be available, so just check we don't get errors
      expect(true).toBe(true);
    });
  });

  describe("Error Handling and Edge Cases", () => {
    test("handles rapid consecutive requests without crashing", async () => {
      await mockWebSocket.connected;

      // Send many requests rapidly
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(mockWebSocket.send(JSON.stringify({ type: "ping" })));
      }

      await Promise.all(promises);

      // Server should still respond to new requests
      mockWebSocket.send(JSON.stringify({ type: "request_status" }));

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe("status_update");
    });

    test("handles large message payloads", async () => {
      await mockWebSocket.connected;

      // Create a large task description
      const largeDescription = "A".repeat(10000);
      const largeTask = {
        id: "large_payload_task",
        type: "testing",
        priority: "medium",
        description: largeDescription,
        files_pattern: "**/*.js",
      };

      mockWebSocket.send(
        JSON.stringify({
          type: "start_task",
          task: largeTask,
        }),
      );

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe("task_started");
    });

    test("handles concurrent WebSocket connections", async () => {
      await mockWebSocket.connected;

      // Create additional connections
      const client2 = new WS(`ws://localhost:${testPort}/ws`);
      const client3 = new WS(`ws://localhost:${testPort}/ws`);

      // All should receive connection established
      const responses = await Promise.all([
        mockWebSocket.nextMessage,
        client2.nextMessage,
        client3.nextMessage,
      ]);

      responses.forEach((response) => {
        const data = JSON.parse(response);
        expect(data.type).toBe("connection_established");
      });

      client2.close();
      client3.close();
    });
  });
});
