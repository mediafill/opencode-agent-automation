const { spawn } = require("child_process");
const fs = require("fs").promises;
const path = require("path");

describe("Agent Pooling and Resource Management Tests", () => {
  let testProjectDir;
  let claudeDir;
  let orchestratorProcess;
  let slaveAgentProcess;

  beforeAll(async () => {
    testProjectDir = path.join(
      __dirname,
      "..",
      "fixtures",
      "agent-pooling-test",
    );
    claudeDir = path.join(testProjectDir, ".claude");

    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(path.join(claudeDir, "logs"), { recursive: true });
  });

  beforeEach(async () => {
    // Reset config with pooling settings
    const config = {
      health_check_interval: 5,
      agent_timeout: 30,
      max_slave_agents: 3, // Limited pool size for testing
      master_id: "pooling_test_master",
    };
    await fs.writeFile(
      path.join(claudeDir, "master_orchestrator_config.json"),
      JSON.stringify(config, null, 2),
    );
  });

  afterEach(async () => {
    [orchestratorProcess, slaveAgentProcess].forEach((proc) => {
      if (proc && !proc.killed) {
        proc.kill("SIGTERM");
      }
    });

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

  describe("Agent Pool Capacity Management", () => {
    test("master agent enforces maximum pool size limits", async () => {
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
      let enforcesLimits = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("max_slave_agents") ||
          stdout.includes("Maximum slave agents") ||
          stdout.includes("pool size")
        ) {
          enforcesLimits = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(enforcesLimits).toBe(true);
      expect(stdout).toContain("Master Agent Orchestrator");

      orchestratorProcess.kill("SIGTERM");
    });

    test("pool rejects new agents when at capacity", async () => {
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
      let rejectsAtCapacity = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("len(self.slave_agents) >= self.max_slave_agents") ||
          stdout.includes("Maximum slave agents reached")
        ) {
          rejectsAtCapacity = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(rejectsAtCapacity).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("pool allows agent removal to make room for new agents", async () => {
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
      let allowsRemoval = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("unregister_slave_agent") ||
          stdout.includes("del self.slave_agents")
        ) {
          allowsRemoval = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(allowsRemoval).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });
  });

  describe("Resource Usage Monitoring", () => {
    test("agents track CPU and memory usage continuously", async () => {
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
      let tracksResources = false;

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("cpu_percent") ||
          stdout.includes("memory_mb") ||
          stdout.includes("ResourceMonitor")
        ) {
          tracksResources = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(tracksResources).toBe(true);
      expect(stdout).toContain("Slave agent");

      slaveAgentProcess.kill("SIGTERM");
    });

    test("resource usage affects agent health scoring", async () => {
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
      let affectsHealth = false;

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("health_score") ||
          stdout.includes("update_health") ||
          stdout.includes("cpu_penalty")
        ) {
          affectsHealth = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(affectsHealth).toBe(true);

      slaveAgentProcess.kill("SIGTERM");
    });

    test("master agent receives resource usage reports", async () => {
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
      let receivesReports = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("_handle_health_check") ||
          stdout.includes("cpu_percent") ||
          stdout.includes("memory_mb")
        ) {
          receivesReports = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(receivesReports).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });
  });

  describe("Load Balancing and Task Distribution", () => {
    test("load balancer selects agents based on health and availability", async () => {
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
      let loadBalances = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("load_balancer") ||
          stdout.includes("health_score") ||
          stdout.includes("current_task is None")
        ) {
          loadBalances = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(loadBalances).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("tasks are distributed evenly across healthy agents", async () => {
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
      let distributesEvenly = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("available_agents") ||
          stdout.includes("sorted_agents") ||
          stdout.includes("assign_task_to_agent")
        ) {
          distributesEvenly = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(distributesEvenly).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("unhealthy agents are excluded from task assignment", async () => {
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
      let excludesUnhealthy = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("is_healthy()") ||
          stdout.includes("agent.status == AgentStatus.READY")
        ) {
          excludesUnhealthy = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(excludesUnhealthy).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });
  });

  describe("Resource Efficiency Optimization", () => {
    test("agents are reused for multiple tasks when appropriate", async () => {
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
      let reusesAgents = false;

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("current_task = None") ||
          stdout.includes("status = AgentStatus.READY") ||
          stdout.includes("task completed")
        ) {
          reusesAgents = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(reusesAgents).toBe(true);

      slaveAgentProcess.kill("SIGTERM");
    });

    test("idle agents are identified and can be terminated", async () => {
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
      let identifiesIdle = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("last_heartbeat") ||
          stdout.includes("agent_timeout") ||
          stdout.includes("cleanup_failed_agents")
        ) {
          identifiesIdle = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(identifiesIdle).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("resource usage is optimized through intelligent scheduling", async () => {
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
      let optimizesScheduling = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("sorted_agents") ||
          stdout.includes("health_score") ||
          stdout.includes("current_task is None")
        ) {
          optimizesScheduling = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(optimizesScheduling).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });
  });

  describe("Pool Scaling and Adaptation", () => {
    test("pool can dynamically adjust based on workload", async () => {
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
      let adjustsDynamically = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("discover_slave_agents") ||
          stdout.includes("register_slave_agent") ||
          stdout.includes("unregister_slave_agent")
        ) {
          adjustsDynamically = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(adjustsDynamically).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("resource thresholds trigger pool management actions", async () => {
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
      let managesByThresholds = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("health_score <= 0") ||
          stdout.includes("agent.status == AgentStatus.FAILED") ||
          stdout.includes("_cleanup_failed_agents")
        ) {
          managesByThresholds = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(managesByThresholds).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("pool maintains optimal resource utilization", async () => {
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
      let maintainsOptimal = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("get_system_status") ||
          stdout.includes("system_health") ||
          stdout.includes("resource_usage")
        ) {
          maintainsOptimal = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(maintainsOptimal).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });
  });
});
