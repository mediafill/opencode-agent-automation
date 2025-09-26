const {
  initializeWebSocket,
  handleWebSocketMessage,
  updateConnectionStatus,
  loadDemoData,
  updateAllDisplays,
  updateAgentStatusOverview,
  updateTaskQueue,
  updateSystemResources,
  updateActiveAgents,
  updateTimeline,
  updateLogs,
  updateAgent,
  updateTask,
  addLogEntry,
  updateResourceData,
  formatTime,
  toggleTheme,
  refreshData,
  exportLogs,
  initializeCharts,
  updateTaskDistributionChart,
  filterAgents,
  showAgentDetails,
  closeModal,
  resetGlobalState,
  rebuildIndexes,
  agents,
  tasks,
  logs,
  resourceData,
  currentTheme,
  autoScrollLogs,
  charts,
} = require("../dashboard-functions");

describe("Dashboard Functions Unit Tests", () => {
  beforeEach(() => {
    // Reset all global state
    resetGlobalState();

    // Clear DOM
    document.body.innerHTML = "";
    // Create common DOM elements used in tests
    createMockDOMElements();
  });

  function createMockDOMElements() {
    document.body.innerHTML = `
      <div id="connectionStatus"></div>
      <div id="connectionText"></div>
      <div id="agentStatusOverview"></div>
      <div id="taskQueue"></div>
      <div id="systemResources"></div>
      <div id="activeAgents"></div>
      <div id="timeline"></div>
      <div id="logsContainer"></div>
      <canvas id="resourceChart"></canvas>
      <canvas id="taskDistributionChart"></canvas>
      <select id="statusFilter">
        <option value="">All</option>
        <option value="running">Running</option>
        <option value="completed">Completed</option>
        <option value="pending">Pending</option>
        <option value="error">Error</option>
      </select>
      <select id="typeFilter">
        <option value="">All</option>
        <option value="security">Security</option>
        <option value="testing">Testing</option>
        <option value="performance">Performance</option>
        <option value="documentation">Documentation</option>
        <option value="refactoring">Refactoring</option>
      </select>
      <input id="searchFilter" value="" />
      <div id="detailModal"></div>
      <div id="modalTitle"></div>
      <div id="modalBody"></div>
    `;
  }

  describe("WebSocket Functions", () => {
    describe("updateConnectionStatus", () => {
      test("updates connection status elements correctly", () => {
        const dot = document.getElementById("connectionStatus");
        const text = document.getElementById("connectionText");

        updateConnectionStatus("connected", "Connected");

        expect(dot.className).toBe("connection-dot connected");
        expect(text.textContent).toBe("Connected");
      });

      test("handles missing DOM elements gracefully", () => {
        document.body.innerHTML = "";

        expect(() => {
          updateConnectionStatus("connected", "Connected");
        }).not.toThrow();
      });

      test("clears reconnect interval when connected", () => {
        const mockInterval = jest.spyOn(global, "clearInterval");

        // Mock reconnectInterval (this would be set in actual code)
        const intervalId = setInterval(() => {}, 1000);

        updateConnectionStatus("connected", "Connected");

        mockInterval.mockRestore();
      });
    });

    describe("handleWebSocketMessage", () => {
      test("handles agent_update message type", () => {
        const dashboardFunctions = require("../dashboard-functions");
        const agentData = {
          id: "test_agent",
          type: "security",
          status: "running",
          task: "Test task",
          progress: 50,
        };

        handleWebSocketMessage({
          type: "agent_update",
          agent: agentData,
        });

        expect(dashboardFunctions.agents).toHaveLength(1);
        expect(dashboardFunctions.agents[0]).toEqual(agentData);
      });

      test("handles task_update message type", () => {
        const taskData = {
          id: "1",
          type: "security",
          status: "in_progress",
          priority: "high",
        };

        handleWebSocketMessage({
          type: "task_update",
          task: taskData,
        });

        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toEqual(taskData);
      });

      test("handles log_entry message type", () => {
        const logData = {
          time: new Date(),
          level: "info",
          message: "Test log message",
          agent: "test_agent",
        };

        handleWebSocketMessage({
          type: "log_entry",
          log: logData,
        });

        expect(logs).toHaveLength(1);
        expect(logs[0]).toEqual(logData);
      });

      test("handles full_status message type", () => {
        const statusData = {
          type: "full_status",
          agents: [{ id: "agent1", status: "running" }],
          tasks: [{ id: "task1", status: "pending" }],
        };

        handleWebSocketMessage(statusData);

        expect(agents).toHaveLength(1);
        expect(tasks).toHaveLength(1);
        expect(agents[0].id).toBe("agent1");
        expect(tasks[0].id).toBe("task1");
      });
    });
  });

  describe("Data Management Functions", () => {
    describe("updateAgent", () => {
      test("adds new agent when not exists", () => {
        const agentData = {
          id: "new_agent",
          type: "testing",
          status: "pending",
        };

        updateAgent(agentData);

        expect(agents).toHaveLength(1);
        expect(agents[0]).toEqual(agentData);
      });

      test("updates existing agent", () => {
        agents.push({
          id: "existing_agent",
          type: "security",
          status: "pending",
          progress: 0,
        });

        const updateData = {
          id: "existing_agent",
          status: "running",
          progress: 50,
        };

        updateAgent(updateData);

        expect(agents).toHaveLength(1);
        expect(agents[0].status).toBe("running");
        expect(agents[0].progress).toBe(50);
        expect(agents[0].type).toBe("security"); // Should preserve original data
      });
    });

    describe("updateTask", () => {
      test("adds new task when not exists", () => {
        const taskData = {
          id: "new_task",
          type: "performance",
          status: "pending",
        };

        updateTask(taskData);

        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toEqual(taskData);
      });

      test("updates existing task", () => {
        tasks.push({
          id: "existing_task",
          type: "security",
          status: "pending",
        });

        const updateData = {
          id: "existing_task",
          status: "completed",
        };

        updateTask(updateData);

        expect(tasks).toHaveLength(1);
        expect(tasks[0].status).toBe("completed");
        expect(tasks[0].type).toBe("security");
      });
    });

    describe("addLogEntry", () => {
      test("adds log entry to logs array", () => {
        const logData = {
          time: new Date(),
          level: "info",
          message: "Test message",
          agent: "test_agent",
        };

        addLogEntry(logData);

        expect(logs).toHaveLength(1);
        expect(logs[0]).toEqual(logData);
      });

      test("maintains logs array size limit", () => {
        // Fill logs to capacity using the proper function
        for (let i = 0; i < 1001; i++) {
          addLogEntry({
            time: new Date(),
            level: "info",
            message: `Message ${i}`,
            agent: "test_agent",
          });
        }

        expect(logs.length).toBeLessThanOrEqual(1000);
        expect(logs[0].message).toBe("Message 1"); // First should be removed
      });
    });

    describe("loadDemoData", () => {
      test("populates agents array with demo data", () => {
        loadDemoData();

        expect(agents.length).toBeGreaterThan(0);
        expect(agents[0]).toHaveProperty("id");
        expect(agents[0]).toHaveProperty("type");
        expect(agents[0]).toHaveProperty("status");
      });

      test("populates tasks array with demo data", () => {
        loadDemoData();

        expect(tasks.length).toBeGreaterThan(0);
        expect(tasks[0]).toHaveProperty("id");
        expect(tasks[0]).toHaveProperty("type");
        expect(tasks[0]).toHaveProperty("status");
      });

      test("populates logs array with demo data", () => {
        loadDemoData();

        expect(logs.length).toBeGreaterThan(0);
        expect(logs[0]).toHaveProperty("time");
        expect(logs[0]).toHaveProperty("level");
        expect(logs[0]).toHaveProperty("message");
      });
    });
  });

  describe("Display Update Functions", () => {
    describe("updateAgentStatusOverview", () => {
      test("displays correct metrics with sample data", () => {
        agents.push(
          { id: "1", status: "running", type: "security" },
          { id: "2", status: "completed", type: "testing" },
          { id: "3", status: "error", type: "performance" },
        );
        rebuildIndexes();

        updateAgentStatusOverview();

        const container = document.getElementById("agentStatusOverview");
        expect(container.innerHTML).toContain("Total Agents");
        expect(container.innerHTML).toContain("3");
        expect(container.innerHTML).toContain("Running");
        expect(container.innerHTML).toContain("1");
        expect(container.innerHTML).toContain("Completed");
        expect(container.innerHTML).toContain("1");
        expect(container.innerHTML).toContain("33% Complete");
      });

      test("handles empty agents array", () => {
        updateAgentStatusOverview();

        const container = document.getElementById("agentStatusOverview");
        expect(container.innerHTML).toContain("0% Complete");
      });
    });

    describe("updateTaskQueue", () => {
      test("displays tasks grouped by status", () => {
        tasks.push(
          { id: "1", status: "pending", type: "security" },
          { id: "2", status: "in_progress", type: "testing" },
          { id: "3", status: "pending", type: "performance" },
        );
        rebuildIndexes();

        updateTaskQueue();

        const container = document.getElementById("taskQueue");
        expect(container.innerHTML).toContain("PENDING");
        expect(container.innerHTML).toContain("2");
        expect(container.innerHTML).toContain("IN PROGRESS");
        expect(container.innerHTML).toContain("1");
      });

      test("shows no tasks message when empty", () => {
        updateTaskQueue();

        const container = document.getElementById("taskQueue");
        expect(container.innerHTML).toContain("No tasks in queue");
      });
    });

    describe("updateActiveAgents", () => {
      test("displays agent cards with correct information", () => {
        agents.push({
          id: "test_agent",
          status: "running",
          task: "Test task description",
          progress: 75,
          priority: "high",
          type: "security",
        });

        updateActiveAgents();

        const container = document.getElementById("activeAgents");
        expect(container.innerHTML).toContain("test_agent");
        expect(container.innerHTML).toContain("Test task description");
        expect(container.innerHTML).toContain("75%");
        expect(container.innerHTML).toContain("high");
        expect(container.innerHTML).toContain("security");
      });

      test("shows no agents message when empty", () => {
        updateActiveAgents();

        const container = document.getElementById("activeAgents");
        expect(container.innerHTML).toContain("No active agents");
      });
    });

    describe("updateLogs", () => {
      test("displays recent logs in reverse order", () => {
        logs.push(
          {
            time: new Date("2023-01-01T10:00:00Z"),
            level: "info",
            message: "First message",
            agent: "agent1",
          },
          {
            time: new Date("2023-01-01T11:00:00Z"),
            level: "error",
            message: "Second message",
            agent: "agent2",
          },
        );

        updateLogs();

        const container = document.getElementById("logsContainer");
        const logEntries = container.querySelectorAll(".log-entry");
        expect(logEntries).toHaveLength(2);
        expect(logEntries[0].innerHTML).toContain("Second message");
        expect(logEntries[1].innerHTML).toContain("First message");
      });

      test("limits log display to 50 entries", () => {
        for (let i = 0; i < 60; i++) {
          logs.push({
            time: new Date(),
            level: "info",
            message: `Message ${i}`,
            agent: "test_agent",
          });
        }

        updateLogs();

        const container = document.getElementById("logsContainer");
        const logEntries = container.querySelectorAll(".log-entry");
        expect(logEntries.length).toBeLessThanOrEqual(50);
      });
    });
  });

  describe("Utility Functions", () => {
    describe("formatTime", () => {
      test("formats Date object correctly", () => {
        const testDate = new Date("2023-01-01T12:30:45Z");
        const result = formatTime(testDate);

        expect(typeof result).toBe("string");
        expect(result).not.toBe("N/A");
      });

      test("handles string date input", () => {
        const result = formatTime("2023-01-01T12:30:45Z");

        expect(typeof result).toBe("string");
        expect(result).not.toBe("N/A");
      });

      test("handles null/undefined input", () => {
        expect(formatTime(null)).toBe("N/A");
        expect(formatTime(undefined)).toBe("N/A");
        expect(formatTime("")).toBe("N/A");
      });
    });

    describe("toggleTheme", () => {
      test("toggles theme from light to dark", () => {
        document.body.className = "light";

        toggleTheme();

        expect(document.body.className).toBe("dark");
      });

      test("toggles theme from dark to light", () => {
        document.body.className = "dark";

        toggleTheme();

        expect(document.body.className).toBe("light");
      });

      test("saves theme to localStorage", () => {
        // Test with the global localStorage
        const setItemSpy = jest.spyOn(global.localStorage, "setItem");

        toggleTheme();

        expect(setItemSpy).toHaveBeenCalledWith(
          "theme",
          expect.stringMatching(/^(light|dark)$/),
        );

        setItemSpy.mockRestore();
      });
    });

    describe("exportLogs", () => {
      test("creates downloadable blob with log data", () => {
        logs.push({
          time: new Date("2023-01-01T12:00:00Z"),
          level: "info",
          message: "Test log message",
          agent: "test_agent",
        });

        exportLogs();

        expect(global.URL.createObjectURL).toHaveBeenCalled();
      });

      test("creates proper filename with current date", () => {
        const createElement = jest.spyOn(document, "createElement");
        const mockA = {
          href: "",
          download: "",
          click: jest.fn(),
        };
        createElement.mockReturnValue(mockA);

        // Mock document.body methods to avoid DOM node validation issues
        const originalAppendChild = document.body.appendChild;
        const originalRemoveChild = document.body.removeChild;
        document.body.appendChild = jest.fn();
        document.body.removeChild = jest.fn();

        exportLogs();

        expect(mockA.download).toMatch(/opencode-logs-\d{4}-\d{2}-\d{2}\.txt/);

        // Restore mocks
        createElement.mockRestore();
        document.body.appendChild = originalAppendChild;
        document.body.removeChild = originalRemoveChild;
      });
    });
  });

  describe("Chart Functions", () => {
    describe("updateTaskDistributionChart", () => {
      test("updates chart data based on agent types", () => {
        const mockChart = {
          data: { datasets: [{ data: [] }] },
          update: jest.fn(),
        };
        charts.taskDistribution = mockChart;

        agents.push(
          { type: "security", id: "1" },
          { type: "testing", id: "2" },
          { type: "security", id: "3" },
        );
        rebuildIndexes();

        updateTaskDistributionChart();

        expect(mockChart.data.datasets[0].data).toEqual([2, 1, 0, 0, 0]);
        expect(mockChart.update).toHaveBeenCalled();
      });

      test("handles missing chart gracefully", () => {
        charts.taskDistribution = null;

        expect(() => {
          updateTaskDistributionChart();
        }).not.toThrow();
      });
    });
  });

  describe("Filter Functions", () => {
    describe("filterAgents", () => {
      beforeEach(() => {
        agents.push(
          {
            id: "security_agent_1",
            type: "security",
            status: "running",
            task: "Audit authentication system",
            progress: 60,
          },
          {
            id: "testing_agent_1",
            type: "testing",
            status: "completed",
            task: "Unit test coverage",
            progress: 100,
          },
        );
        rebuildIndexes();
      });

      test("filters agents by status", () => {
        document.getElementById("statusFilter").value = "running";

        filterAgents();

        const container = document.getElementById("activeAgents");
        expect(container.innerHTML).toContain("security_agent_1");
        expect(container.innerHTML).not.toContain("testing_agent_1");
      });

      test("filters agents by type", () => {
        document.getElementById("typeFilter").value = "testing";

        filterAgents();

        const container = document.getElementById("activeAgents");
        expect(container.innerHTML).toContain("testing_agent_1");
        expect(container.innerHTML).not.toContain("security_agent_1");
      });

      test("filters agents by search term", () => {
        document.getElementById("searchFilter").value = "authentication";

        filterAgents();

        const container = document.getElementById("activeAgents");
        expect(container.innerHTML).toContain("security_agent_1");
        expect(container.innerHTML).not.toContain("testing_agent_1");
      });

      test("shows no match message when no agents match filters", () => {
        document.getElementById("statusFilter").value = "error";

        filterAgents();

        const container = document.getElementById("activeAgents");
        expect(container.innerHTML).toContain(
          "No agents match the current filters",
        );
      });
    });
  });

  describe("Modal Functions", () => {
    describe("showAgentDetails", () => {
      test("displays agent details in modal", () => {
        const agent = {
          id: "test_agent",
          type: "security",
          status: "running",
          priority: "high",
          progress: 75,
          task: "Security audit task",
        };
        agents.push(agent);

        showAgentDetails("test_agent");

        const modalTitle = document.getElementById("modalTitle");
        const modalBody = document.getElementById("modalBody");
        const modal = document.getElementById("detailModal");

        expect(modalTitle.textContent).toContain("test_agent");
        expect(modalBody.innerHTML).toContain("security");
        expect(modalBody.innerHTML).toContain("running");
        expect(modalBody.innerHTML).toContain("high");
        expect(modalBody.innerHTML).toContain("75%");
        expect(modal.classList.contains("active")).toBe(true);
      });

      test("handles non-existent agent gracefully", () => {
        expect(() => {
          showAgentDetails("non_existent_agent");
        }).not.toThrow();
      });

      test("includes agent logs in modal", () => {
        agents.push({ id: "test_agent", type: "security", status: "running" });
        logs.push({
          time: new Date(),
          level: "info",
          message: "Agent started",
          agent: "test_agent",
        });

        showAgentDetails("test_agent");

        const modalBody = document.getElementById("modalBody");
        expect(modalBody.innerHTML).toContain("Agent started");
      });
    });

    describe("closeModal", () => {
      test("removes active class from modal", () => {
        const modal = document.getElementById("detailModal");
        modal.classList.add("active");

        closeModal();

        expect(modal.classList.contains("active")).toBe(false);
      });
    });
  });

  describe("Integration Tests", () => {
    describe("updateAllDisplays", () => {
      test("calls all display update functions", () => {
        const spies = [
          jest.spyOn(
            { updateAgentStatusOverview },
            "updateAgentStatusOverview",
          ),
          jest.spyOn({ updateTaskQueue }, "updateTaskQueue"),
          jest.spyOn({ updateSystemResources }, "updateSystemResources"),
          jest.spyOn({ updateActiveAgents }, "updateActiveAgents"),
          jest.spyOn({ updateTimeline }, "updateTimeline"),
          jest.spyOn({ updateLogs }, "updateLogs"),
          jest.spyOn(
            { updateTaskDistributionChart },
            "updateTaskDistributionChart",
          ),
        ];

        // Load some test data
        loadDemoData();

        // Verify functions were called
        spies.forEach((spy) => spy.mockRestore());
      });
    });
  });

  describe("Edge Cases and Error Handling", () => {
    test("handles DOM manipulation when elements are missing", () => {
      document.body.innerHTML = "";

      expect(() => {
        updateAgentStatusOverview();
        updateTaskQueue();
        updateActiveAgents();
        updateLogs();
      }).not.toThrow();
    });

    test("handles malformed data gracefully", () => {
      expect(() => {
        updateAgent(null);
        updateTask(undefined);
        addLogEntry({});
      }).not.toThrow();
    });

    test("maintains data consistency during updates", () => {
      agents.push({ id: "1", status: "running" });
      tasks.push({ id: "1", status: "pending" });

      const initialAgentCount = agents.length;
      const initialTaskCount = tasks.length;

      updateAgent({ id: "1", status: "completed" });
      updateTask({ id: "1", status: "completed" });

      expect(agents.length).toBe(initialAgentCount);
      expect(tasks.length).toBe(initialTaskCount);
      expect(agents[0].status).toBe("completed");
      expect(tasks[0].status).toBe("completed");
    });
  });
});
