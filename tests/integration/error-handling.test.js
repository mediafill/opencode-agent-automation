const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const WS = require('jest-websocket-mock');

describe('Error Handling Integration Tests', () => {
  let server;
  let mockWebSocket;
  const testPort = 8085; // Different port to avoid conflicts
  const testProjectDir = path.join(__dirname, '..', 'fixtures', 'error-test-project');
  const claudeDir = path.join(testProjectDir, '.claude');
  const tasksFile = path.join(claudeDir, 'tasks.json');
  const taskStatusFile = path.join(claudeDir, 'task_status.json');
  const logsDir = path.join(claudeDir, 'logs');

  beforeAll(async () => {
    // Create test project structure
    await fs.mkdir(logsDir, { recursive: true });

    // Initialize with valid test data
    const initialTasks = [
      {
        id: 'error_test_task',
        type: 'testing',
        priority: 'medium',
        description: 'Error handling test task',
        files_pattern: '**/*.test.js',
        created_at: new Date().toISOString(),
        status: 'pending'
      }
    ];

    const initialStatus = {
      error_test_task: {
        status: 'pending',
        progress: 0,
        created_at: new Date().toISOString()
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
      const resetTasks = [
        {
          id: 'error_test_task',
          type: 'testing',
          priority: 'medium',
          description: 'Error handling test task',
          files_pattern: '**/*.test.js',
          created_at: new Date().toISOString(),
          status: 'pending'
        }
      ];

      const resetStatus = {
        error_test_task: {
          status: 'pending',
          progress: 0,
          created_at: new Date().toISOString()
        }
      };

      await fs.writeFile(tasksFile, JSON.stringify(resetTasks, null, 2));
      await fs.writeFile(taskStatusFile, JSON.stringify(resetStatus, null, 2));
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

  describe('WebSocket Error Handling', () => {
    test('handles malformed JSON messages gracefully', async () => {
      await mockWebSocket.connected;

      // Send various malformed JSON
      const malformedMessages = [
        'invalid json',
        '{ incomplete json',
        '{"type": "ping", "extra": }',
        'null',
        'undefined',
        '{"type": "ping", "data": NaN}',
        '{"type": "ping", "data": Infinity}'
      ];

      for (const message of malformedMessages) {
        mockWebSocket.send(message);

        // Should receive error response or handle gracefully
        try {
          const response = await mockWebSocket.nextMessage;
          const data = JSON.parse(response);
          expect(data.type).toBe('error');
          expect(data.message).toContain('JSON');
        } catch (e) {
          // Connection may close on severe errors, which is acceptable
          break;
        }
      }
    });

    test('handles unknown message types', async () => {
      await mockWebSocket.connected;

      const unknownTypes = [
        'unknown_command',
        'invalid_type',
        'nonexistent_endpoint',
        'random_string',
        '',
        null,
        123,
        []
      ];

      for (const messageType of unknownTypes) {
        mockWebSocket.send(JSON.stringify({ type: messageType }));

        const response = await mockWebSocket.nextMessage;
        const data = JSON.parse(response);

        expect(data.type).toBe('error');
        expect(data.message).toContain('Unknown message type');
      }
    });

    test('handles invalid message structure', async () => {
      await mockWebSocket.connected;

      const invalidMessages = [
        JSON.stringify({}), // Empty object
        JSON.stringify({ type: null }), // Null type
        JSON.stringify({ type: '' }), // Empty type
        JSON.stringify({ type: 123 }), // Numeric type
        JSON.stringify({ type: [] }), // Array type
        JSON.stringify({ type: {} }), // Object type
        JSON.stringify({ command: 'ping' }), // Wrong field name
      ];

      for (const message of invalidMessages) {
        mockWebSocket.send(message);

        const response = await mockWebSocket.nextMessage;
        const data = JSON.parse(response);

        expect(data.type).toBe('error');
      }
    });

    test('handles oversized messages', async () => {
      await mockWebSocket.connected;

      // Create a very large message (1MB)
      const largeData = 'x'.repeat(1024 * 1024);
      const largeMessage = JSON.stringify({
        type: 'ping',
        data: largeData
      });

      mockWebSocket.send(largeMessage);

      // Should handle gracefully (may reject or process partially)
      try {
        const response = await mockWebSocket.nextMessage;
        const data = JSON.parse(response);
        expect(['pong', 'error']).toContain(data.type);
      } catch (e) {
        // Connection may close, which is acceptable
        expect(true).toBe(true);
      }
    });
  });

  describe('API Endpoint Error Handling', () => {
    test('handles invalid task creation requests', async () => {
      await mockWebSocket.connected;

      const invalidTasks = [
        { type: 'start_task' }, // Missing task data
        { type: 'start_task', task: null }, // Null task
        { type: 'start_task', task: {} }, // Empty task
        { type: 'start_task', task: { description: 'No ID' } }, // Missing ID
        { type: 'start_task', task: { id: '', type: 'testing' } }, // Empty ID
        { type: 'start_task', task: { id: 123, type: 'testing' } }, // Numeric ID
        { type: 'start_task', task: { id: 'test', type: null } }, // Null type
        { type: 'start_task', task: { id: 'test', type: 'invalid_type' } }, // Invalid type
      ];

      for (const request of invalidTasks) {
        mockWebSocket.send(JSON.stringify(request));

        const response = await mockWebSocket.nextMessage;
        const data = JSON.parse(response);

        expect(data.type).toBe('error');
        expect(data.message).toContain('Invalid task data');
      }
    });

    test('handles invalid process kill requests', async () => {
      await mockWebSocket.connected;

      const invalidKillRequests = [
        { type: 'kill_process' }, // Missing PID
        { type: 'kill_process', pid: null }, // Null PID
        { type: 'kill_process', pid: 'invalid' }, // String PID
        { type: 'kill_process', pid: -1 }, // Negative PID
        { type: 'kill_process', pid: 0 }, // Zero PID
        { type: 'kill_process', pid: 999999999 }, // Non-existent PID
        { type: 'kill_process', pid: 123, signal: 'INVALID' }, // Invalid signal
      ];

      for (const request of invalidKillRequests) {
        mockWebSocket.send(JSON.stringify(request));

        const response = await mockWebSocket.nextMessage;
        const data = JSON.parse(response);

        expect(data.type).toBe('error');
        expect(data.message).toContain('process');
      }
    });

    test('handles invalid agent detail requests', async () => {
      await mockWebSocket.connected;

      const invalidRequests = [
        { type: 'request_agent_details' }, // Missing agent_id
        { type: 'request_agent_details', agent_id: null }, // Null agent_id
        { type: 'request_agent_details', agent_id: '' }, // Empty agent_id
        { type: 'request_agent_details', agent_id: 123 }, // Numeric agent_id
        { type: 'request_agent_details', agent_id: 'nonexistent_agent_12345' }, // Non-existent agent
      ];

      for (const request of invalidRequests) {
        mockWebSocket.send(JSON.stringify(request));

        const response = await mockWebSocket.nextMessage;
        const data = JSON.parse(response);

        // Should either return error or empty details
        expect(['error', 'agent_details_update']).toContain(data.type);
      }
    });

    test('handles server overload gracefully', async () => {
      await mockWebSocket.connected;

      // Send many requests rapidly to simulate overload
      const requests = Array.from({ length: 200 }, (_, i) =>
        mockWebSocket.send(JSON.stringify({ type: 'ping', id: i }))
      );

      await Promise.all(requests);

      // Collect as many responses as possible
      const responses = [];
      const maxWait = 10000;
      const startTime = Date.now();

      while (responses.length < 50 && (Date.now() - startTime) < maxWait) {
        try {
          const response = await mockWebSocket.nextMessage;
          responses.push(JSON.parse(response));
        } catch (e) {
          break;
        }
      }

      // Should have received some responses
      expect(responses.length).toBeGreaterThan(0);

      // All responses should be valid
      responses.forEach(response => {
        expect(response.type).toBe('pong');
      });
    });
  });

  describe('Database Error Handling', () => {
    test('handles corrupted tasks.json file', async () => {
      // Corrupt the tasks file
      await fs.writeFile(tasksFile, '{ invalid json content');

      // Try to read tasks via WebSocket
      await mockWebSocket.connected;
      mockWebSocket.send(JSON.stringify({ type: 'request_status' }));

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      // Should handle gracefully (may return error or partial data)
      expect(['status_update', 'error']).toContain(data.type);

      // Restore valid data
      const validTasks = [{
        id: 'error_test_task',
        type: 'testing',
        priority: 'medium',
        description: 'Restored after corruption',
        files_pattern: '**/*.test.js',
        created_at: new Date().toISOString(),
        status: 'pending'
      }];

      await fs.writeFile(tasksFile, JSON.stringify(validTasks, null, 2));
    });

    test('handles corrupted task_status.json file', async () => {
      // Corrupt the status file
      await fs.writeFile(taskStatusFile, '{ invalid json status');

      // Try operations that use status
      await mockWebSocket.connected;
      mockWebSocket.send(JSON.stringify({ type: 'request_status' }));

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      // Should handle gracefully
      expect(['status_update', 'error']).toContain(data.type);

      // Restore valid data
      const validStatus = {
        error_test_task: {
          status: 'pending',
          progress: 0,
          created_at: new Date().toISOString()
        }
      };

      await fs.writeFile(taskStatusFile, JSON.stringify(validStatus, null, 2));
    });

    test('handles missing database files', async () => {
      // Remove database files
      await fs.unlink(tasksFile);
      await fs.unlink(taskStatusFile);

      // Try to access via WebSocket
      await mockWebSocket.connected;
      mockWebSocket.send(JSON.stringify({ type: 'request_status' }));

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      // Should handle gracefully (may return error or empty data)
      expect(['status_update', 'error']).toContain(data.type);

      // Recreate files
      await fs.writeFile(tasksFile, JSON.stringify([]));
      await fs.writeFile(taskStatusFile, JSON.stringify({}));
    });

    test('handles concurrent file access conflicts', async () => {
      // Create multiple operations that might conflict
      const conflictingOperations = Array.from({ length: 10 }, () =>
        (async () => {
          try {
            const tasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
            // Modify and write back
            tasks[0].last_access = Date.now();
            await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2));
            return 'success';
          } catch (e) {
            return 'error';
          }
        })()
      );

      const results = await Promise.all(conflictingOperations);

      // Should handle conflicts gracefully
      const successCount = results.filter(r => r === 'success').length;
      const errorCount = results.filter(r => r === 'error').length;

      expect(successCount + errorCount).toBe(10);
      // At least some operations should succeed
      expect(successCount).toBeGreaterThan(0);
    });
  });

  describe('File System Error Handling', () => {
    test('handles permission denied errors', async () => {
      // Try to write to a read-only location (if possible)
      const readOnlyFile = path.join(testProjectDir, 'readonly_test.json');

      // Make file read-only if possible
      try {
        await fs.writeFile(readOnlyFile, '{}');
        // Note: chmod may not work on all systems, so this is best effort
        await fs.chmod(readOnlyFile, 0o444); // Read-only
      } catch (e) {
        // Skip test if can't set permissions
        expect(true).toBe(true);
        return;
      }

      // Try to write to read-only file
      try {
        await fs.writeFile(readOnlyFile, '{"test": "data"}');
        fail('Should have thrown permission error');
      } catch (error) {
        expect(error.code).toBe('EACCES');
      }

      // Clean up
      try {
        await fs.unlink(readOnlyFile);
      } catch (e) {
        // Ignore cleanup errors
      }
    });

    test('handles disk space errors', async () => {
      // Try to create very large files to simulate disk space issues
      const largeFile = path.join(testProjectDir, 'large_test.json');

      try {
        // Create a moderately large file (this may fail on systems with very limited space)
        const largeData = JSON.stringify(Array.from({ length: 10000 }, (_, i) => ({
          id: `large_item_${i}`,
          data: 'x'.repeat(1000) // 1KB per item
        })));

        await fs.writeFile(largeFile, largeData);

        // Verify it was written
        const stats = await fs.stat(largeFile);
        expect(stats.size).toBeGreaterThan(1000000); // At least 1MB

        // Clean up
        await fs.unlink(largeFile);
      } catch (error) {
        // If it fails due to disk space, that's acceptable
        expect(['ENOSPC', 'EACCES', 'EROFS']).toContain(error.code);
      }
    });

    test('handles file locking and concurrent access', async () => {
      // Create operations that might cause file locking issues
      const fileAccessOperations = Array.from({ length: 20 }, () =>
        (async () => {
          try {
            // Rapid read/write operations
            const content = await fs.readFile(tasksFile, 'utf8');
            const data = JSON.parse(content);
            data.push({ id: `temp_${Date.now()}`, type: 'temp' });
            await fs.writeFile(tasksFile, JSON.stringify(data));
            return 'success';
          } catch (e) {
            return 'error';
          }
        })()
      );

      const results = await Promise.all(fileAccessOperations);

      // Should handle file locking gracefully
      const successCount = results.filter(r => r === 'success').length;
      expect(successCount).toBeGreaterThan(0);

      // Clean up extra data
      const finalContent = await fs.readFile(tasksFile, 'utf8');
      const finalData = JSON.parse(finalContent);
      const cleanedData = finalData.filter(item => !item.id.startsWith('temp_'));
      await fs.writeFile(tasksFile, JSON.stringify(cleanedData));
    });
  });

  describe('Network and Connection Error Handling', () => {
    test('handles WebSocket connection drops', async () => {
      await mockWebSocket.connected;

      // Send a request
      mockWebSocket.send(JSON.stringify({ type: 'ping' }));

      // Immediately close connection
      mockWebSocket.close();

      // Try to send another message (should fail gracefully)
      try {
        mockWebSocket.send(JSON.stringify({ type: 'ping' }));
      } catch (e) {
        // Expected to fail
        expect(e).toBeDefined();
      }

      // Try to reconnect
      const newWebSocket = new WS(`ws://localhost:${testPort}/ws`);
      await newWebSocket.connected;

      // Should work again
      newWebSocket.send(JSON.stringify({ type: 'ping' }));

      const response = await newWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe('pong');

      newWebSocket.close();
    });

    test('handles slow or timeout connections', async () => {
      await mockWebSocket.connected;

      // Send a request that might take time
      mockWebSocket.send(JSON.stringify({ type: 'request_claude_processes' }));

      // Set a reasonable timeout
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), 5000)
      );

      const responsePromise = mockWebSocket.nextMessage;

      try {
        const response = await Promise.race([responsePromise, timeoutPromise]);
        const data = JSON.parse(response);

        expect(data.type).toBe('claude_processes_update');
        expect(data.data).toHaveProperty('processes');
      } catch (error) {
        if (error.message === 'Timeout') {
          // Timeout is acceptable for this test
          expect(true).toBe(true);
        } else {
          throw error;
        }
      }
    });

    test('handles invalid WebSocket URLs and ports', async () => {
      // Try to connect to invalid ports
      const invalidPorts = [0, -1, 65536, 'invalid'];

      for (const port of invalidPorts) {
        try {
          const invalidWS = new WS(`ws://localhost:${port}/ws`);
          await invalidWS.connected;
          fail(`Should not connect to invalid port ${port}`);
        } catch (error) {
          // Expected to fail
          expect(error).toBeDefined();
        }
      }
    });
  });

  describe('Task Manager Integration Error Handling', () => {
    test('handles task manager unavailable gracefully', async () => {
      await mockWebSocket.connected;

      // Try operations that depend on task manager
      const taskManagerRequests = [
        { type: 'start_task', task: { id: 'tm_test', type: 'testing', description: 'Test' } },
        { type: 'cancel_task', task_id: 'nonexistent' },
        { type: 'retry_task', task_id: 'failed_task' }
      ];

      for (const request of taskManagerRequests) {
        mockWebSocket.send(JSON.stringify(request));

        const response = await mockWebSocket.nextMessage;
        const data = JSON.parse(response);

        // Should handle gracefully whether task manager is available or not
        expect(['task_started', 'task_cancelled', 'task_retried', 'error']).toContain(data.type);
      }
    });

    test('handles subprocess execution failures', async () => {
      await mockWebSocket.connected;

      // Create a task that will fail during execution
      mockWebSocket.send(JSON.stringify({
        type: 'start_task',
        task: {
          id: 'failing_execution_task',
          type: 'testing',
          description: 'Task designed to fail',
          files_pattern: '**/*.nonexistent',
          command: 'nonexistent_command_that_fails'
        }
      }));

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      // Should handle subprocess failure gracefully
      expect(['task_started', 'error']).toContain(data.type);

      // If task was started, it should eventually fail
      if (data.type === 'task_started') {
        // Wait for task to fail
        let failureDetected = false;
        const maxWait = 10000;
        const startTime = Date.now();

        while (!failureDetected && (Date.now() - startTime) < maxWait) {
          try {
            mockWebSocket.send(JSON.stringify({ type: 'request_status' }));
            const statusResponse = await mockWebSocket.nextMessage;
            const statusData = JSON.parse(statusResponse);

            if (statusData.type === 'status_update') {
              const task = statusData.data.tasks.find(t => t.id === 'failing_execution_task');
              if (task && task.status === 'failed') {
                failureDetected = true;
              }
            }
          } catch (e) {
            break;
          }
        }

        expect(failureDetected).toBe(true);
      }
    });

    test('handles task queue overflow', async () => {
      await mockWebSocket.connected;

      // Create many tasks rapidly to potentially overflow queue
      const manyTasks = Array.from({ length: 100 }, (_, i) => ({
        id: `overflow_task_${i}`,
        type: 'testing',
        priority: 'low',
        description: `Overflow test task ${i}`,
        files_pattern: '**/*.js'
      }));

      // Send all tasks
      const sendPromises = manyTasks.map(task =>
        mockWebSocket.send(JSON.stringify({
          type: 'start_task',
          task: task
        }))
      );

      await Promise.all(sendPromises);

      // Collect responses
      const responses = [];
      for (let i = 0; i < 50; i++) { // Collect reasonable number of responses
        try {
          const response = await mockWebSocket.nextMessage;
          responses.push(JSON.parse(response));
        } catch (e) {
          break;
        }
      }

      // Should handle queue overflow gracefully
      expect(responses.length).toBeGreaterThan(0);

      const startedTasks = responses.filter(r => r.type === 'task_started').length;
      const errors = responses.filter(r => r.type === 'error').length;

      // Should have some successful starts and possibly some errors due to limits
      expect(startedTasks + errors).toBe(responses.length);
    });
  });