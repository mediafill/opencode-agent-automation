const {
  initializeWebSocket,
  handleWebSocketMessage,
  updateConnectionStatus,
  sendMessage,
  resetGlobalState,
  websocket,
  agents,
  tasks,
  logs,
  resourceData,
  connectionState,
  connectionMetrics
} = require('../dashboard-functions');

describe('Enhanced WebSocket Integration Tests', () => {
  let mockWebSocket;

  beforeEach(() => {
    // Reset all global state
    resetGlobalState();
    
    document.body.innerHTML = `
      <div id="connectionStatus"></div>
      <div id="connectionText"></div>
      <div id="agentStatusOverview"></div>
      <div id="activeAgents"></div>
      <div id="taskQueue"></div>
      <div id="systemResources"></div>
      <div id="timeline"></div>
      <div id="logsContainer"></div>
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
    global.console.warn = jest.fn();
    global.console.error = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Enhanced Connection Management', () => {
    test('creates WebSocket with protocol detection', () => {
      Object.defineProperty(window, 'location', {
        value: { protocol: 'https:' },
        writable: true
      });

      initializeWebSocket();

      expect(global.WebSocket).toHaveBeenCalledWith('wss://localhost:8080/ws');
    });

    test('handles connection timeout', () => {
      jest.useFakeTimers();
      initializeWebSocket();
      
      // Fast-forward time to trigger timeout
      jest.advanceTimersByTime(11000);
      
      expect(mockWebSocket.close).toHaveBeenCalled();
      jest.useRealTimers();
    });

    test('implements exponential backoff for reconnection', () => {
      jest.useFakeTimers();
      
      global.WebSocket = jest.fn(() => {
        throw new Error('Connection failed');
      });

      initializeWebSocket();
      
      // Should schedule reconnection with increasing delays
      jest.advanceTimersByTime(2000); // First retry after ~1s
      expect(global.WebSocket).toHaveBeenCalledTimes(2);
      
      jest.advanceTimersByTime(4000); // Second retry after ~2s
      expect(global.WebSocket).toHaveBeenCalledTimes(3);
      
      jest.useRealTimers();
    });

    test('handles maximum reconnection attempts', () => {
      global.WebSocket = jest.fn(() => {
        throw new Error('Connection failed');
      });

      // Mock internal state for max attempts
      const originalMaxAttempts = require('../dashboard-functions').maxReconnectAttempts;
      require('../dashboard-functions').maxReconnectAttempts = 2;

      initializeWebSocket();
      
      const statusElement = document.getElementById('connectionText');
      setTimeout(() => {
        expect(statusElement.textContent).toContain('Max reconnection attempts');
        require('../dashboard-functions').maxReconnectAttempts = originalMaxAttempts;
      }, 100);
    });
  });

  describe('Heartbeat and Health Monitoring', () => {
    test('sends heartbeat ping messages', () => {
      jest.useFakeTimers();
      
      initializeWebSocket();
      mockWebSocket.onopen();
      
      // Advance time to trigger heartbeat
      jest.advanceTimersByTime(30000);
      
      expect(mockWebSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"ping"')
      );
      
      jest.useRealTimers();
    });

    test('detects heartbeat timeout and forces reconnection', () => {
      jest.useFakeTimers();
      
      initializeWebSocket();
      mockWebSocket.onopen();
      
      // Simulate no heartbeat response for extended period
      jest.advanceTimersByTime(70000); // More than 2x heartbeat interval
      
      expect(mockWebSocket.close).toHaveBeenCalledWith(1006, 'Heartbeat timeout');
      
      jest.useRealTimers();
    });

    test('updates connection metrics correctly', () => {
      initializeWebSocket();
      mockWebSocket.onopen();
      
      expect(require('../dashboard-functions').connectionMetrics.connectTime).toBeTruthy();
      expect(require('../dashboard-functions').connectionMetrics.reconnectCount).toBe(0);
      
      // Simulate message sending
      const result = sendMessage({ type: 'test' });
      expect(result).toBe(true);
      expect(require('../dashboard-functions').connectionMetrics.messagesSent).toBe(1);
    });
  });

  describe('Message Handling and Validation', () => {
    test('validates message structure before processing', () => {
      const invalidMessages = [
        null,
        undefined,
        'string',
        123,
        [],
        { /* no type */ }
      ];

      invalidMessages.forEach(msg => {
        console.warn.mockClear();
        handleWebSocketMessage(msg);
        expect(console.warn).toHaveBeenCalled();
      });
    });

    test('processes full_status message correctly', () => {
      const statusMessage = {
        type: 'full_status',
        agents: [
          { id: 'agent1', status: 'running', type: 'testing' },
          { id: 'agent2', status: 'completed', type: 'security' }
        ],
        tasks: [
          { id: 'task1', status: 'pending', type: 'performance' }
        ]
      };

      handleWebSocketMessage(statusMessage);

      expect(agents).toHaveLength(2);
      expect(tasks).toHaveLength(1);
      expect(agents[0].id).toBe('agent1');
      expect(tasks[0].id).toBe('task1');
    });

    test('handles agent_update with status change logging', () => {
      // First add an agent
      agents.push({ id: 'test_agent', status: 'pending' });

      const updateMessage = {
        type: 'agent_update',
        agent: { id: 'test_agent', status: 'running', progress: 50 }
      };

      handleWebSocketMessage(updateMessage);

      expect(agents[0].status).toBe('running');
      expect(agents[0].progress).toBe(50);
      
      // Check that status change was logged
      const statusChangeLog = logs.find(log => 
        log.message.includes('status changed from pending to running')
      );
      expect(statusChangeLog).toBeTruthy();
    });

    test('processes resource_update message', () => {
      const resourceMessage = {
        type: 'resource_update',
        resources: {
          cpu: 45,
          memory: 60,
          disk: 30,
          timestamp: new Date().toISOString()
        }
      };

      handleWebSocketMessage(resourceMessage);

      expect(resourceData).toHaveLength(1);
      expect(resourceData[0]).toMatchObject({
        cpu: expect.any(Number),
        memory: expect.any(Number),
        disk: expect.any(Number)
      });
    });

    test('handles system_alert message', () => {
      const alertMessage = {
        type: 'system_alert',
        alert: {
          severity: 'error',
          message: 'High memory usage detected'
        }
      };

      handleWebSocketMessage(alertMessage);

      const alertLog = logs.find(log => 
        log.message.includes('High memory usage detected') && log.level === 'error'
      );
      expect(alertLog).toBeTruthy();
      expect(alertLog.agent).toBe('system');
    });

    test('processes agent_metrics message', () => {
      const metricsMessage = {
        type: 'agent_metrics',
        metrics: {
          performance: {
            averageResponseTime: 250,
            throughput: 100
          },
          resources: {
            cpu: 35,
            memory: 55
          }
        }
      };

      // Mock the performance update function
      const originalUpdate = require('../dashboard-functions').updatePerformanceMetrics;
      const mockUpdate = jest.fn();
      require('../dashboard-functions').updatePerformanceMetrics = mockUpdate;

      handleWebSocketMessage(metricsMessage);

      expect(mockUpdate).toHaveBeenCalledWith(metricsMessage.metrics.performance);

      // Restore original function
      require('../dashboard-functions').updatePerformanceMetrics = originalUpdate;
    });

    test('logs unknown message types', () => {
      const unknownMessage = {
        type: 'unknown_message_type',
        data: 'some data'
      };

      console.log = jest.fn();
      handleWebSocketMessage(unknownMessage);

      expect(console.log).toHaveBeenCalledWith(
        'Unknown message type received:', 'unknown_message_type'
      );
    });
  });

  describe('Connection State Management', () => {
    test('handles normal WebSocket closure', () => {
      initializeWebSocket();
      
      const closeEvent = { code: 1000, reason: 'Normal closure' };
      mockWebSocket.onclose(closeEvent);

      const statusElement = document.getElementById('connectionText');
      expect(statusElement.textContent).toBe('Disconnected');
    });

    test('handles abnormal WebSocket closure with reconnection', () => {
      jest.useFakeTimers();
      
      initializeWebSocket();
      mockWebSocket.onopen();
      
      const closeEvent = { code: 1006, reason: 'Connection lost' };
      mockWebSocket.onclose(closeEvent);

      // Should attempt reconnection
      jest.advanceTimersByTime(2000);
      expect(global.WebSocket).toHaveBeenCalledTimes(2);
      
      jest.useRealTimers();
    });

    test('handles WebSocket errors gracefully', () => {
      initializeWebSocket();
      
      const errorEvent = new Error('WebSocket error');
      mockWebSocket.onerror(errorEvent);

      expect(console.error).toHaveBeenCalledWith('WebSocket error:', errorEvent);
    });
  });

  describe('Performance Monitoring', () => {
    test('tracks connection uptime', () => {
      jest.useFakeTimers();
      const startTime = Date.now();
      
      initializeWebSocket();
      mockWebSocket.onopen();
      
      jest.advanceTimersByTime(5000);
      
      const metrics = require('../dashboard-functions').connectionMetrics;
      expect(metrics.connectTime.getTime()).toBeCloseTo(startTime, -2);
      
      jest.useRealTimers();
    });

    test('tracks message statistics', () => {
      initializeWebSocket();
      mockWebSocket.onopen();
      
      // Send messages
      sendMessage({ type: 'test1' });
      sendMessage({ type: 'test2' });
      
      // Receive messages
      mockWebSocket.onmessage({ data: JSON.stringify({ type: 'pong' }) });
      mockWebSocket.onmessage({ data: JSON.stringify({ type: 'log_entry', log: {} }) });
      
      const metrics = require('../dashboard-functions').connectionMetrics;
      expect(metrics.messagesSent).toBe(2);
      expect(metrics.messagesReceived).toBe(2);
    });

    test('handles performance metrics updates', () => {
      const performanceData = {
        connectionUptime: 60000,
        messagesSent: 10,
        messagesReceived: 15,
        reconnectCount: 1
      };

      // Mock sendMessage to avoid actual WebSocket call
      const originalSendMessage = require('../dashboard-functions').sendMessage;
      const mockSendMessage = jest.fn();
      
      // Temporarily replace sendMessage
      require('../dashboard-functions').sendMessage = mockSendMessage;
      global.websocket = { readyState: 1 };

      const updatePerformanceMetrics = require('../dashboard-functions').updatePerformanceMetrics;
      updatePerformanceMetrics(performanceData);

      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'performance_metrics',
        data: performanceData,
        timestamp: expect.any(Number)
      });

      // Restore original function
      require('../dashboard-functions').sendMessage = originalSendMessage;
    });
  });

  describe('Real-time Data Updates', () => {
    test('updates agent display in real-time', () => {
      agents.push({ id: 'real_time_agent', status: 'pending', task: 'Test task', progress: 0 });

      const updateMessage = {
        type: 'agent_update',
        agent: { id: 'real_time_agent', status: 'running', progress: 75 }
      };

      handleWebSocketMessage(updateMessage);

      const container = document.getElementById('activeAgents');
      expect(container.innerHTML).toContain('real_time_agent');
      expect(container.innerHTML).toContain('running');
      expect(container.innerHTML).toContain('75%');
    });

    test('updates task queue in real-time', () => {
      const taskUpdate = {
        type: 'task_update',
        task: { id: 'new_task', status: 'in_progress', type: 'testing', priority: 'high' }
      };

      handleWebSocketMessage(taskUpdate);

      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('new_task');

      const container = document.getElementById('taskQueue');
      expect(container.innerHTML).toContain('IN_PROGRESS');
    });

    test('appends log entries in real-time', () => {
      const logMessage = {
        type: 'log_entry',
        log: {
          time: new Date(),
          level: 'info',
          message: 'Real-time log entry',
          agent: 'test_agent'
        }
      };

      handleWebSocketMessage(logMessage);

      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('Real-time log entry');

      const container = document.getElementById('logsContainer');
      expect(container.innerHTML).toContain('Real-time log entry');
    });

    test('maintains log size limits during heavy traffic', () => {
      // Simulate heavy log traffic
      for (let i = 0; i < 1200; i++) {
        const logMessage = {
          type: 'log_entry',
          log: {
            time: new Date(),
            level: 'debug',
            message: `Log entry ${i}`,
            agent: 'stress_test'
          }
        };
        handleWebSocketMessage(logMessage);
      }

      expect(logs.length).toBeLessThanOrEqual(1000);
      expect(logs[logs.length - 1].message).toContain('Log entry 1199');
    });
  });

  describe('Error Recovery and Resilience', () => {
    test('recovers from malformed JSON messages', () => {
      initializeWebSocket();
      
      const malformedEvent = { data: '{"invalid": json}' };
      mockWebSocket.onmessage(malformedEvent);

      expect(console.error).toHaveBeenCalledWith(
        'Error parsing WebSocket message:',
        expect.any(Error)
      );

      // Should add error to logs
      const errorLog = logs.find(log => 
        log.message.includes('WebSocket message parse error')
      );
      expect(errorLog).toBeTruthy();
    });

    test('handles null agent data gracefully', () => {
      const invalidUpdate = {
        type: 'agent_update',
        agent: null
      };

      console.warn.mockClear();
      handleWebSocketMessage(invalidUpdate);

      expect(console.warn).toHaveBeenCalledWith('Invalid agent data:', null);
      expect(agents).toHaveLength(0); // Should not add invalid agent
    });

    test('handles missing agent ID gracefully', () => {
      const invalidUpdate = {
        type: 'agent_update',
        agent: { status: 'running', progress: 50 } // missing id
      };

      console.warn.mockClear();
      handleWebSocketMessage(invalidUpdate);

      expect(console.warn).toHaveBeenCalledWith(
        'Invalid agent data:', 
        expect.objectContaining({ status: 'running' })
      );
    });

    test('recovers from send message failures', () => {
      mockWebSocket.send = jest.fn(() => {
        throw new Error('Send failed');
      });

      initializeWebSocket();
      mockWebSocket.onopen();

      const result = sendMessage({ type: 'test' });
      
      expect(result).toBe(false);
      expect(console.error).toHaveBeenCalledWith(
        'Error sending WebSocket message:',
        expect.any(Error)
      );
    });

    test('handles WebSocket state changes during operations', () => {
      initializeWebSocket();
      mockWebSocket.onopen();
      
      // Change state to closing mid-operation
      mockWebSocket.readyState = WebSocket.CLOSING;
      
      const result = sendMessage({ type: 'test' });
      expect(result).toBe(false);
      expect(console.warn).toHaveBeenCalledWith(
        'Cannot send message: WebSocket not connected'
      );
    });
  });

  describe('Connection Health Checks', () => {
    test('performs health check for different WebSocket states', () => {
      const healthCheck = require('../dashboard-functions').performConnectionHealthCheck;
      
      // No WebSocket
      global.websocket = null;
      expect(healthCheck()).toBe(false);
      
      // Connecting state
      global.websocket = { readyState: 0 };
      expect(healthCheck()).toBe('connecting');
      
      // Open and healthy
      global.websocket = { readyState: 1 };
      require('../dashboard-functions').connectionMetrics.lastHeartbeat = new Date();
      expect(healthCheck()).toBe('healthy');
      
      // Open but unhealthy (no recent heartbeat)
      require('../dashboard-functions').connectionMetrics.lastHeartbeat = new Date(Date.now() - 60000);
      expect(healthCheck()).toBe('unhealthy');
      
      // Closing state
      global.websocket = { readyState: 2 };
      expect(healthCheck()).toBe('closing');
      
      // Closed state
      global.websocket = { readyState: 3 };
      expect(healthCheck()).toBe('closed');
    });
  });

  describe('Advanced Message Processing', () => {
    test('processes batch message updates efficiently', () => {
      const batchMessage = {
        type: 'full_status',
        agents: Array.from({ length: 50 }, (_, i) => ({
          id: `agent_${i}`,
          status: i % 3 === 0 ? 'running' : i % 3 === 1 ? 'completed' : 'pending',
          type: 'testing',
          progress: Math.floor(Math.random() * 100)
        })),
        tasks: Array.from({ length: 30 }, (_, i) => ({
          id: `task_${i}`,
          status: 'pending',
          type: 'testing'
        }))
      };

      const startTime = Date.now();
      handleWebSocketMessage(batchMessage);
      const endTime = Date.now();

      expect(agents).toHaveLength(50);
      expect(tasks).toHaveLength(30);
      expect(endTime - startTime).toBeLessThan(100); // Should process quickly
    });

    test('handles concurrent message processing', () => {
      const messages = [
        { type: 'agent_update', agent: { id: 'agent1', status: 'running' } },
        { type: 'task_update', task: { id: 'task1', status: 'completed' } },
        { type: 'log_entry', log: { time: new Date(), level: 'info', message: 'Test' } },
        { type: 'resource_update', resources: { cpu: 50, memory: 60 } }
      ];

      // Process all messages rapidly
      messages.forEach(msg => handleWebSocketMessage(msg));

      expect(agents).toHaveLength(1);
      expect(tasks).toHaveLength(1);
      expect(logs).toHaveLength(1);
      expect(resourceData).toHaveLength(1);
    });
  });

  describe('WebSocket Integration with UI Updates', () => {
    test('updates connection status indicator in DOM', () => {
      initializeWebSocket();
      mockWebSocket.onopen();

      const statusDot = document.getElementById('connectionStatus');
      const statusText = document.getElementById('connectionText');

      expect(statusDot.className).toContain('connected');
      expect(statusText.textContent).toBe('Connected');
    });

    test('updates system resources display from WebSocket data', () => {
      const resourceUpdate = {
        type: 'resource_update',
        resources: {
          cpu: 42,
          memory: 68,
          disk: 25,
          active_processes: 5
        }
      };

      handleWebSocketMessage(resourceUpdate);

      const container = document.getElementById('systemResources');
      expect(container.innerHTML).toContain('Active Processes');
    });

    test('integrates with timeline updates', () => {
      const agentUpdate = {
        type: 'agent_update',
        agent: {
          id: 'timeline_agent',
          status: 'completed',
          task: 'Timeline test task',
          startTime: new Date().toISOString()
        }
      };

      handleWebSocketMessage(agentUpdate);

      const timeline = document.getElementById('timeline');
      expect(timeline.innerHTML).toContain('timeline_agent');
      expect(timeline.innerHTML).toContain('Timeline test task');
    });
  });
});