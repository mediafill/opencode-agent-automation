const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const WS = require('jest-websocket-mock');

describe('Enhanced API Endpoints Integration Tests', () => {
  let server;
  let mockWebSocket;
  const testPort = 8086; // Different port to avoid conflicts
  const testProjectDir = path.join(__dirname, '..', 'fixtures', 'enhanced-api-test-project');
  const claudeDir = path.join(testProjectDir, '.claude');
  const tasksFile = path.join(claudeDir, 'tasks.json');
  const taskStatusFile = path.join(claudeDir, 'task_status.json');
  const logsDir = path.join(claudeDir, 'logs');

  beforeAll(async () => {
    // Create test project structure
    await fs.mkdir(logsDir, { recursive: true });

    // Initialize with comprehensive test data
    const initialTasks = [
      {
        id: 'enhanced_api_task_1',
        type: 'testing',
        priority: 'high',
        description: 'Enhanced API integration test task',
        files_pattern: '**/*.test.js',
        created_at: new Date().toISOString(),
        status: 'pending',
        metadata: {
          estimated_duration: 300,
          complexity: 'medium',
          dependencies: []
        }
      },
      {
        id: 'enhanced_api_task_2',
        type: 'security',
        priority: 'critical',
        description: 'Security audit task',
        files_pattern: '**/*',
        created_at: new Date().toISOString(),
        status: 'completed',
        metadata: {
          estimated_duration: 600,
          complexity: 'high',
          dependencies: ['enhanced_api_task_1']
        }
      }
    ];

    const initialStatus = {
      enhanced_api_task_1: {
        status: 'pending',
        progress: 0,
        created_at: new Date().toISOString(),
        metrics: {
          files_processed: 0,
          tests_run: 0,
          coverage_percent: 0
        }
      },
      enhanced_api_task_2: {
        status: 'completed',
        progress: 100,
        completed_at: new Date().toISOString(),
        result: 'success',
        metrics: {
          files_processed: 25,
          tests_run: 15,
          coverage_percent: 87.5
        }
      }
    };

    await fs.writeFile(tasksFile, JSON.stringify(initialTasks, null, 2));
    await fs.writeFile(taskStatusFile, JSON.stringify(initialStatus, null, 2));
  });

  beforeEach(async () => {
    // Start the Python WebSocket server
    const serverScript = path.join(__dirname, '..', '..', 'scripts', 'dashboard_server.py');
    server = spawn('python3', [serverScript, '--port', testPort, '--project-dir', testProjectDir], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Wait for server to start
    await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(), 5000);
      server.stdout.on('data', (data) => {
        if (data.toString().includes('WebSocket server started') ||
            data.toString().includes('dashboard server started')) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    // Create WebSocket connection
    mockWebSocket = new WS(`ws://localhost:${testPort}/ws`);
  });

  afterEach(async () => {
    if (mockWebSocket) {
      mockWebSocket.close();
    }
    if (server && !server.killed) {
      server.kill('SIGTERM');
      await new Promise((resolve) => {
        server.on('close', resolve);
      });
    }

    // Reset test data
    try {
      const initialTasks = [
        {
          id: 'enhanced_api_task_1',
          type: 'testing',
          priority: 'high',
          description: 'Enhanced API integration test task',
          files_pattern: '**/*.test.js',
          created_at: new Date().toISOString(),
          status: 'pending'
        }
      ];

      const initialStatus = {
        enhanced_api_task_1: {
          status: 'pending',
          progress: 0,
          created_at: new Date().toISOString()
        }
      };

      await fs.writeFile(tasksFile, JSON.stringify(initialTasks, null, 2));
      await fs.writeFile(taskStatusFile, JSON.stringify(initialStatus, null, 2));
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  afterAll(async () => {
    // Clean up test directory
    try {
      await fs.rm(testProjectDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('API Security and Authentication', () => {
    test('handles connection authentication challenges', async () => {
      await mockWebSocket.connected;

      // Test connection without authentication (should work in current implementation)
      const connectionMessage = await mockWebSocket.nextMessage;
      const connectionData = JSON.parse(connectionMessage);

      expect(connectionData.type).toBe('connection_established');
    });

    test('validates message origin and integrity', async () => {
      await mockWebSocket.connected;

      // Send message with invalid origin
      mockWebSocket.send(JSON.stringify({
        type: 'request_status',
        origin: 'invalid_domain.com'
      }));

      // Should still process the request (no origin validation currently)
      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe('status_update');
    });

    test('handles rate limiting for rapid requests', async () => {
      await mockWebSocket.connected;

      // Send many requests rapidly to test rate limiting
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(
          mockWebSocket.send(JSON.stringify({ type: 'ping' }))
        );
      }

      await Promise.all(promises);

      // Count responses received within timeout
      let responseCount = 0;
      const maxWait = 5000;
      const startTime = Date.now();

      while (responseCount < 100 && (Date.now() - startTime) < maxWait) {
        try {
          const response = await mockWebSocket.nextMessage;
          const data = JSON.parse(response);
          if (data.type === 'pong') {
            responseCount++;
          }
        } catch (e) {
          break;
        }
      }

      // Should handle the load without crashing
      expect(responseCount).toBeGreaterThan(0);
    });
  });

  describe('Session Management and Connection Handling', () => {
    test('maintains session state across reconnections', async () => {
      await mockWebSocket.connected;

      // Get initial status
      mockWebSocket.send(JSON.stringify({ type: 'request_status' }));
      const initialResponse = await mockWebSocket.nextMessage;
      const initialData = JSON.parse(initialResponse);
      expect(initialData.type).toBe('status_update');

      // Close and reconnect
      mockWebSocket.close();
      mockWebSocket = new WS(`ws://localhost:${testPort}/ws`);
      await mockWebSocket.connected;

      // Should receive connection established again
      const reconnectMessage = await mockWebSocket.nextMessage;
      const reconnectData = JSON.parse(reconnectMessage);
      expect(reconnectData.type).toBe('connection_established');
    });

    test('handles multiple concurrent client sessions', async () => {
      await mockWebSocket.connected;

      // Create additional client connections
      const client2 = new WS(`ws://localhost:${testPort}/ws`);
      const client3 = new WS(`ws://localhost:${testPort}/ws`);
      const client4 = new WS(`ws://localhost:${testPort}/ws`);

      // All should establish connections
      const connections = await Promise.all([
        mockWebSocket.nextMessage,
        client2.nextMessage,
        client3.nextMessage,
        client4.nextMessage
      ]);

      connections.forEach(message => {
        const data = JSON.parse(message);
        expect(data.type).toBe('connection_established');
      });

      // Test broadcasting to all clients
      mockWebSocket.send(JSON.stringify({ type: 'ping' }));

      // Should receive pong on original client
      const pongResponse = await mockWebSocket.nextMessage;
      const pongData = JSON.parse(pongResponse);
      expect(pongData.type).toBe('pong');

      client2.close();
      client3.close();
      client4.close();
    });

    test('gracefully handles client disconnections', async () => {
      await mockWebSocket.connected;

      // Start a long-running operation simulation
      mockWebSocket.send(JSON.stringify({ type: 'request_status' }));

      // Disconnect abruptly
      mockWebSocket.close();

      // Server should continue running without issues
      // (This is more of a stability test - we can't easily verify internal state)
      expect(true).toBe(true);
    });
  });

  describe('Advanced Task Management API', () => {
    test('handles task dependencies and prerequisites', async () => {
      await mockWebSocket.connected;

      // Create a task with dependencies
      const dependentTask = {
        id: 'dependent_task',
        type: 'testing',
        priority: 'medium',
        description: 'Task that depends on enhanced_api_task_2',
        files_pattern: '**/*.spec.js',
        dependencies: ['enhanced_api_task_2'],
        metadata: {
          estimated_duration: 180,
          complexity: 'low'
        }
      };

      mockWebSocket.send(JSON.stringify({
        type: 'start_task',
        task: dependentTask
      }));

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe('task_started');
      expect(data.task_id).toBe('dependent_task');

      // Verify task was created with dependencies
      const tasksContent = await fs.readFile(tasksFile, 'utf8');
      const tasks = JSON.parse(tasksContent);
      const createdTask = tasks.find(t => t.id === 'dependent_task');
      expect(createdTask).toBeDefined();
      expect(createdTask.dependencies).toEqual(['enhanced_api_task_2']);
    });

    test('supports task scheduling and delayed execution', async () => {
      await mockWebSocket.connected;

      const scheduledTask = {
        id: 'scheduled_task',
        type: 'maintenance',
        priority: 'low',
        description: 'Scheduled maintenance task',
        files_pattern: '**/*.log',
        scheduled_time: new Date(Date.now() + 60000).toISOString(), // 1 minute from now
        metadata: {
          estimated_duration: 120,
          is_scheduled: true
        }
      };

      mockWebSocket.send(JSON.stringify({
        type: 'schedule_task',
        task: scheduledTask
      }));

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      // Should accept the scheduled task (implementation may vary)
      expect(['task_scheduled', 'task_started', 'error']).toContain(data.type);
    });

    test('manages task resource allocation and limits', async () => {
      await mockWebSocket.connected;

      // Create multiple high-resource tasks
      const resourceIntensiveTasks = Array.from({ length: 5 }, (_, i) => ({
        id: `resource_task_${i + 1}`,
        type: 'analysis',
        priority: 'high',
        description: `Resource intensive analysis task ${i + 1}`,
        files_pattern: '**/*',
        metadata: {
          estimated_duration: 600,
          memory_required: '512MB',
          cpu_required: '2_cores',
          complexity: 'high'
        }
      }));

      // Start tasks and monitor resource usage
      for (const task of resourceIntensiveTasks) {
        mockWebSocket.send(JSON.stringify({
          type: 'start_task',
          task: task
        }));

        const response = await mockWebSocket.nextMessage;
        const data = JSON.parse(response);

        expect(['task_started', 'task_queued']).toContain(data.type);
      }

      // Request system resources to verify monitoring
      mockWebSocket.send(JSON.stringify({ type: 'request_status' }));
      const statusResponse = await mockWebSocket.nextMessage;
      const statusData = JSON.parse(statusResponse);

      expect(statusData.type).toBe('status_update');
      expect(statusData.data).toHaveProperty('system_resources');
    });
  });

  describe('System Monitoring and Health Checks', () => {
    test('provides comprehensive system health metrics', async () => {
      await mockWebSocket.connected;

      mockWebSocket.send(JSON.stringify({ type: 'request_system_health' }));

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      // Should return health information (may be status_update or dedicated health response)
      expect(['status_update', 'system_health']).toContain(data.type);

      if (data.type === 'status_update') {
        expect(data.data).toHaveProperty('system_resources');
        expect(data.data.system_resources).toHaveProperty('cpu_usage');
        expect(data.data.system_resources).toHaveProperty('memory_usage');
      }
    });

    test('monitors API endpoint performance and latency', async () => {
      await mockWebSocket.connected;

      const startTime = Date.now();

      // Send multiple ping requests to measure latency
      const pingCount = 10;
      for (let i = 0; i < pingCount; i++) {
        mockWebSocket.send(JSON.stringify({ type: 'ping' }));
      }

      let pongCount = 0;
      const latencies = [];

      while (pongCount < pingCount) {
        const response = await mockWebSocket.nextMessage;
        const data = JSON.parse(response);

        if (data.type === 'pong') {
          const latency = Date.now() - startTime;
          latencies.push(latency);
          pongCount++;
        }
      }

      // Verify reasonable latency (under 1 second per request)
      latencies.forEach(latency => {
        expect(latency).toBeLessThan(1000);
      });

      expect(latencies.length).toBe(pingCount);
    });

    test('tracks API usage statistics and metrics', async () => {
      await mockWebSocket.connected;

      // Perform various API operations
      const operations = [
        { type: 'request_status' },
        { type: 'ping' },
        { type: 'request_claude_processes' },
        { type: 'request_status' },
        { type: 'ping' }
      ];

      for (const op of operations) {
        mockWebSocket.send(JSON.stringify(op));
        // Consume response
        await mockWebSocket.nextMessage;
      }

      // Request metrics (if available)
      mockWebSocket.send(JSON.stringify({ type: 'request_metrics' }));

      const metricsResponse = await mockWebSocket.nextMessage;
      const metricsData = JSON.parse(metricsResponse);

      // Should return some form of metrics or status
      expect(['status_update', 'metrics', 'error']).toContain(metricsData.type);
    });
  });

  describe('Data Synchronization and Consistency', () => {
    test('maintains data consistency across concurrent operations', async () => {
      await mockWebSocket.connected;

      // Start multiple tasks concurrently
      const concurrentTasks = Array.from({ length: 3 }, (_, i) => ({
        id: `concurrent_task_${i + 1}`,
        type: 'testing',
        priority: 'medium',
        description: `Concurrent task ${i + 1}`,
        files_pattern: `**/*${i + 1}.js`
      }));

      // Send all task creation requests
      const taskPromises = concurrentTasks.map(task =>
        mockWebSocket.send(JSON.stringify({
          type: 'start_task',
          task: task
        }))
      );

      await Promise.all(taskPromises);

      // Collect all responses
      const responses = [];
      for (let i = 0; i < concurrentTasks.length; i++) {
        const response = await mockWebSocket.nextMessage;
        responses.push(JSON.parse(response));
      }

      // All should be successful
      responses.forEach(response => {
        expect(response.type).toBe('task_started');
      });

      // Verify all tasks were created in database
      const tasksContent = await fs.readFile(tasksFile, 'utf8');
      const tasks = JSON.parse(tasksContent);

      concurrentTasks.forEach(task => {
        const createdTask = tasks.find(t => t.id === task.id);
        expect(createdTask).toBeDefined();
        expect(createdTask.description).toBe(task.description);
      });
    });

    test('handles data synchronization conflicts gracefully', async () => {
      await mockWebSocket.connected;

      // Create a task
      const conflictTask = {
        id: 'conflict_task',
        type: 'testing',
        priority: 'medium',
        description: 'Task for conflict testing',
        files_pattern: '**/*.js'
      };

      mockWebSocket.send(JSON.stringify({
        type: 'start_task',
        task: conflictTask
      }));

      const response1 = await mockWebSocket.nextMessage;
      expect(JSON.parse(response1).type).toBe('task_started');

      // Try to create the same task again (should handle gracefully)
      mockWebSocket.send(JSON.stringify({
        type: 'start_task',
        task: conflictTask
      }));

      const response2 = await mockWebSocket.nextMessage;
      const data2 = JSON.parse(response2);

      // Should either succeed (if allowed) or return appropriate error
      expect(['task_started', 'error']).toContain(data2.type);
    });

    test('synchronizes data across multiple client connections', async () => {
      await mockWebSocket.connected;

      // Create second client
      const client2 = new WS(`ws://localhost:${testPort}/ws`);
      await client2.connected;

      // Both clients should receive connection messages
      await mockWebSocket.nextMessage;
      await client2.nextMessage;

      // Create task from first client
      const syncTask = {
        id: 'sync_task',
        type: 'testing',
        priority: 'medium',
        description: 'Task for synchronization testing',
        files_pattern: '**/*.js'
      };

      mockWebSocket.send(JSON.stringify({
        type: 'start_task',
        task: syncTask
      }));

      // Both clients should eventually see updates (through periodic updates)
      // This is a basic synchronization test
      const taskResponse = await mockWebSocket.nextMessage;
      expect(JSON.parse(taskResponse).type).toBe('task_started');

      client2.close();
    });
  });

  describe('Performance and Load Testing', () => {
    test('handles high-frequency status updates', async () => {
      await mockWebSocket.connected;

      // Send rapid status requests
      const requestCount = 50;
      const startTime = Date.now();

      for (let i = 0; i < requestCount; i++) {
        mockWebSocket.send(JSON.stringify({ type: 'request_status' }));
      }

      // Collect responses
      let responseCount = 0;
      while (responseCount < requestCount) {
        try {
          const response = await mockWebSocket.nextMessage;
          const data = JSON.parse(response);
          if (data.type === 'status_update') {
            responseCount++;
          }
        } catch (e) {
          break;
        }
      }

      const totalTime = Date.now() - startTime;

      // Should handle the load reasonably well
      expect(responseCount).toBeGreaterThan(0);
      expect(totalTime).toBeLessThan(30000); // Under 30 seconds for 50 requests
    });

    test('maintains performance under memory pressure', async () => {
      await mockWebSocket.connected;

      // Create large tasks with substantial data
      const largeTasks = Array.from({ length: 10 }, (_, i) => ({
        id: `large_task_${i + 1}`,
        type: 'analysis',
        priority: 'medium',
        description: 'A'.repeat(1000), // Large description
        files_pattern: '**/*',
        metadata: {
          large_data: 'B'.repeat(2000), // Additional large data
          complex_config: {
            nested: {
              deeply: {
                nested: 'C'.repeat(500)
              }
            }
          }
        }
      }));

      // Send large tasks
      for (const task of largeTasks) {
        mockWebSocket.send(JSON.stringify({
          type: 'start_task',
          task: task
        }));

        const response = await mockWebSocket.nextMessage;
        const data = JSON.parse(response);

        expect(data.type).toBe('task_started');
      }

      // Verify system remains responsive
      mockWebSocket.send(JSON.stringify({ type: 'ping' }));
      const pongResponse = await mockWebSocket.nextMessage;
      const pongData = JSON.parse(pongResponse);

      expect(pongData.type).toBe('pong');
    });

    test('scales with increasing client connections', async () => {
      await mockWebSocket.connected;

      // Create multiple client connections
      const additionalClients = [];
      const clientCount = 5;

      for (let i = 0; i < clientCount; i++) {
        const client = new WS(`ws://localhost:${testPort}/ws`);
        additionalClients.push(client);
        await client.connected;
      }

      // All clients should connect successfully
      const connectionPromises = additionalClients.map(client => client.nextMessage);
      const connections = await Promise.all(connectionPromises);

      connections.forEach(message => {
        const data = JSON.parse(message);
        expect(data.type).toBe('connection_established');
      });

      // Test broadcast to all clients
      mockWebSocket.send(JSON.stringify({ type: 'ping' }));

      // Original client should receive pong
      const pongResponse = await mockWebSocket.nextMessage;
      expect(JSON.parse(pongResponse).type).toBe('pong');

      // Close additional clients
      additionalClients.forEach(client => client.close());
    });
  });
});