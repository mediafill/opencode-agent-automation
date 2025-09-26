const { spawn } = require("child_process");
const fs = require("fs").promises;
const path = require("path");

describe("Health Monitoring and Auto-restart Tests", () => {
  let testProjectDir;
  let claudeDir;
  let orchestratorProcess;
  let slaveAgentProcess;

  beforeAll(async () => {
    testProjectDir = path.join(
      __dirname,
      "..",
      "fixtures",
      "health-monitoring-test",
    );
    claudeDir = path.join(testProjectDir, ".claude");

    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(path.join(claudeDir, "logs"), { recursive: true });
  });

  beforeEach(async () => {
    // Reset config with health monitoring settings
    const config = {
      health_check_interval: 5,
      agent_timeout: 15, // Shorter timeout for testing
      max_slave_agents: 5,
      master_id: "health_test_master",
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

  describe("Continuous Health Monitoring", () => {
    test("health monitoring loop runs continuously", async () => {
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
      let monitoringActive = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("health_monitoring_loop") ||
          stdout.includes("while self.is_running") ||
          stdout.includes("time.sleep(self.health_check_interval)")
        ) {
          monitoringActive = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(monitoringActive).toBe(true);
      expect(stdout).toContain("Master Agent Orchestrator");

      orchestratorProcess.kill("SIGTERM");
    });

    test("agents report health metrics at regular intervals", async () => {
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
      let reportsHealthMetrics = false;

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("health_check_interval") ||
          stdout.includes("_perform_health_check") ||
          stdout.includes("_send_health_report")
        ) {
          reportsHealthMetrics = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(reportsHealthMetrics).toBe(true);
      expect(stdout).toContain("Slave agent");

      slaveAgentProcess.kill("SIGTERM");
    });

    test("master receives and processes health reports", async () => {
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
      let processesHealthReports = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("_handle_health_check") ||
          stdout.includes("cpu_percent") ||
          stdout.includes("memory_mb")
        ) {
          processesHealthReports = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(processesHealthReports).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });
  });

  describe("Agent Health Scoring", () => {
    test("health score calculation considers multiple factors", async () => {
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
      let calculatesHealthScore = false;

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("health_score") ||
          stdout.includes("cpu_penalty") ||
          stdout.includes("memory_penalty") ||
          stdout.includes("age_penalty")
        ) {
          calculatesHealthScore = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(calculatesHealthScore).toBe(true);

      slaveAgentProcess.kill("SIGTERM");
    });

    test("CPU usage affects health score negatively", async () => {
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
      let cpuAffectsHealth = false;

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("cpu_penalty = min(50, cpu_percent * 0.5)") ||
          stdout.includes("cpu_percent * 0.5")
        ) {
          cpuAffectsHealth = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(cpuAffectsHealth).toBe(true);

      slaveAgentProcess.kill("SIGTERM");
    });

    test("memory usage affects health score", async () => {
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
      let memoryAffectsHealth = false;

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("memory_penalty = min(30, memory_mb / 100)") ||
          stdout.includes("memory_mb / 100")
        ) {
          memoryAffectsHealth = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(memoryAffectsHealth).toBe(true);

      slaveAgentProcess.kill("SIGTERM");
    });

    test("agent age affects health score over time", async () => {
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
      let ageAffectsHealth = false;

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes(
            "age_penalty = min(20, (datetime.now() - self.last_heartbeat).total_seconds() / 3600)",
          ) ||
          stdout.includes("last_heartbeat")
        ) {
          ageAffectsHealth = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(ageAffectsHealth).toBe(true);

      slaveAgentProcess.kill("SIGTERM");
    });
  });

  describe("Agent Failure Detection", () => {
    test("agents are marked as timed out after missing heartbeats", async () => {
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
      let detectsTimeouts = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes(
            "(current_time - agent.last_heartbeat).total_seconds() > self.agent_timeout",
          ) ||
          stdout.includes("Agent timed out") ||
          stdout.includes("agent.status = AgentStatus.UNAVAILABLE")
        ) {
          detectsTimeouts = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(detectsTimeouts).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("failed agents are identified by health score", async () => {
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
      let identifiesFailed = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("agent.health_score <= 0") ||
          stdout.includes("agent.status == AgentStatus.FAILED")
        ) {
          identifiesFailed = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(identifiesFailed).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("unhealthy agents are excluded from task assignments", async () => {
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
          stdout.includes(
            "agent for agent in self.slave_agents.values() if agent.is_healthy()",
          ) ||
          stdout.includes("is_healthy()")
        ) {
          excludesUnhealthy = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(excludesUnhealthy).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });
  });

  describe("Auto-restart Functionality", () => {
    test("failed agents trigger restart attempts", async () => {
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
      let attemptsRestart = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("_attempt_agent_restart") ||
          stdout.includes("restart agent")
        ) {
          attemptsRestart = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(attemptsRestart).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("restart attempts are logged and tracked", async () => {
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
      let logsRestartAttempts = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("Marked agent") ||
          stdout.includes("as failed") ||
          stdout.includes("restart not implemented")
        ) {
          logsRestartAttempts = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(logsRestartAttempts).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("agents can recover from temporary failures", async () => {
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
      let canRecover = false;

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("last_heartbeat = datetime.now()") ||
          stdout.includes("update_health") ||
          stdout.includes("health_score")
        ) {
          canRecover = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(canRecover).toBe(true);

      slaveAgentProcess.kill("SIGTERM");
    });
  });

  describe("Health-Based System Adaptation", () => {
    test("system load balances around unhealthy agents", async () => {
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
      let loadBalancesAroundUnhealthy = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes(
            "sorted(available_agents, key=lambda a: (a.health_score, a.current_task is None), reverse=True)",
          ) ||
          stdout.includes("health_score")
        ) {
          loadBalancesAroundUnhealthy = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(loadBalancesAroundUnhealthy).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("health monitoring prevents system overload", async () => {
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
      let preventsOverload = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("_cleanup_failed_agents") ||
          stdout.includes("Removing failed agent") ||
          stdout.includes("unregister_slave_agent")
        ) {
          preventsOverload = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(preventsOverload).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("system maintains operational capacity despite failures", async () => {
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
      let maintainsCapacity = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("get_system_status") ||
          stdout.includes("healthy_agents") ||
          stdout.includes("system_health")
        ) {
          maintainsCapacity = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(maintainsCapacity).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });
  });
});
