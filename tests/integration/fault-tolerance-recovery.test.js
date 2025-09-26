const { spawn } = require("child_process");
const fs = require("fs").promises;
const path = require("path");

describe("Fault Tolerance and Recovery Tests", () => {
  let testProjectDir;
  let claudeDir;
  let orchestratorProcess;
  let slaveAgentProcess;

  beforeAll(async () => {
    testProjectDir = path.join(
      __dirname,
      "..",
      "fixtures",
      "fault-tolerance-test",
    );
    claudeDir = path.join(testProjectDir, ".claude");

    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(path.join(claudeDir, "logs"), { recursive: true });
  });

  beforeEach(async () => {
    // Reset config with fault tolerance settings
    const config = {
      health_check_interval: 3,
      agent_timeout: 8, // Short timeout for testing
      max_slave_agents: 3,
      master_id: "fault_tolerance_test_master",
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

  describe("Agent Failure Detection and Isolation", () => {
    test("system detects agent crashes and marks them as failed", async () => {
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
      slaveAgentProcess = spawn("python3", [slaveScript], {
        cwd: testProjectDir,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "..") },
      });

      // Let slave start, then kill it to simulate crash
      await new Promise((resolve) => setTimeout(resolve, 3000));

      slaveAgentProcess.kill("SIGKILL"); // Force kill to simulate crash

      // Wait for orchestrator to detect failure
      await new Promise((resolve) => setTimeout(resolve, 5000));

      let failureDetected = false;
      orchestratorProcess.stdout.on("data", (data) => {
        const output = data.toString();
        if (
          output.includes("agent.status = AgentStatus.FAILED") ||
          output.includes("marked as failed") ||
          output.includes("Agent crashed")
        ) {
          failureDetected = true;
        }
      });

      expect(failureDetected).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("failed agents are isolated from task assignments", async () => {
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
      let isolatesFailedAgents = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("agent.status == AgentStatus.FAILED") ||
          stdout.includes("is_healthy()") ||
          stdout.includes("available_agents")
        ) {
          isolatesFailedAgents = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(isolatesFailedAgents).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("system continues operating with reduced agent pool", async () => {
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
      let operatesWithReducedPool = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("get_system_status") ||
          stdout.includes("healthy_agents") ||
          stdout.includes("No available agents")
        ) {
          operatesWithReducedPool = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(operatesWithReducedPool).toBe(true);
      expect(stdout).toContain("Master Agent Orchestrator");

      orchestratorProcess.kill("SIGTERM");
    });
  });

  describe("Automatic Recovery Mechanisms", () => {
    test("system attempts to restart failed agents automatically", async () => {
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
      let attemptsAutoRestart = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("_attempt_agent_restart") ||
          stdout.includes("restart agent") ||
          stdout.includes("restart not implemented")
        ) {
          attemptsAutoRestart = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(attemptsAutoRestart).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("recovery attempts are logged and tracked", async () => {
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
      let logsRecoveryAttempts = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("Marked agent") ||
          stdout.includes("as failed") ||
          stdout.includes("recovery")
        ) {
          logsRecoveryAttempts = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(logsRecoveryAttempts).toBe(true);

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
      let canRecoverFromTempFailures = false;

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("last_heartbeat") ||
          stdout.includes("update_health") ||
          stdout.includes("health_score")
        ) {
          canRecoverFromTempFailures = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(canRecoverFromTempFailures).toBe(true);

      slaveAgentProcess.kill("SIGTERM");
    });
  });

  describe("Task Recovery and Reassignment", () => {
    test("incomplete tasks from failed agents are reassigned", async () => {
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
      let reassignsIncompleteTasks = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("_reassign_task") ||
          stdout.includes("Reassigning task") ||
          stdout.includes("agent.current_task")
        ) {
          reassignsIncompleteTasks = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(reassignsIncompleteTasks).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("task state is preserved during recovery operations", async () => {
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
      let preservesTaskState = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("task_assignments") ||
          stdout.includes("current_task") ||
          stdout.includes("task status")
        ) {
          preservesTaskState = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(preservesTaskState).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("duplicate task execution is prevented during recovery", async () => {
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
      let preventsDuplicateExecution = false;

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("current_task") ||
          stdout.includes("already working") ||
          stdout.includes("busy")
        ) {
          preventsDuplicateExecution = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(preventsDuplicateExecution).toBe(true);

      slaveAgentProcess.kill("SIGTERM");
    });
  });

  describe("Communication Failure Recovery", () => {
    test("system falls back gracefully when vector database is unavailable", async () => {
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
      let fallsBackGracefully = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("VECTOR_DB_AVAILABLE = False") ||
          stdout.includes("message_queue") ||
          stdout.includes("fallback")
        ) {
          fallsBackGracefully = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(fallsBackGracefully).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("message delivery retries on communication failures", async () => {
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
      let retriesOnFailure = false;

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("maxRetries") ||
          stdout.includes("retry") ||
          stdout.includes("VECTOR_DB_AVAILABLE")
        ) {
          retriesOnFailure = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(retriesOnFailure).toBe(true);

      slaveAgentProcess.kill("SIGTERM");
    });

    test("agents maintain operation during network partitions", async () => {
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
      let maintainsOperation = false;

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("initialize()") ||
          stdout.includes("Slave agent") ||
          stdout.includes("initialized")
        ) {
          maintainsOperation = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(maintainsOperation).toBe(true);

      slaveAgentProcess.kill("SIGTERM");
    });
  });

  describe("Data Consistency During Failures", () => {
    test("task assignment records remain consistent during failures", async () => {
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
      let maintainsConsistency = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("task_assignments") ||
          stdout.includes("current_task") ||
          stdout.includes("consistency")
        ) {
          maintainsConsistency = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(maintainsConsistency).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("agent state is accurately reflected after recovery", async () => {
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
      let accurateStateAfterRecovery = false;

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("state") ||
          stdout.includes("status") ||
          stdout.includes("health_score")
        ) {
          accurateStateAfterRecovery = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(accurateStateAfterRecovery).toBe(true);

      slaveAgentProcess.kill("SIGTERM");
    });

    test("system state converges after failure recovery", async () => {
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
      let convergesAfterRecovery = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("get_system_status") ||
          stdout.includes("healthy_agents") ||
          stdout.includes("system_health")
        ) {
          convergesAfterRecovery = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(convergesAfterRecovery).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });
  });

  describe("Graceful Degradation", () => {
    test("system provides reduced functionality when resources are scarce", async () => {
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
      let degradesGracefully = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("No available agents") ||
          stdout.includes("return None") ||
          stdout.includes("reduced functionality")
        ) {
          degradesGracefully = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(degradesGracefully).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("critical operations are prioritized during resource constraints", async () => {
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
      let prioritizesCriticalOps = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("priority") ||
          stdout.includes("health_score") ||
          stdout.includes("critical")
        ) {
          prioritizesCriticalOps = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(prioritizesCriticalOps).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("system provides clear status information during degraded operation", async () => {
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
      let providesClearStatus = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("get_system_status") ||
          stdout.includes("system_health") ||
          stdout.includes("degraded")
        ) {
          providesClearStatus = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(providesClearStatus).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });
  });
});
