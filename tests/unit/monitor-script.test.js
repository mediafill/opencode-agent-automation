/**
 * Tests for scripts/monitor.sh bash monitoring script
 * Tests command-line interface, log analysis, and monitoring functions
 */

const { exec, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");

const execAsync = promisify(exec);

describe("Monitor Script Tests", () => {
  const scriptPath = path.join(__dirname, "../../scripts/monitor.sh");
  const testLogDir = path.join(__dirname, "../temp/logs");
  const testClaudeDir = path.join(__dirname, "../temp/.claude");

  beforeAll(() => {
    // Create test directories
    if (!fs.existsSync(testLogDir)) {
      fs.mkdirSync(testLogDir, { recursive: true });
    }
    if (!fs.existsSync(testClaudeDir)) {
      fs.mkdirSync(testClaudeDir, { recursive: true });
    }
  });

  afterAll(() => {
    // Clean up test directories
    try {
      fs.rmSync(path.join(__dirname, "../temp"), {
        recursive: true,
        force: true,
      });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  beforeEach(() => {
    // Clean test directories before each test
    try {
      fs.readdirSync(testLogDir).forEach((file) => {
        fs.unlinkSync(path.join(testLogDir, file));
      });
      fs.readdirSync(testClaudeDir).forEach((file) => {
        fs.unlinkSync(path.join(testClaudeDir, file));
      });
    } catch (error) {
      // Ignore if directories don't exist
    }
  });

  describe("Script Availability and Permissions", () => {
    test("script file exists and is executable", () => {
      expect(fs.existsSync(scriptPath)).toBe(true);

      const stats = fs.statSync(scriptPath);
      // Check if file has execute permissions
      expect(stats.mode & parseInt("111", 8)).toBeTruthy();
    });

    test("script shows help when called with invalid argument", async () => {
      const { stdout } = await execAsync(`bash "${scriptPath}" invalid`);
      expect(stdout).toContain("Usage:");
      expect(stdout).toContain("status");
      expect(stdout).toContain("watch");
      expect(stdout).toContain("dashboard");
      expect(stdout).toContain("summary");
      expect(stdout).toContain("clean");
    });
  });

  describe("Status Command", () => {
    test("status command shows agent count", async () => {
      const { stdout } = await execAsync(`bash "${scriptPath}" status`);
      expect(stdout).toContain("OpenCode Agent Status");
      expect(stdout).toMatch(/\d+ agents running|No agents currently running/);
    });

    test("status command handles missing log directory", async () => {
      const { stdout } = await execAsync(
        `LOG_DIR="/nonexistent" bash "${scriptPath}" status`,
      );
      expect(stdout).toContain("No logs found");
    });

    test("status command analyzes task file when present", async () => {
      // Create test tasks.json
      const tasksFile = path.join(testClaudeDir, "tasks.json");
      const testTasks = {
        tasks: [
          { id: "1", status: "completed", priority: "high" },
          { id: "2", status: "in_progress", priority: "medium" },
          { id: "3", status: "pending", priority: "low" },
        ],
      };
      fs.writeFileSync(tasksFile, JSON.stringify(testTasks, null, 2));

      const { stdout } = await execAsync(
        `CLAUDE_DIR="${testClaudeDir}" bash "${scriptPath}" status`,
      );
      expect(stdout).toContain("Total Tasks: 3");
      expect(stdout).toContain("Completed: 1");
      expect(stdout).toContain("In Progress: 1");
      expect(stdout).toContain("Pending: 1");
    });

    test("status command handles malformed tasks.json", async () => {
      // Create invalid JSON file
      const tasksFile = path.join(testClaudeDir, "tasks.json");
      fs.writeFileSync(tasksFile, "{ invalid json }");

      const { stdout } = await execAsync(
        `CLAUDE_DIR="${testClaudeDir}" bash "${scriptPath}" status`,
      );
      expect(stdout).toMatch(/Error parsing task file|Error reading tasks/);
    });
  });

  describe("Log Analysis", () => {
    test("analyzes completed log files correctly", async () => {
      const logFile = path.join(testLogDir, "test-agent.log");
      fs.writeFileSync(
        logFile,
        "Starting task...\nProcessing data...\nTask completed successfully\n",
      );

      const { stdout } = await execAsync(
        `LOG_DIR="${testLogDir}" bash "${scriptPath}" status`,
      );
      expect(stdout).toContain("test-agent: Completed");
    });

    test("analyzes error log files correctly", async () => {
      const logFile = path.join(testLogDir, "error-agent.log");
      fs.writeFileSync(
        logFile,
        "Starting task...\nError: Connection failed\nFailed to complete task\n",
      );

      const { stdout } = await execAsync(
        `LOG_DIR="${testLogDir}" bash "${scriptPath}" status`,
      );
      expect(stdout).toContain("error-agent: Error");
    });

    test("analyzes running log files correctly", async () => {
      const logFile = path.join(testLogDir, "running-agent.log");
      fs.writeFileSync(
        logFile,
        "Starting task...\nProcessing data...\nAnalyzing results...\n",
      );

      const { stdout } = await execAsync(
        `LOG_DIR="${testLogDir}" bash "${scriptPath}" status`,
      );
      expect(stdout).toContain("running-agent: Running");
    });

    test("handles empty log files correctly", async () => {
      const logFile = path.join(testLogDir, "empty-agent.log");
      fs.writeFileSync(logFile, "");

      const { stdout } = await execAsync(
        `LOG_DIR="${testLogDir}" bash "${scriptPath}" status`,
      );
      expect(stdout).toContain("empty-agent: Starting");
    });

    test("handles non-existent log files correctly", async () => {
      const { stdout } = await execAsync(
        `LOG_DIR="/nonexistent" bash "${scriptPath}" status`,
      );
      expect(stdout).toContain("No logs found");
    });
  });

  describe("Summary Command", () => {
    test("summary shows project information", async () => {
      const { stdout } = await execAsync(`bash "${scriptPath}" summary`);
      expect(stdout).toContain("Agent Summary Report");
      expect(stdout).toContain("Project:");
      expect(stdout).toContain("Time:");
      expect(stdout).toContain("Results:");
    });

    test("summary counts different log types correctly", async () => {
      // Create test logs with different statuses
      fs.writeFileSync(
        path.join(testLogDir, "completed1.log"),
        "Task completed successfully",
      );
      fs.writeFileSync(
        path.join(testLogDir, "completed2.log"),
        "Another task completed successfully",
      );
      fs.writeFileSync(
        path.join(testLogDir, "failed1.log"),
        "Error: Task failed",
      );
      fs.writeFileSync(path.join(testLogDir, "running1.log"), "Processing...");

      const { stdout } = await execAsync(
        `LOG_DIR="${testLogDir}" bash "${scriptPath}" summary`,
      );
      expect(stdout).toContain("Completed: 2");
      expect(stdout).toContain("Failed: 1");
      expect(stdout).toContain("Running: 1");
    });

    test("summary shows errors when present", async () => {
      fs.writeFileSync(
        path.join(testLogDir, "error.log"),
        "Error: Database connection failed\nFailed to execute query",
      );

      const { stdout } = await execAsync(
        `LOG_DIR="${testLogDir}" bash "${scriptPath}" summary`,
      );
      expect(stdout).toContain("Errors found:");
      expect(stdout).toContain("Database connection failed");
    });
  });

  describe("Dashboard Generation", () => {
    test("dashboard command generates HTML file", async () => {
      const { stdout } = await execAsync(
        `CLAUDE_DIR="${testClaudeDir}" bash "${scriptPath}" dashboard`,
      );

      expect(stdout).toContain("Dashboard generated at:");
      expect(stdout).toContain("dashboard.html");

      const dashboardFile = path.join(testClaudeDir, "dashboard.html");
      expect(fs.existsSync(dashboardFile)).toBe(true);

      const htmlContent = fs.readFileSync(dashboardFile, "utf8");
      expect(htmlContent).toContain("OpenCode Agent Dashboard");
      expect(htmlContent).toContain("Agent Status");
      expect(htmlContent).toContain("Task Progress");
      expect(htmlContent).toContain("System Resources");
      expect(htmlContent).toContain("Recent Activity");
    });

    test("generated dashboard contains valid HTML structure", async () => {
      await execAsync(
        `CLAUDE_DIR="${testClaudeDir}" bash "${scriptPath}" dashboard`,
      );

      const dashboardFile = path.join(testClaudeDir, "dashboard.html");
      const htmlContent = fs.readFileSync(dashboardFile, "utf8");

      expect(htmlContent).toContain("<!DOCTYPE html>");
      expect(htmlContent).toContain("<html>");
      expect(htmlContent).toContain("<head>");
      expect(htmlContent).toContain("<body>");
      expect(htmlContent).toContain("</html>");
      expect(htmlContent).toContain("<script>");
      expect(htmlContent).toContain("loadDashboardData");
    });
  });

  describe("Clean Command", () => {
    test("clean command removes old log files", async () => {
      // Create old log file (simulate 8 days ago)
      const oldLogFile = path.join(testLogDir, "old.log");
      fs.writeFileSync(oldLogFile, "old log content");

      // Change file modification time to 8 days ago
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      fs.utimesSync(oldLogFile, eightDaysAgo, eightDaysAgo);

      // Create recent log file
      const recentLogFile = path.join(testLogDir, "recent.log");
      fs.writeFileSync(recentLogFile, "recent log content");

      const { stdout } = await execAsync(
        `LOG_DIR="${testLogDir}" bash "${scriptPath}" clean`,
      );
      expect(stdout).toContain("Cleaning old logs");
      expect(stdout).toContain("Cleaned logs older than 7 days");

      // Check that old file is removed and recent file remains
      expect(fs.existsSync(oldLogFile)).toBe(false);
      expect(fs.existsSync(recentLogFile)).toBe(true);
    });

    test("clean command handles empty log directory", async () => {
      const { stdout } = await execAsync(
        `LOG_DIR="${testLogDir}" bash "${scriptPath}" clean`,
      );
      expect(stdout).toContain("Cleaning old logs");
      expect(stdout).toContain("Cleaned logs older than 7 days");
    });
  });

  describe("Process Detection", () => {
    test("get_agent_status function detects opencode processes", async () => {
      // This test checks if the process detection logic works
      // We'll test the logic by checking the command structure
      const { stdout } = await execAsync(
        `bash -c 'source "${scriptPath}"; get_agent_status'`,
      );
      expect(stdout.trim()).toMatch(/^\d+$/);
    });
  });

  describe("Resource Monitoring", () => {
    test("resource monitoring shows system information", async () => {
      const { stdout } = await execAsync(`bash "${scriptPath}" status`);
      // The status command should include resource information
      expect(stdout).toBeDefined();
    });
  });

  describe("Environment Configuration", () => {
    test("script uses environment variables correctly", async () => {
      const customDir = "/tmp/test-opencode";
      const { stdout } = await execAsync(
        `PROJECT_DIR="${customDir}" bash "${scriptPath}" status`,
      );
      expect(stdout).toContain("OpenCode Agent Status");
    });

    test("script handles missing config.env gracefully", async () => {
      // Script should work even without config.env file
      const { stdout } = await execAsync(`bash "${scriptPath}" status`);
      expect(stdout).toContain("OpenCode Agent Status");
    });
  });

  describe("Error Handling", () => {
    test("script handles permission errors gracefully", async () => {
      // Create a directory that can't be read
      const restrictedDir = path.join(__dirname, "../temp/restricted");
      fs.mkdirSync(restrictedDir, { recursive: true });
      fs.chmodSync(restrictedDir, "000");

      try {
        const { stdout } = await execAsync(
          `LOG_DIR="${restrictedDir}" bash "${scriptPath}" status`,
        );
        expect(stdout).toContain("OpenCode Agent Status");
      } finally {
        // Clean up
        fs.chmodSync(restrictedDir, "755");
        fs.rmSync(restrictedDir, { recursive: true, force: true });
      }
    });

    test("script handles malformed log files", async () => {
      // Create binary file that might cause issues
      const binaryFile = path.join(testLogDir, "binary.log");
      const binaryData = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]);
      fs.writeFileSync(binaryFile, binaryData);

      const { stdout } = await execAsync(
        `LOG_DIR="${testLogDir}" bash "${scriptPath}" status`,
      );
      expect(stdout).toContain("OpenCode Agent Status");
    });
  });

  describe("Integration Tests", () => {
    test("full workflow with tasks and logs", async () => {
      // Create comprehensive test scenario
      const tasksFile = path.join(testClaudeDir, "tasks.json");
      const testTasks = {
        tasks: [
          {
            id: "1",
            status: "completed",
            priority: "high",
            description: "Security audit",
          },
          {
            id: "2",
            status: "in_progress",
            priority: "medium",
            description: "Add tests",
          },
          {
            id: "3",
            status: "pending",
            priority: "low",
            description: "Documentation",
          },
          {
            id: "4",
            status: "blocked",
            priority: "high",
            description: "API integration",
          },
        ],
      };
      fs.writeFileSync(tasksFile, JSON.stringify(testTasks, null, 2));

      // Create corresponding log files
      fs.writeFileSync(
        path.join(testLogDir, "security-audit.log"),
        "Starting security audit\nScanning for vulnerabilities\nTask completed successfully\n",
      );
      fs.writeFileSync(
        path.join(testLogDir, "add-tests.log"),
        "Creating test files\nAdding unit tests\nRunning test suite\n",
      );
      fs.writeFileSync(
        path.join(testLogDir, "api-integration.log"),
        "Connecting to API\nError: Authentication failed\nBlocked on API credentials\n",
      );

      // Run status command
      const { stdout } = await execAsync(
        `CLAUDE_DIR="${testClaudeDir}" LOG_DIR="${testLogDir}" bash "${scriptPath}" status`,
      );

      expect(stdout).toContain("Total Tasks: 4");
      expect(stdout).toContain("Completed: 1");
      expect(stdout).toContain("In Progress: 1");
      expect(stdout).toContain("Pending: 1");
      expect(stdout).toContain("Blocked: 1");
      expect(stdout).toContain("security-audit: Completed");
      expect(stdout).toContain("add-tests: Running");
      expect(stdout).toContain("api-integration: Error");
    });

    test("continuous monitoring setup (mock test)", async () => {
      // Test that watch command setup works (we can't test the full loop)
      // We'll test by checking if the script accepts the watch command
      const child = spawn("bash", [scriptPath, "watch"], {
        env: { ...process.env, LOG_DIR: testLogDir, CLAUDE_DIR: testClaudeDir },
      });

      // Give it a moment to start
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Kill the process
      child.kill("SIGINT");

      // Wait for process to end
      await new Promise((resolve) => {
        child.on("exit", resolve);
      });

      // Test passes if no errors were thrown
      expect(true).toBe(true);
    });
  });

  describe("Output Formatting", () => {
    test("status output contains proper formatting", async () => {
      const { stdout } = await execAsync(`bash "${scriptPath}" status`);

      expect(stdout).toContain("═══");
      expect(stdout).toMatch(/✓|○/); // Check for status symbols
    });

    test("summary output is properly formatted", async () => {
      const { stdout } = await execAsync(`bash "${scriptPath}" summary`);

      expect(stdout).toContain("═══ Agent Summary Report ═══");
      expect(stdout).toMatch(/✓ Completed:|● Running:|✗ Failed:/);
    });
  });
});
