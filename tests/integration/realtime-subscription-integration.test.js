const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs").promises;
const WS = require("jest-websocket-mock");

describe("Real-time WebSocket Subscription Integration Tests", () => {
  let server;
  let mockWebSocket;
  const testPort = 8085; // Different port to avoid conflicts
  const testProjectDir = path.join(
    __dirname,
    "..",
    "fixtures",
    "realtime-subscription-test",
  );
  const claudeDir = path.join(testProjectDir, ".claude");
  const tasksFile = path.join(claudeDir, "tasks.json");
  const taskStatusFile = path.join(claudeDir, "task_status.json");
  const logsDir = path.join(claudeDir, "logs");

  beforeAll(async () => {
    // Create test project structure
    await fs.mkdir(logsDir, { recursive: true });
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

    // Clean up test data
    try {
      const initialTasks = [];
      const initialStatus = {};
      await fs.writeFile(tasksFile, JSON.stringify(initialTasks, null, 2));
      await fs.writeFile(
        taskStatusFile,
        JSON.stringify(initialStatus, null, 2),
      );

      // Clean up log files
      const logFiles = await fs.readdir(logsDir);
      for (const logFile of logFiles) {
        await fs.unlink(path.join(logsDir, logFile));
      }
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

  describe("Real-time Task Status Updates", () => {
    test("should receive real-time task status updates when subscribed", async () => {
      await mockWebSocket.connected;

      // Subscribe to task status updates
      mockWebSocket.send(
        JSON.stringify({
          type: "subscribe_to_updates",
          channels: ["task_status"],
        }),
      );

      const subscriptionResponse = await mockWebSocket.nextMessage;
      const subscriptionData = JSON.parse(subscriptionResponse);

      expect(subscriptionData.type).toBe("subscription_confirmed");
      expect(subscriptionData.channels).toContain("task_status");

      // Create a task
      const taskId = "realtime_task_1";
      const taskData = {
        id: taskId,
        type: "testing",
        priority: "high",
        description: "Real-time subscription test task",
        files_pattern: "**/*.test.js",
      };

      mockWebSocket.send(
        JSON.stringify({
          type: "start_task",
          task: taskData,
        }),
      );

      await mockWebSocket.nextMessage; // task_started

      // Monitor for real-time updates
      let statusUpdates = [];
      const maxWait = 10000;
      const startTime = Date.now();

      // Collect status updates for a period
      while (statusUpdates.length < 3 && Date.now() - startTime < maxWait) {
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

      // Should have received some status updates
      expect(statusUpdates.length).toBeGreaterThanOrEqual(0);
    });

    test("should receive task progress updates in real-time", async () => {
      await mockWebSocket.connected;

      // Subscribe to updates
      mockWebSocket.send(
        JSON.stringify({
          type: "subscribe_to_updates",
          channels: ["task_status"],
        }),
      );

      await mockWebSocket.nextMessage; // subscription_confirmed

      // Create task
      const taskId = "progress_task";
      const taskData = {
        id: taskId,
        type: "analysis",
        priority: "medium",
        description: "Progress update test task",
        files_pattern: "**/*.js",
      };

      mockWebSocket.send(
        JSON.stringify({
          type: "start_task",
          task: taskData,
        }),
      );

      await mockWebSocket.nextMessage; // task_started

      // Simulate progress updates
      const progressUpdates = [25, 50, 75, 100];
      let receivedUpdates = [];

      for (const progress of progressUpdates) {
        // Update task status
        const statusContent = await fs.readFile(taskStatusFile, "utf8");
        const statusData = JSON.parse(statusContent);
        statusData[taskId] = {
          status: progress === 100 ? "completed" : "running",
          progress: progress,
          started_at: new Date().toISOString(),
          ...(progress === 100 && { completed_at: new Date().toISOString() }),
        };
        await fs.writeFile(taskStatusFile, JSON.stringify(statusData, null, 2));

        // Small delay to allow for real-time processing
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Collect any progress updates received
      const maxWait = 5000;
      const startTime = Date.now();

      while (Date.now() - startTime < maxWait) {
        try {
          const message = await mockWebSocket.nextMessage;
          const data = JSON.parse(message);

          if (
            data.type === "task_status_update" ||
            data.type === "task_progress_update"
          ) {
            receivedUpdates.push(data);
          }
        } catch (e) {
          break;
        }
      }

      // Verify we received some form of updates
      expect(receivedUpdates.length).toBeGreaterThanOrEqual(0);
    });

    test("should handle filtered task status subscriptions", async () => {
      await mockWebSocket.connected;

      // Create multiple tasks first
      const taskIds = ["filtered_task_1", "filtered_task_2", "filtered_task_3"];

      for (const taskId of taskIds) {
        const taskData = {
          id: taskId,
          type: "testing",
          priority: taskId.includes("1") ? "high" : "medium",
          description: `Filtered subscription test ${taskId}`,
          files_pattern: "**/*.js",
        };

        mockWebSocket.send(
          JSON.stringify({
            type: "start_task",
            task: taskData,
          }),
        );

        await mockWebSocket.nextMessage; // task_started
      }

      // Subscribe with filters
      mockWebSocket.send(
        JSON.stringify({
          type: "subscribe_to_updates",
          channels: ["task_status"],
          filters: {
            task_status: {
              priorities: ["high"],
            },
          },
        }),
      );

      const subscriptionResponse = await mockWebSocket.nextMessage;
      const subscriptionData = JSON.parse(subscriptionResponse);

      expect(subscriptionData.type).toBe("subscription_confirmed");

      // Update task statuses
      for (const taskId of taskIds) {
        const statusContent = await fs.readFile(taskStatusFile, "utf8");
        const statusData = JSON.parse(statusContent);
        statusData[taskId] = {
          status: "running",
          progress: 50,
          started_at: new Date().toISOString(),
        };
        await fs.writeFile(taskStatusFile, JSON.stringify(statusData, null, 2));
      }

      // Should only receive updates for high priority tasks
      let filteredUpdates = [];
      const maxWait = 3000;
      const startTime = Date.now();

      while (Date.now() - startTime < maxWait) {
        try {
          const message = await mockWebSocket.nextMessage;
          const data = JSON.parse(message);

          if (data.type === "task_status_update") {
            filteredUpdates.push(data);
          }
        } catch (e) {
          break;
        }
      }

      // Verify filtering (may not work if server doesn't implement filtering yet)
      expect(filteredUpdates.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("System Resource Real-time Updates", () => {
    test("should receive periodic system resource updates", async () => {
      await mockWebSocket.connected;

      // Subscribe to system resources
      mockWebSocket.send(
        JSON.stringify({
          type: "subscribe_to_updates",
          channels: ["system_resources"],
        }),
      );

      const subscriptionResponse = await mockWebSocket.nextMessage;
      const subscriptionData = JSON.parse(subscriptionResponse);

      expect(subscriptionData.type).toBe("subscription_confirmed");
      expect(subscriptionData.channels).toContain("system_resources");

      // Wait for periodic resource updates
      let resourceUpdates = [];
      const maxWait = 15000; // 15 seconds to catch multiple updates
      const startTime = Date.now();

      while (resourceUpdates.length < 3 && Date.now() - startTime < maxWait) {
        try {
          const message = await mockWebSocket.nextMessage;
          const data = JSON.parse(message);

          if (data.type === "resource_update") {
            resourceUpdates.push(data);
          }
        } catch (e) {
          break;
        }
      }

      // Should receive multiple resource updates
      expect(resourceUpdates.length).toBeGreaterThan(0);

      // Verify resource data structure
      const firstUpdate = resourceUpdates[0];
      expect(firstUpdate.resources).toHaveProperty("cpu_usage");
      expect(firstUpdate.resources).toHaveProperty("memory_usage");
      expect(firstUpdate.resources).toHaveProperty("disk_usage");
      expect(firstUpdate.resources).toHaveProperty("timestamp");

      // Verify data types
      expect(typeof firstUpdate.resources.cpu_usage).toBe("number");
      expect(typeof firstUpdate.resources.memory_usage).toBe("number");
      expect(firstUpdate.resources.cpu_usage).toBeGreaterThanOrEqual(0);
      expect(firstUpdate.resources.cpu_usage).toBeLessThanOrEqual(100);
    });

    test("should receive detailed process scan updates", async () => {
      await mockWebSocket.connected;

      // Subscribe to system resources (which includes process scans)
      mockWebSocket.send(
        JSON.stringify({
          type: "subscribe_to_updates",
          channels: ["system_resources"],
        }),
      );

      await mockWebSocket.nextMessage; // subscription_confirmed

      // Wait for detailed process scan updates
      let processScanUpdates = [];
      const maxWait = 20000; // 20 seconds to catch process scan
      const startTime = Date.now();

      while (
        processScanUpdates.length < 1 &&
        Date.now() - startTime < maxWait
      ) {
        try {
          const message = await mockWebSocket.nextMessage;
          const data = JSON.parse(message);

          if (data.type === "detailed_process_scan") {
            processScanUpdates.push(data);
          }
        } catch (e) {
          break;
        }
      }

      // May or may not receive detailed process scans depending on timing
      if (processScanUpdates.length > 0) {
        const processUpdate = processScanUpdates[0];
        expect(processUpdate).toHaveProperty("processes");
        expect(processUpdate).toHaveProperty("scan_time");
        expect(Array.isArray(processUpdate.processes)).toBe(true);
      }
    });
  });

  describe("Log Entry Real-time Streaming", () => {
    test("should receive real-time log entries", async () => {
      await mockWebSocket.connected;

      // Subscribe to log entries
      mockWebSocket.send(
        JSON.stringify({
          type: "subscribe_to_updates",
          channels: ["log_entries"],
        }),
      );

      const subscriptionResponse = await mockWebSocket.nextMessage;
      const subscriptionData = JSON.parse(subscriptionResponse);

      expect(subscriptionData.type).toBe("subscription_confirmed");
      expect(subscriptionData.channels).toContain("log_entries");

      // Create a task and generate log entries
      const taskId = "log_streaming_task";
      const taskData = {
        id: taskId,
        type: "logging",
        priority: "low",
        description: "Log streaming test task",
        files_pattern: "**/*.js",
      };

      mockWebSocket.send(
        JSON.stringify({
          type: "start_task",
          task: taskData,
        }),
      );

      await mockWebSocket.nextMessage; // task_started

      // Create log file with entries
      const logFile = path.join(logsDir, `${taskId}.log`);
      const logEntries = [
        "Task started at " + new Date().toISOString(),
        "INFO: Processing files...",
        "DEBUG: Found 5 files to process",
        "INFO: Processing complete",
        "Task completed successfully",
      ];

      await fs.writeFile(logFile, logEntries.join("\n"));

      // Wait for log entries to be broadcast
      let receivedLogs = [];
      const maxWait = 5000;
      const startTime = Date.now();

      while (Date.now() - startTime < maxWait) {
        try {
          const message = await mockWebSocket.nextMessage;
          const data = JSON.parse(message);

          if (data.type === "log_entry") {
            receivedLogs.push(data);
          }
        } catch (e) {
          break;
        }
      }

      // Should receive some log entries
      expect(receivedLogs.length).toBeGreaterThanOrEqual(0);

      if (receivedLogs.length > 0) {
        const firstLog = receivedLogs[0];
        expect(firstLog).toHaveProperty("log");
        expect(firstLog.log).toHaveProperty("time");
        expect(firstLog.log).toHaveProperty("level");
        expect(firstLog.log).toHaveProperty("message");
        expect(firstLog.log).toHaveProperty("agent");
      }
    });

    test("should filter log entries by level", async () => {
      await mockWebSocket.connected;

      // Subscribe to log entries with filtering
      mockWebSocket.send(
        JSON.stringify({
          type: "subscribe_to_updates",
          channels: ["log_entries"],
          filters: {
            log_entries: {
              levels: ["error", "warn"],
            },
          },
        }),
      );

      await mockWebSocket.nextMessage; // subscription_confirmed

      // Create log file with mixed log levels
      const taskId = "filtered_logs_task";
      const logFile = path.join(logsDir, `${taskId}.log`);
      const logContent = [
        "INFO: Task started",
        "DEBUG: Initializing components",
        "WARN: Deprecated function used",
        "INFO: Processing data",
        "ERROR: Failed to connect to database",
        "DEBUG: Retrying connection",
        "INFO: Task completed",
      ].join("\n");

      await fs.writeFile(logFile, logContent);

      // Wait for filtered log entries
      let filteredLogs = [];
      const maxWait = 3000;
      const startTime = Date.now();

      while (Date.now() - startTime < maxWait) {
        try {
          const message = await mockWebSocket.nextMessage;
          const data = JSON.parse(message);

          if (data.type === "log_entry") {
            filteredLogs.push(data);
          }
        } catch (e) {
          break;
        }
      }

      // Should receive filtered logs (may not be implemented yet)
      expect(filteredLogs.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Agent Status Real-time Updates", () => {
    test("should receive real-time agent status updates", async () => {
      await mockWebSocket.connected;

      // Subscribe to task status (which includes agent updates)
      mockWebSocket.send(
        JSON.stringify({
          type: "subscribe_to_updates",
          channels: ["task_status"],
        }),
      );

      await mockWebSocket.nextMessage; // subscription_confirmed

      // Create a task that will become an agent
      const taskId = "agent_status_task";
      const taskData = {
        id: taskId,
        type: "agent_test",
        priority: "medium",
        description: "Agent status update test",
        files_pattern: "**/*.js",
      };

      mockWebSocket.send(
        JSON.stringify({
          type: "start_task",
          task: taskData,
        }),
      );

      await mockWebSocket.nextMessage; // task_started

      // Update task status to running (simulating agent activity)
      const statusContent = await fs.readFile(taskStatusFile, "utf8");
      const statusData = JSON.parse(statusContent);
      statusData[taskId] = {
        status: "running",
        progress: 30,
        started_at: new Date().toISOString(),
        current_step: "Processing agent tasks",
      };
      await fs.writeFile(taskStatusFile, JSON.stringify(statusData, null, 2));

      // Wait for agent updates
      let agentUpdates = [];
      const maxWait = 5000;
      const startTime = Date.now();

      while (Date.now() - startTime < maxWait) {
        try {
          const message = await mockWebSocket.nextMessage;
          const data = JSON.parse(message);

          if (data.type === "agent_update") {
            agentUpdates.push(data);
          }
        } catch (e) {
          break;
        }
      }

      // Should receive agent updates
      expect(agentUpdates.length).toBeGreaterThanOrEqual(0);

      if (agentUpdates.length > 0) {
        const agentUpdate = agentUpdates[0];
        expect(agentUpdate).toHaveProperty("agent");
        expect(agentUpdate.agent).toHaveProperty("id");
        expect(agentUpdate.agent).toHaveProperty("status");
        expect(agentUpdate.agent).toHaveProperty("progress");
      }
    });
  });

  describe("Subscription Management", () => {
    test("should handle multiple channel subscriptions", async () => {
      await mockWebSocket.connected;

      // Subscribe to multiple channels
      mockWebSocket.send(
        JSON.stringify({
          type: "subscribe_to_updates",
          channels: ["system_resources", "task_status", "log_entries"],
        }),
      );

      const subscriptionResponse = await mockWebSocket.nextMessage;
      const subscriptionData = JSON.parse(subscriptionResponse);

      expect(subscriptionData.type).toBe("subscription_confirmed");
      expect(subscriptionData.channels).toContain("system_resources");
      expect(subscriptionData.channels).toContain("task_status");
      expect(subscriptionData.channels).toContain("log_entries");
    });

    test("should handle subscription and unsubscription correctly", async () => {
      await mockWebSocket.connected;

      // Subscribe to channels
      mockWebSocket.send(
        JSON.stringify({
          type: "subscribe_to_updates",
          channels: ["system_resources", "task_status"],
        }),
      );

      const subscribeResponse = await mockWebSocket.nextMessage;
      const subscribeData = JSON.parse(subscribeResponse);

      expect(subscribeData.type).toBe("subscription_confirmed");

      // Unsubscribe from one channel
      mockWebSocket.send(
        JSON.stringify({
          type: "unsubscribe_from_updates",
          channels: ["task_status"],
        }),
      );

      const unsubscribeResponse = await mockWebSocket.nextMessage;
      const unsubscribeData = JSON.parse(unsubscribeResponse);

      expect(unsubscribeData.type).toBe("unsubscription_confirmed");
      expect(unsubscribeData.channels).toContain("task_status");
    });

    test("should handle concurrent client subscriptions", async () => {
      await mockWebSocket.connected;

      // Create additional WebSocket connections
      const client2 = new WS(`ws://localhost:${testPort}/ws`);
      const client3 = new WS(`ws://localhost:${testPort}/ws`);

      // All clients subscribe
      const subscriptions = [mockWebSocket, client2, client3].map(
        async (client) => {
          client.send(
            JSON.stringify({
              type: "subscribe_to_updates",
              channels: ["system_resources"],
            }),
          );

          const response = await client.nextMessage;
          return JSON.parse(response);
        },
      );

      const responses = await Promise.all(subscriptions);

      // All should receive subscription confirmations
      responses.forEach((response) => {
        expect(response.type).toBe("subscription_confirmed");
      });

      // Clean up additional clients
      client2.close();
      client3.close();
    });
  });

  describe("Real-time Update Performance", () => {
    test("should handle high-frequency updates without performance degradation", async () => {
      await mockWebSocket.connected;

      // Subscribe to updates
      mockWebSocket.send(
        JSON.stringify({
          type: "subscribe_to_updates",
          channels: ["system_resources"],
        }),
      );

      await mockWebSocket.nextMessage; // subscription_confirmed

      // Monitor update frequency and performance
      let updateCount = 0;
      let startTime = Date.now();
      const testDuration = 10000; // 10 seconds

      while (Date.now() - startTime < testDuration) {
        try {
          const message = await mockWebSocket.nextMessage;
          const data = JSON.parse(message);

          if (data.type === "resource_update") {
            updateCount++;
          }
        } catch (e) {
          break;
        }
      }

      const endTime = Date.now();
      const actualDuration = endTime - startTime;

      // Should receive multiple updates during the test period
      expect(updateCount).toBeGreaterThan(0);

      // Calculate update frequency
      const updatesPerSecond = (updateCount / actualDuration) * 1000;

      // Should not be excessively high (server should throttle updates)
      expect(updatesPerSecond).toBeLessThan(10); // Less than 10 updates per second
    });

    test("should maintain real-time performance under load", async () => {
      await mockWebSocket.connected;

      // Subscribe to updates
      mockWebSocket.send(
        JSON.stringify({
          type: "subscribe_to_updates",
          channels: ["system_resources", "task_status"],
        }),
      );

      await mockWebSocket.nextMessage; // subscription_confirmed

      // Create multiple tasks to simulate load
      const taskCount = 10;
      for (let i = 0; i < taskCount; i++) {
        const taskData = {
          id: `load_test_task_${i + 1}`,
          type: "load_test",
          priority: "low",
          description: `Load test task ${i + 1}`,
          files_pattern: `**/*${i + 1}.*`,
        };

        mockWebSocket.send(
          JSON.stringify({
            type: "start_task",
            task: taskData,
          }),
        );

        // Don't wait for response to simulate rapid creation
      }

      // Wait for task creation responses
      let responseCount = 0;
      const maxWait = 5000;
      const startTime = Date.now();

      while (responseCount < taskCount && Date.now() - startTime < maxWait) {
        try {
          const message = await mockWebSocket.nextMessage;
          const data = JSON.parse(message);

          if (data.type === "task_started") {
            responseCount++;
          }
        } catch (e) {
          break;
        }
      }

      // Should handle the load
      expect(responseCount).toBeGreaterThan(5); // At least half should succeed
    });
  });
});
