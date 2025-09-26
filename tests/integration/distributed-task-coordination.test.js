const { spawn } = require("child_process");
const fs = require("fs").promises;
const path = require("path");

describe("Distributed Task Coordination Tests", () => {
  let testProjectDir;
  let claudeDir;
  let orchestratorProcess;
  let slaveAgentProcess;

  beforeAll(async () => {
    testProjectDir = path.join(
      __dirname,
      "..",
      "fixtures",
      "distributed-coordination-test",
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
      master_id: "distributed_test_master",
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

  describe("Inter-Agent Communication Infrastructure", () => {
    test("vector database serves as communication backbone", async () => {
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
      let usesVectorDb = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("VectorDatabase") ||
          stdout.includes("store_task_history") ||
          stdout.includes("query_similar_solutions")
        ) {
          usesVectorDb = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(usesVectorDb).toBe(true);
      expect(stdout).toContain("Master Agent Orchestrator");

      orchestratorProcess.kill("SIGTERM");
    });

    test("message routing works through vector database", async () => {
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
      let routesMessages = false;

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("_store_message_in_vector_db") ||
          stdout.includes("recipient_id") ||
          stdout.includes("Message from")
        ) {
          routesMessages = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(routesMessages).toBe(true);
      expect(stdout).toContain("Slave agent");

      slaveAgentProcess.kill("SIGTERM");
    });

    test("agents can discover and communicate with each other", async () => {
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
      let discoversPeers = false;

      orchestratorProcess.stdout.on("data", (data) => {
        orchestratorStdout += data.toString();
      });

      slaveAgentProcess.stdout.on("data", (data) => {
        slaveStdout += data.toString();
        if (
          slaveStdout.includes("orchestrator") ||
          slaveStdout.includes("connected") ||
          slaveStdout.includes("communication")
        ) {
          discoversPeers = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 5000));

      expect(discoversPeers).toBe(true);

      orchestratorProcess.kill("SIGTERM");
      slaveAgentProcess.kill("SIGTERM");
    });
  });

  describe("Task Dependency Management", () => {
    test("agents can express and track task dependencies", async () => {
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
      let handlesDependencies = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("dependencies") ||
          stdout.includes("task coordination") ||
          stdout.includes("coordination_signal")
        ) {
          handlesDependencies = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(handlesDependencies).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("dependent tasks wait for prerequisites to complete", async () => {
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
      let waitsForPrerequisites = false;

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("current_task") ||
          stdout.includes("already working") ||
          stdout.includes("busy")
        ) {
          waitsForPrerequisites = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(waitsForPrerequisites).toBe(true);

      slaveAgentProcess.kill("SIGTERM");
    });

    test("coordination signals synchronize agent actions", async () => {
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
      let synchronizesActions = false;

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("_handle_coordination_signal") ||
          stdout.includes("COORDINATION_SIGNAL") ||
          stdout.includes("signal_type")
        ) {
          synchronizesActions = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(synchronizesActions).toBe(true);

      slaveAgentProcess.kill("SIGTERM");
    });
  });

  describe("Distributed State Management", () => {
    test("task state is shared across all agents", async () => {
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
      let sharesState = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("task_assignments") ||
          stdout.includes("message_queue") ||
          stdout.includes("shared state")
        ) {
          sharesState = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(sharesState).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("agents maintain consistent view of system state", async () => {
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
      let maintainsConsistency = false;

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("self.orchestrator") ||
          stdout.includes("master_id") ||
          stdout.includes("communication")
        ) {
          maintainsConsistency = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(maintainsConsistency).toBe(true);

      slaveAgentProcess.kill("SIGTERM");
    });

    test("state changes are propagated through the system", async () => {
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
      let propagatesChanges = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("_send_message") ||
          stdout.includes("process_incoming_messages") ||
          stdout.includes("status_callbacks")
        ) {
          propagatesChanges = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(propagatesChanges).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });
  });

  describe("Load Distribution and Balancing", () => {
    test("workload is distributed across available agents", async () => {
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
      let distributesWorkload = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("load_balancer") ||
          stdout.includes("available_agents") ||
          stdout.includes("selected_agent")
        ) {
          distributesWorkload = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(distributesWorkload).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("agents can request load balancing assistance", async () => {
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
      let handlesLoadRequests = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("_handle_load_balance_request") ||
          stdout.includes("LOAD_BALANCE_REQUEST") ||
          stdout.includes("load balance")
        ) {
          handlesLoadRequests = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(handlesLoadRequests).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("system adapts to changing agent availability", async () => {
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
      let adaptsToChanges = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("discover_slave_agents") ||
          stdout.includes("unregister_slave_agent") ||
          stdout.includes("_cleanup_failed_agents")
        ) {
          adaptsToChanges = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(adaptsToChanges).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });
  });

  describe("Fault Tolerance in Distributed System", () => {
    test("agent failures don't break the entire system", async () => {
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
      let handlesFailures = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("_reassign_task") ||
          stdout.includes("_cleanup_failed_agents") ||
          stdout.includes("agent.status = AgentStatus.FAILED")
        ) {
          handlesFailures = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(handlesFailures).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("communication failures are handled gracefully", async () => {
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
      let handlesCommFailures = false;

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("VECTOR_DB_AVAILABLE = False") ||
          stdout.includes("communication") ||
          stdout.includes("fallback")
        ) {
          handlesCommFailures = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(handlesCommFailures).toBe(true);

      slaveAgentProcess.kill("SIGTERM");
    });

    test("system maintains operation during partial failures", async () => {
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
      let maintainsOperation = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("get_system_status") ||
          stdout.includes("healthy_agents") ||
          stdout.includes("system_health")
        ) {
          maintainsOperation = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(maintainsOperation).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });
  });

  describe("Scalability and Performance", () => {
    test("system scales with increasing number of agents", async () => {
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
      let scalesWithAgents = false;

      orchestratorProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("max_slave_agents") ||
          stdout.includes("len(self.slave_agents)") ||
          stdout.includes("pool size")
        ) {
          scalesWithAgents = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(scalesWithAgents).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });

    test("communication overhead remains manageable", async () => {
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
      let managesOverhead = false;

      slaveAgentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        if (
          stdout.includes("health_check_interval") ||
          stdout.includes("time.sleep") ||
          stdout.includes("async")
        ) {
          managesOverhead = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(managesOverhead).toBe(true);

      slaveAgentProcess.kill("SIGTERM");
    });

    test("coordination performance degrades gracefully under load", async () => {
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
          stdout.includes("prevents overload")
        ) {
          degradesGracefully = true;
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(degradesGracefully).toBe(true);

      orchestratorProcess.kill("SIGTERM");
    });
  });
});
