const {
  initializeWebSocket,
  updateSystemResources,
  refreshData,
  initializeCharts,
  resetGlobalState,
  websocket,
  resourceData,
  charts
} = require('../dashboard-functions');

describe('WebSocket Integration Tests', () => {
  let mockWebSocket;

  beforeEach(() => {
    // Reset all global state
    resetGlobalState();

    document.body.innerHTML = `
      <div id="connectionStatus"></div>
      <div id="connectionText"></div>
      <canvas id="resourceChart"></canvas>
      <canvas id="taskDistributionChart"></canvas>
    `;

    mockWebSocket = {
      readyState: WebSocket.OPEN,
      send: jest.fn(),
      close: jest.fn(),
      onopen: null,
      onclose: null,
      onmessage: null,
      onerror: null
    };

    global.WebSocket = jest.fn(() => mockWebSocket);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initializeWebSocket', () => {
    test('creates WebSocket with correct URL', () => {
      Object.defineProperty(window, 'location', {
        value: { protocol: 'http:' },
        writable: true
      });

      initializeWebSocket();

      expect(global.WebSocket).toHaveBeenCalledWith('ws://localhost:8080/ws');
    });

    test('uses secure WebSocket for HTTPS', () => {
      Object.defineProperty(window, 'location', {
        value: { protocol: 'https:' },
        writable: true
      });

      initializeWebSocket();

      expect(global.WebSocket).toHaveBeenCalledWith('wss://localhost:8080/ws');
    });

    test('sets up WebSocket event handlers', () => {
      initializeWebSocket();

      expect(typeof mockWebSocket.onopen).toBe('function');
      expect(typeof mockWebSocket.onclose).toBe('function');
      expect(typeof mockWebSocket.onmessage).toBe('function');
      expect(typeof mockWebSocket.onerror).toBe('function');
    });

    test('sends initial status request on open', () => {
      // Mock WebSocket to capture the instance
      let capturedWebSocket;
      global.WebSocket = jest.fn().mockImplementation(function(url) {
        capturedWebSocket = this;
        this.url = url;
        this.readyState = WebSocket.CONNECTING;
        this.onopen = null;
        this.onclose = null;
        this.onmessage = null;
        this.onerror = null;
        this.send = jest.fn();

        // Simulate connection
        setTimeout(() => {
          this.readyState = WebSocket.OPEN;
          if (this.onopen) this.onopen();
        }, 0);

        return this;
      });

      initializeWebSocket();

      // Wait for async connection
      return new Promise(resolve => {
        setTimeout(() => {
          expect(capturedWebSocket.send).toHaveBeenCalledWith(
            JSON.stringify({ type: 'request_status' })
          );
          resolve();
        }, 10);
      });
    });

    test('handles WebSocket errors gracefully', () => {
      global.WebSocket = jest.fn(() => {
        throw new Error('Connection failed');
      });

      expect(() => {
        initializeWebSocket();
      }).not.toThrow();

      const statusElement = document.getElementById('connectionText');
      expect(statusElement.textContent).toBe('Failed to Connect');
    });

    test('processes WebSocket messages correctly', () => {
      const mockMessage = {
        data: JSON.stringify({
          type: 'log_entry',
          log: {
            time: new Date(),
            level: 'info',
            message: 'Test message'
          }
        })
      };

      initializeWebSocket();
      mockWebSocket.onmessage(mockMessage);

      // Should not throw and should process the message
      expect(console.error).not.toHaveBeenCalled();
    });

    test('handles malformed WebSocket messages', () => {
      const mockMessage = {
        data: 'invalid json'
      };

      initializeWebSocket();
      mockWebSocket.onmessage(mockMessage);

      expect(console.error).toHaveBeenCalledWith(
        'Error parsing WebSocket message:',
        expect.any(Error)
      );
    });
  });

  describe('refreshData', () => {
    test('sends status request when WebSocket is open', () => {
      // Mock global websocket variable
      global.websocket = {
        readyState: WebSocket.OPEN,
        send: jest.fn()
      };

      refreshData();

      expect(global.websocket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'request_status' })
      );
    });

    test('loads demo data when WebSocket is not available', () => {
      global.websocket = null;

      const originalAgentsLength = require('../dashboard-functions').agents.length;
      refreshData();

      // Should load demo data (agents array should be populated)
      const { agents } = require('../dashboard-functions');
      expect(agents.length).toBeGreaterThan(originalAgentsLength);
    });

    test('loads demo data when WebSocket is not open', () => {
      global.websocket = {
        readyState: WebSocket.CLOSED,
        send: jest.fn()
      };

      refreshData();

      expect(global.websocket.send).not.toHaveBeenCalled();
    });
  });
});

describe('System Resource Monitoring Tests', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="systemResources"></div>
    `;

    // Clear resource data
    resourceData.length = 0;

    // Reset agents array
    const { agents } = require('../dashboard-functions');
    agents.length = 0;
  });

  describe('updateSystemResources', () => {
    test('generates realistic resource usage values', () => {
      updateSystemResources();

      const container = document.getElementById('systemResources');
      const cpuMatch = container.innerHTML.match(/CPU Usage.*?(\d+)%/);
      const memoryMatch = container.innerHTML.match(/Memory Usage.*?(\d+)%/);
      const diskMatch = container.innerHTML.match(/Disk Usage.*?(\d+)%/);

      expect(cpuMatch).toBeTruthy();
      expect(memoryMatch).toBeTruthy();
      expect(diskMatch).toBeTruthy();

      const cpuUsage = parseInt(cpuMatch[1]);
      const memoryUsage = parseInt(memoryMatch[1]);
      const diskUsage = parseInt(diskMatch[1]);

      expect(cpuUsage).toBeGreaterThanOrEqual(20);
      expect(cpuUsage).toBeLessThanOrEqual(60);
      expect(memoryUsage).toBeGreaterThanOrEqual(40);
      expect(memoryUsage).toBeLessThanOrEqual(70);
      expect(diskUsage).toBeGreaterThanOrEqual(15);
      expect(diskUsage).toBeLessThanOrEqual(35);
    });

    test('displays active processes count correctly', () => {
      const { agents } = require('../dashboard-functions');
      agents.push(
        { id: '1', status: 'running' },
        { id: '2', status: 'running' },
        { id: '3', status: 'completed' }
      );

      updateSystemResources();

      const container = document.getElementById('systemResources');
      expect(container.innerHTML).toContain('Active Processes');
      expect(container.innerHTML).toContain('2'); // Only running agents
    });

    test('maintains resource data history', () => {
      const initialLength = resourceData.length;

      updateSystemResources();

      expect(resourceData.length).toBe(initialLength + 1);
      expect(resourceData[resourceData.length - 1]).toHaveProperty('time');
      expect(resourceData[resourceData.length - 1]).toHaveProperty('cpu');
      expect(resourceData[resourceData.length - 1]).toHaveProperty('memory');
      expect(resourceData[resourceData.length - 1]).toHaveProperty('disk');
    });

    test('limits resource data to 20 entries', () => {
      // Fill with more than 20 entries
      for (let i = 0; i < 25; i++) {
        updateSystemResources();
      }

      expect(resourceData.length).toBe(20);
    });

    test('resource data entries have valid values', () => {
      updateSystemResources();

      const latest = resourceData[resourceData.length - 1];
      expect(latest.cpu).toBeGreaterThanOrEqual(0);
      expect(latest.cpu).toBeLessThanOrEqual(100);
      expect(latest.memory).toBeGreaterThanOrEqual(0);
      expect(latest.memory).toBeLessThanOrEqual(100);
      expect(latest.disk).toBeGreaterThanOrEqual(0);
      expect(latest.disk).toBeLessThanOrEqual(100);
      expect(latest.time).toBeInstanceOf(Date);
    });
  });
});

describe('Chart Integration Tests', () => {
  let mockChart;

  beforeEach(() => {
    document.body.innerHTML = `
      <canvas id="resourceChart"></canvas>
      <canvas id="taskDistributionChart"></canvas>
    `;

    mockChart = {
      data: {
        labels: [],
        datasets: [{
          data: [],
          borderColor: '#667eea',
          backgroundColor: 'rgba(102,126,234,0.1)'
        }]
      },
      update: jest.fn(),
      destroy: jest.fn()
    };

    global.Chart = jest.fn(() => mockChart);
    Object.keys(charts).forEach(key => delete charts[key]);
  });

  describe('initializeCharts', () => {
    test('creates resource chart when Chart.js is available', () => {
      initializeCharts();

      expect(global.Chart).toHaveBeenCalledWith(
        expect.any(Object), // canvas context
        expect.objectContaining({
          type: 'line',
          data: expect.objectContaining({
            labels: [],
            datasets: expect.arrayContaining([
              expect.objectContaining({
                label: 'CPU %'
              }),
              expect.objectContaining({
                label: 'Memory %'
              })
            ])
          })
        })
      );
    });

    test('creates task distribution chart when Chart.js is available', () => {
      initializeCharts();

      expect(global.Chart).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          type: 'doughnut',
          data: expect.objectContaining({
            labels: ['Security', 'Testing', 'Performance', 'Documentation', 'Refactoring']
          })
        })
      );
    });

    test('handles missing Chart.js gracefully', () => {
      global.Chart = undefined;

      expect(() => {
        initializeCharts();
      }).not.toThrow();
    });

    test('handles missing canvas elements gracefully', () => {
      document.body.innerHTML = '';

      expect(() => {
        initializeCharts();
      }).not.toThrow();
    });

    test('stores chart references correctly', () => {
      initializeCharts();

      expect(charts.resource).toBeDefined();
      expect(charts.taskDistribution).toBeDefined();
    });
  });
});

describe('Performance and Memory Management Tests', () => {
  describe('Memory management', () => {
    test('logs array maintains size limit during heavy usage', () => {
      const { logs, addLogEntry } = require('../dashboard-functions');

      // Clear logs first
      logs.length = 0;

      // Add many log entries rapidly
      for (let i = 0; i < 1500; i++) {
        addLogEntry({
          time: new Date(),
          level: 'info',
          message: `Stress test message ${i}`,
          agent: 'stress_test_agent'
        });
      }

      expect(logs.length).toBeLessThanOrEqual(1000);
    });

    test('resource data array maintains size limit', () => {
      // Clear resource data
      resourceData.length = 0;

      // Simulate rapid resource updates
      for (let i = 0; i < 50; i++) {
        updateSystemResources();
      }

      expect(resourceData.length).toBeLessThanOrEqual(20);
    });
  });

  describe('DOM manipulation performance', () => {
    test('updateActiveAgents handles large agent arrays efficiently', () => {
      const { agents } = require('../dashboard-functions');
      agents.length = 0;

      // Add many agents
      for (let i = 0; i < 100; i++) {
        agents.push({
          id: `agent_${i}`,
          type: 'testing',
          status: 'running',
          task: `Task ${i}`,
          progress: i % 100,
          priority: 'medium'
        });
      }

      document.body.innerHTML = '<div id="activeAgents"></div>';

      const startTime = Date.now();
      const { updateActiveAgents } = require('../dashboard-functions');
      updateActiveAgents();
      const endTime = Date.now();

      // Should complete in reasonable time (less than 100ms for 100 agents)
      expect(endTime - startTime).toBeLessThan(100);

      const container = document.getElementById('activeAgents');
      expect(container.children.length).toBe(100);
    });
  });
});