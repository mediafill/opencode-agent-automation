// Simple WebSocket functionality tests for the OpenCode Agent Dashboard
try {
  console.log("🧪 Starting WebSocket Functionality Tests\n");

  const {
    initializeWebSocket,
    handleWebSocketMessage,
    updateConnectionStatus,
    loadDemoData,
    updateAgent,
    updateTask,
    addLogEntry,
  } = require("./dashboard-functions");

  console.log("✅ Dashboard functions loaded successfully");

  // Mock WebSocket for testing
  class MockWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 1; // OPEN
      this.sentMessages = [];

      // Simulate connection
      setTimeout(() => {
        if (this.onopen) this.onopen();
      }, 10);
    }

    send(data) {
      this.sentMessages.push(data);
      return true;
    }

    close(code, reason) {
      this.readyState = 3;
      if (this.onclose) {
        this.onclose({ code: code || 1000, reason: reason || "" });
      }
    }
  }

  // Mock globals with better DOM simulation
  global.WebSocket = MockWebSocket;
  global.document = {
    getElementById: (id) => ({
      className: "",
      textContent: "",
      innerHTML: "",
      scrollTop: 0,
      scrollHeight: 100,
      classList: {
        add: () => {},
        remove: () => {},
      },
    }),
    body: {
      appendChild: () => {},
      removeChild: () => {},
    },
    createElement: (tag) => ({
      href: "",
      download: "",
      click: () => {},
    }),
  };
  global.localStorage = { getItem: () => null, setItem: () => {} };
  global.URL = { createObjectURL: () => "mock-url", revokeObjectURL: () => {} };
  global.Blob = function (data, options) {
    this.data = data;
    this.options = options;
  };
  global.setTimeout = (fn) => {
    try {
      fn();
    } catch (e) {
      console.error("Timer error:", e);
    }
  };
  global.setInterval = () => "interval_id";
  global.clearTimeout = () => {};
  global.clearInterval = () => {};

  // Mock Chart.js
  global.Chart = function () {
    return { update: () => {}, data: { datasets: [{ data: [] }] } };
  };

  // Keep original console for test output
  const originalConsole = global.console;
  global.console = { log: () => {}, warn: () => {}, error: () => {} };

  // Initialize global variables that the functions expect
  global.websocket = null;
  global.connectionState = "disconnected";
  global.connectionAttempts = 0;
  global.maxReconnectAttempts = 10;
  global.baseReconnectDelay = 1000;
  global.maxReconnectDelay = 30000;
  global.heartbeatInterval_ms = 30000;
  global.connectionMetrics = {
    connectTime: null,
    lastHeartbeat: null,
    messagesSent: 0,
    messagesReceived: 0,
    reconnectCount: 0,
    totalDowntime: 0,
  };
  global.agents = [];
  global.tasks = [];
  global.logs = [];
  global.reconnectInterval = null;
  global.heartbeatInterval = null;

  // Test runner
  function runTest(name, testFn) {
    try {
      testFn();
      originalConsole.log(`✅ ${name}`);
      return true;
    } catch (error) {
      originalConsole.error(`❌ ${name}: ${error.message}`);
      return false;
    }
  }

  let passed = 0;
  let total = 0;

  // Test 1: Demo Data Loading (simplest test first)
  total++;
  if (
    runTest("Demo Data Loading", () => {
      const dashboardFunctions = require("./dashboard-functions");
      dashboardFunctions.loadDemoData();

      // Check the exported arrays from the module
      if (dashboardFunctions.agents.length === 0)
        throw new Error("No demo agents loaded");
      if (dashboardFunctions.tasks.length === 0)
        throw new Error("No demo tasks loaded");
      if (dashboardFunctions.logs.length === 0)
        throw new Error("No demo logs loaded");

      // Verify structure
      const agent = dashboardFunctions.agents[0];
      if (!agent.id || !agent.type || !agent.status || !agent.task) {
        throw new Error("Agent structure invalid");
      }
    })
  )
    passed++;

  // Test 2: Agent Update
  total++;
  if (
    runTest("Agent Update Handling", () => {
      const dashboardFunctions = require("./dashboard-functions");
      const initialCount = dashboardFunctions.agents.length;
      const agentData = {
        id: "test_agent_123",
        status: "running",
        progress: 50,
        type: "security",
        task: "Testing",
      };

      dashboardFunctions.updateAgent(agentData);

      const agent = dashboardFunctions.agents.find(
        (a) => a.id === "test_agent_123",
      );
      if (!agent) throw new Error("Test agent not found");
      if (agent.status !== "running") throw new Error("Agent status incorrect");
    })
  )
    passed++;

  // Test 3: Task Updates
  total++;
  if (
    runTest("Task Update Handling", () => {
      const dashboardFunctions = require("./dashboard-functions");
      const taskData = {
        id: "test_task_456",
        type: "testing",
        status: "completed",
        priority: "high",
      };

      dashboardFunctions.updateTask(taskData);

      const task = dashboardFunctions.tasks.find(
        (t) => t.id === "test_task_456",
      );
      if (!task) throw new Error("Task not found");
      if (task.status !== "completed") throw new Error("Task status incorrect");
    })
  )
    passed++;

  // Test 4: Log Entries
  total++;
  if (
    runTest("Log Entry Handling", () => {
      const dashboardFunctions = require("./dashboard-functions");
      const initialCount = dashboardFunctions.logs.length;
      const logData = {
        time: new Date(),
        level: "info",
        message: "Test log message",
        agent: "test_agent",
      };

      dashboardFunctions.addLogEntry(logData);

      if (dashboardFunctions.logs.length !== initialCount + 1)
        throw new Error("Log not added");

      const log = dashboardFunctions.logs[dashboardFunctions.logs.length - 1];
      if (log.message !== "Test log message")
        throw new Error("Log message incorrect");
    })
  )
    passed++;

  // Test 5: Message Handling
  total++;
  if (
    runTest("WebSocket Message Handling", () => {
      const dashboardFunctions = require("./dashboard-functions");
      const initialAgentCount = dashboardFunctions.agents.length;
      const testMessage = {
        type: "agent_update",
        agent: {
          id: "ws_test_agent",
          status: "running",
          progress: 75,
          type: "security",
          task: "WebSocket test",
        },
      };

      dashboardFunctions.handleWebSocketMessage(testMessage);

      const agent = dashboardFunctions.agents.find(
        (a) => a.id === "ws_test_agent",
      );
      if (!agent) throw new Error("WebSocket test agent not found");
      if (agent.progress !== 75) throw new Error("Agent progress incorrect");
    })
  )
    passed++;

  // Test 6: Invalid Message Handling
  total++;
  if (
    runTest("Invalid Message Handling", () => {
      const dashboardFunctions = require("./dashboard-functions");
      const invalidMessages = [
        null,
        undefined,
        "invalid",
        123,
        {},
        { type: "unknown" },
      ];

      invalidMessages.forEach((msg, i) => {
        try {
          dashboardFunctions.handleWebSocketMessage(msg);
        } catch (error) {
          throw new Error(
            `Should not throw on invalid message ${i}: ${error.message}`,
          );
        }
      });
    })
  )
    passed++;

  // Test 7: Connection Status Updates
  total++;
  if (
    runTest("Connection Status Updates", () => {
      const dashboardFunctions = require("./dashboard-functions");
      const mockElement = { className: "", textContent: "" };
      global.document.getElementById = () => mockElement;

      dashboardFunctions.updateConnectionStatus(
        "connected",
        "Connected successfully",
      );

      if (mockElement.className !== "connection-dot connected")
        throw new Error("Class not updated correctly");
      if (mockElement.textContent !== "Connected successfully")
        throw new Error("Text not updated correctly");
    })
  )
    passed++;

  // Test 8: Full Status Message
  total++;
  if (
    runTest("Full Status Message Handling", () => {
      const dashboardFunctions = require("./dashboard-functions");
      const statusMessage = {
        type: "full_status",
        agents: [
          { id: "status_agent1", status: "running", type: "security" },
          { id: "status_agent2", status: "completed", type: "testing" },
        ],
        tasks: [
          { id: "status_task1", status: "pending" },
          { id: "status_task2", status: "in_progress" },
        ],
      };

      dashboardFunctions.handleWebSocketMessage(statusMessage);

      if (dashboardFunctions.agents.length < 2)
        throw new Error(
          `Agents not updated from full status: got ${dashboardFunctions.agents.length}`,
        );
      if (dashboardFunctions.tasks.length < 2)
        throw new Error(
          `Tasks not updated from full status: got ${dashboardFunctions.tasks.length}`,
        );

      const agent = dashboardFunctions.agents.find(
        (a) => a.id === "status_agent1",
      );
      if (!agent) throw new Error("Status agent not found");
    })
  )
    passed++;

  // Test 9: System Alert Handling
  total++;
  if (
    runTest("System Alert Handling", () => {
      const dashboardFunctions = require("./dashboard-functions");
      const initialLogCount = dashboardFunctions.logs.length;
      const alertMessage = {
        type: "system_alert",
        alert: {
          severity: "warn",
          message: "Test system alert",
        },
      };

      dashboardFunctions.handleWebSocketMessage(alertMessage);

      if (dashboardFunctions.logs.length !== initialLogCount + 1)
        throw new Error("Alert log not added");

      const lastLog =
        dashboardFunctions.logs[dashboardFunctions.logs.length - 1];
      if (lastLog.level !== "warn")
        throw new Error("Alert log level incorrect");
      if (!lastLog.message.includes("Test system alert"))
        throw new Error("Alert message not found in log");
    })
  )
    passed++;

  // Test 10: Log Limits
  total++;
  if (
    runTest("Log Entry Limits (1000 max)", () => {
      const dashboardFunctions = require("./dashboard-functions");
      const initialCount = dashboardFunctions.logs.length;

      // Add logs to reach over 1000
      for (let i = 0; i < 1010; i++) {
        dashboardFunctions.addLogEntry({
          time: new Date(),
          level: "info",
          message: `Limit test log ${i}`,
          agent: "test",
        });
      }

      if (dashboardFunctions.logs.length > 1000) {
        throw new Error(
          `Too many logs maintained: ${dashboardFunctions.logs.length}, should be max 1000`,
        );
      }
    })
  )
    passed++;

  // Summary
  originalConsole.log(`\n📊 Test Results: ${passed}/${total} tests passed`);
  if (passed === total) {
    originalConsole.log("🎉 All WebSocket functionality tests passed!");
  } else {
    originalConsole.log(`⚠️  ${total - passed} tests failed`);
    process.exit(1);
  }
} catch (error) {
  console.error("❌ Test setup failed:", error.message);
  console.error(error.stack);
  process.exit(1);
}
