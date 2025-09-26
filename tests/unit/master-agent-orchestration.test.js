const { spawn } = require("child_process");
const fs = require("fs").promises;
const path = require("path");

describe("Master Agent Orchestration Tests", () => {
  let testProjectDir;
  let claudeDir;
  let orchestratorConfigFile;
  let tasksFile;
  let orchestratorProcess;

  beforeAll(async () => {
    testProjectDir = path.join(
      __dirname,
      "..",
      "fixtures",
      "master-agent-test",
    );
    claudeDir = path.join(testProjectDir, ".claude");
    orchestratorConfigFile = path.join(claudeDir, "orchestrator_config.json");
    tasksFile = path.join(claudeDir, "tasks.json");

    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(path.join(claudeDir, "logs"), { recursive: true });
  });

  beforeEach(async () => {
    // Reset config and tasks before each test
    const defaultConfig = {
      auto_delegate: true,
      max_concurrent_agents: 4,
      monitor_interval: 5,
      auto_retry_failed: true,
      delegation_history: [],
    };
    await fs.writeFile(
      orchestratorConfigFile,
      JSON.stringify(defaultConfig, null, 2),
    );
    await fs.writeFile(tasksFile, JSON.stringify([]));
  });

  afterEach(async () => {
    if (orchestratorProcess && !orchestratorProcess.killed) {
      orchestratorProcess.kill("SIGTERM");
      await new Promise((resolve) => {
        orchestratorProcess.on("close", resolve);
      });
    }
  });

  afterAll(async () => {
    try {
      await fs.rm(testProjectDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe("Request Analysis and Auto-Delegation", () => {
    test("correctly identifies delegatable tasks", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "orchestrator.py",
      );

      // Test various request types
      const testRequests = [
        {
          request:
            "Create comprehensive unit tests for the authentication module",
          expectedType: "testing",
          shouldDelegate: true,
        },
        {
          request: "Fix the memory leak in the data processing pipeline",
          expectedType: "bugs",
          shouldDelegate: true,
        },
        {
          request: "Implement input validation and sanitization for security",
          expectedType: "security",
          shouldDelegate: true,
        },
        {
          request: "Optimize database queries for better performance",
          expectedType: "performance",
          shouldDelegate: true,
        },
        {
          request: "Update the README with installation instructions",
          expectedType: "documentation",
          shouldDelegate: true,
        },
        {
          request: "Hello, how are you today?",
          expectedType: null,
          shouldDelegate: false,
        },
      ];

      for (const testCase of testRequests) {
        orchestratorProcess = spawn(
          "python3",
          [orchestratorScript, "analyze", testCase.request],
          {
            cwd: testProjectDir,
            stdio: "pipe",
          },
        );

        let stdout = "";
        let stderr = "";

        orchestratorProcess.stdout.on("data", (data) => {
          stdout += data.toString();
        });

        orchestratorProcess.stderr.on("data", (data) => {
          stderr += data.toString();
        });

        await new Promise((resolve) => {
          orchestratorProcess.on("close", (code) => {
            resolve({ code, stdout, stderr });
          });
        });

        expect(orchestratorProcess.exitCode).toBe(0);

        // Parse the JSON output
        const result = JSON.parse(stdout.trim());

        expect(result.should_auto_delegate).toBe(testCase.shouldDelegate);
        if (testCase.shouldDelegate) {
          expect(result.task_type).toBe(testCase.expectedType);
          expect(result.matched_keywords).toBeDefined();
          expect(Array.isArray(result.matched_keywords)).toBe(true);
        }
      }
    });

    test("respects auto-delegation configuration", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "orchestrator.py",
      );

      // Disable auto-delegation
      const config = {
        auto_delegate: false,
        max_concurrent_agents: 4,
        monitor_interval: 5,
        auto_retry_failed: true,
        delegation_history: [],
      };
      await fs.writeFile(
        orchestratorConfigFile,
        JSON.stringify(config, null, 2),
      );

      orchestratorProcess = spawn(
        "python3",
        [
          orchestratorScript,
          "delegate",
          "Create unit tests for the login functionality",
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
        orchestratorProcess.on("close", resolve);
      });

      const result = JSON.parse(stdout.trim());
      expect(result.delegated).toBe(false);
      expect(result.reason).toContain("Auto-delegation disabled");
    });

    test("force delegation overrides configuration", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "orchestrator.py",
      );

      // Disable auto-delegation
      const config = {
        auto_delegate: false,
        max_concurrent_agents: 4,
        monitor_interval: 5,
        auto_retry_failed: true,
        delegation_history: [],
      };
      await fs.writeFile(
        orchestratorConfigFile,
        JSON.stringify(config, null, 2),
      );

      orchestratorProcess = spawn(
        "python3",
        [
          orchestratorScript,
          "delegate",
          "--force",
          "Create unit tests for the login functionality",
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
        orchestratorProcess.on("close", resolve);
      });

      const result = JSON.parse(stdout.trim());
      expect(result.delegated).toBe(true);
      expect(result.task_type).toBe("testing");
    });
  });

  describe("Task Delegation and Monitoring", () => {
    test("successfully delegates tasks to agents", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "orchestrator.py",
      );

      orchestratorProcess = spawn(
        "python3",
        [
          orchestratorScript,
          "delegate",
          "Implement comprehensive error handling for the API endpoints",
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
        orchestratorProcess.on("close", resolve);
      });

      const result = JSON.parse(stdout.trim());
      expect(result.delegated).toBe(true);
      expect(result.task_type).toBe("bugs"); // Error handling falls under bugs category
      expect(result.return_code).toBeDefined();
    });

    test("tracks delegation history", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "orchestrator.py",
      );

      const requests = [
        "Create unit tests for user authentication",
        "Fix memory leak in data processor",
        "Optimize database query performance",
      ];

      for (const request of requests) {
        orchestratorProcess = spawn(
          "python3",
          [orchestratorScript, "delegate", request],
          {
            cwd: testProjectDir,
            stdio: "pipe",
          },
        );

        await new Promise((resolve) => {
          orchestratorProcess.on("close", resolve);
        });
      }

      // Check that delegation history was updated
      const config = JSON.parse(
        await fs.readFile(orchestratorConfigFile, "utf8"),
      );
      expect(config.delegation_history).toHaveLength(3);

      config.delegation_history.forEach((entry, index) => {
        expect(entry).toHaveProperty("timestamp");
        expect(entry).toHaveProperty("objective");
        expect(entry).toHaveProperty("task_type");
        expect(entry).toHaveProperty("matched_keywords");
        expect(entry.objective).toBe(requests[index]);
      });
    });

    test("provides meaningful delegation recommendations", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "orchestrator.py",
      );

      orchestratorProcess = spawn(
        "python3",
        [orchestratorScript, "recommend"],
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
        orchestratorProcess.on("close", resolve);
      });

      const output = stdout.trim();
      expect(output).toContain("Recommended delegations:");

      // Should provide at least some recommendations
      const lines = output.split("\n").filter((line) => line.trim().length > 0);
      expect(lines.length).toBeGreaterThan(1); // At least header + 1 recommendation
    });
  });

  describe("Task Planning and Breakdown", () => {
    test("breaks down high-level objectives into specific tasks", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "orchestrator.py",
      );

      const testObjectives = [
        {
          objective:
            "Implement comprehensive testing for the entire application",
          expectedTasks: [
            "unit tests",
            "integration tests",
            "end-to-end tests",
          ],
        },
        {
          objective: "Make the application production ready",
          expectedTasks: [
            "error handling",
            "monitoring",
            "logging",
            "health check",
          ],
        },
      ];

      for (const testCase of testObjectives) {
        orchestratorProcess = spawn(
          "python3",
          [orchestratorScript, "plan", testCase.objective],
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
          orchestratorProcess.on("close", resolve);
        });

        const output = stdout.trim();
        expect(output).toContain(`Delegation plan for: ${testCase.objective}`);

        // Should contain numbered tasks
        const taskLines = output
          .split("\n")
          .filter((line) => line.trim().match(/^\d+\./));
        expect(taskLines.length).toBeGreaterThan(0);

        // Check that expected task types are present
        const taskText = taskLines.join(" ").toLowerCase();
        testCase.expectedTasks.forEach((expectedTask) => {
          expect(taskText).toContain(expectedTask.toLowerCase());
        });
      }
    });

    test("handles non-delegatable requests appropriately", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "orchestrator.py",
      );

      orchestratorProcess = spawn(
        "python3",
        [orchestratorScript, "plan", "What is the weather like today?"],
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
        orchestratorProcess.on("close", resolve);
      });

      const output = stdout.trim();
      expect(output).toContain(
        "Delegation plan for: What is the weather like today?",
      );

      // Should still provide the original objective as a task
      const taskLines = output
        .split("\n")
        .filter((line) => line.trim().match(/^\d+\./));
      expect(taskLines.length).toBeGreaterThan(0);
      expect(taskLines[0]).toContain("What is the weather like today?");
    });
  });

  describe("Agent Monitoring and Status", () => {
    test("monitors agent status continuously", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "orchestrator.py",
      );

      orchestratorProcess = spawn("python3", [orchestratorScript, "monitor"], {
        cwd: testProjectDir,
        stdio: "pipe",
        timeout: 10000, // Kill after 10 seconds for testing
      });

      let stdout = "";
      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      // Let it run for a few seconds
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Kill the process
      orchestratorProcess.kill("SIGTERM");

      await new Promise((resolve) => {
        orchestratorProcess.on("close", resolve);
      });

      const output = stdout.trim();
      expect(output).toBeDefined();
      // Should contain some monitoring output
      expect(output.length).toBeGreaterThan(0);
    });

    test("handles monitoring errors gracefully", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "orchestrator.py",
      );

      // Remove the launch script to simulate missing dependency
      const launchScript = path.join(claudeDir, "launch.sh");
      if (
        await fs
          .access(launchScript)
          .then(() => true)
          .catch(() => false)
      ) {
        await fs.unlink(launchScript);
      }

      orchestratorProcess = spawn("python3", [orchestratorScript, "monitor"], {
        cwd: testProjectDir,
        stdio: "pipe",
        timeout: 5000,
      });

      let stderr = "";
      orchestratorProcess.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      await new Promise((resolve) => {
        orchestratorProcess.on("close", (code) => {
          // Process should exit gracefully even with errors
          expect(code).toBe(0);
          resolve();
        });
      });

      // Should not crash completely
      expect(orchestratorProcess.killed).toBe(true); // We killed it with timeout
    });
  });
});
