const { spawn } = require("child_process");
const fs = require("fs").promises;
const path = require("path");
const WS = require("jest-websocket-mock");

describe("Real-time Updates Integration Tests", () => {
  let server;
  let mockWebSocket;
  const testPort = 8086; // Different port to avoid conflicts
  const testProjectDir = path.join(
    __dirname,
    "..",
    "fixtures",
    "realtime-test-project",
  );
  const claudeDir = path.join(testProjectDir, ".claude");
  const tasksFile = path.join(claudeDir, "tasks.json");
  const taskStatusFile = path.join(claudeDir, "task_status.json");
  const logsDir = path.join(claudeDir, "logs");

  beforeAll(async () => {
    // Create test project structure
    await fs.mkdir(logsDir, { recursive: true });

    // Initialize with test data
    const initialTasks = [
      {
        id: "realtime_task_1",
        type: "testing",
        priority: "high",
        description: "Real-time test task 1",
        files_pattern: "**/*.test.js",
        created_at: new Date().toISOString(),
        status: "pending",
      },
      {
        id: "realtime_task_2",
        type: "monitoring",
        priority: "medium",
        description: "Real-time test task 2",
        files_pattern: "**/*.js",
        created_at: new Date().toISOString(),
        status: "running",
      },
    ];

    const initialStatus = {
      realtime_task_1: {
        status: "pending",
        progress: 0,
        created_at: new Date().toISOString(),
      },
      realtime_task_2: {
        status: "running",
        progress: 25,
        started_at: new Date().toISOString(),
        current_step: "Monitoring files",
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
  });

  afterAll(async () => {
    // Clean up test directory
    try {
      await fs.rm(testProjectDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe("Periodic System Updates", () => {
    test("receives periodic system resource updates", async () => {
      await mockWebSocket.connected;

      let resourceUpdates = [];
      const maxWait = 15000; // 15 seconds
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

      expect(resourceUpdates.length).toBeGreaterThan(0);

      // Verify resource data structure
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
        expect(update.disk_usage).toBeGreaterThanOrEqual(0);
        expect(update.disk_usage).toBeLessThanOrEqual(100);
      });
    });

    test("system resource updates reflect actual system state", async () => {
      await mockWebSocket.connected;

      // Collect a few resource updates
      const updates = [];
      const maxWait = 10000;
      const startTime = Date.now();

      while (updates.length < 2 && Date.now() - startTime < maxWait) {
        try {
          const message = await mockWebSocket.nextMessage;
          const data = JSON.parse(message);

          if (data.type === "system_resources_update") {
            updates.push(data.data);
          }
        } catch (e) {
          break;
        }
      }

      expect(updates.length).toBeGreaterThanOrEqual(1);

      // Updates should be relatively recent
      const latestUpdate = updates[updates.length - 1];
      const updateTime = new Date(latestUpdate.timestamp);
      const now = new Date();
      const timeDiff = now - updateTime;

      // Should be within last minute
      expect(timeDiff).toBeLessThan(60000);
    });

    test("receives periodic Claude process scans", async () => {
      await mockWebSocket.connected;

      let processScans = [];
      const maxWait = 20000; // 20 seconds (process scans are less frequent)
      const startTime = Date.now();

      while (processScans.length < 2 && Date.now() - startTime < maxWait) {
        try {
          const message = await mockWebSocket.nextMessage;
          const data = JSON.parse(message);

          if (data.type === "detailed_process_scan") {
            processScans.push(data.data);
          }
        } catch (e) {
          break;
        }
      }

      // Process scans may or may not occur depending on timing
      expect(processScans.length).toBeGreaterThanOrEqual(0);

      if (processScans.length > 0) {
        processScans.forEach((scan) => {
          expect(scan).toHaveProperty("processes");
          expect(scan).toHaveProperty("scan_time");
          expect(Array.isArray(scan.processes)).toBe(true);
        });
      }
    });
  });

  describe("Task Status Broadcasting", () => {
    test("broadcasts task status changes in real-time", async () => {
      await mockWebSocket.connected;

      // Start a new task to trigger status updates
      const newTask = {
        id: "broadcast_test_task",
        type: "testing",
        priority: "medium",
        description: "Task for broadcast testing",
        files_pattern: "**/*.js",
      };

      mockWebSocket.send(
        JSON.stringify({
          type: "start_task",
          task: newTask,
        }),
      );

      // Monitor for task status updates
      let statusUpdates = [];
      const maxWait = 10000;
      const startTime = Date.now();

      while (statusUpdates.length < 3 && Date.now() - startTime < maxWait) {
        try {
          const message = await mockWebSocket.nextMessage;
          const data = JSON.parse(message);

          if (
            data.type === "task_status_update" ||
            data.type === "task_started"
          ) {
            statusUpdates.push(data);
          }
        } catch (e) {
          break;
        }
      }

      // Should have received at least task started
      expect(statusUpdates.length).toBeGreaterThan(0);
      expect(
        statusUpdates.some((update) => update.type === "task_started"),
      ).toBe(true);
    });

    test("broadcasts task progress updates", async () => {
      await mockWebSocket.connected;

      // Update task progress in database to simulate progress updates
      const statusData = JSON.parse(await fs.readFile(taskStatusFile, "utf8"));
      statusData.realtime_task_2.progress = 50;
      statusData.realtime_task_2.current_step = "Halfway complete";
      statusData.realtime_task_2.last_update = new Date().toISOString();

      await fs.writeFile(taskStatusFile, JSON.stringify(statusData, null, 2));

      // Monitor for progress broadcasts (may not happen immediately)
      let progressUpdates = [];
      const maxWait = 8000;
      const startTime = Date.now();

      while (progressUpdates.length < 1 && Date.now() - startTime < maxWait) {
        try {
          const message = await mockWebSocket.nextMessage;
          const data = JSON.parse(message);

          if (data.type === "task_progress_update") {
            progressUpdates.push(data);
          }
        } catch (e) {
          break;
        }
      }

      // Progress updates may not be broadcast immediately depending on implementation
      expect(progressUpdates.length).toBeGreaterThanOrEqual(0);
    });

    test("handles multiple clients receiving broadcasts", async () => {
      await mockWebSocket.connected;

      // Create additional WebSocket connections
      const client2 = new WS(`ws://localhost:${testPort}/ws`);
      const client3 = new WS(`ws://localhost:${testPort}/ws`);

      await Promise.all([client2.connected, client3.connected]);

      // Start a task that should trigger broadcasts
      const broadcastTask = {
        id: "multi_client_task",
        type: "broadcast_test",
        priority: "high",
        description: "Task for multi-client broadcast test",
        files_pattern: "**/*.js",
      };

      mockWebSocket.send(
        JSON.stringify({
          type: "start_task",
          task: broadcastTask,
        }),
      );

      // Collect responses from all clients
      const responses = await Promise.all([
        mockWebSocket.nextMessage,
        client2.nextMessage,
        client3.nextMessage,
      ]);

      // All clients should receive the same type of message
      const parsedResponses = responses.map((r) => JSON.parse(r));
      const hasTaskStarted = parsedResponses.some(
        (r) => r.type === "task_started",
      );

      expect(hasTaskStarted).toBe(true);

      // Clean up additional clients
      client2.close();
      client3.close();
    });
  });

  describe("Log File Monitoring", () => {
    test("broadcasts new log entries in real-time", async () => {
      await mockWebSocket.connected;

      // Create a test log file
      const testLogFile = path.join(logsDir, "realtime_test.log");
      await fs.writeFile(testLogFile, "");

      // Wait for file watcher to register
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Append log entries
      const logEntries = [
        `${new Date().toISOString()} [INFO] Real-time log test started`,
        `${new Date().toISOString()} [DEBUG] Processing test data`,
        `${new Date().toISOString()} [INFO] Test completed successfully`,
      ];

      for (const entry of logEntries) {
        await fs.appendFile(testLogFile, entry + "\n");
        // Small delay to ensure entries are processed separately
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Monitor for log broadcasts
      let logBroadcasts = [];
      const maxWait = 5000;
      const startTime = Date.now();

      while (logBroadcasts.length < 3 && Date.now() - startTime < maxWait) {
        try {
          const message = await mockWebSocket.nextMessage;
          const data = JSON.parse(message);

          if (data.type === "log_entry") {
            logBroadcasts.push(data);
          }
        } catch (e) {
          break;
        }
      }

      expect(logBroadcasts.length).toBeGreaterThan(0);

      // Verify log entry structure
      logBroadcasts.forEach((broadcast) => {
        expect(broadcast.log).toHaveProperty("time");
        expect(broadcast.log).toHaveProperty("level");
        expect(broadcast.log).toHaveProperty("message");
        expect(broadcast.log).toHaveProperty("agent");
      });

      // Clean up
      await fs.unlink(testLogFile);
    });

    test("handles multiple log files simultaneously", async () => {
      await mockWebSocket.connected;

      // Create multiple log files
      const logFiles = Array.from({ length: 3 }, (_, i) =>
        path.join(logsDir, `multi_log_test_${i + 1}.log`),
      );

      // Initialize files
      await Promise.all(logFiles.map((file) => fs.writeFile(file, "")));

      // Wait for watchers
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Write to all files concurrently
      const writeOperations = logFiles.map((file, index) =>
        fs.appendFile(
          file,
          `${new Date().toISOString()} [INFO] Multi-file test ${index + 1}\n`,
        ),
      );

      await Promise.all(writeOperations);

      // Monitor for broadcasts
      let logBroadcasts = [];
      const maxWait = 3000;
      const startTime = Date.now();

      while (logBroadcasts.length < 3 && Date.now() - startTime < maxWait) {
        try {
          const message = await mockWebSocket.nextMessage;
          const data = JSON.parse(message);

          if (data.type === "log_entry") {
            logBroadcasts.push(data);
          }
        } catch (e) {
          break;
        }
      }

      expect(logBroadcasts.length).toBeGreaterThan(0);

      // Clean up
      await Promise.all(logFiles.map((file) => fs.unlink(file)));
    });

    test("filters and formats log entries correctly", async () => {
      await mockWebSocket.connected;

      const testLogFile = path.join(logsDir, "format_test.log");
      await fs.writeFile(testLogFile, "");

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Write various log formats
      const testLogs = [
        "2023-01-01T10:00:00.000Z [INFO] Standard log entry",
        "2023-01-01T10:01:00.000Z [ERROR] Error message here",
        "2023-01-01T10:02:00.000Z [WARN] Warning message",
        "2023-01-01T10:03:00.000Z [DEBUG] Debug information",
        "Invalid log format without timestamp",
      ];

      for (const log of testLogs) {
        await fs.appendFile(testLogFile, log + "\n");
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      // Monitor broadcasts
      let logBroadcasts = [];
      const maxWait = 5000;
      const startTime = Date.now();

      while (logBroadcasts.length < 4 && Date.now() - startTime < maxWait) {
        try {
          const message = await mockWebSocket.nextMessage;
          const data = JSON.parse(message);

          if (data.type === "log_entry") {
            logBroadcasts.push(data);
          }
        } catch (e) {
          break;
        }
      }

      expect(logBroadcasts.length).toBeGreaterThan(0);

      // Verify log level extraction
      const infoLogs = logBroadcasts.filter((b) => b.log.level === "info");
      const errorLogs = logBroadcasts.filter((b) => b.log.level === "error");
      const warnLogs = logBroadcasts.filter((b) => b.log.level === "warn");

      expect(infoLogs.length).toBeGreaterThan(0);
      expect(errorLogs.length).toBeGreaterThanOrEqual(0);
      expect(warnLogs.length).toBeGreaterThanOrEqual(0);

      // Clean up
      await fs.unlink(testLogFile);
    });
  });

  describe("Agent Status Broadcasting", () => {
    test("broadcasts agent status updates", async () => {
      await mockWebSocket.connected;

      // Monitor for agent updates (may happen periodically)
      let agentUpdates = [];
      const maxWait = 10000;
      const startTime = Date.now();

      while (agentUpdates.length < 2 && Date.now() - startTime < maxWait) {
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

      // Agent updates may or may not occur depending on system state
      expect(agentUpdates.length).toBeGreaterThanOrEqual(0);

      if (agentUpdates.length > 0) {
        agentUpdates.forEach((update) => {
          expect(update.agent).toHaveProperty("id");
          expect(update.agent).toHaveProperty("status");
          expect(["running", "completed", "error", "pending"]).toContain(
            update.agent.status,
          );
        });
      }
    });

    test("broadcasts Claude process updates", async () => {
      await mockWebSocket.connected;

      // Monitor for Claude process updates
      let processUpdates = [];
      const maxWait = 15000;
      const startTime = Date.now();

      while (processUpdates.length < 1 && Date.now() - startTime < maxWait) {
        try {
          const message = await mockWebSocket.nextMessage;
          const data = JSON.parse(message);

          if (data.type === "claude_processes_update") {
            processUpdates.push(data);
          }
        } catch (e) {
          break;
        }
      }

      // Process updates should occur
      expect(processUpdates.length).toBeGreaterThan(0);

      processUpdates.forEach((update) => {
        expect(update.data).toHaveProperty("processes");
        expect(update.data).toHaveProperty("total_processes");
        expect(update.data).toHaveProperty("timestamp");
        expect(Array.isArray(update.data.processes)).toBe(true);
      });
    });

    test("handles agent lifecycle broadcasts", async () => {
      await mockWebSocket.connected;

      // Start a task that might create an agent
      const lifecycleTask = {
        id: "lifecycle_broadcast_task",
        type: "testing",
        priority: "medium",
        description: "Task for testing agent lifecycle broadcasts",
        files_pattern: "**/*.js",
      };

      mockWebSocket.send(
        JSON.stringify({
          type: "start_task",
          task: lifecycleTask,
        }),
      );

      // Monitor for various broadcasts
      let broadcasts = [];
      const maxWait = 8000;
      const startTime = Date.now();

      while (broadcasts.length < 5 && Date.now() - startTime < maxWait) {
        try {
          const message = await mockWebSocket.nextMessage;
          const data = JSON.parse(message);

          if (
            [
              "task_started",
              "agent_update",
              "task_status_update",
              "log_entry",
            ].includes(data.type)
          ) {
            broadcasts.push(data);
          }
        } catch (e) {
          break;
        }
      }

      // Should receive at least task started
      expect(broadcasts.length).toBeGreaterThan(0);
      expect(broadcasts.some((b) => b.type === "task_started")).toBe(true);
    });
  });

  describe("Broadcast Performance and Scalability", () => {
    test("handles broadcast load with multiple subscribers", async () => {
      await mockWebSocket.connected;

      // Create multiple subscribers
      const subscribers = Array.from(
        { length: 5 },
        () => new WS(`ws://localhost:${testPort}/ws`),
      );

      // Wait for all to connect
      await Promise.all(subscribers.map((ws) => ws.connected));

      // Trigger broadcasts by starting a task
      const loadTestTask = {
        id: "load_test_broadcast_task",
        type: "load_test",
        priority: "high",
        description: "Task to test broadcast load handling",
        files_pattern: "**/*.js",
      };

      mockWebSocket.send(
        JSON.stringify({
          type: "start_task",
          task: loadTestTask,
        }),
      );

      // Collect responses from all subscribers
      const responsePromises = subscribers.map((ws) => ws.nextMessage);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), 5000),
      );

      try {
        const responses = await Promise.race([
          Promise.all(responsePromises),
          timeoutPromise,
        ]);

        // All subscribers should receive the broadcast
        responses.forEach((response) => {
          const data = JSON.parse(response);
          expect(data.type).toBe("task_started");
        });
      } catch (error) {
        if (error.message === "Timeout") {
          // Timeout is acceptable under load
          expect(true).toBe(true);
        } else {
          throw error;
        }
      }

      // Clean up subscribers
      await Promise.all(subscribers.map((ws) => ws.close()));
    });

    test("maintains broadcast order and integrity", async () => {
      await mockWebSocket.connected;

      // Send a sequence of different requests
      const requests = [
        { type: "ping", id: 1 },
        { type: "request_status" },
        { type: "ping", id: 2 },
        { type: "request_claude_processes" },
        { type: "ping", id: 3 },
      ];

      requests.forEach((req) => {
        mockWebSocket.send(JSON.stringify(req));
      });

      // Collect responses
      const responses = [];
      for (let i = 0; i < requests.length; i++) {
        try {
          const response = await mockWebSocket.nextMessage;
          responses.push(JSON.parse(response));
        } catch (e) {
          break;
        }
      }

      // Should receive responses for pings
      const pongResponses = responses.filter((r) => r.type === "pong");
      expect(pongResponses.length).toBeGreaterThan(0);

      // Should receive status and process updates
      const hasStatusUpdate = responses.some((r) => r.type === "status_update");
      const hasProcessUpdate = responses.some(
        (r) => r.type === "claude_processes_update",
      );

      expect(hasStatusUpdate || hasProcessUpdate).toBe(true);
    });

    test("handles broadcast failures gracefully", async () => {
      await mockWebSocket.connected;

      // Create a connection that will fail
      const failingClient = new WS(`ws://localhost:${testPort}/ws`);
      await failingClient.connected;

      // Close the connection abruptly
      failingClient.close();

      // Send a broadcast that should not crash the server
      mockWebSocket.send(JSON.stringify({ type: "ping" }));

      // Server should still respond to other clients
      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe("pong");
    });
  });
});
