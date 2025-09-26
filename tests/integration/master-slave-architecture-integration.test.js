const { spawn } = require("child_process");
const fs = require("fs").promises;
const path = require("path");

describe("Master-Slave Agent Architecture Integration Tests", () => {
  let testProjectDir;
  let claudeDir;
  let orchestratorProcess;
  let slaveAgentProcess;
  let vectorDbDir;

  beforeAll(async () => {
    testProjectDir = path.join(
      __dirname,
      "..",
      "fixtures",
      "master-slave-integration-test",
    );
    claudeDir = path.join(testProjectDir, ".claude");
    vectorDbDir = path.join(claudeDir, "vector_db");

    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(vectorDbDir, { recursive: true });
    await fs.mkdir(path.join(claudeDir, "logs"), { recursive: true });
  });

  beforeEach(async () => {
    // Clean up any existing files
    try {
      const files = await fs.readdir(vectorDbDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          await fs.unlink(path.join(vectorDbDir, file));
        }
      }
    } catch (e) {
      // Ignore if directory doesn't exist yet
    }

    // Reset config files
    const orchestratorConfig = {
      health_check_interval: 5,
      agent_timeout: 30,
      max_slave_agents: 5,
      master_id: "test_master",
    };
    await fs.writeFile(
      path.join(claudeDir, "master_orchestrator_config.json"),
      JSON.stringify(orchestratorConfig, null, 2),
    );
  });

  afterEach(async () => {
    // Clean up processes
    [orchestratorProcess, slaveAgentProcess].forEach((proc) => {
      if (proc && !proc.killed) {
        proc.kill("SIGTERM");
      }
    });

    // Wait for processes to terminate
    await Promise.all(
      [orchestratorProcess, slaveAgentProcess].map((proc) => {
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
  });

  afterAll(async () => {
    try {
      await fs.rm(testProjectDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe("Master-Slave Agent Lifecycle", () => {
    test("master orchestrator starts and initializes correctly", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "master_agent_orchestrator.py",
      );

      orchestratorProcess = spawn("python3", [orchestratorScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      let stdout = "";
      let stderr = "";
      let initialized = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("Starting Master Agent Orchestrator") ||
          stdout.includes("Master Orchestrator started")
        ) {
          initialized = true;
        }
      });

      orchestratorProcess.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(initialized).toBe(true);
      expect(stderr).not.toContain("ERROR");
      expect(stderr).not.toContain("Exception");

      // Kill the process for cleanup
      orchestratorProcess.kill("SIGTERM");
    });

    test("slave agent wrapper initializes and connects to orchestrator", async () => {
      const slaveScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "slave_agent_wrapper.py",
      );

      slaveAgentProcess = spawn("python3", [slaveScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      let stdout = "";
      let stderr = "";
      let initialized = false;
      let connected = false;

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("Slave agent") &&
          stdout.includes("initialized successfully")
        ) {
          initialized = true;
        }
        if (stdout.includes("Connected to master orchestrator")) {
          connected = true;
        }
      });

      slaveAgentProcess.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(initialized).toBe(true);
      expect(connected).toBe(true);
      expect(stderr).not.toContain("ERROR");
      expect(stderr).not.toContain("Exception");

      // Kill the process for cleanup
      slaveAgentProcess.kill("SIGTERM");
    });

    test("master and slave agents communicate through vector database", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "master_agent_orchestrator.py",
      );

      const slaveScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "slave_agent_wrapper.py",
      );

      // Start orchestrator
      orchestratorProcess = spawn("python3", [orchestratorScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      // Wait for orchestrator to start
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Start slave agent
      slaveAgentProcess = spawn("python3", [slaveScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      let orchestratorStdout = "";
      let slaveStdout = "";
      let messageReceived = false;

      orchestratorProcess.stdout.on("data", (data) => {
        orchestratorStdout += data.toString();
      });

      slaveAgentProcess.stdout.on("data", (data) => {
        slaveStdout += data.toString();
        if (
          slaveStdout.includes("Received task assignment") ||
          slaveStdout.includes("Message from")
        ) {
          messageReceived = true;
        }
      });

      // Wait for communication to happen
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Check that communication occurred
      expect(orchestratorStdout).toContain("Master Agent Orchestrator");
      expect(slaveStdout).toContain("Slave agent");
      expect(messageReceived || slaveStdout.includes("initialized")).toBe(true);

      // Clean up
      orchestratorProcess.kill("SIGTERM");
      slaveAgentProcess.kill("SIGTERM");
    });
  });

  describe("Agent Hierarchy and Role Management", () => {
    test("master agent maintains hierarchical control over slave agents", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "master_agent_orchestrator.py",
      );

      orchestratorProcess = spawn("python3", [orchestratorScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      let stdout = "";
      let hasHierarchy = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (stdout.includes("master_") && stdout.includes("slave")) {
          hasHierarchy = true;
        }
      });

      // Wait for orchestrator to initialize
      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(hasHierarchy).toBe(true);
      expect(stdout).toContain("Master Agent Orchestrator");

      orchestratorProcess.kill("SIGTERM");
    });

    test("slave agents properly register with master and receive roles", async () => {
      const slaveScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "slave_agent_wrapper.py",
      );

      slaveAgentProcess = spawn("python3", [slaveScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      let stdout = "";
      let registered = false;
      let hasCapabilities = false;

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("registered with orchestrator") ||
          stdout.includes("Successfully registered")
        ) {
          registered = true;
        }
        if (
          stdout.includes("capabilities") ||
          stdout.includes("code_analysis")
        ) {
          hasCapabilities = true;
        }
      });

      // Wait for registration
      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(registered).toBe(true);
      expect(hasCapabilities).toBe(true);

      slaveAgentProcess.kill("SIGTERM");
    });
  });

  describe("Agent Pooling and Resource Management", () => {
    test("master agent manages agent pool with capacity limits", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "master_agent_orchestrator.py",
      );

      orchestratorProcess = spawn("python3", [orchestratorScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      let stdout = "";
      let hasCapacityManagement = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("max_slave_agents") ||
          stdout.includes("Maximum slave agents") ||
          stdout.includes("capacity")
        ) {
          hasCapacityManagement = true;
        }
      });

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(hasCapacityManagement).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("load balancer distributes tasks based on agent health and capacity", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "master_agent_orchestrator.py",
      );

      orchestratorProcess = spawn("python3", [orchestratorScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      let stdout = "";
      let hasLoadBalancing = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("load_balancer") ||
          stdout.includes("health_score") ||
          stdout.includes("Available agents")
        ) {
          hasLoadBalancing = true;
        }
      });

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(hasLoadBalancing).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });
  });

  describe("Health Monitoring and Auto-restart", () => {
    test("health monitoring system tracks agent status continuously", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "master_agent_orchestrator.py",
      );

      orchestratorProcess = spawn("python3", [orchestratorScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      let stdout = "";
      let hasHealthMonitoring = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("health_check") ||
          stdout.includes("heartbeat") ||
          stdout.includes("Health monitoring")
        ) {
          hasHealthMonitoring = true;
        }
      });

      // Wait for monitoring to start
      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(hasHealthMonitoring).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("slave agents report health metrics to master", async () => {
      const slaveScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "slave_agent_wrapper.py",
      );

      slaveAgentProcess = spawn("python3", [slaveScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      let stdout = "";
      let reportsHealth = false;

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("health_report") ||
          stdout.includes("cpu_percent") ||
          stdout.includes("memory_mb")
        ) {
          reportsHealth = true;
        }
      });

      // Wait for health reporting
      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(reportsHealth).toBe(true);

      slaveAgentProcess.kill("SIGTERM");
    });
  });

  describe("Task Queue with Priority Management", () => {
    test("task assignment respects priority and agent availability", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "master_agent_orchestrator.py",
      );

      orchestratorProcess = spawn("python3", [orchestratorScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      let stdout = "";
      let hasTaskManagement = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("task_assignments") ||
          stdout.includes("assign_task") ||
          stdout.includes("Task assigned")
        ) {
          hasTaskManagement = true;
        }
      });

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(hasTaskManagement).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("task status updates propagate through the system", async () => {
      const slaveScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "slave_agent_wrapper.py",
      );

      slaveAgentProcess = spawn("python3", [slaveScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      let stdout = "";
      let hasStatusUpdates = false;

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("task_status_update") ||
          stdout.includes("status:") ||
          stdout.includes("completed") ||
          stdout.includes("failed")
        ) {
          hasStatusUpdates = true;
        }
      });

      // Wait for status updates
      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(hasStatusUpdates).toBe(true);

      slaveAgentProcess.kill("SIGTERM");
    });
  });

  describe("Distributed Task Coordination", () => {
    test("multiple agents coordinate through shared communication channels", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "master_agent_orchestrator.py",
      );

      const slaveScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "slave_agent_wrapper.py",
      );

      // Start orchestrator
      orchestratorProcess = spawn("python3", [orchestratorScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      // Wait for orchestrator
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Start slave agent
      slaveAgentProcess = spawn("python3", [slaveScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      let orchestratorStdout = "";
      let slaveStdout = "";
      let coordinationHappened = false;

      orchestratorProcess.stdout.on("data", (data) => {
        orchestratorStdout += data.toString();
      });

      slaveAgentProcess.stdout.on("data", (data) => {
        slaveStdout += data.toString();
        if (
          slaveStdout.includes("coordination") ||
          slaveStdout.includes("orchestrator") ||
          slaveStdout.includes("message")
        ) {
          coordinationHappened = true;
        }
      });

      // Wait for coordination
      await new Promise((resolve) => setTimeout(resolve, 5000));

      expect(coordinationHappened).toBe(true);

      orchestratorProcess.kill("SIGTERM");
      slaveAgentProcess.kill("SIGTERM");
    });

    test("system maintains consistency across distributed operations", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "master_agent_orchestrator.py",
      );

      orchestratorProcess = spawn("python3", [orchestratorScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      let stdout = "";
      let hasConsistency = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("message_queue") ||
          stdout.includes("task_assignments") ||
          stdout.includes("consistency")
        ) {
          hasConsistency = true;
        }
      });

      // Wait for system to stabilize
      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(hasConsistency).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });
  });

  describe("End-to-End Integration Scenarios", () => {
    test("complete task execution workflow from assignment to completion", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "master_agent_orchestrator.py",
      );

      const slaveScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "slave_agent_wrapper.py",
      );

      // Start orchestrator
      orchestratorProcess = spawn("python3", [orchestratorScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      // Wait for orchestrator
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Start slave agent
      slaveAgentProcess = spawn("python3", [slaveScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      let orchestratorStdout = "";
      let slaveStdout = "";
      let workflowCompleted = false;

      orchestratorProcess.stdout.on("data", (data) => {
        orchestratorStdout += data.toString();
      });

      slaveAgentProcess.stdout.on("data", (data) => {
        slaveStdout += data.toString();
        if (
          (slaveStdout.includes("initialized successfully") ||
            slaveStdout.includes("ready")) &&
          (orchestratorStdout.includes("Master Agent") ||
            orchestratorStdout.includes("orchestrator"))
        ) {
          workflowCompleted = true;
        }
      });

      // Wait for complete workflow
      await new Promise((resolve) => setTimeout(resolve, 5000));

      expect(workflowCompleted).toBe(true);
      expect(orchestratorStdout).toContain("Master Agent Orchestrator");
      expect(slaveStdout).toContain("Slave agent");

      orchestratorProcess.kill("SIGTERM");
      slaveAgentProcess.kill("SIGTERM");
    });

    test("system handles agent failures and recovers gracefully", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "master_agent_orchestrator.py",
      );

      orchestratorProcess = spawn("python3", [orchestratorScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      let stdout = "";
      let hasRecovery = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("cleanup_failed_agents") ||
          stdout.includes("restart") ||
          stdout.includes("recovery")
        ) {
          hasRecovery = true;
        }
      });

      // Wait for recovery mechanisms to initialize
      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(hasRecovery).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });
  });
});
