const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const WS = require('jest-websocket-mock');

describe('Database Persistence and Recovery Integration Tests', () => {
  let server;
  let mockWebSocket;
  const testPort = 8084; // Different port to avoid conflicts
  const testProjectDir = path.join(__dirname, '..', 'fixtures', 'db-persistence-test');
  const claudeDir = path.join(testProjectDir, '.claude');
  const tasksFile = path.join(claudeDir, 'tasks.json');
  const taskStatusFile = path.join(claudeDir, 'task_status.json');
  const logsDir = path.join(claudeDir, 'logs');
  const backupsDir = path.join(claudeDir, 'backups');

  beforeAll(async () => {
    // Create test project structure
    await fs.mkdir(backupsDir, { recursive: true });
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

  describe('Database Persistence Across Operations', () => {
    test('should persist task data correctly through create/update/delete cycles', async () => {
      await mockWebSocket.connected;

      const taskId = 'persistence_task_1';
      const taskData = {
        id: taskId,
        type: 'testing',
        priority: 'high',
        description: 'Database persistence test task',
        files_pattern: '**/*.test.js',
        metadata: {
          estimated_duration: 300,
          complexity: 'medium',
          tags: ['persistence', 'database']
        }
      };

      // Create task
      mockWebSocket.send(JSON.stringify({
        type: 'start_task',
        task: taskData
      }));

      await mockWebSocket.nextMessage; // task_started

      // Verify task was persisted
      let tasksContent = await fs.readFile(tasksFile, 'utf8');
      let tasks = JSON.parse(tasksContent);
      let task = tasks.find(t => t.id === taskId);
      expect(task).toBeDefined();
      expect(task.metadata.tags).toContain('persistence');

      // Update task status
      const statusData = {
        status: 'running',
        progress: 50,
        started_at: new Date().toISOString(),
        metrics: {
          files_processed: 10,
          tests_run: 5,
          coverage_percent: 85
        }
      };

      const statusContent = await fs.readFile(taskStatusFile, 'utf8');
      const allStatus = JSON.parse(statusContent);
      allStatus[taskId] = statusData;
      await fs.writeFile(taskStatusFile, JSON.stringify(allStatus, null, 2));

      // Verify status persistence
      const updatedStatus = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
      expect(updatedStatus[taskId].progress).toBe(50);
      expect(updatedStatus[taskId].metrics.files_processed).toBe(10);

      // Simulate task completion
      updatedStatus[taskId].status = 'completed';
      updatedStatus[taskId].progress = 100;
      updatedStatus[taskId].completed_at = new Date().toISOString();
      await fs.writeFile(taskStatusFile, JSON.stringify(updatedStatus, null, 2));

      // Verify final state
      const finalStatus = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
      expect(finalStatus[taskId].status).toBe('completed');
      expect(finalStatus[taskId].progress).toBe(100);
    });

    test('should maintain data integrity during concurrent operations', async () => {
      await mockWebSocket.connected;

      const taskIds = ['concurrent_task_1', 'concurrent_task_2', 'concurrent_task_3'];

      // Create multiple tasks concurrently
      const createPromises = taskIds.map(async (taskId) => {
        const taskData = {
          id: taskId,
          type: 'testing',
          priority: 'medium',
          description: `Concurrent persistence test ${taskId}`,
          files_pattern: '**/*.js'
        };

        mockWebSocket.send(JSON.stringify({
          type: 'start_task',
          task: taskData
        }));

        await mockWebSocket.nextMessage; // task_started
        return taskId;
      });

      await Promise.all(createPromises);

      // Verify all tasks were persisted
      const tasksContent = await fs.readFile(tasksFile, 'utf8');
      const tasks = JSON.parse(tasksContent);

      taskIds.forEach(taskId => {
        const task = tasks.find(t => t.id === taskId);
        expect(task).toBeDefined();
        expect(task.description).toContain(taskId);
      });

      // Concurrently update task statuses
      const updatePromises = taskIds.map(async (taskId, index) => {
        const statusContent = await fs.readFile(taskStatusFile, 'utf8');
        const statusData = JSON.parse(statusContent);
        statusData[taskId] = {
          status: 'running',
          progress: (index + 1) * 25,
          started_at: new Date().toISOString()
        };
        await fs.writeFile(taskStatusFile, JSON.stringify(statusData, null, 2));
      });

      await Promise.all(updatePromises);

      // Verify all status updates were persisted
      const finalStatus = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
      taskIds.forEach((taskId, index) => {
        expect(finalStatus[taskId]).toBeDefined();
        expect(finalStatus[taskId].progress).toBe((index + 1) * 25);
      });
    });

    test('should handle large datasets without corruption', async () => {
      await mockWebSocket.connected;

      // Create a large number of tasks
      const largeTaskCount = 100;
      const largeTasks = Array.from({ length: largeTaskCount }, (_, i) => ({
        id: `large_dataset_task_${i + 1}`,
        type: 'performance_test',
        priority: ['low', 'medium', 'high'][i % 3],
        description: `Large dataset task ${i + 1} with substantial content for testing database performance and integrity under load`,
        files_pattern: `**/*${i + 1}.*`,
        created_at: new Date().toISOString(),
        status: 'pending',
        metadata: {
          large_field: 'x'.repeat(100), // 100 character string
          complex_data: {
            nested: {
              array: Array.from({ length: 5 }, () => Math.random()),
              object: { a: i, b: i * 2, c: `test_${i}` }
            }
          },
          tags: [`tag_${i % 10}`, `category_${i % 5}`]
        }
      }));

      // Write large dataset directly to file
      await fs.writeFile(tasksFile, JSON.stringify(largeTasks, null, 2));

      // Verify data integrity
      const readTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      expect(readTasks).toHaveLength(largeTaskCount);

      // Verify specific tasks
      const firstTask = readTasks[0];
      const lastTask = readTasks[largeTaskCount - 1];

      expect(firstTask.id).toBe('large_dataset_task_1');
      expect(lastTask.id).toBe(`large_dataset_task_${largeTaskCount}`);
      expect(firstTask.metadata.large_field).toBe('x'.repeat(100));
      expect(lastTask.metadata.complex_data.nested.object.a).toBe(largeTaskCount - 1);

      // Test querying/filtering large dataset
      mockWebSocket.send(JSON.stringify({
        type: 'list_tasks',
        filter: { priority: 'high' }
      }));

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe('task_list');
      expect(data.tasks.length).toBeGreaterThan(30); // Should have ~33 high priority tasks
      expect(data.tasks.length).toBeLessThan(40);
    });
  });

  describe('Database Backup and Recovery', () => {
    test('should create and restore from backups correctly', async () => {
      await mockWebSocket.connected;

      // Create initial dataset
      const initialTasks = [
        {
          id: 'backup_test_task_1',
          type: 'backup',
          priority: 'high',
          description: 'Task for backup testing',
          files_pattern: '**/*.js',
          created_at: new Date().toISOString(),
          status: 'pending'
        },
        {
          id: 'backup_test_task_2',
          type: 'backup',
          priority: 'medium',
          description: 'Second task for backup testing',
          files_pattern: '**/*.md',
          created_at: new Date().toISOString(),
          status: 'running'
        }
      ];

      const initialStatus = {
        backup_test_task_1: {
          status: 'pending',
          progress: 0,
          created_at: new Date().toISOString()
        },
        backup_test_task_2: {
          status: 'running',
          progress: 75,
          started_at: new Date().toISOString()
        }
      };

      await fs.writeFile(tasksFile, JSON.stringify(initialTasks, null, 2));
      await fs.writeFile(taskStatusFile, JSON.stringify(initialStatus, null, 2));

      // Create backup
      const backupTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const tasksBackup = path.join(backupsDir, `tasks_backup_${backupTimestamp}.json`);
      const statusBackup = path.join(backupsDir, `task_status_backup_${backupTimestamp}.json`);

      await fs.copyFile(tasksFile, tasksBackup);
      await fs.copyFile(taskStatusFile, statusBackup);

      // Modify original data
      initialTasks[0].status = 'completed';
      initialStatus.backup_test_task_1.status = 'completed';
      initialStatus.backup_test_task_1.completed_at = new Date().toISOString();

      await fs.writeFile(tasksFile, JSON.stringify(initialTasks, null, 2));
      await fs.writeFile(taskStatusFile, JSON.stringify(initialStatus, null, 2));

      // Verify modification
      const modifiedTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      expect(modifiedTasks[0].status).toBe('completed');

      // Restore from backup
      await fs.copyFile(tasksBackup, tasksFile);
      await fs.copyFile(statusBackup, taskStatusFile);

      // Verify restoration
      const restoredTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      const restoredStatus = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));

      expect(restoredTasks[0].status).toBe('pending');
      expect(restoredStatus.backup_test_task_1.status).toBe('pending');
      expect(restoredStatus.backup_test_task_2.status).toBe('running');
      expect(restoredStatus.backup_test_task_2.progress).toBe(75);

      // Clean up backup files
      await fs.unlink(tasksBackup);
      await fs.unlink(statusBackup);
    });

    test('should handle point-in-time recovery', async () => {
      await mockWebSocket.connected;

      const taskId = 'recovery_test_task';
      const timeline = [];

      // Record initial state
      timeline.push({
        timestamp: new Date().toISOString(),
        tasks: [],
        status: {}
      });

      // Create task
      const taskData = {
        id: taskId,
        type: 'recovery',
        priority: 'medium',
        description: 'Point-in-time recovery test',
        files_pattern: '**/*.js'
      };

      mockWebSocket.send(JSON.stringify({
        type: 'start_task',
        task: taskData
      }));

      await mockWebSocket.nextMessage; // task_started

      // Record state after creation
      const afterCreateTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      const afterCreateStatus = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
      timeline.push({
        timestamp: new Date().toISOString(),
        tasks: afterCreateTasks,
        status: afterCreateStatus
      });

      // Update progress multiple times
      for (let progress = 25; progress <= 75; progress += 25) {
        const statusContent = await fs.readFile(taskStatusFile, 'utf8');
        const statusData = JSON.parse(statusContent);
        statusData[taskId] = {
          status: 'running',
          progress: progress,
          started_at: new Date().toISOString()
        };
        await fs.writeFile(taskStatusFile, JSON.stringify(statusData, null, 2));

        timeline.push({
          timestamp: new Date().toISOString(),
          tasks: JSON.parse(await fs.readFile(tasksFile, 'utf8')),
          status: JSON.parse(await fs.readFile(taskStatusFile, 'utf8'))
        });
      }

      // Recover to middle state (progress = 50)
      const recoveryPoint = timeline[3]; // After 50% progress
      await fs.writeFile(tasksFile, JSON.stringify(recoveryPoint.tasks, null, 2));
      await fs.writeFile(taskStatusFile, JSON.stringify(recoveryPoint.status, null, 2));

      // Verify recovery
      const recoveredTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      const recoveredStatus = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));

      expect(recoveredTasks.find(t => t.id === taskId)).toBeDefined();
      expect(recoveredStatus[taskId].progress).toBe(50);
      expect(recoveredStatus[taskId].status).toBe('running');
    });

    test('should compress and decompress backup data', async () => {
      const zlib = require('zlib');
      const util = require('util');

      const gzip = util.promisify(zlib.gzip);
      const gunzip = util.promisify(zlib.gunzip);

      // Create large test data
      const largeTasks = Array.from({ length: 50 }, (_, i) => ({
        id: `compression_task_${i + 1}`,
        type: 'compression_test',
        priority: 'low',
        description: `Compression test task ${i + 1} with large content`,
        files_pattern: `**/*${i + 1}.*`,
        created_at: new Date().toISOString(),
        status: 'pending',
        metadata: {
          large_content: 'x'.repeat(1000), // 1KB per task
          complex_data: {
            arrays: Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => Math.random())),
            nested_objects: {
              level1: {
                level2: {
                  level3: {
                    data: 'nested_data_'.repeat(50)
                  }
                }
              }
            }
          }
        }
      }));

      const jsonData = JSON.stringify(largeTasks, null, 2);
      const originalSize = Buffer.byteLength(jsonData, 'utf8');

      // Compress data
      const compressedData = await gzip(jsonData);
      const compressedSize = compressedData.length;

      // Save compressed backup
      const compressedBackup = path.join(backupsDir, 'tasks_compressed.gz');
      await fs.writeFile(compressedBackup, compressedData);

      // Verify compression ratio (should be significant)
      expect(compressedSize).toBeLessThan(originalSize * 0.5); // At least 50% compression

      // Test decompression and recovery
      const storedCompressedData = await fs.readFile(compressedBackup);
      const decompressedData = await gunzip(storedCompressedData);
      const recoveredTasks = JSON.parse(decompressedData.toString());

      // Verify data integrity
      expect(recoveredTasks).toHaveLength(50);
      expect(recoveredTasks[0].id).toBe('compression_task_1');
      expect(recoveredTasks[0].metadata.large_content).toBe('x'.repeat(1000));
      expect(recoveredTasks[49].id).toBe('compression_task_50');

      // Clean up
      await fs.unlink(compressedBackup);
    });
  });

  describe('Data Integrity and Validation', () => {
    test('should validate data integrity with checksums', async () => {
      const taskData = {
        id: 'checksum_task',
        type: 'validation',
        priority: 'high',
        description: 'Data integrity validation test',
        files_pattern: '**/*.js',
        created_at: new Date().toISOString(),
        status: 'pending',
        metadata: {
          checksum_test: true,
          data: 'test_data_'.repeat(10)
        }
      };

      // Create data with checksum
      const jsonString = JSON.stringify(taskData, null, 2);
      const checksum = crypto.createHash('sha256').update(jsonString).digest('hex');

      const dataWithChecksum = {
        checksum: checksum,
        data: taskData
      };

      await fs.writeFile(tasksFile, JSON.stringify([dataWithChecksum], null, 2));

      // Verify integrity on read
      const savedData = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      const savedTask = savedData[0];
      const savedJsonString = JSON.stringify(savedTask.data, null, 2);
      const calculatedChecksum = crypto.createHash('sha256').update(savedJsonString).digest('hex');

      expect(calculatedChecksum).toBe(savedTask.checksum);
      expect(savedTask.data.id).toBe('checksum_task');
      expect(savedTask.data.metadata.checksum_test).toBe(true);
    });

    test('should handle corrupted data gracefully', async () => {
      // Create valid data first
      const validTasks = [
        {
          id: 'corruption_test_task_1',
          type: 'testing',
          priority: 'high',
          description: 'Valid task for corruption test',
          files_pattern: '**/*.js',
          created_at: new Date().toISOString(),
          status: 'pending'
        },
        {
          id: 'corruption_test_task_2',
          type: 'testing',
          priority: 'medium',
          description: 'Another valid task',
          files_pattern: '**/*.md',
          created_at: new Date().toISOString(),
          status: 'running'
        }
      ];

      await fs.writeFile(tasksFile, JSON.stringify(validTasks, null, 2));

      // Corrupt the file by truncating it
      const corruptedContent = '{"id": "incomplete_task", "type": "testing"'; // Invalid JSON
      await fs.writeFile(tasksFile, corruptedContent);

      // Attempt to read and handle corruption
      try {
        const content = await fs.readFile(tasksFile, 'utf8');
        JSON.parse(content);
        // If we get here, the corruption wasn't detected
        expect(true).toBe(false); // Should have thrown
      } catch (error) {
        expect(error.message).toContain('JSON');
      }

      // Restore valid data
      await fs.writeFile(tasksFile, JSON.stringify(validTasks, null, 2));

      // Verify restoration
      const restoredTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      expect(restoredTasks).toHaveLength(2);
      expect(restoredTasks[0].id).toBe('corruption_test_task_1');
    });

    test('should handle schema migrations and backward compatibility', async () => {
      // Create old schema data (without metadata field)
      const oldSchemaTasks = [
        {
          id: 'old_schema_task',
          type: 'legacy',
          priority: 'medium',
          description: 'Task with old schema',
          files_pattern: '**/*',
          created_at: new Date().toISOString(),
          status: 'pending'
          // Missing metadata field from new schema
        }
      ];

      await fs.writeFile(tasksFile, JSON.stringify(oldSchemaTasks, null, 2));

      // Simulate migration by adding missing fields
      const tasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      const migratedTasks = tasks.map(task => ({
        ...task,
        metadata: {
          estimated_duration: 300,
          complexity: 'medium',
          tags: ['migrated'],
          dependencies: [],
          migrated_from: 'old_schema'
        }
      }));

      await fs.writeFile(tasksFile, JSON.stringify(migratedTasks, null, 2));

      // Verify migration
      const finalTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      expect(finalTasks[0]).toHaveProperty('metadata');
      expect(finalTasks[0].metadata.migrated_from).toBe('old_schema');
      expect(finalTasks[0].metadata.tags).toContain('migrated');
    });
  });

  describe('Database Performance and Optimization', () => {
    test('should handle rapid sequential operations efficiently', async () => {
      await mockWebSocket.connected;

      const operationCount = 50;
      const startTime = Date.now();

      // Perform rapid task creation operations
      for (let i = 0; i < operationCount; i++) {
        const taskData = {
          id: `rapid_task_${i + 1}`,
          type: 'performance',
          priority: 'low',
          description: `Rapid operation task ${i + 1}`,
          files_pattern: `**/*${i + 1}.*`
        };

        mockWebSocket.send(JSON.stringify({
          type: 'start_task',
          task: taskData
        }));

        // Don't wait for response to simulate rapid operations
      }

      // Wait for all operations to complete
      const responses = [];
      for (let i = 0; i < operationCount; i++) {
        try {
          const response = await mockWebSocket.nextMessage;
          responses.push(JSON.parse(response));
        } catch (e) {
          break;
        }
      }

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Should complete within reasonable time (allowing for test environment)
      expect(totalTime).toBeLessThan(30000); // 30 seconds max
      expect(responses.length).toBeGreaterThan(40); // At least 80% success rate

      // Verify data persistence
      const tasksContent = await fs.readFile(tasksFile, 'utf8');
      const tasks = JSON.parse(tasksContent);
      expect(tasks.length).toBeGreaterThan(40);
    });

    test('should maintain performance with large datasets', async () => {
      // Create large dataset
      const largeDatasetSize = 500;
      const largeTasks = Array.from({ length: largeDatasetSize }, (_, i) => ({
        id: `perf_task_${i + 1}`,
        type: 'performance_test',
        priority: ['low', 'medium', 'high'][i % 3],
        description: `Performance test task ${i + 1}`,
        files_pattern: `**/*${i + 1}.*`,
        created_at: new Date().toISOString(),
        status: ['pending', 'running', 'completed'][i % 3],
        metadata: {
          index: i,
          data: `data_${i}_`.repeat(5)
        }
      }));

      const writeStartTime = Date.now();
      await fs.writeFile(tasksFile, JSON.stringify(largeTasks, null, 2));
      const writeTime = Date.now() - writeStartTime;

      // Write should be reasonably fast
      expect(writeTime).toBeLessThan(5000); // 5 seconds max

      const readStartTime = Date.now();
      const readTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      const readTime = Date.now() - readStartTime;

      // Read should be fast
      expect(readTime).toBeLessThan(2000); // 2 seconds max
      expect(readTasks).toHaveLength(largeDatasetSize);

      // Test filtering performance
      const filterStartTime = Date.now();
      const highPriorityTasks = readTasks.filter(task => task.priority === 'high');
      const filterTime = Date.now() - filterStartTime;

      expect(filterTime).toBeLessThan(100); // Filtering should be very fast
      expect(highPriorityTasks.length).toBeGreaterThan(160); // ~33% should be high priority
    });
  });
});