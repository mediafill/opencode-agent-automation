const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const WS = require('jest-websocket-mock');

describe('WebSocket Server Integration Tests', () => {
  let server;
  let mockWebSocket;
  const testPort = 8081;
  const testProjectDir = path.join(__dirname, '..', 'fixtures', 'test-project');
  const claudeDir = path.join(testProjectDir, '.claude');
  const tasksFile = path.join(claudeDir, 'tasks.json');
  const taskStatusFile = path.join(claudeDir, 'task_status.json');

  beforeAll(async () => {
    // Create test project structure
    await fs.promises.mkdir(claudeDir, { recursive: true });
    await fs.promises.mkdir(path.join(claudeDir, 'logs'), { recursive: true });

    // Initialize test files
    await fs.promises.writeFile(tasksFile, JSON.stringify([]));
    await fs.promises.writeFile(taskStatusFile, JSON.stringify({}));
  });

  beforeEach(async () => {
    // Start the Python WebSocket server for integration tests
    const serverScript = path.join(__dirname, '..', '..', 'scripts', 'dashboard_server.py');
    server = spawn('python3', [serverScript, '--port', testPort, '--project-dir', testProjectDir], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Wait for server to start
    await new Promise((resolve) => {
      server.stdout.on('data', (data) => {
        if (data.toString().includes('WebSocket server started')) {
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
      // Wait for graceful shutdown
      await new Promise((resolve) => {
        server.on('close', resolve);
      });
    }

    // Clean up test files
    try {
      await fs.promises.writeFile(tasksFile, JSON.stringify([]));
      await fs.promises.writeFile(taskStatusFile, JSON.stringify({}));
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  afterAll(async () => {
    // Clean up test directory
    try {
      await fs.promises.rm(testProjectDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('WebSocket Connection Management', () => {
    test('establishes WebSocket connection successfully', async () => {
      await expect(mockWebSocket).toReceiveMessage(
        expect.objectContaining({
          type: 'connection_established'
        })
      );
    });

    test('handles multiple concurrent connections', async () => {
      const client2 = new WS(`ws://localhost:${testPort}/ws`);
      const client3 = new WS(`ws://localhost:${testPort}/ws`);

      await Promise.all([
        expect(mockWebSocket).toReceiveMessage(expect.objectContaining({ type: 'connection_established' })),
        expect(client2).toReceiveMessage(expect.objectContaining({ type: 'connection_established' })),
        expect(client3).toReceiveMessage(expect.objectContaining({ type: 'connection_established' }))
      ]);

      client2.close();
      client3.close();
    });

    test('handles connection drops gracefully', async () => {
      await mockWebSocket.connected;

      mockWebSocket.close();

      // Server should handle the disconnection without crashing
      // Reconnect should work
      const newClient = new WS(`ws://localhost:${testPort}/ws`);
      await expect(newClient).toReceiveMessage(
        expect.objectContaining({ type: 'connection_established' })
      );
      newClient.close();
    });
  });

  describe('System Status API Integration', () => {
    test('request_status returns complete system information', async () => {
      await mockWebSocket.connected;

      mockWebSocket.send(JSON.stringify({ type: 'request_status' }));

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data).toMatchObject({
        type: 'status_update',
        data: expect.objectContaining({
          agents: expect.any(Array),
          tasks: expect.any(Object),
          system_resources: expect.objectContaining({
            cpu_percent: expect.any(Number),
            memory_percent: expect.any(Number),
            disk_usage: expect.any(Number)
          }),
          timestamp: expect.any(String)
        })
      });
    });

    test('request_claude_processes returns process information', async () => {
      await mockWebSocket.connected;

      mockWebSocket.send(JSON.stringify({ type: 'request_claude_processes' }));

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data).toMatchObject({
        type: 'claude_processes_update',
        data: expect.objectContaining({
          processes: expect.any(Array),
          total_processes: expect.any(Number),
          timestamp: expect.any(String)
        })
      });
    });

    test('request_agent_details returns detailed agent information', async () => {
      await mockWebSocket.connected;

      mockWebSocket.send(JSON.stringify({
        type: 'request_agent_details',
        agent_id: 'test_agent_1'
      }));

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe('agent_details_update');
      expect(data.data).toHaveProperty('agent_id');
      expect(data.data).toHaveProperty('details');
    });

    test('ping returns pong for health checks', async () => {
      await mockWebSocket.connected;

      mockWebSocket.send(JSON.stringify({ type: 'ping' }));

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data).toMatchObject({
        type: 'pong',
        timestamp: expect.any(String)
      });
    });
  });

  describe('Task Management API Integration', () => {
    test('start_task creates and executes new tasks', async () => {
      await mockWebSocket.connected;

      const taskData = {
        type: 'start_task',
        task: {
          id: 'integration_test_task',
          type: 'testing',
          priority: 'medium',
          description: 'Integration test task',
          files_pattern: '**/*.test.js'
        }
      };

      mockWebSocket.send(JSON.stringify(taskData));

      // Should receive task started confirmation
      const startResponse = await mockWebSocket.nextMessage;
      const startData = JSON.parse(startResponse);

      expect(startData).toMatchObject({
        type: 'task_started',
        task_id: 'integration_test_task'
      });

      // Should eventually receive task status updates
      let statusUpdates = 0;
      const maxWait = 5000;
      const startTime = Date.now();

      while (statusUpdates < 3 && (Date.now() - startTime) < maxWait) {
        try {
          const statusResponse = await mockWebSocket.nextMessage;
          const statusData = JSON.parse(statusResponse);

          if (statusData.type === 'task_status_update') {
            statusUpdates++;
            expect(statusData.data).toHaveProperty('task_id', 'integration_test_task');
            expect(statusData.data).toHaveProperty('status');
            expect(statusData.data).toHaveProperty('progress');
          }
        } catch (e) {
          break;
        }
      }

      expect(statusUpdates).toBeGreaterThan(0);
    });

    test('handles invalid task data gracefully', async () => {
      await mockWebSocket.connected;

      const invalidTaskData = {
        type: 'start_task',
        task: {
          // Missing required fields
        }
      };

      mockWebSocket.send(JSON.stringify(invalidTaskData));

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe('error');
      expect(data.message).toContain('Invalid task data');
    });
  });

  describe('Process Management API Integration', () => {
    test('kill_process handles process termination requests', async () => {
      await mockWebSocket.connected;

      // First get list of processes to find a safe one to test with
      mockWebSocket.send(JSON.stringify({ type: 'request_claude_processes' }));

      const processResponse = await mockWebSocket.nextMessage;
      const processData = JSON.parse(processResponse);

      if (processData.data.processes.length > 0) {
        const testPid = processData.data.processes[0].pid;

        mockWebSocket.send(JSON.stringify({
          type: 'kill_process',
          pid: testPid,
          signal: 'SIGTERM'
        }));

        const response = await mockWebSocket.nextMessage;
        const data = JSON.parse(response);

        expect(data.type).toBe('process_killed');
        expect(data.data).toHaveProperty('pid', testPid);
        expect(data.data).toHaveProperty('success');
      }
    });

    test('handles invalid process kill requests', async () => {
      await mockWebSocket.connected;

      mockWebSocket.send(JSON.stringify({
        type: 'kill_process',
        pid: 999999999, // Non-existent PID
        signal: 'SIGTERM'
      }));

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe('error');
      expect(data.message).toContain('process');
    });
  });

  describe('Real-time Updates Integration', () => {
    test('receives periodic system resource updates', async () => {
      await mockWebSocket.connected;

      let resourceUpdates = 0;
      const maxWait = 10000; // 10 seconds
      const startTime = Date.now();

      while (resourceUpdates < 3 && (Date.now() - startTime) < maxWait) {
        try {
          const message = await mockWebSocket.nextMessage;
          const data = JSON.parse(message);

          if (data.type === 'system_resources_update') {
            resourceUpdates++;
            expect(data.data).toHaveProperty('cpu_percent');
            expect(data.data).toHaveProperty('memory_percent');
            expect(data.data).toHaveProperty('disk_usage');
            expect(data.data).toHaveProperty('timestamp');
          }
        } catch (e) {
          break;
        }
      }

      expect(resourceUpdates).toBeGreaterThan(0);
    }, 15000);

    test('receives log file updates when logs change', async () => {
      await mockWebSocket.connected;

      // Create a test log file
      const testLogFile = path.join(claudeDir, 'logs', 'test.log');
      await fs.promises.writeFile(testLogFile, '');

      // Wait a moment for file watcher to register
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Append to log file
      await fs.promises.appendFile(testLogFile, 'Test log entry\n');

      // Should receive log update
      let logUpdateReceived = false;
      const maxWait = 5000;
      const startTime = Date.now();

      while (!logUpdateReceived && (Date.now() - startTime) < maxWait) {
        try {
          const message = await mockWebSocket.nextMessage;
          const data = JSON.parse(message);

          if (data.type === 'log_entry' && data.data.message.includes('Test log entry')) {
            logUpdateReceived = true;
          }
        } catch (e) {
          break;
        }
      }

      expect(logUpdateReceived).toBe(true);

      // Clean up
      await fs.promises.unlink(testLogFile);
    }, 10000);
  });

  describe('Error Handling and Edge Cases', () => {
    test('handles malformed JSON messages', async () => {
      await mockWebSocket.connected;

      mockWebSocket.send('invalid json');

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe('error');
      expect(data.message).toContain('Invalid JSON');
    });

    test('handles unknown message types', async () => {
      await mockWebSocket.connected;

      mockWebSocket.send(JSON.stringify({ type: 'unknown_message_type' }));

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe('error');
      expect(data.message).toContain('Unknown message type');
    });

    test('handles server overload gracefully', async () => {
      await mockWebSocket.connected;

      // Send many requests rapidly
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(
          mockWebSocket.send(JSON.stringify({ type: 'ping' }))
        );
      }

      await Promise.all(promises);

      // Server should still respond (may be slower but shouldn't crash)
      mockWebSocket.send(JSON.stringify({ type: 'request_status' }));

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe('status_update');
    }, 15000);
  });
});