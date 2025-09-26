const { spawn } = require("child_process");
const fs = require("fs").promises;
const path = require("path");

describe("End-to-End Master-Slave Agent Integration Tests", () => {
  let testProjectDir;
  let claudeDir;
  let orchestratorProcess;
  let slaveAgentProcess1;
  let slaveAgentProcess2;

  beforeAll(async () => {
    testProjectDir = path.join(
      __dirname,
      "..",
      "fixtures",
      "end-to-end-integration-test",
    );
    claudeDir = path.join(testProjectDir, ".claude");

    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(path.join(claudeDir, "logs"), { recursive: true });
    await fs.mkdir(path.join(claudeDir, "vector_db"), { recursive: true });
  });

  beforeEach(async () => {
    // Reset config for end-to-end testing
    const config = {
      health_check_interval: 3, // Faster for testing
      agent_timeout: 10,
      max_slave_agents: 3,
      master_id: "e2e_test_master",
    };
    await fs.writeFile(
      path.join(claudeDir, "master_orchestrator_config.json"),
      JSON.stringify(config, null, 2),
    );

    // Clean vector DB
    try {
      const files = await fs.readdir(path.join(claudeDir, "vector_db"));
      for (const file of files) {
        if (file.endsWith(".json")) {
          await fs.unlink(path.join(claudeDir, "vector_db", file));
        }
      }
    } catch (e) {
      // Ignore if directory doesn't exist
    }
  });

  afterEach(async () => {
    // Clean up all processes
    [orchestratorProcess, slaveAgentProcess1, slaveAgentProcess2].forEach(
      (proc) => {
        if (proc && !proc.killed) {
          proc.kill("SIGTERM");
        }
      },
    );

    // Wait for all processes to terminate
    await Promise.all(
      [orchestratorProcess, slaveAgentProcess1, slaveAgentProcess2].map(
        (proc) => {
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
        },
      ),
    );
  });

  afterAll(async () => {
    try {
      await fs.rm(testProjectDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe("Complete System Startup and Initialization", () => {
    test("full master-slave system starts up correctly", async () => {
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

      // Wait for orchestrator to initialize
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Start first slave agent
      slaveAgentProcess1 = spawn("python3", [slaveScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      // Start second slave agent
      slaveAgentProcess2 = spawn("python3", [slaveScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      let orchestratorReady = false;
      let slave1Ready = false;
      let slave2Ready = false;

      orchestratorProcess.stdout.on("data", (data) => {
        const output = data.toString();
        if (
          output.includes("Master Agent Orchestrator") ||
          output.includes("orchestrator started")
        ) {
          orchestratorReady = true;
        }
      });

      slaveAgentProcess1.stdout.on("data", (data) => {
        const output = data.toString();
        if (output.includes("Slave agent") && output.includes("initialized")) {
          slave1Ready = true;
        }
      });

      slaveAgentProcess2.stdout.on("data", (data) => {
        const output = data.toString();
        if (output.includes("Slave agent") && output.includes("initialized")) {
          slave2Ready = true;
        }
      });

      // Wait for all components to start
      await new Promise((resolve) => setTimeout(resolve, 5000));

      expect(orchestratorReady).toBe(true);
      expect(slave1Ready).toBe(true);
      expect(slave2Ready).toBe(true);

      // Clean up
      orchestratorProcess.kill("SIGTERM");
      slaveAgentProcess1.kill("SIGTERM");
      slaveAgentProcess2.kill("SIGTERM");
    });

    test("agents discover and register with master orchestrator", async () => {
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

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Start slave agents
      slaveAgentProcess1 = spawn("python3", [slaveScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      slaveAgentProcess2 = spawn("python3", [slaveScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      let registrationComplete = false;
      let orchestratorStdout = "";
      let slave1Stdout = "";
      let slave2Stdout = "";

      orchestratorProcess.stdout.on("data", (data) => {
        orchestratorStdout += data.toString();
      });

      slaveAgentProcess1.stdout.on("data", (data) => {
        slave1Stdout += data.toString();
        if (
          slave1Stdout.includes("registered") ||
          slave1Stdout.includes("connected to orchestrator")
        ) {
          registrationComplete = true;
        }
      });

      slaveAgentProcess2.stdout.on("data", (data) => {
        slave2Stdout += data.toString();
        if (
          slave2Stdout.includes("registered") ||
          slave2Stdout.includes("connected to orchestrator")
        ) {
          registrationComplete = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 5000));

      expect(registrationComplete).toBe(true);
      expect(orchestratorStdout).toContain("Master Agent Orchestrator");

      orchestratorProcess.kill("SIGTERM");
      slaveAgentProcess1.kill("SIGTERM");
      slaveAgentProcess2.kill("SIGTERM");
    });
  });

  describe("Task Assignment and Execution Workflow", () => {
    test("master assigns tasks to available slave agents", async () => {
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

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Start slave agents
      slaveAgentProcess1 = spawn("python3", [slaveScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      slaveAgentProcess2 = spawn("python3", [slaveScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      let taskAssigned = false;
      let slave1ReceivedTask = false;
      let slave2ReceivedTask = false;

      slaveAgentProcess1.stdout.on("data", (data) => {
        const output = data.toString();
        if (
          output.includes("Received task assignment") ||
          output.includes("task_id")
        ) {
          slave1ReceivedTask = true;
          taskAssigned = true;
        }
      });

      slaveAgentProcess2.stdout.on("data", (data) => {
        const output = data.toString();
        if (
          output.includes("Received task assignment") ||
          output.includes("task_id")
        ) {
          slave2ReceivedTask = true;
          taskAssigned = true;
        }
      });

      // Wait for task assignment to occur
      await new Promise((resolve) => setTimeout(resolve, 8000));

      expect(taskAssigned).toBe(true);

      orchestratorProcess.kill("SIGTERM");
      slaveAgentProcess1.kill("SIGTERM");
      slaveAgentProcess2.kill("SIGTERM");
    });

    test("agents execute assigned tasks and report completion", async () => {
      const slaveScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "slave_agent_wrapper.py",
      );

      slaveAgentProcess1 = spawn("python3", [slaveScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      let taskExecuted = false;
      let taskCompleted = false;

      slaveAgentProcess1.stdout.on("data", (data) => {
        const output = data.toString();
        if (
          output.includes("Starting execution") ||
          output.includes("_execute_task")
        ) {
          taskExecuted = true;
        }
        if (
          output.includes("completed successfully") ||
          output.includes("_complete_task")
        ) {
          taskCompleted = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 5000));

      expect(taskExecuted).toBe(true);
      expect(taskCompleted).toBe(true);

      slaveAgentProcess1.kill("SIGTERM");
    });

    test("task status updates flow back to master orchestrator", async () => {
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

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Start slave
      slaveAgentProcess1 = spawn("python3", [slaveScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      let statusUpdateReceived = false;

      orchestratorProcess.stdout.on("data", (data) => {
        const output = data.toString();
        if (
          output.includes("task_status_update") ||
          output.includes("Task completed") ||
          output.includes("status: completed")
        ) {
          statusUpdateReceived = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 8000));

      expect(statusUpdateReceived).toBe(true);

      orchestratorProcess.kill("SIGTERM");
      slaveAgentProcess1.kill("SIGTERM");
    });
  });

  describe("Health Monitoring and Auto-restart E2E", () => {
    test("health monitoring works across the entire system", async () => {
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

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Start slave
      slaveAgentProcess1 = spawn("python3", [slaveScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      let healthMonitoringActive = false;
      let healthReportsReceived = false;

      orchestratorProcess.stdout.on("data", (data) => {
        const output = data.toString();
        if (
          output.includes("health_monitoring_loop") ||
          output.includes("_perform_health_checks")
        ) {
          healthMonitoringActive = true;
        }
        if (
          output.includes("cpu_percent") ||
          output.includes("memory_mb") ||
          output.includes("health_score")
        ) {
          healthReportsReceived = true;
        }
      });

      slaveAgentProcess1.stdout.on("data", (data) => {
        const output = data.toString();
        if (
          output.includes("health_report") ||
          output.includes("ResourceMonitor")
        ) {
          healthReportsReceived = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 10000));

      expect(healthMonitoringActive).toBe(true);
      expect(healthReportsReceived).toBe(true);

      orchestratorProcess.kill("SIGTERM");
      slaveAgentProcess1.kill("SIGTERM");
    });

    test("system recovers from agent failures automatically", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "master_agent_orchestrator.py",
      );

      // Start orchestrator
      orchestratorProcess = spawn("python3", [orchestratorScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      let failureHandlingActive = false;

      orchestratorProcess.stdout.on("data", (data) => {
        const output = data.toString();
        if (
          output.includes("_cleanup_failed_agents") ||
          output.includes("_attempt_agent_restart") ||
          output.includes("agent.status = AgentStatus.FAILED")
        ) {
          failureHandlingActive = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 5000));

      expect(failureHandlingActive).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });
  });

  describe("Load Balancing and Resource Management E2E", () => {
    test("load balancer distributes work across multiple agents", async () => {
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

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Start multiple slaves
      slaveAgentProcess1 = spawn("python3", [slaveScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      slaveAgentProcess2 = spawn("python3", [slaveScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      let loadBalancingActive = false;
      let tasksDistributed = false;

      orchestratorProcess.stdout.on("data", (data) => {
        const output = data.toString();
        if (
          output.includes("load_balancer") ||
          output.includes("available_agents") ||
          output.includes("selected_agent")
        ) {
          loadBalancingActive = true;
        }
      });

      slaveAgentProcess1.stdout.on("data", (data) => {
        const output = data.toString();
        if (output.includes("task assignment")) {
          tasksDistributed = true;
        }
      });

      slaveAgentProcess2.stdout.on("data", (data) => {
        const output = data.toString();
        if (output.includes("task assignment")) {
          tasksDistributed = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 8000));

      expect(loadBalancingActive).toBe(true);
      expect(tasksDistributed).toBe(true);

      orchestratorProcess.kill("SIGTERM");
      slaveAgentProcess1.kill("SIGTERM");
      slaveAgentProcess2.kill("SIGTERM");
    });

    test("resource usage is monitored and managed system-wide", async () => {
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

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Start slave
      slaveAgentProcess1 = spawn("python3", [slaveScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      let resourceMonitoringActive = false;

      orchestratorProcess.stdout.on("data", (data) => {
        const output = data.toString();
        if (
          output.includes("resource_usage") ||
          output.includes("cpu_percent") ||
          output.includes("memory_mb")
        ) {
          resourceMonitoringActive = true;
        }
      });

      slaveAgentProcess1.stdout.on("data", (data) => {
        const output = data.toString();
        if (
          output.includes("ResourceMonitor") ||
          output.includes("cpu_percent")
        ) {
          resourceMonitoringActive = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 8000));

      expect(resourceMonitoringActive).toBe(true);

      orchestratorProcess.kill("SIGTERM");
      slaveAgentProcess1.kill("SIGTERM");
    });
  });

  describe("System Reliability and Fault Tolerance E2E", () => {
    test("system continues operating when individual agents fail", async () => {
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

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Start slave
      slaveAgentProcess1 = spawn("python3", [slaveScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      // Let it run briefly, then kill slave to simulate failure
      await new Promise((resolve) => setTimeout(resolve, 3000));

      slaveAgentProcess1.kill("SIGTERM");

      // Wait for orchestrator to detect failure and continue
      await new Promise((resolve) => setTimeout(resolve, 5000));

      let orchestratorStillRunning = false;
      orchestratorProcess.stdout.on("data", (data) => {
        const output = data.toString();
        if (
          output.includes("Master Agent Orchestrator") ||
          output.includes("get_system_status")
        ) {
          orchestratorStillRunning = true;
        }
      });

      expect(orchestratorStillRunning).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("communication failures don't break task coordination", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "master_agent_orchestrator.py",
      );

      // Start orchestrator
      orchestratorProcess = spawn("python3", [orchestratorScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      let communicationRobust = false;

      orchestratorProcess.stdout.on("data", (data) => {
        const output = data.toString();
        if (
          output.includes("VECTOR_DB_AVAILABLE = False") ||
          output.includes("message_queue") ||
          output.includes("fallback")
        ) {
          communicationRobust = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 5000));

      expect(communicationRobust).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });
  });

  describe("Performance and Scalability E2E", () => {
    test("system maintains performance under load", async () => {
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

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Start multiple slaves
      slaveAgentProcess1 = spawn("python3", [slaveScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      slaveAgentProcess2 = spawn("python3", [slaveScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      let performanceMaintained = false;

      orchestratorProcess.stdout.on("data", (data) => {
        const output = data.toString();
        if (
          output.includes("get_system_status") ||
          output.includes("healthy_agents") ||
          output.includes("No available agents")
        ) {
          performanceMaintained = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 10000));

      expect(performanceMaintained).toBe(true);

      orchestratorProcess.kill("SIGTERM");
      slaveAgentProcess1.kill("SIGTERM");
      slaveAgentProcess2.kill("SIGTERM");
    });

    test("system scales appropriately with agent pool size", async () => {
      const orchestratorScript = path.join(
        __dirname,
        "..",
        "..",
        ".claude",
        "master_agent_orchestrator.py",
      );

      // Start orchestrator
      orchestratorProcess = spawn("python3", [orchestratorScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      let scalingWorks = false;

      orchestratorProcess.stdout.on("data", (data) => {
        const output = data.toString();
        if (
          output.includes("max_slave_agents") ||
          output.includes("len(self.slave_agents)") ||
          output.includes("pool size")
        ) {
          scalingWorks = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 5000));

      expect(scalingWorks).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });
  });
});
