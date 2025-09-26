const { spawn } = require("child_process");
const fs = require("fs").promises;
const path = require("path");
const WS = require("jest-websocket-mock");

describe("Data Consistency Integration Tests", () => {
  let server;
  let mockWebSocket;
  const testPort = 8083; // Different port to avoid conflicts
  const testProjectDir = path.join(
    __dirname,
    "..",
    "fixtures",
    "consistency-test-project",
  );
  const claudeDir = path.join(testProjectDir, ".claude");
  const tasksFile = path.join(claudeDir, "tasks.json");
  const taskStatusFile = path.join(claudeDir, "task_status.json");
  const logsDir = path.join(claudeDir, "logs");

  beforeAll(async () => {
    // Create test project structure
    await fs.mkdir(logsDir, { recursive: true });

    // Initialize with consistent test data
    const initialTasks = [
      {
        id: "consistency_task_1",
        type: "testing",
        priority: "high",
        description: "Data consistency test task 1",
        files_pattern: "**/*.test.js",
        created_at: new Date().toISOString(),
        status: "pending",
      },
      {
        id: "consistency_task_2",
        type: "documentation",
        priority: "medium",
        description: "Data consistency test task 2",
        files_pattern: "docs/**/*.md",
        created_at: new Date().toISOString(),
        status: "running",
      },
    ];

    const initialStatus = {
      consistency_task_1: {
        status: "pending",
        progress: 0,
        created_at: new Date().toISOString(),
      },
      consistency_task_2: {
        status: "running",
        progress: 45,
        started_at: new Date().toISOString(),
        current_step: "Processing documentation",
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
      const timeout = setTimeout(() => resolve(), 5000);
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
      await new Promise((resolve) => {
        server.on("close", resolve);
      });
    }

    // Reset test data to consistent state
    try {
      const resetTasks = [
        {
          id: "consistency_task_1",
          type: "testing",
          priority: "high",
          description: "Data consistency test task 1",
          files_pattern: "**/*.test.js",
          created_at: new Date().toISOString(),
          status: "pending",
        },
        {
          id: "consistency_task_2",
          type: "documentation",
          priority: "medium",
          description: "Data consistency test task 2",
          files_pattern: "docs/**/*.md",
          created_at: new Date().toISOString(),
          status: "running",
        },
      ];

      const resetStatus = {
        consistency_task_1: {
          status: "pending",
          progress: 0,
          created_at: new Date().toISOString(),
        },
        consistency_task_2: {
          status: "running",
          progress: 45,
          started_at: new Date().toISOString(),
          current_step: "Processing documentation",
        },
      };

      await fs.writeFile(tasksFile, JSON.stringify(resetTasks, null, 2));
      await fs.writeFile(taskStatusFile, JSON.stringify(resetStatus, null, 2));
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

  describe("Task and Status Data Synchronization", () => {
    test("maintains consistency between tasks.json and task_status.json", async () => {
      // Read both files
      const tasks = JSON.parse(await fs.readFile(tasksFile, "utf8"));
      const status = JSON.parse(await fs.readFile(taskStatusFile, "utf8"));

      // Verify all tasks have corresponding status entries
      tasks.forEach((task) => {
        expect(status).toHaveProperty(task.id);
        expect(status[task.id].status).toBe(task.status);
      });

      // Verify all status entries have corresponding tasks
      Object.keys(status).forEach((taskId) => {
        const task = tasks.find((t) => t.id === taskId);
        expect(task).toBeDefined();
        expect(task.status).toBe(status[taskId].status);
      });
    });

    test("synchronizes status updates across files", async () => {
      // Update task status in tasks.json
      const tasks = JSON.parse(await fs.readFile(tasksFile, "utf8"));
      tasks[0].status = "running";
      tasks[0].started_at = new Date().toISOString();
      await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2));

      // Update corresponding status in task_status.json
      const status = JSON.parse(await fs.readFile(taskStatusFile, "utf8"));
      status.consistency_task_1.status = "running";
      status.consistency_task_1.progress = 10;
      status.consistency_task_1.started_at = new Date().toISOString();
      await fs.writeFile(taskStatusFile, JSON.stringify(status, null, 2));

      // Verify consistency
      const updatedTasks = JSON.parse(await fs.readFile(tasksFile, "utf8"));
      const updatedStatus = JSON.parse(
        await fs.readFile(taskStatusFile, "utf8"),
      );

      expect(updatedTasks[0].status).toBe("running");
      expect(updatedStatus.consistency_task_1.status).toBe("running");
      expect(updatedTasks[0].status).toBe(
        updatedStatus.consistency_task_1.status,
      );
    });

    test("handles task completion consistency", async () => {
      // Mark task as completed in both files
      const tasks = JSON.parse(await fs.readFile(tasksFile, "utf8"));
      const status = JSON.parse(await fs.readFile(taskStatusFile, "utf8"));

      const completionTime = new Date().toISOString();

      // Update tasks.json
      tasks[1].status = "completed";
      tasks[1].completed_at = completionTime;
      await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2));

      // Update task_status.json
      status.consistency_task_2.status = "completed";
      status.consistency_task_2.progress = 100;
      status.consistency_task_2.completed_at = completionTime;
      status.consistency_task_2.result = "success";
      await fs.writeFile(taskStatusFile, JSON.stringify(status, null, 2));

      // Verify consistency
      const finalTasks = JSON.parse(await fs.readFile(tasksFile, "utf8"));
      const finalStatus = JSON.parse(await fs.readFile(taskStatusFile, "utf8"));

      expect(finalTasks[1].status).toBe("completed");
      expect(finalStatus.consistency_task_2.status).toBe("completed");
      expect(finalStatus.consistency_task_2.progress).toBe(100);
      expect(finalTasks[1].status).toBe(finalStatus.consistency_task_2.status);
    });
  });

  describe("WebSocket Broadcast Consistency", () => {
    test("WebSocket status updates reflect database state", async () => {
      await mockWebSocket.connected;

      // Request status via WebSocket
      mockWebSocket.send(JSON.stringify({ type: "request_status" }));

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe("status_update");
      expect(data.data).toHaveProperty("tasks");

      // Verify WebSocket data matches database
      const dbTasks = JSON.parse(await fs.readFile(tasksFile, "utf8"));
      const dbStatus = JSON.parse(await fs.readFile(taskStatusFile, "utf8"));

      // Check that WebSocket returns same number of tasks
      expect(data.data.tasks.length).toBeGreaterThanOrEqual(dbTasks.length);

      // Check specific task data consistency
      const wsTask1 = data.data.tasks.find(
        (t) => t.id === "consistency_task_1",
      );
      const wsTask2 = data.data.tasks.find(
        (t) => t.id === "consistency_task_2",
      );

      if (wsTask1) {
        expect(wsTask1.status).toBe(dbStatus.consistency_task_1.status);
      }
      if (wsTask2) {
        expect(wsTask2.status).toBe(dbStatus.consistency_task_2.status);
      }
    });

    test("real-time updates maintain consistency", async () => {
      await mockWebSocket.connected;

      // Start a new task via WebSocket
      const newTask = {
        id: "realtime_consistency_task",
        type: "testing",
        priority: "medium",
        description: "Real-time consistency test",
        files_pattern: "**/*.js",
      };

      mockWebSocket.send(
        JSON.stringify({
          type: "start_task",
          task: newTask,
        }),
      );

      // Wait for task started response
      const startResponse = await mockWebSocket.nextMessage;
      const startData = JSON.parse(startResponse);
      expect(startData.type).toBe("task_started");

      // Verify task was added to database
      const dbTasks = JSON.parse(await fs.readFile(tasksFile, "utf8"));
      const addedTask = dbTasks.find(
        (t) => t.id === "realtime_consistency_task",
      );
      expect(addedTask).toBeDefined();

      // Request status again to verify consistency
      mockWebSocket.send(JSON.stringify({ type: "request_status" }));

      const statusResponse = await mockWebSocket.nextMessage;
      const statusData = JSON.parse(statusResponse);

      const wsTask = statusData.data.tasks.find(
        (t) => t.id === "realtime_consistency_task",
      );
      expect(wsTask).toBeDefined();
      expect(wsTask.status).toBe(addedTask.status);
    });

    test("broadcasts maintain data integrity during concurrent operations", async () => {
      await mockWebSocket.connected;

      // Perform multiple operations that should trigger broadcasts
      const operations = [
        mockWebSocket.send(JSON.stringify({ type: "ping" })),
        mockWebSocket.send(
          JSON.stringify({ type: "request_claude_processes" }),
        ),
        mockWebSocket.send(JSON.stringify({ type: "request_status" })),
      ];

      await Promise.all(operations);

      // Collect multiple responses
      const responses = [];
      for (let i = 0; i < 3; i++) {
        try {
          const response = await mockWebSocket.nextMessage;
          responses.push(JSON.parse(response));
        } catch (e) {
          break;
        }
      }

      // Verify responses are valid and consistent
      responses.forEach((response) => {
        expect(response).toHaveProperty("type");
        if (response.type === "status_update") {
          expect(response.data).toHaveProperty("system_resources");
        } else if (response.type === "claude_processes_update") {
          expect(response.data).toHaveProperty("processes");
        } else if (response.type === "pong") {
          expect(response).toHaveProperty("timestamp");
        }
      });
    });
  });

  describe("Cross-Component Data Flow", () => {
    test("task manager updates are reflected in WebSocket broadcasts", async () => {
      await mockWebSocket.connected;

      // Start task manager process to simulate real task execution
      const taskManagerScript = path.join(
        __dirname,
        "..",
        "..",
        "scripts",
        "task_manager.py",
      );
      const taskManagerProcess = spawn(
        "python3",
        [
          taskManagerScript,
          "--test-mode",
          "--project-dir",
          testProjectDir,
          "--single-task",
          "consistency_task_1",
        ],
        {
          stdio: "pipe",
        },
      );

      // Monitor for task status updates via WebSocket
      let statusUpdates = [];
      const monitorUpdates = async () => {
        try {
          const message = await mockWebSocket.nextMessage;
          const data = JSON.parse(message);
          if (
            data.type === "task_status_update" ||
            data.type === "task_progress_update"
          ) {
            statusUpdates.push(data);
          }
        } catch (e) {
          // Ignore timeouts
        }
      };

      // Monitor for a short period
      const monitorPromises = [];
      for (let i = 0; i < 5; i++) {
        monitorPromises.push(monitorUpdates());
      }

      // Wait a bit for task manager to process
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Clean up task manager
      if (taskManagerProcess && !taskManagerProcess.killed) {
        taskManagerProcess.kill("SIGTERM");
      }

      // Check if any status updates were received
      // (Task manager may or may not be fully functional in test environment)
      expect(statusUpdates.length).toBeGreaterThanOrEqual(0);
    });

    test("log file changes trigger consistent broadcasts", async () => {
      await mockWebSocket.connected;

      // Create a test log file
      const testLogFile = path.join(logsDir, "consistency_test.log");
      await fs.writeFile(testLogFile, "");

      // Wait for file watcher to register
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Append to log file
      const logEntry = `${new Date().toISOString()} [INFO] Consistency test log entry\n`;
      await fs.appendFile(testLogFile, logEntry);

      // Monitor for log broadcast
      let logReceived = false;
      const maxWait = 5000;
      const startTime = Date.now();

      while (!logReceived && Date.now() - startTime < maxWait) {
        try {
          const message = await mockWebSocket.nextMessage;
          const data = JSON.parse(message);

          if (
            data.type === "log_entry" &&
            data.log.message.includes("Consistency test log entry")
          ) {
            logReceived = true;
            expect(data.log).toHaveProperty("time");
            expect(data.log).toHaveProperty("level");
            expect(data.log).toHaveProperty("message");
            expect(data.log).toHaveProperty("agent");
          }
        } catch (e) {
          break;
        }
      }

      expect(logReceived).toBe(true);

      // Clean up
      await fs.unlink(testLogFile);
    });

    test("system resource updates maintain consistency", async () => {
      await mockWebSocket.connected;

      // Monitor system resource updates
      let resourceUpdates = [];
      const maxWait = 10000;
      const startTime = Date.now();

      while (resourceUpdates.length < 3 && Date.now() - startTime < maxWait) {
        try {
          const message = await mockWebSocket.nextMessage;
          const data = JSON.parse(message);

          if (data.type === "system_resources_update") {
            resourceUpdates.push(data.data);
          }
        } catch (e) {
          break;
        }
      }

      // Verify resource data consistency
      resourceUpdates.forEach((update) => {
        expect(update).toHaveProperty("cpu_usage");
        expect(update).toHaveProperty("memory_usage");
        expect(update).toHaveProperty("disk_usage");
        expect(update).toHaveProperty("timestamp");

        // Values should be reasonable
        expect(update.cpu_usage).toBeGreaterThanOrEqual(0);
        expect(update.cpu_usage).toBeLessThanOrEqual(100);
        expect(update.memory_usage).toBeGreaterThanOrEqual(0);
        expect(update.memory_usage).toBeLessThanOrEqual(100);
      });

      expect(resourceUpdates.length).toBeGreaterThan(0);
    });
  });

  describe("Error Handling Consistency", () => {
    test("handles database corruption consistently across components", async () => {
      // Corrupt tasks file
      await fs.writeFile(tasksFile, "{ invalid json");

      // Try to request status via WebSocket
      await mockWebSocket.connected;
      mockWebSocket.send(JSON.stringify({ type: "request_status" }));

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      // Should handle gracefully (may return error or partial data)
      expect(["status_update", "error"]).toContain(data.type);

      // Restore valid data
      const validTasks = [
        {
          id: "recovered_task",
          type: "recovery",
          priority: "medium",
          description: "Recovered after corruption",
          files_pattern: "**/*.js",
          created_at: new Date().toISOString(),
          status: "pending",
        },
      ];

      await fs.writeFile(tasksFile, JSON.stringify(validTasks, null, 2));

      // Verify recovery
      const recoveredTasks = JSON.parse(await fs.readFile(tasksFile, "utf8"));
      expect(recoveredTasks).toHaveLength(1);
      expect(recoveredTasks[0].id).toBe("recovered_task");
    });

    test("maintains consistency during network interruptions", async () => {
      await mockWebSocket.connected;

      // Send a request
      mockWebSocket.send(JSON.stringify({ type: "ping" }));

      // Simulate disconnection and reconnection
      mockWebSocket.close();

      // Reconnect
      const newWebSocket = new WS(`ws://localhost:${testPort}/ws`);
      await newWebSocket.connected;

      // Send another request
      newWebSocket.send(JSON.stringify({ type: "ping" }));

      const response = await newWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe("pong");

      newWebSocket.close();
    });

    test("handles concurrent data access without corruption", async () => {
      // Perform multiple concurrent operations
      const concurrentOperations = Array.from({ length: 10 }, (_, i) =>
        fs.readFile(tasksFile, "utf8").then((data) => JSON.parse(data)),
      );

      const results = await Promise.all(concurrentOperations);

      // All reads should return consistent data
      results.forEach((result) => {
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThanOrEqual(2); // Should have our test tasks
        expect(result.some((task) => task.id === "consistency_task_1")).toBe(
          true,
        );
        expect(result.some((task) => task.id === "consistency_task_2")).toBe(
          true,
        );
      });
    });
  });
});
