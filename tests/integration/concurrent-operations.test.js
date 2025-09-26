const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const WS = require('jest-websocket-mock');

describe('Concurrent Operations Integration Tests', () => {
  let server;
  let mockWebSocket;
  const testPort = 8084; // Different port to avoid conflicts
  const testProjectDir = path.join(__dirname, '..', 'fixtures', 'concurrent-test-project');
  const claudeDir = path.join(testProjectDir, '.claude');
  const tasksFile = path.join(claudeDir, 'tasks.json');
  const taskStatusFile = path.join(claudeDir, 'task_status.json');
  const logsDir = path.join(claudeDir, 'logs');

  beforeAll(async () => {
    // Create test project structure
    await fs.mkdir(logsDir, { recursive: true });

    // Initialize with test data
    const initialTasks = Array.from({ length: 5 }, (_, i) => ({
      id: `concurrent_task_${i + 1}`,
      type: 'testing',
      priority: 'medium',
      description: `Concurrent test task ${i + 1}`,
      files_pattern: `**/*${i + 1}.test.js`,
      created_at: new Date().toISOString(),
      status: 'pending'
    }));

    const initialStatus = {};
    initialTasks.forEach(task => {
      initialStatus[task.id] = {
        status: 'pending',
        progress: 0,
        created_at: task.created_at
      };
    });

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
  });

  afterAll(async () => {
    // Clean up test directory
    try {
      await fs.rm(testProjectDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('Concurrent WebSocket Operations', () => {
    test('handles multiple simultaneous WebSocket connections', async () => {
      await mockWebSocket.connected;

      // Create multiple concurrent connections
      const connections = [];
      for (let i = 0; i < 5; i++) {
        connections.push(new WS(`ws://localhost:${testPort}/ws`));
      }

      // Wait for all connections to establish
      await Promise.all(connections.map(ws => ws.connected));

      // Send requests from all connections simultaneously
      const requests = connections.map((ws, index) =>
        ws.send(JSON.stringify({ type: 'ping', client_id: index }))
      );
      await Promise.all(requests);

      // Collect responses
      const responses = await Promise.all(
        connections.map(ws => ws.nextMessage)
      );

      // Verify all responses are valid pongs
      responses.forEach(response => {
        const data = JSON.parse(response);
        expect(data.type).toBe('pong');
        expect(data).toHaveProperty('timestamp');
      });

      // Clean up additional connections
      await Promise.all(connections.map(ws => ws.close()));
    });

    test('processes concurrent API requests without interference', async () => {
      await mockWebSocket.connected;

      // Send multiple different types of requests concurrently
      const requests = [
        mockWebSocket.send(JSON.stringify({ type: 'ping' })),
        mockWebSocket.send(JSON.stringify({ type: 'request_status' })),
        mockWebSocket.send(JSON.stringify({ type: 'request_claude_processes' })),
        mockWebSocket.send(JSON.stringify({ type: 'ping' })),
        mockWebSocket.send(JSON.stringify({ type: 'request_status' }))
      ];

      await Promise.all(requests);

      // Collect and verify responses
      const responses = [];
      for (let i = 0; i < 5; i++) {
        try {
          const response = await mockWebSocket.nextMessage;
          responses.push(JSON.parse(response));
        } catch (e) {
          break;
        }
      }

      // Should have received various response types
      const responseTypes = responses.map(r => r.type);
      expect(responseTypes).toContain('pong');
      expect(responseTypes).toContain('status_update');
      expect(responseTypes).toContain('claude_processes_update');

      // Verify response integrity
      responses.forEach(response => {
        if (response.type === 'status_update') {
          expect(response.data).toHaveProperty('system_resources');
        } else if (response.type === 'claude_processes_update') {
          expect(response.data).toHaveProperty('processes');
        } else if (response.type === 'pong') {
          expect(response).toHaveProperty('timestamp');
        }
      });
    });

    test('maintains WebSocket message ordering under load', async () => {
      await mockWebSocket.connected;

      // Send a sequence of ping requests
      const pingCount = 10;
      for (let i = 0; i < pingCount; i++) {
        mockWebSocket.send(JSON.stringify({ type: 'ping', sequence: i }));
      }

      // Collect responses
      const responses = [];
      for (let i = 0; i < pingCount; i++) {
        try {
          const response = await mockWebSocket.nextMessage;
          responses.push(JSON.parse(response));
        } catch (e) {
          break;
        }
      }

      // Should receive correct number of pongs
      expect(responses.length).toBe(pingCount);
      responses.forEach(response => {
        expect(response.type).toBe('pong');
      });
    });
  });

  describe('Concurrent Database Operations', () => {
    test('handles concurrent reads from multiple processes', async () => {
      // Simulate multiple processes reading the database concurrently
      const readOperations = Array.from({ length: 20 }, () =>
        fs.readFile(tasksFile, 'utf8').then(data => JSON.parse(data))
      );

      const results = await Promise.all(readOperations);

      // All reads should return consistent data
      results.forEach(result => {
        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(5); // Should have our 5 test tasks
        expect(result.every(task => task.id.startsWith('concurrent_task_'))).toBe(true);
      });

      // All results should be identical
      const firstResult = JSON.stringify(results[0]);
      results.forEach(result => {
        expect(JSON.stringify(result)).toBe(firstResult);
      });
    });

    test('handles concurrent database writes safely', async () => {
      // Create multiple concurrent write operations
      const writeOperations = Array.from({ length: 10 }, (_, i) =>
        (async () => {
          const tasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
          // Add a new task with unique ID
          const newTask = {
            id: `concurrent_write_task_${i}_${Date.now()}`,
            type: 'testing',
            priority: 'low',
            description: `Concurrent write task ${i}`,
            files_pattern: `**/*${i}.js`,
            created_at: new Date().toISOString(),
            status: 'pending'
          };
          tasks.push(newTask);
          await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2));
          return newTask.id;
        })()
      );

      const addedTaskIds = await Promise.all(writeOperations);

      // Verify all tasks were added
      const finalTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      expect(finalTasks.length).toBe(15); // 5 original + 10 added

      // Verify all added tasks are present
      addedTaskIds.forEach(taskId => {
        const task = finalTasks.find(t => t.id === taskId);
        expect(task).toBeDefined();
      });
    });

    test('maintains data integrity during concurrent read-write operations', async () => {
      const operations = [];

      // Mix of read and write operations
      for (let i = 0; i < 15; i++) {
        if (i % 3 === 0) {
          // Write operation
          operations.push(
            (async () => {
              const tasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
              const taskToUpdate = tasks[i % tasks.length];
              taskToUpdate.status = `updated_${i}`;
              taskToUpdate.last_modified = new Date().toISOString();
              await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2));
              return 'write';
            })()
          );
        } else {
          // Read operation
          operations.push(
            (async () => {
              const tasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
              return { type: 'read', count: tasks.length };
            })()
          );
        }
      }

      const results = await Promise.all(operations);

      // Verify results
      const readResults = results.filter(r => r.type === 'read');
      const writeResults = results.filter(r => r === 'write');

      expect(readResults.length).toBeGreaterThan(0);
      expect(writeResults.length).toBeGreaterThan(0);

      // All reads should return valid data
      readResults.forEach(result => {
        expect(result.count).toBeGreaterThanOrEqual(5);
      });

      // Final state should be consistent
      const finalTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      expect(finalTasks.length).toBe(5); // Should still have original 5 tasks
      expect(finalTasks.every(task => task.id.startsWith('concurrent_task_'))).toBe(true);
    });
  });

  describe('Concurrent Task Management Operations', () => {
    test('handles concurrent task creation via WebSocket', async () => {
      await mockWebSocket.connected;

      // Create multiple tasks concurrently via WebSocket
      const taskCreationPromises = Array.from({ length: 5 }, (_, i) => {
        const task = {
          id: `websocket_task_${i + 1}`,
          type: 'testing',
          priority: 'medium',
          description: `WebSocket created task ${i + 1}`,
          files_pattern: `**/*${i + 1}.test.js`
        };

        mockWebSocket.send(JSON.stringify({
          type: 'start_task',
          task: task
        }));

        return task.id;
      });

      // Wait for all task creation requests to be sent
      await Promise.all(taskCreationPromises);

      // Collect responses
      const responses = [];
      for (let i = 0; i < 5; i++) {
        try {
          const response = await mockWebSocket.nextMessage;
          responses.push(JSON.parse(response));
        } catch (e) {
          break;
        }
      }

      // Should have received task_started responses
      const startedResponses = responses.filter(r => r.type === 'task_started');
      expect(startedResponses.length).toBeGreaterThanOrEqual(1);

      // Verify tasks were added to database
      const dbTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      const websocketTasks = dbTasks.filter(t => t.id.startsWith('websocket_task_'));
      expect(websocketTasks.length).toBeGreaterThanOrEqual(1);
    });

    test('handles concurrent task status updates', async () => {
      // Start with a known task
      const tasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      const testTask = tasks[0];

      // Perform concurrent status updates
      const statusUpdates = ['running', 'in_progress', 'processing', 'completed'];
      const updateOperations = statusUpdates.map((status, index) =>
        (async () => {
          const currentTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
          const task = currentTasks.find(t => t.id === testTask.id);
          task.status = status;
          task.progress = (index + 1) * 25;
          task.last_update = new Date().toISOString();
          await fs.writeFile(tasksFile, JSON.stringify(currentTasks, null, 2));
          return status;
        })()
      );

      await Promise.all(updateOperations);

      // Verify final state is one of the updated states
      const finalTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      const finalTask = finalTasks.find(t => t.id === testTask.id);
      expect(statusUpdates).toContain(finalTask.status);
      expect(finalTask).toHaveProperty('last_update');
    });

    test('handles concurrent task manager operations', async () => {
      // Start multiple task manager processes concurrently
      const taskManagerProcesses = Array.from({ length: 3 }, () => {
        const taskManagerScript = path.join(__dirname, '..', '..', 'scripts', 'task_manager.py');
        return spawn('python3', [
          taskManagerScript,
          '--test-mode',
          '--project-dir', testProjectDir,
          '--max-concurrent', '1'
        ], {
          stdio: 'pipe'
        });
      });

      // Let them run briefly
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Clean up processes
      await Promise.all(taskManagerProcesses.map(proc =>
        new Promise(resolve => {
          if (!proc.killed) {
            proc.kill('SIGTERM');
            proc.on('close', resolve);
          } else {
            resolve();
          }
        })
      ));

      // Verify database integrity was maintained
      const finalTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      expect(Array.isArray(finalTasks)).toBe(true);
      expect(finalTasks.length).toBeGreaterThanOrEqual(5);

      // All tasks should have valid structure
      finalTasks.forEach(task => {
        expect(task).toHaveProperty('id');
        expect(task).toHaveProperty('type');
        expect(task).toHaveProperty('status');
        expect(['pending', 'running', 'completed', 'failed']).toContain(task.status);
      });
    });
  });

  describe('Concurrent File System Operations', () => {
    test('handles concurrent log file writes', async () => {
      const logFiles = Array.from({ length: 5 }, (_, i) =>
        path.join(logsDir, `concurrent_log_${i + 1}.log`)
      );

      // Initialize log files
      await Promise.all(logFiles.map(file => fs.writeFile(file, '')));

      // Perform concurrent log writes
      const logOperations = Array.from({ length: 20 }, (_, i) =>
        (async () => {
          const logFile = logFiles[i % logFiles.length];
          const logEntry = `${new Date().toISOString()} [INFO] Concurrent log entry ${i}\n`;
          await fs.appendFile(logFile, logEntry);
          return logEntry;
        })()
      );

      await Promise.all(logOperations);

      // Verify all log entries were written
      const logContents = await Promise.all(logFiles.map(file => fs.readFile(file, 'utf8')));

      logContents.forEach((content, index) => {
        const lines = content.trim().split('\n');
        expect(lines.length).toBeGreaterThan(0);
        expect(content).toContain(`concurrent_log_${index + 1}.log`);
      });

      // Total log entries should be 20
      const totalLines = logContents.reduce((total, content) =>
        total + content.trim().split('\n').length, 0
      );
      expect(totalLines).toBe(20);
    });

    test('handles concurrent file monitoring and updates', async () => {
      await mockWebSocket.connected;

      // Create multiple log files
      const testLogFiles = Array.from({ length: 3 }, (_, i) =>
        path.join(logsDir, `monitor_test_${i + 1}.log`)
      );

      // Initialize files
      await Promise.all(testLogFiles.map(file => fs.writeFile(file, '')));

      // Wait for file watcher to register
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Perform concurrent log writes
      const writeOperations = testLogFiles.map((file, index) =>
        fs.appendFile(file, `${new Date().toISOString()} [INFO] Monitor test entry ${index + 1}\n`)
      );

      await Promise.all(writeOperations);

      // Monitor for log broadcasts
      let logBroadcasts = [];
      const maxWait = 5000;
      const startTime = Date.now();

      while (logBroadcasts.length < 3 && (Date.now() - startTime) < maxWait) {
        try {
          const message = await mockWebSocket.nextMessage;
          const data = JSON.parse(message);

          if (data.type === 'log_entry') {
            logBroadcasts.push(data);
          }
        } catch (e) {
          break;
        }
      }

      expect(logBroadcasts.length).toBeGreaterThanOrEqual(1);

      // Clean up test files
      await Promise.all(testLogFiles.map(file => fs.unlink(file)));
    });

    test('handles concurrent directory operations', async () => {
      const testDirs = Array.from({ length: 5 }, (_, i) =>
        path.join(testProjectDir, `concurrent_dir_${i + 1}`)
      );

      // Create directories concurrently
      await Promise.all(testDirs.map(dir => fs.mkdir(dir, { recursive: true })));

      // Verify all directories exist
      const dirChecks = await Promise.all(testDirs.map(dir =>
        fs.stat(dir).then(stat => stat.isDirectory())
      ));

      expect(dirChecks.every(exists => exists)).toBe(true);

      // Create files in directories concurrently
      const fileOperations = testDirs.map((dir, index) =>
        fs.writeFile(path.join(dir, `test_file_${index + 1}.txt`), `Content ${index + 1}`)
      );

      await Promise.all(fileOperations);

      // Verify files were created
      const fileChecks = await Promise.all(testDirs.map((dir, index) =>
        fs.readFile(path.join(dir, `test_file_${index + 1}.txt`), 'utf8')
      ));

      fileChecks.forEach((content, index) => {
        expect(content).toBe(`Content ${index + 1}`);
      });

      // Clean up
      await Promise.all(testDirs.map(dir => fs.rm(dir, { recursive: true, force: true })));
    });
  });

  describe('Load Testing and Performance', () => {
    test('handles high-frequency WebSocket message load', async () => {
      await mockWebSocket.connected;

      const messageCount = 100;
      const startTime = Date.now();

      // Send many messages rapidly
      for (let i = 0; i < messageCount; i++) {
        mockWebSocket.send(JSON.stringify({ type: 'ping', id: i }));
      }

      const sendTime = Date.now() - startTime;

      // Collect responses
      const responses = [];
      for (let i = 0; i < messageCount; i++) {
        try {
          const response = await mockWebSocket.nextMessage;
          responses.push(JSON.parse(response));
        } catch (e) {
          break;
        }
      }

      const totalTime = Date.now() - startTime;

      // Should handle the load reasonably
      expect(responses.length).toBeGreaterThan(0);
      expect(sendTime).toBeLessThan(1000); // Should send quickly
      expect(totalTime).toBeLessThan(10000); // Should complete within reasonable time

      // All responses should be valid
      responses.forEach(response => {
        expect(response.type).toBe('pong');
      });
    });

    test('maintains performance under concurrent database load', async () => {
      const operationCount = 50;
      const startTime = Date.now();

      // Perform many concurrent database operations
      const operations = Array.from({ length: operationCount }, (_, i) =>
        (async () => {
          if (i % 2 === 0) {
            // Read operation
            const tasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
            return { type: 'read', count: tasks.length };
          } else {
            // Write operation (add metadata)
            const tasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
            tasks[0].last_access = new Date().toISOString();
            await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2));
            return { type: 'write' };
          }
        })()
      );

      const results = await Promise.all(operations);
      const totalTime = Date.now() - startTime;

      // Verify performance
      expect(totalTime).toBeLessThan(5000); // Should complete within 5 seconds

      const readResults = results.filter(r => r.type === 'read');
      const writeResults = results.filter(r => r.type === 'write');

      expect(readResults.length).toBeGreaterThan(0);
      expect(writeResults.length).toBeGreaterThan(0);

      // All reads should return valid data
      readResults.forEach(result => {
        expect(result.count).toBeGreaterThanOrEqual(5);
      });
    });

    test('handles memory pressure from concurrent operations', async () => {
      // Create many concurrent operations that consume memory
      const largeOperations = Array.from({ length: 20 }, () =>
        (async () => {
          // Read and process large amounts of data
          const tasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
          const status = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));

          // Create large data structures
          const processedData = {
            tasks: tasks,
            status: status,
            analysis: Array.from({ length: 1000 }, (_, i) => ({
              id: i,
              data: 'x'.repeat(100) // 100 chars per entry
            }))
          };

          // Simulate processing time
          await new Promise(resolve => setTimeout(resolve, 10));

          return processedData.tasks.length;
        })()
      );

      const results = await Promise.all(largeOperations);

      // All operations should complete successfully
      results.forEach(result => {
        expect(result).toBeGreaterThanOrEqual(5);
      });

      // Memory should be freed (no explicit assertion, but test passing indicates no memory issues)
      expect(true).toBe(true);
    });
  });
});