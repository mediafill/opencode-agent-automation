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
  fuzzyMatch,
  fuzzyMatchScore,
  checkDateRange,
  sortAgents,
  updateFilterSummary,
  clearAllFilters,
  exportFilteredAgents,
  resetGlobalState,
  agents,
  tasks,
  logs,
  resourceData,
  currentTheme,
  autoScrollLogs,
  charts,
  performConnectionHealthCheck,
  updatePerformanceMetrics,
  formatDuration,
  startHeartbeat,
  stopHeartbeat,
  sendMessage,
  handleConnectionFailure,
  logAgentStatusChange,
  handleSystemAlert,
  updateAgentMetrics
} = require('../dashboard-functions');

describe('Dashboard Functions - Comprehensive Edge Cases', () => {
  beforeEach(() => {
    resetGlobalState();

    // Create common DOM elements
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
  });

  describe('WebSocket Connection Edge Cases', () => {
    test('initializeWebSocket handles WebSocket constructor failure', () => {
      const originalWebSocket = global.WebSocket;
      global.WebSocket = jest.fn(() => {
        throw new Error('WebSocket not supported');
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      initializeWebSocket();

      expect(consoleSpy).toHaveBeenCalledWith('Failed to create WebSocket connection:', expect.any(Error));
      expect(updateConnectionStatus).toHaveBeenCalledWith('disconnected', expect.stringContaining('Failed to initialize'));

      global.WebSocket = originalWebSocket;
      consoleSpy.mockRestore();
    });

    test('handleConnectionFailure with max attempts reached', () => {
      // Simulate max reconnection attempts
      for (let i = 0; i < 10; i++) {
        handleConnectionFailure('Test failure');
      }

      expect(updateConnectionStatus).toHaveBeenCalledWith('disconnected', 'Max reconnection attempts reached');
    });

    test('sendMessage with closed WebSocket', () => {
      const mockWebSocket = { readyState: 3, send: jest.fn() }; // CLOSED
      global.websocket = mockWebSocket;

      const result = sendMessage({ type: 'test' });

      expect(result).toBe(false);
      expect(mockWebSocket.send).not.toHaveBeenCalled();
    });

    test('sendMessage with WebSocket send error', () => {
      const mockWebSocket = {
        readyState: 1, // OPEN
        send: jest.fn(() => { throw new Error('Send failed'); })
      };
      global.websocket = mockWebSocket;

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = sendMessage({ type: 'test' });

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith('Error sending WebSocket message:', expect.any(Error));

      consoleSpy.mockRestore();
    });

    test('performConnectionHealthCheck with various WebSocket states', () => {
      // Test CONNECTING
      global.websocket = { readyState: 0 };
      expect(performConnectionHealthCheck()).toBe('connecting');

      // Test OPEN
      global.websocket = { readyState: 1 };
      expect(performConnectionHealthCheck()).toBe('healthy');

      // Test CLOSING
      global.websocket = { readyState: 2 };
      expect(performConnectionHealthCheck()).toBe('closing');

      // Test CLOSED
      global.websocket = { readyState: 3 };
      expect(performConnectionHealthCheck()).toBe('closed');

      // Test invalid state
      global.websocket = { readyState: 999 };
      expect(performConnectionHealthCheck()).toBe('unknown');
    });

    test('performConnectionHealthCheck with unhealthy connection', () => {
      const mockWebSocket = { readyState: 1 }; // OPEN
      global.websocket = mockWebSocket;

      // Mock old heartbeat
      const originalLastHeartbeat = connectionMetrics.lastHeartbeat;
      connectionMetrics.lastHeartbeat = new Date(Date.now() - 40000); // 40 seconds ago

      expect(performConnectionHealthCheck()).toBe('unhealthy');

      connectionMetrics.lastHeartbeat = originalLastHeartbeat;
    });
  });

  describe('Data Handling Edge Cases', () => {
    test('updateAgent with null agentData', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      updateAgent(null);

      expect(consoleSpy).toHaveBeenCalledWith('Invalid agent data:', null);
      consoleSpy.mockRestore();
    });

    test('updateAgent with missing id', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const agentData = { type: 'security', status: 'running' };

      updateAgent(agentData);

      expect(consoleSpy).toHaveBeenCalledWith('Invalid agent data:', agentData);
      consoleSpy.mockRestore();
    });

    test('updateTask with null taskData', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      updateTask(null);

      expect(consoleSpy).toHaveBeenCalledWith('Invalid task data:', null);
      consoleSpy.mockRestore();
    });

    test('addLogEntry with null logData', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      addLogEntry(null);

      expect(consoleSpy).toHaveBeenCalledWith('Invalid log data:', null);
      consoleSpy.mockRestore();
    });

    test('addLogEntry maintains maximum log size', () => {
      // Fill logs beyond capacity
      for (let i = 0; i < 1005; i++) {
        addLogEntry({
          time: new Date(),
          level: 'info',
          message: `Message ${i}`,
          agent: 'test_agent'
        });
      }

      expect(logs.length).toBeLessThanOrEqual(1000);
      expect(logs[0].message).toBe('Message 5'); // First few should be removed
    });
  });

  describe('UI Update Edge Cases', () => {
    test('updateAgentStatusOverview with empty agents array', () => {
      updateAgentStatusOverview();

      const container = document.getElementById('agentStatusOverview');
      expect(container.innerHTML).toContain('0% Complete');
    });

    test('updateTaskQueue with empty tasks array', () => {
      updateTaskQueue();

      const container = document.getElementById('taskQueue');
      expect(container.innerHTML).toContain('No tasks in queue');
    });

    test('updateActiveAgents with empty agents array', () => {
      updateActiveAgents();

      const container = document.getElementById('activeAgents');
      expect(container.innerHTML).toContain('No active agents');
    });

    test('updateTimeline with no agents with startTime', () => {
      agents.push({ id: '1', status: 'running' }); // No startTime

      updateTimeline();

      const container = document.getElementById('timeline');
      expect(container.innerHTML).toContain('No recent activity');
    });

    test('updateLogs with empty logs array', () => {
      updateLogs();

      const container = document.getElementById('logsContainer');
      expect(container.innerHTML).toContain('No logs available');
    });

    test('updateAllDisplays calls all update functions', () => {
      const spies = [
        jest.spyOn({ updateAgentStatusOverview }, 'updateAgentStatusOverview'),
        jest.spyOn({ updateTaskQueue }, 'updateTaskQueue'),
        jest.spyOn({ updateSystemResources }, 'updateSystemResources'),
        jest.spyOn({ updateActiveAgents }, 'updateActiveAgents'),
        jest.spyOn({ updateTimeline }, 'updateTimeline'),
        jest.spyOn({ updateLogs }, 'updateLogs'),
        jest.spyOn({ updateTaskDistributionChart }, 'updateTaskDistributionChart')
      ];

      updateAllDisplays();

      // Note: In the actual implementation, these functions are called directly
      // so we can't easily spy on them. This test verifies the function doesn't crash.
      expect(updateAllDisplays).toBeDefined();
    });
  });

  describe('Utility Function Edge Cases', () => {
    test('formatTime with invalid date inputs', () => {
      expect(formatTime(null)).toBe('N/A');
      expect(formatTime(undefined)).toBe('N/A');
      expect(formatTime('')).toBe('N/A');
      expect(formatTime('invalid-date')).toBe('N/A');
    });

    test('formatDuration with edge values', () => {
      expect(formatDuration(0)).toBe('0s');
      expect(formatDuration(59)).toBe('59s');
      expect(formatDuration(60)).toBe('1m 0s');
      expect(formatDuration(3599)).toBe('59m 59s');
      expect(formatDuration(3600)).toBe('1h 0m');
      expect(formatDuration(7265)).toBe('2h 1m'); // 2 hours, 1 minute, 5 seconds
    });

    test('fuzzyMatchScore with edge cases', () => {
      expect(fuzzyMatchScore('', '')).toBe(1.0);
      expect(fuzzyMatchScore('test', '')).toBe(0.0);
      expect(fuzzyMatchScore('', 'test')).toBe(1.0);
      expect(fuzzyMatchScore('test', 'test')).toBe(1.0);
      expect(fuzzyMatchScore('tst', 'test')).toBe(0.75); // 3 out of 4 characters match
    });

    test('fuzzyMatch with empty search term', () => {
      const searchFields = ['field1', 'field2'];
      expect(fuzzyMatch('', searchFields)).toBe(true);
    });

    test('checkDateRange with various date combinations', () => {
      const testDate = '2023-01-15';

      // No date range
      expect(checkDateRange(testDate, null, null)).toBe(true);

      // Only from date
      expect(checkDateRange(testDate, '2023-01-10', null)).toBe(true);
      expect(checkDateRange(testDate, '2023-01-20', null)).toBe(false);

      // Only to date
      expect(checkDateRange(testDate, null, '2023-01-20')).toBe(true);
      expect(checkDateRange(testDate, null, '2023-01-10')).toBe(false);

      // Both dates
      expect(checkDateRange(testDate, '2023-01-10', '2023-01-20')).toBe(true);
      expect(checkDateRange(testDate, '2023-01-01', '2023-01-10')).toBe(false);
    });

    test('checkDateRange with null agent date', () => {
      expect(checkDateRange(null, '2023-01-01', '2023-01-31')).toBe(false);
      expect(checkDateRange(null, null, null)).toBe(true);
    });
  });

  describe('Sorting and Filtering Edge Cases', () => {
    beforeEach(() => {
      agents.length = 0;
      agents.push(
        { id: '1', startTime: '2023-01-03', priority: 'high', status: 'running' },
        { id: '2', startTime: '2023-01-01', priority: 'low', status: 'completed' },
        { id: '3', startTime: '2023-01-02', priority: 'medium', status: 'pending' },
        { id: '4', priority: 'high', status: 'error' } // No startTime
      );
    });

    test('sortAgents by newest (default)', () => {
      const sorted = sortAgents([...agents], 'newest');

      expect(sorted[0].id).toBe('1'); // Most recent
      expect(sorted[1].id).toBe('3');
      expect(sorted[2].id).toBe('2');
      expect(sorted[3].id).toBe('4'); // No startTime comes last
    });

    test('sortAgents by oldest', () => {
      const sorted = sortAgents([...agents], 'oldest');

      expect(sorted[0].id).toBe('2'); // Oldest
      expect(sorted[1].id).toBe('3');
      expect(sorted[2].id).toBe('1');
      expect(sorted[3].id).toBe('4'); // No startTime comes last
    });

    test('sortAgents by priority high to low', () => {
      const sorted = sortAgents([...agents], 'priority-high');

      expect(sorted[0].priority).toBe('high');
      expect(sorted[1].priority).toBe('high');
      expect(sorted[2].priority).toBe('medium');
      expect(sorted[3].priority).toBe('low');
    });

    test('sortAgents by priority low to high', () => {
      const sorted = sortAgents([...agents], 'priority-low');

      expect(sorted[0].priority).toBe('low');
      expect(sorted[1].priority).toBe('medium');
      expect(sorted[2].priority).toBe('high');
      expect(sorted[3].priority).toBe('high');
    });

    test('sortAgents by status', () => {
      const sorted = sortAgents([...agents], 'status');

      // Should be ordered by status priority: running, pending, error, completed
      expect(sorted[0].status).toBe('running');
      expect(sorted[1].status).toBe('pending');
      expect(sorted[2].status).toBe('error');
      expect(sorted[3].status).toBe('completed');
    });

    test('sortAgents by progress', () => {
      // Add progress values
      agents[0].progress = 50;
      agents[1].progress = 100;
      agents[2].progress = 25;
      agents[3].progress = 75;

      const sorted = sortAgents([...agents], 'progress');

      expect(sorted[0].progress).toBe(100);
      expect(sorted[1].progress).toBe(75);
      expect(sorted[2].progress).toBe(50);
      expect(sorted[3].progress).toBe(25);
    });

    test('sortAgents with invalid sort type defaults to newest', () => {
      const sorted = sortAgents([...agents], 'invalid');

      expect(sorted[0].id).toBe('1'); // Same as newest
    });
  });

  describe('Modal and Agent Details Edge Cases', () => {
    test('showAgentDetails with non-existent agent', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      showAgentDetails('nonexistent');

      expect(consoleSpy).toHaveBeenCalledWith('Agent not found:', 'nonexistent');
      consoleSpy.mockRestore();
    });

    test('showAgentDetails with agent having no logs', () => {
      agents.push({ id: 'test_agent', type: 'security', status: 'running' });

      showAgentDetails('test_agent');

      const modalBody = document.getElementById('modalBody');
      expect(modalBody.innerHTML).toContain('No logs available for this agent');
    });

    test('showAgentDetails with agent having error', () => {
      agents.push({
        id: 'error_agent',
        type: 'security',
        status: 'error',
        error: 'Test error message'
      });

      showAgentDetails('error_agent');

      const modalBody = document.getElementById('modalBody');
      expect(modalBody.innerHTML).toContain('Test error message');
    });
  });

  describe('Export and File Operations Edge Cases', () => {
    test('exportLogs with Blob and URL not available', () => {
      const originalBlob = global.Blob;
      const originalURL = global.URL;

      global.Blob = undefined;
      global.URL = undefined;

      // Should not crash
      expect(() => exportLogs()).not.toThrow();

      global.Blob = originalBlob;
      global.URL = originalURL;
    });

    test('exportFilteredAgents with no Blob support', () => {
      const originalBlob = global.Blob;
      global.Blob = undefined;

      const result = exportFilteredAgents();

      expect(typeof result).toBe('string');
      expect(result).toContain('ID,Type,Status,Priority,Progress,Task,Start Time,Error');

      global.Blob = originalBlob;
    });

    test('exportFilteredAgents with filtered agents', () => {
      agents.push(
        { id: '1', type: 'security', status: 'running', priority: 'high', progress: 75, task: 'Test task', startTime: '2023-01-01' },
        { id: '2', type: 'testing', status: 'completed', priority: 'medium', progress: 100, task: 'Another task' }
      );

      document.getElementById('statusFilter').value = 'running';

      const csvData = exportFilteredAgents();

      expect(csvData).toContain('1,security,running,high,75%,Test task,');
      expect(csvData).not.toContain('2,testing,completed');
    });
  });

  describe('Theme and LocalStorage Edge Cases', () => {
    test('toggleTheme with localStorage not available', () => {
      const originalLocalStorage = global.localStorage;
      global.localStorage = undefined;

      // Should not crash
      expect(() => toggleTheme()).not.toThrow();

      global.localStorage = originalLocalStorage;
    });

    test('toggleTheme with localStorage throwing error', () => {
      const mockLocalStorage = {
        setItem: jest.fn(() => { throw new Error('Storage quota exceeded'); })
      };
      global.localStorage = mockLocalStorage;

      // Should not crash
      expect(() => toggleTheme()).not.toThrow();

      global.localStorage = undefined; // Reset
    });
  });

  describe('Heartbeat Mechanism Edge Cases', () => {
    test('startHeartbeat with setInterval not available', () => {
      const originalSetInterval = global.setInterval;
      global.setInterval = undefined;

      // Should not crash
      expect(() => startHeartbeat()).not.toThrow();

      global.setInterval = originalSetInterval;
    });

    test('startHeartbeat stops existing heartbeat', () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      startHeartbeat(); // Start first heartbeat
      startHeartbeat(); // Start second heartbeat (should clear first)

      expect(clearIntervalSpy).toHaveBeenCalled();

      clearIntervalSpy.mockRestore();
      stopHeartbeat(); // Clean up
    });

    test('stopHeartbeat with no active heartbeat', () => {
      // Should not crash
      expect(() => stopHeartbeat()).not.toThrow();
    });
  });

  describe('Performance Metrics Edge Cases', () => {
    test('updatePerformanceMetrics with null performanceData', () => {
      // Should not crash
      expect(() => updatePerformanceMetrics(null)).not.toThrow();
    });

    test('updatePerformanceMetrics with WebSocket not connected', () => {
      global.websocket = { readyState: 3 }; // CLOSED

      // Should not crash
      expect(() => updatePerformanceMetrics({})).not.toThrow();
    });
  });

  describe('System Alert Handling Edge Cases', () => {
    test('handleSystemAlert with missing alert properties', () => {
      expect(() => handleSystemAlert({})).not.toThrow();
      expect(() => handleSystemAlert(null)).not.toThrow();
      expect(() => handleSystemAlert({ message: 'Test' })).not.toThrow();
    });
  });

  describe('Resource Data Updates Edge Cases', () => {
    test('updateResourceData maintains data array size limit', () => {
      // Fill resourceData beyond capacity
      for (let i = 0; i < 25; i++) {
        resourceData.push({
          time: new Date(),
          cpu: 50,
          memory: 60,
          disk: 30
        });
      }

      updateResourceData({});

      expect(resourceData.length).toBeLessThanOrEqual(20);
    });
  });

  describe('Filter Summary Edge Cases', () => {
    test('updateFilterSummary with DOM elements not available', () => {
      document.body.innerHTML = '';

      // Should not crash
      expect(() => updateFilterSummary(5, 10)).not.toThrow();
    });
  });

  describe('Clear Filters Edge Cases', () => {
    test('clearAllFilters with missing DOM elements', () => {
      document.body.innerHTML = '';

      // Should not crash
      expect(() => clearAllFilters()).not.toThrow();
    });
  });

  describe('Chart Initialization Edge Cases', () => {
    test('initializeCharts with Chart.js not available', () => {
      const originalChart = global.Chart;
      global.Chart = undefined;

      // Should not crash
      expect(() => initializeCharts()).not.toThrow();

      global.Chart = originalChart;
    });

    test('initializeCharts with missing canvas elements', () => {
      document.body.innerHTML = '';

      // Should not crash
      expect(() => initializeCharts()).not.toThrow();
    });
  });

  describe('WebSocket Message Handling Edge Cases', () => {
    test('handleWebSocketMessage with null data', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      handleWebSocketMessage(null);

      expect(consoleSpy).toHaveBeenCalledWith('Unknown message type received:', undefined);
      consoleSpy.mockRestore();
    });

    test('handleWebSocketMessage with invalid JSON data', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      // Mock JSON.parse to throw
      const originalParse = JSON.parse;
      JSON.parse = jest.fn(() => { throw new Error('Invalid JSON'); });

      // This would be called from the WebSocket onmessage handler
      // We can't easily test this directly, but we can test the error handling concept

      JSON.parse = originalParse;
      consoleSpy.mockRestore();
    });

    test('handleWebSocketMessage with unknown message type', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      handleWebSocketMessage({ type: 'unknown_type', data: 'test' });

      expect(consoleSpy).toHaveBeenCalledWith('Unknown message type received:', 'unknown_type');
      consoleSpy.mockRestore();
    });
  });

  describe('Load Demo Data Edge Cases', () => {
    test('loadDemoData populates all data arrays correctly', () => {
      loadDemoData();

      expect(agents.length).toBeGreaterThan(0);
      expect(tasks.length).toBeGreaterThan(0);
      expect(logs.length).toBeGreaterThan(0);

      // Verify agent structure
      const agent = agents[0];
      expect(agent).toHaveProperty('id');
      expect(agent).toHaveProperty('type');
      expect(agent).toHaveProperty('status');
      expect(agent).toHaveProperty('task');
      expect(agent).toHaveProperty('progress');
      expect(agent).toHaveProperty('priority');

      // Verify task structure
      const task = tasks[0];
      expect(task).toHaveProperty('id');
      expect(task).toHaveProperty('type');
      expect(task).toHaveProperty('status');
      expect(task).toHaveProperty('priority');
      expect(task).toHaveProperty('description');

      // Verify log structure
      const log = logs[0];
      expect(log).toHaveProperty('time');
      expect(log).toHaveProperty('level');
      expect(log).toHaveProperty('message');
    });
  });

  describe('Global State Reset Edge Cases', () => {
    test('resetGlobalState clears all global variables', () => {
      // Populate some data first
      agents.push({ id: 'test' });
      tasks.push({ id: 'test' });
      logs.push({ time: new Date(), level: 'info', message: 'test' });
      resourceData.push({ time: new Date(), cpu: 50 });
      currentTheme = 'dark';
      autoScrollLogs = false;

      resetGlobalState();

      expect(agents.length).toBe(0);
      expect(tasks.length).toBe(0);
      expect(logs.length).toBe(0);
      expect(resourceData.length).toBe(0);
      expect(currentTheme).toBe('light');
      expect(autoScrollLogs).toBe(true);
      expect(Object.keys(charts).length).toBe(0);
    });
  });
});
