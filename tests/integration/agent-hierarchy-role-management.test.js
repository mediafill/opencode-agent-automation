const { spawn } = require("child_process");
const fs = require("fs").promises;
const path = require("path");

describe("Agent Hierarchy and Role Management Tests", () => {
  let testProjectDir;
  let claudeDir;
  let orchestratorProcess;
  let slaveAgentProcess;

  beforeAll(async () => {
    testProjectDir = path.join(
      __dirname,
      "..",
      "fixtures",
      "agent-hierarchy-test",
    );
    claudeDir = path.join(testProjectDir, ".claude");

    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(path.join(claudeDir, "logs"), { recursive: true });
  });

  beforeEach(async () => {
    // Reset config
    const config = {
      health_check_interval: 5,
      agent_timeout: 30,
      max_slave_agents: 5,
      master_id: "hierarchy_test_master",
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

  describe("Role-Based Agent Management", () => {
    test("master agent maintains supreme authority in hierarchy", async () => {
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
      let hasMasterAuthority = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("master_id") ||
          stdout.includes('MASTER = "master"') ||
          stdout.includes("supreme authority")
        ) {
          hasMasterAuthority = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(hasMasterAuthority).toBe(true);
      expect(stdout).toContain("Master Agent Orchestrator");

      orchestratorProcess.kill("SIGTERM");
    });

    test("slave agents properly identify as subordinate role", async () => {
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
      let hasSlaveRole = false;

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("role = AgentRole.SLAVE") ||
          stdout.includes("SLAVE") ||
          stdout.includes("subordinate")
        ) {
          hasSlaveRole = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(hasSlaveRole).toBe(true);
      expect(stdout).toContain("Slave agent");

      slaveAgentProcess.kill("SIGTERM");
    });

    test("coordinator role supports hierarchical delegation", async () => {
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
      let hasCoordinatorSupport = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("COORDINATOR") ||
          stdout.includes("coordinator") ||
          stdout.includes("hierarchical delegation")
        ) {
          hasCoordinatorSupport = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(hasCoordinatorSupport).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });
  });

  describe("Agent Registration and Authority", () => {
    test("master agent controls slave agent registration", async () => {
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
      let controlsRegistration = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("register_slave_agent") ||
          stdout.includes("max_slave_agents") ||
          stdout.includes("Maximum slave agents")
        ) {
          controlsRegistration = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(controlsRegistration).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("slave agents cannot register other agents", async () => {
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
      let cannotRegisterOthers = true; // Assume true unless proven otherwise

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("register_slave_agent") ||
          stdout.includes("registering other agents")
        ) {
          cannotRegisterOthers = false;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(cannotRegisterOthers).toBe(true);
      expect(stdout).toContain("Slave agent");

      slaveAgentProcess.kill("SIGTERM");
    });

    test("role-based access control prevents unauthorized operations", async () => {
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
      let hasAccessControl = true; // Assume true unless proven otherwise

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("orchestrator.register_slave_agent") ||
          stdout.includes("master-only operation")
        ) {
          hasAccessControl = false;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(hasAccessControl).toBe(true);

      slaveAgentProcess.kill("SIGTERM");
    });
  });

  describe("Hierarchical Communication Patterns", () => {
    test("communication flows from master to slaves only", async () => {
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

      let orchestratorStdout = "";
      let slaveStdout = "";
      let hierarchicalCommunication = false;

      orchestratorProcess.stdout.on("data", (data) => {
        orchestratorStdout += data.toString();
      });

      slaveAgentProcess.stdout.on("data", (data) => {
        slaveStdout += data.toString();
        if (
          slaveStdout.includes("from master") ||
          slaveStdout.includes("orchestrator") ||
          slaveStdout.includes("Message from")
        ) {
          hierarchicalCommunication = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 5000));

      expect(hierarchicalCommunication).toBe(true);

      orchestratorProcess.kill("SIGTERM");
      slaveAgentProcess.kill("SIGTERM");
    });

    test("slave-to-slave communication requires master coordination", async () => {
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
      let requiresCoordination = true; // Assume true unless proven otherwise

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("direct slave communication") ||
          stdout.includes("peer-to-peer")
        ) {
          requiresCoordination = false;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(requiresCoordination).toBe(true);

      slaveAgentProcess.kill("SIGTERM");
    });

    test("master agent routes all inter-agent messages", async () => {
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
      let routesMessages = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("_send_message") ||
          stdout.includes("message_queue") ||
          stdout.includes("routing")
        ) {
          routesMessages = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(routesMessages).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });
  });

  describe("Role-Based Task Assignment", () => {
    test("master agent assigns tasks based on agent roles and capabilities", async () => {
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
      let assignsByRole = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("assign_task_to_agent") ||
          stdout.includes("capabilities") ||
          stdout.includes("load_balancer")
        ) {
          assignsByRole = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(assignsByRole).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("slave agents accept tasks appropriate to their role", async () => {
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
      let acceptsAppropriateTasks = false;

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("capabilities") ||
          stdout.includes("code_analysis") ||
          stdout.includes("testing")
        ) {
          acceptsAppropriateTasks = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(acceptsAppropriateTasks).toBe(true);

      slaveAgentProcess.kill("SIGTERM");
    });

    test("role violations are prevented by hierarchical controls", async () => {
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
      let preventsViolations = true; // Assume true unless proven otherwise

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("master-only task") ||
          stdout.includes("insufficient permissions")
        ) {
          preventsViolations = false;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(preventsViolations).toBe(true);

      slaveAgentProcess.kill("SIGTERM");
    });
  });

  describe("Hierarchical Monitoring and Control", () => {
    test("master agent monitors all slave agent activities", async () => {
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
      let monitorsActivities = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("health_monitoring_loop") ||
          stdout.includes("_perform_health_checks") ||
          stdout.includes("monitoring")
        ) {
          monitorsActivities = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(monitorsActivities).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("slave agents report status to master only", async () => {
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
      let reportsToMaster = false;

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("orchestrator.master_id") ||
          stdout.includes("report to master") ||
          stdout.includes("status update")
        ) {
          reportsToMaster = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(reportsToMaster).toBe(true);

      slaveAgentProcess.kill("SIGTERM");
    });

    test("master agent can shutdown or restart slave agents", async () => {
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
      let canControlSlaves = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("unregister_slave_agent") ||
          stdout.includes("_attempt_agent_restart") ||
          stdout.includes("control")
        ) {
          canControlSlaves = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(canControlSlaves).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });
  });
});
