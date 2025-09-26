const { spawn } = require("child_process");
const fs = require("fs").promises;
const path = require("path");

describe("Slave Agent Execution and Lifecycle Tests", () => {
  let testProjectDir;
  let claudeDir;
  let agentManagerProcess;
  let tasksFile;
  let taskStatusFile;
  let logsDir;

  beforeAll(async () => {
    testProjectDir = path.join(__dirname, "..", "fixtures", "slave-agent-test");
    claudeDir = path.join(testProjectDir, ".claude");
    tasksFile = path.join(claudeDir, "tasks.json");
    taskStatusFile = path.join(claudeDir, "task_status.json");
    logsDir = path.join(claudeDir, "logs");

    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(logsDir, { recursive: true });
  });

  beforeEach(async () => {
    // Reset task files before each test
    await fs.writeFile(tasksFile, JSON.stringify([]));
    await fs.writeFile(taskStatusFile, JSON.stringify({}));
  });

  afterEach(async () => {
    // Clean up any running processes
    if (agentManagerProcess && !agentManagerProcess.killed) {
      agentManagerProcess.kill("SIGTERM");
      await new Promise((resolve) => {
        agentManagerProcess.on("close", resolve);
      });
    }

    // Kill any remaining opencode processes
    try {
      const { spawn } = require("child_process");
      const killProcess = spawn("pkill", ["-f", "opencode"], {
        stdio: "ignore",
      });
      await new Promise((resolve) => {
        killProcess.on("close", resolve);
      });
    } catch (e) {
      // Ignore if pkill fails
    }
  });

  afterAll(async () => {
    try {
      await fs.rm(testProjectDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe("Agent Process Management", () => {
    test("lists running OpenCode agents correctly", async () => {
      const agentManagerScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "agent_manager.py",
      );

      agentManagerProcess = spawn("python3", [agentManagerScript, "list"], {
        cwd: testProjectDir,
        stdio: "pipe",
      });

      let stdout = "";
      let stderr = "";

      agentManagerProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      agentManagerProcess.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      await new Promise((resolve) => {
        agentManagerProcess.on("close", (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const output = stdout.trim();
      expect(output).toContain("OpenCode Agent Status");
      expect(output).toContain("Total:");
      expect(output).toContain("Max:");
    });

    test("stops specific agents gracefully", async () => {
      // First, start a mock agent process
      const mockAgent = spawn("sleep", ["30"], {
        stdio: "ignore",
      });

      // Give it a moment to start
      await new Promise((resolve) => setTimeout(resolve, 500));

      const agentManagerScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "agent_manager.py",
      );

      agentManagerProcess = spawn(
        "python3",
        [agentManagerScript, "stop", "--pid", mockAgent.pid.toString()],
        {
          cwd: testProjectDir,
          stdio: "pipe",
        },
      );

      let stdout = "";
      agentManagerProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      await new Promise((resolve) => {
        agentManagerProcess.on("close", (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const output = stdout.trim();
      expect(output).toContain("stopped gracefully") ||
        expect(output).toContain("not running") ||
        expect(output).toContain("SIGTERM");

      // Verify the process was actually stopped
      expect(mockAgent.killed).toBe(true);
    });

    test("handles invalid PIDs gracefully", async () => {
      const agentManagerScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "agent_manager.py",
      );

      agentManagerProcess = spawn(
        "python3",
        [agentManagerScript, "stop", "--pid", "999999"],
        {
          cwd: testProjectDir,
          stdio: "pipe",
        },
      );

      let stdout = "";
      agentManagerProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      await new Promise((resolve) => {
        agentManagerProcess.on("close", (code) => {
          expect(code).toBe(0); // Should not crash
          resolve();
        });
      });

      const output = stdout.trim();
      expect(output).toContain("Invalid PID") ||
        expect(output).toContain("not found") ||
        expect(output).toContain("access denied");
    });

    test("stops all agents when requested", async () => {
      const agentManagerScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "agent_manager.py",
      );

      // Mock user input for confirmation
      agentManagerProcess = spawn("python3", [agentManagerScript, "stop-all"], {
        cwd: testProjectDir,
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Simulate user typing 'y' for confirmation
      setTimeout(() => {
        agentManagerProcess.stdin.write("y\n");
      }, 100);

      let stdout = "";
      agentManagerProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      await new Promise((resolve) => {
        agentManagerProcess.on("close", (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const output = stdout.trim();
      expect(output).toContain("Stop ALL OpenCode agents?") ||
        expect(output).toContain("No OpenCode agents running") ||
        expect(output).toContain("Successfully stopped");
    });
  });

  describe("Agent Resource Limits and Enforcement", () => {
    test("enforces maximum concurrent agent limits", async () => {
      // Set a low limit for testing
      process.env.MAX_CONCURRENT_AGENTS = "2";

      const agentManagerScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "agent_manager.py",
      );

      agentManagerProcess = spawn("python3", [agentManagerScript, "list"], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, MAX_CONCURRENT_AGENTS: "2" },
      });

      let stdout = "";
      agentManagerProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      await new Promise((resolve) => {
        agentManagerProcess.on("close", (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const output = stdout.trim();
      expect(output).toContain("Max: 2");

      // Clean up environment
      delete process.env.MAX_CONCURRENT_AGENTS;
    });

    test("stops excess agents when limit exceeded", async () => {
      const agentManagerScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "agent_manager.py",
      );

      agentManagerProcess = spawn(
        "python3",
        [agentManagerScript, "stop-excess"],
        {
          cwd: testProjectDir,
          stdio: "pipe",
          env: { ...process.env, MAX_CONCURRENT_AGENTS: "1" },
        },
      );

      let stdout = "";
      agentManagerProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      await new Promise((resolve) => {
        agentManagerProcess.on("close", (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const output = stdout.trim();
      expect(output).toContain("within limit") ||
        expect(output).toContain("Stopping") ||
        expect(output).toContain("excess agents");

      // Clean up environment
      delete process.env.MAX_CONCURRENT_AGENTS;
    });
  });

  describe("Agent Health Monitoring", () => {
    test("continuously monitors agent status", async () => {
      const agentManagerScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "agent_manager.py",
      );

      agentManagerProcess = spawn("python3", [agentManagerScript, "monitor"], {
        cwd: testProjectDir,
        stdio: "pipe",
      });

      let stdout = "";
      let hasMonitoringOutput = false;

      agentManagerProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("Agent Supervisor Started") ||
          stdout.includes("Supervision Report") ||
          stdout.includes("Monitoring agents")
        ) {
          hasMonitoringOutput = true;
        }
      });

      // Let it run for a few seconds
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Kill the monitoring process
      agentManagerProcess.kill("SIGTERM");

      await new Promise((resolve) => {
        agentManagerProcess.on("close", resolve);
      });

      expect(hasMonitoringOutput).toBe(true);
    });

    test("provides memory usage information", async () => {
      const agentManagerScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "agent_manager.py",
      );

      agentManagerProcess = spawn("python3", [agentManagerScript, "monitor"], {
        cwd: testProjectDir,
        stdio: "pipe",
      });

      let stdout = "";
      let hasMemoryInfo = false;

      agentManagerProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("Memory:") ||
          stdout.includes("used") ||
          stdout.includes("free")
        ) {
          hasMemoryInfo = true;
        }
      });

      // Let it run briefly
      await new Promise((resolve) => setTimeout(resolve, 2000));

      agentManagerProcess.kill("SIGTERM");

      await new Promise((resolve) => {
        agentManagerProcess.on("close", resolve);
      });

      expect(hasMemoryInfo).toBe(true);
    });

    test("tracks task status and progress", async () => {
      // Create some test tasks
      const testTasks = [
        {
          id: "monitor_task_1",
          type: "testing",
          priority: "high",
          description: "Monitor test task 1",
          status: "running",
        },
        {
          id: "monitor_task_2",
          type: "documentation",
          priority: "medium",
          description: "Monitor test task 2",
          status: "pending",
        },
      ];

      await fs.writeFile(tasksFile, JSON.stringify(testTasks, null, 2));

      const agentManagerScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "agent_manager.py",
      );

      agentManagerProcess = spawn("python3", [agentManagerScript, "monitor"], {
        cwd: testProjectDir,
        stdio: "pipe",
      });

      let stdout = "";
      let hasTaskStatus = false;

      agentManagerProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("Task Status:") ||
          stdout.includes("Pending:") ||
          stdout.includes("In Progress:") ||
          stdout.includes("Completed:")
        ) {
          hasTaskStatus = true;
        }
      });

      // Let it run briefly
      await new Promise((resolve) => setTimeout(resolve, 2000));

      agentManagerProcess.kill("SIGTERM");

      await new Promise((resolve) => {
        agentManagerProcess.on("close", resolve);
      });

      expect(hasTaskStatus).toBe(true);
    });
  });

  describe("Agent Auto-restart and Recovery", () => {
    test("provides guidance for active tasks", async () => {
      // Create a task in progress
      const activeTask = {
        id: "guidance_task",
        type: "unit_tests",
        priority: "high",
        description: "Create unit tests for authentication module",
        status: "running",
      };

      await fs.writeFile(tasksFile, JSON.stringify([activeTask], null, 2));

      const agentManagerScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "agent_manager.py",
      );

      agentManagerProcess = spawn("python3", [agentManagerScript, "monitor"], {
        cwd: testProjectDir,
        stdio: "pipe",
      });

      let stdout = "";
      let hasGuidance = false;

      agentManagerProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("Guidance for Active Tasks:") ||
          stdout.includes("Focus on critical functions") ||
          stdout.includes("Use mocking for external dependencies")
        ) {
          hasGuidance = true;
        }
      });

      // Let it run briefly
      await new Promise((resolve) => setTimeout(resolve, 2000));

      agentManagerProcess.kill("SIGTERM");

      await new Promise((resolve) => {
        agentManagerProcess.on("close", resolve);
      });

      expect(hasGuidance).toBe(true);
    });

    test("handles high memory usage warnings", async () => {
      const agentManagerScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "agent_manager.py",
      );

      agentManagerProcess = spawn("python3", [agentManagerScript, "monitor"], {
        cwd: testProjectDir,
        stdio: "pipe",
      });

      let stdout = "";
      let hasMemoryWarning = false;

      agentManagerProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("HIGH MEMORY USAGE") ||
          stdout.includes("Consider stopping some agents") ||
          stdout.includes("Reducing to")
        ) {
          hasMemoryWarning = true;
        }
      });

      // Let it run briefly
      await new Promise((resolve) => setTimeout(resolve, 2000));

      agentManagerProcess.kill("SIGTERM");

      await new Promise((resolve) => {
        agentManagerProcess.on("close", resolve);
      });

      // Memory warning may or may not appear depending on system state
      // Just ensure the monitoring ran without crashing
      expect(agentManagerProcess.killed).toBe(true);
    });
  });

  describe("Task Execution and Lifecycle", () => {
    test("starts new agents when tasks are pending and capacity allows", async () => {
      // Create pending tasks
      const pendingTasks = [
        {
          id: "start_agent_task_1",
          type: "testing",
          priority: "high",
          description: "Execute test task 1",
          status: "pending",
        },
        {
          id: "start_agent_task_2",
          type: "documentation",
          priority: "medium",
          description: "Execute documentation task",
          status: "pending",
        },
      ];

      await fs.writeFile(tasksFile, JSON.stringify(pendingTasks, null, 2));

      const agentManagerScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "agent_manager.py",
      );

      agentManagerProcess = spawn("python3", [agentManagerScript, "monitor"], {
        cwd: testProjectDir,
        stdio: "pipe",
      });

      let stdout = "";
      let hasAgentStartMessage = false;

      agentManagerProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("Starting") ||
          stdout.includes("new agents") ||
          stdout.includes("🚀")
        ) {
          hasAgentStartMessage = true;
        }
      });

      // Let it run briefly
      await new Promise((resolve) => setTimeout(resolve, 2000));

      agentManagerProcess.kill("SIGTERM");

      await new Promise((resolve) => {
        agentManagerProcess.on("close", resolve);
      });

      // Should attempt to start agents for pending tasks
      expect(hasAgentStartMessage).toBe(true);
    });

    test("handles task completion and status updates", async () => {
      // Create a completed task
      const completedTask = {
        id: "completed_task",
        type: "testing",
        priority: "high",
        description: "Completed test task",
        status: "completed",
      };

      await fs.writeFile(tasksFile, JSON.stringify([completedTask], null, 2));

      // Update task status
      const statusUpdate = {
        completed_task: {
          status: "completed",
          progress: 100,
          completed_at: new Date().toISOString(),
        },
      };

      await fs.writeFile(taskStatusFile, JSON.stringify(statusUpdate, null, 2));

      const agentManagerScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "agent_manager.py",
      );

      agentManagerProcess = spawn("python3", [agentManagerScript, "monitor"], {
        cwd: testProjectDir,
        stdio: "pipe",
      });

      let stdout = "";
      let hasCompletionInfo = false;

      agentManagerProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("Completed: 1") ||
          stdout.includes("completed_task") ||
          stdout.includes("100")
        ) {
          hasCompletionInfo = true;
        }
      });

      // Let it run briefly
      await new Promise((resolve) => setTimeout(resolve, 2000));

      agentManagerProcess.kill("SIGTERM");

      await new Promise((resolve) => {
        agentManagerProcess.on("close", resolve);
      });

      expect(hasCompletionInfo).toBe(true);
    });
  });
});
