const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs").promises;
const WS = require("jest-websocket-mock");

describe("API-Database Integration Tests", () => {
  let server;
  let mockWebSocket;
  const testPort = 8083; // Different port to avoid conflicts
  const testProjectDir = path.join(
    __dirname,
    "..",
    "fixtures",
    "api-db-integration-test",
  );
  const claudeDir = path.join(testProjectDir, ".claude");
  const tasksFile = path.join(claudeDir, "tasks.json");
  const taskStatusFile = path.join(claudeDir, "task_status.json");

  beforeAll(async () => {
    // Create test project structure
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(path.join(claudeDir, "logs"), { recursive: true });

    // Initialize clean database state
    const initialTasks = [
      {
        id: "api_db_test_task_1",
        type: "testing",
        priority: "high",
        description: "API-Database integration test task",
        files_pattern: "**/*.test.js",
        created_at: new Date().toISOString(),
        status: "pending",
      },
    ];

    const initialStatus = {
      api_db_test_task_1: {
        status: "pending",
        progress: 0,
        created_at: new Date().toISOString(),
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

    // Reset test data
    try {
      const resetTasks = [
        {
          id: "api_db_test_task_1",
          type: "testing",
          priority: "high",
          description: "API-Database integration test task",
          files_pattern: "**/*.test.js",
          created_at: new Date().toISOString(),
          status: "pending",
        },
      ];

      const resetStatus = {
        api_db_test_task_1: {
          status: "pending",
          progress: 0,
          created_at: new Date().toISOString(),
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

  describe("Task Creation and Database Persistence", () => {
    test("API task creation persists to database correctly", async () => {
      await mockWebSocket.connected;

      const newTask = {
        id: "integration_persistence_task",
        type: "analysis",
        priority: "medium",
        description: "Task for testing API-database persistence",
        files_pattern: "**/*.js",
      };

      // Send task creation request
      mockWebSocket.send(
        JSON.stringify({
          type: "start_task",
          task: newTask,
        }),
      );

      // Wait for confirmation
      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);
      expect(data.type).toBe("task_started");

      // Verify database state immediately
      const tasksContent = await fs.readFile(tasksFile, "utf8");
      const tasks = JSON.parse(tasksContent);
      const createdTask = tasks.find(
        (t) => t.id === "integration_persistence_task",
      );

      expect(createdTask).toBeDefined();
      expect(createdTask.type).toBe("analysis");
      expect(createdTask.priority).toBe("medium");
      expect(createdTask.status).toBe("pending");
      expect(createdTask).toHaveProperty("created_at");

      // Verify status file
      const statusContent = await fs.readFile(taskStatusFile, "utf8");
      const statusData = JSON.parse(statusContent);
      expect(statusData).toHaveProperty("integration_persistence_task");
      expect(statusData.integration_persistence_task.status).toBe("pending");
    });

    test("Database changes are reflected in API responses", async () => {
      await mockWebSocket.connected;

      // First, modify database directly
      const tasksContent = await fs.readFile(tasksFile, "utf8");
      const tasks = JSON.parse(tasksContent);
      tasks[0].status = "running";
      tasks[0].started_at = new Date().toISOString();
      await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2));

      // Update status file
      const statusContent = await fs.readFile(taskStatusFile, "utf8");
      const statusData = JSON.parse(statusContent);
      statusData.api_db_test_task_1.status = "running";
      statusData.api_db_test_task_1.progress = 25;
      statusData.api_db_test_task_1.started_at = new Date().toISOString();
      await fs.writeFile(taskStatusFile, JSON.stringify(statusData, null, 2));

      // Request status via API
      mockWebSocket.send(JSON.stringify({ type: "request_status" }));

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe("status_update");
      expect(data.data.tasks).toBeDefined();

      // Find our updated task
      const taskInResponse = data.data.tasks.find(
        (t) => t.id === "api_db_test_task_1",
      );
      expect(taskInResponse).toBeDefined();
      expect(taskInResponse.status).toBe("running");
      expect(taskInResponse).toHaveProperty("started_at");
    });
  });

  describe("Real-time Database Synchronization", () => {
    test("API updates are immediately reflected in database", async () => {
      await mockWebSocket.connected;

      const updateTask = {
        id: "api_db_test_task_1",
        status: "completed",
        progress: 100,
        completed_at: new Date().toISOString(),
        result: "success",
      };

      // Send update via API
      mockWebSocket.send(
        JSON.stringify({
          type: "update_task_status",
          task_id: "api_db_test_task_1",
          updates: updateTask,
        }),
      );

      // Wait for confirmation
      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);
      expect(data.type).toBe("task_updated");

      // Verify immediate database update
      const statusContent = await fs.readFile(taskStatusFile, "utf8");
      const statusData = JSON.parse(statusContent);

      expect(statusData.api_db_test_task_1.status).toBe("completed");
      expect(statusData.api_db_test_task_1.progress).toBe(100);
      expect(statusData.api_db_test_task_1.result).toBe("success");
      expect(statusData.api_db_test_task_1).toHaveProperty("completed_at");
    });

    test("Multiple API clients see consistent database state", async () => {
      await mockWebSocket.connected;

      // Create second WebSocket connection
      const client2 = new WS(`ws://localhost:${testPort}/ws`);
      await client2.connected;

      // Client 1 creates a task
      const sharedTask = {
        id: "shared_state_task",
        type: "testing",
        priority: "high",
        description: "Task for testing shared state",
        files_pattern: "**/*.js",
      };

      mockWebSocket.send(
        JSON.stringify({
          type: "start_task",
          task: sharedTask,
        }),
      );

      // Both clients should see the task creation
      const response1 = await mockWebSocket.nextMessage;
      const data1 = JSON.parse(response1);
      expect(data1.type).toBe("task_started");

      // Client 2 requests status
      client2.send(JSON.stringify({ type: "request_status" }));
      const response2 = await client2.nextMessage;
      const data2 = JSON.parse(response2);

      expect(data2.type).toBe("status_update");
      const taskInClient2 = data2.data.tasks.find(
        (t) => t.id === "shared_state_task",
      );
      expect(taskInClient2).toBeDefined();
      expect(taskInClient2.description).toBe("Task for testing shared state");

      client2.close();
    });
  });

  describe("Database Consistency During API Operations", () => {
    test("API operations maintain database referential integrity", async () => {
      await mockWebSocket.connected;

      // Create multiple related tasks
      const relatedTasks = [
        {
          id: "parent_task",
          type: "coordination",
          priority: "high",
          description: "Parent coordination task",
          files_pattern: "**/*.js",
          dependencies: [],
        },
        {
          id: "child_task_1",
          type: "execution",
          priority: "medium",
          description: "Child execution task 1",
          files_pattern: "**/*.js",
          dependencies: ["parent_task"],
        },
        {
          id: "child_task_2",
          type: "execution",
          priority: "medium",
          description: "Child execution task 2",
          files_pattern: "**/*.js",
          dependencies: ["parent_task"],
        },
      ];

      // Create all tasks via API
      for (const task of relatedTasks) {
        mockWebSocket.send(
          JSON.stringify({
            type: "start_task",
            task: task,
          }),
        );
        await mockWebSocket.nextMessage; // Wait for confirmation
      }

      // Verify all tasks exist in database with correct relationships
      const tasksContent = await fs.readFile(tasksFile, "utf8");
      const tasks = JSON.parse(tasksContent);

      expect(tasks.length).toBe(4); // 1 initial + 3 new

      const parentTask = tasks.find((t) => t.id === "parent_task");
      const childTask1 = tasks.find((t) => t.id === "child_task_1");
      const childTask2 = tasks.find((t) => t.id === "child_task_2");

      expect(parentTask).toBeDefined();
      expect(childTask1).toBeDefined();
      expect(childTask2).toBeDefined();

      expect(childTask1.dependencies).toContain("parent_task");
      expect(childTask2.dependencies).toContain("parent_task");
    });

    test("API handles database conflicts gracefully", async () => {
      await mockWebSocket.connected;

      // Create a task
      const conflictTask = {
        id: "conflict_task",
        type: "testing",
        priority: "medium",
        description: "Task for conflict testing",
        files_pattern: "**/*.js",
      };

      mockWebSocket.send(
        JSON.stringify({
          type: "start_task",
          task: conflictTask,
        }),
      );

      await mockWebSocket.nextMessage; // Wait for first creation

      // Try to create the same task again
      mockWebSocket.send(
        JSON.stringify({
          type: "start_task",
          task: conflictTask,
        }),
      );

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      // Should handle conflict appropriately (either error or update)
      expect(["task_started", "error", "task_updated"]).toContain(data.type);

      // Database should remain consistent
      const tasksContent = await fs.readFile(tasksFile, "utf8");
      const tasks = JSON.parse(tasksContent);
      const conflictTasks = tasks.filter((t) => t.id === "conflict_task");
      expect(conflictTasks.length).toBe(1); // Should not create duplicates
    });
  });

  describe("Database Recovery and API Resilience", () => {
    test("API recovers from temporary database unavailability", async () => {
      await mockWebSocket.connected;

      // Simulate database unavailability by renaming files
      const tasksBackup = tasksFile + ".backup";
      const statusBackup = taskStatusFile + ".backup";

      await fs.rename(tasksFile, tasksBackup);
      await fs.rename(taskStatusFile, statusBackup);

      // API should handle gracefully
      mockWebSocket.send(JSON.stringify({ type: "request_status" }));

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      // Should return some response (possibly with error or empty data)
      expect(data.type).toBeDefined();

      // Restore database
      await fs.rename(tasksBackup, tasksFile);
      await fs.rename(statusBackup, taskStatusFile);

      // API should work again
      mockWebSocket.send(JSON.stringify({ type: "request_status" }));

      const recoveryResponse = await mockWebSocket.nextMessage;
      const recoveryData = JSON.parse(recoveryResponse);

      expect(recoveryData.type).toBe("status_update");
    });

    test("API maintains state consistency during rapid operations", async () => {
      await mockWebSocket.connected;

      // Send multiple rapid operations
      const operations = [];
      for (let i = 0; i < 10; i++) {
        operations.push(
          mockWebSocket.send(
            JSON.stringify({
              type: "start_task",
              task: {
                id: `rapid_task_${i}`,
                type: "testing",
                priority: "low",
                description: `Rapid operation task ${i}`,
                files_pattern: "**/*.js",
              },
            }),
          ),
        );
      }

      await Promise.all(operations);

      // Wait for all responses
      const responses = [];
      for (let i = 0; i < 10; i++) {
        const response = await mockWebSocket.nextMessage;
        responses.push(JSON.parse(response));
      }

      // All should be successful
      responses.forEach((response) => {
        expect(response.type).toBe("task_started");
      });

      // Database should contain all tasks
      const tasksContent = await fs.readFile(tasksFile, "utf8");
      const tasks = JSON.parse(tasksContent);

      expect(tasks.length).toBe(11); // 1 initial + 10 new

      // Verify no duplicates or corruption
      const taskIds = tasks.map((t) => t.id);
      const uniqueIds = new Set(taskIds);
      expect(uniqueIds.size).toBe(taskIds.length);
    });
  });
});
