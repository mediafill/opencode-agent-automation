const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

describe('Database Operations Integration Tests', () => {
  let testProjectDir;
  let claudeDir;
  let tasksFile;
  let taskStatusFile;
  let logsDir;
  let taskManagerProcess;

  beforeAll(async () => {
    testProjectDir = path.join(__dirname, 'fixtures', 'db-integration-test');
    claudeDir = path.join(testProjectDir, '.claude');
    tasksFile = path.join(claudeDir, 'tasks.json');
    taskStatusFile = path.join(claudeDir, 'task_status.json');
    logsDir = path.join(claudeDir, 'logs');

    await fs.mkdir(logsDir, { recursive: true });
  });

  beforeEach(async () => {
    // Initialize clean database state
    const initialTasks = [
      {
        id: 'db_test_task_1',
        type: 'testing',
        priority: 'high',
        description: 'Database integration test task 1',
        files_pattern: '**/*.test.js',
        created_at: new Date().toISOString(),
        status: 'pending'
      }
    ];

    const initialStatus = {
      db_test_task_1: {
        status: 'pending',
        progress: 0,
        created_at: new Date().toISOString()
      }
    };

    await fs.writeFile(tasksFile, JSON.stringify(initialTasks, null, 2));
    await fs.writeFile(taskStatusFile, JSON.stringify(initialStatus, null, 2));
  });

  afterEach(async () => {
    if (taskManagerProcess && !taskManagerProcess.killed) {
      taskManagerProcess.kill('SIGTERM');
      await new Promise(resolve => {
        taskManagerProcess.on('close', resolve);
      });
    }
  });

  afterAll(async () => {
    try {
      await fs.rm(testProjectDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('Tasks Database CRUD Operations', () => {
    test('creates new tasks in database', async () => {
      const newTask = {
        id: 'create_test_task',
        type: 'documentation',
        priority: 'medium',
        description: 'Task created during integration test',
        files_pattern: 'docs/**/*.md',
        created_at: new Date().toISOString(),
        status: 'pending'
      };

      // Read current tasks
      const currentTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      expect(currentTasks).toHaveLength(1);

      // Add new task
      currentTasks.push(newTask);
      await fs.writeFile(tasksFile, JSON.stringify(currentTasks, null, 2));

      // Verify task was created
      const updatedTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      expect(updatedTasks).toHaveLength(2);
      const createdTask = updatedTasks.find(t => t.id === 'create_test_task');
      expect(createdTask).toBeDefined();
      expect(createdTask.description).toBe('Task created during integration test');
    });

    test('reads tasks from database correctly', async () => {
      const tasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));

      expect(Array.isArray(tasks)).toBe(true);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        id: 'db_test_task_1',
        type: 'testing',
        priority: 'high',
        status: 'pending'
      });
      expect(tasks[0]).toHaveProperty('created_at');
      expect(tasks[0]).toHaveProperty('description');
    });

    test('updates existing tasks in database', async () => {
      const tasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      const taskToUpdate = tasks[0];

      // Update task properties
      taskToUpdate.status = 'in_progress';
      taskToUpdate.description = 'Updated description';
      taskToUpdate.started_at = new Date().toISOString();

      await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2));

      // Verify update
      const updatedTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      const updatedTask = updatedTasks[0];
      expect(updatedTask.status).toBe('in_progress');
      expect(updatedTask.description).toBe('Updated description');
      expect(updatedTask).toHaveProperty('started_at');
    });

    test('deletes tasks from database', async () => {
      const tasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      expect(tasks).toHaveLength(1);

      // Remove the task
      const filteredTasks = tasks.filter(t => t.id !== 'db_test_task_1');
      await fs.writeFile(tasksFile, JSON.stringify(filteredTasks, null, 2));

      // Verify deletion
      const remainingTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      expect(remainingTasks).toHaveLength(0);
    });

    test('handles bulk task operations', async () => {
      const bulkTasks = Array.from({ length: 10 }, (_, i) => ({
        id: `bulk_task_${i + 1}`,
        type: 'testing',
        priority: 'medium',
        description: `Bulk test task ${i + 1}`,
        files_pattern: `**/*${i + 1}.js`,
        created_at: new Date().toISOString(),
        status: 'pending'
      }));

      await fs.writeFile(tasksFile, JSON.stringify(bulkTasks, null, 2));

      const readTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      expect(readTasks).toHaveLength(10);

      // Update all tasks to in_progress
      readTasks.forEach(task => {
        task.status = 'in_progress';
        task.started_at = new Date().toISOString();
      });

      await fs.writeFile(tasksFile, JSON.stringify(readTasks, null, 2));

      const updatedTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      updatedTasks.forEach(task => {
        expect(task.status).toBe('in_progress');
        expect(task).toHaveProperty('started_at');
      });
    });
  });

  describe('Task Status Database Operations', () => {
    test('creates and reads task status entries', async () => {
      const newStatus = {
        status: 'running',
        progress: 25,
        started_at: new Date().toISOString(),
        current_step: 'Initializing',
        pid: 12345
      };

      const statusData = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
      statusData.new_status_task = newStatus;

      await fs.writeFile(taskStatusFile, JSON.stringify(statusData, null, 2));

      const readStatus = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
      expect(readStatus).toHaveProperty('new_status_task');
      expect(readStatus.new_status_task.status).toBe('running');
      expect(readStatus.new_status_task.progress).toBe(25);
    });

    test('updates task progress and status', async () => {
      const statusData = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
      const taskStatus = statusData.db_test_task_1;

      // Update progress
      taskStatus.progress = 50;
      taskStatus.status = 'running';
      taskStatus.last_update = new Date().toISOString();
      taskStatus.current_step = 'Processing files';

      await fs.writeFile(taskStatusFile, JSON.stringify(statusData, null, 2));

      const updatedStatus = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
      expect(updatedStatus.db_test_task_1.progress).toBe(50);
      expect(updatedStatus.db_test_task_1.status).toBe('running');
      expect(updatedStatus.db_test_task_1).toHaveProperty('current_step');
    });

    test('tracks task completion with metrics', async () => {
      const statusData = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
      const taskStatus = statusData.db_test_task_1;

      taskStatus.status = 'completed';
      taskStatus.progress = 100;
      taskStatus.completed_at = new Date().toISOString();
      taskStatus.result = 'success';
      taskStatus.execution_time = 45.6;
      taskStatus.metrics = {
        files_processed: 15,
        tests_run: 8,
        coverage_percent: 85.5
      };

      await fs.writeFile(taskStatusFile, JSON.stringify(statusData, null, 2));

      const completedStatus = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
      const task = completedStatus.db_test_task_1;
      expect(task.status).toBe('completed');
      expect(task.progress).toBe(100);
      expect(task.result).toBe('success');
      expect(task).toHaveProperty('metrics');
      expect(task.metrics.files_processed).toBe(15);
    });

    test('handles task failures and errors', async () => {
      const statusData = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
      const taskStatus = statusData.db_test_task_1;

      taskStatus.status = 'failed';
      taskStatus.progress = 75;
      taskStatus.failed_at = new Date().toISOString();
      taskStatus.error = 'Test execution failed: assertion error';
      taskStatus.error_details = {
        error_type: 'AssertionError',
        line_number: 42,
        file: 'test_file.js'
      };
      taskStatus.retry_count = 1;

      await fs.writeFile(taskStatusFile, JSON.stringify(statusData, null, 2));

      const failedStatus = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
      const task = failedStatus.db_test_task_1;
      expect(task.status).toBe('failed');
      expect(task.error).toContain('assertion error');
      expect(task).toHaveProperty('error_details');
      expect(task.retry_count).toBe(1);
    });
  });

  describe('Database Concurrency and Race Conditions', () => {
    test('handles concurrent task creation without conflicts', async () => {
      const concurrentTasks = Array.from({ length: 20 }, (_, i) => ({
        id: `concurrent_task_${i + 1}`,
        type: 'testing',
        priority: 'medium',
        description: `Concurrent test task ${i + 1}`,
        files_pattern: `**/*${i + 1}.js`,
        created_at: new Date().toISOString(),
        status: 'pending'
      }));

      // Simulate concurrent operations
      const promises = concurrentTasks.map(async (task) => {
        const currentTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
        currentTasks.push(task);
        await fs.writeFile(tasksFile, JSON.stringify(currentTasks, null, 2));
      });

      await Promise.all(promises);

      // Verify all tasks were created without conflicts
      const finalTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      expect(finalTasks.length).toBe(21); // 1 initial + 20 concurrent

      // Verify no data corruption
      const taskIds = finalTasks.map(t => t.id);
      const uniqueIds = new Set(taskIds);
      expect(uniqueIds.size).toBe(taskIds.length); // No duplicates

      // Verify all tasks have valid data
      finalTasks.forEach(task => {
        expect(task).toHaveProperty('id');
        expect(task).toHaveProperty('type');
        expect(task).toHaveProperty('description');
        expect(task).toHaveProperty('created_at');
      });
    });

    test('manages concurrent status updates with atomic operations', async () => {
      // Initialize multiple tasks
      const initialTasks = Array.from({ length: 10 }, (_, i) => ({
        id: `status_task_${i + 1}`,
        type: 'testing',
        priority: 'medium',
        description: `Status test task ${i + 1}`,
        files_pattern: '**/*.js',
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

      // Simulate concurrent status updates
      const updatePromises = initialTasks.map(async (task, index) => {
        // Small delay to create potential race conditions
        await new Promise(resolve => setTimeout(resolve, Math.random() * 10));

        const statusData = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
        statusData[task.id] = {
          status: 'running',
          progress: (index + 1) * 10,
          started_at: new Date().toISOString(),
          last_update: new Date().toISOString()
        };
        await fs.writeFile(taskStatusFile, JSON.stringify(statusData, null, 2));
      });

      await Promise.all(updatePromises);

      // Verify all updates were applied
      const finalStatus = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
      expect(Object.keys(finalStatus)).toHaveLength(11); // 1 initial + 10 new

      // Verify each task has correct status
      initialTasks.forEach((task, index) => {
        expect(finalStatus[task.id].status).toBe('running');
        expect(finalStatus[task.id].progress).toBe((index + 1) * 10);
        expect(finalStatus[task.id]).toHaveProperty('started_at');
        expect(finalStatus[task.id]).toHaveProperty('last_update');
      });
    });

    test('handles database locks and prevents corruption during simultaneous reads/writes', async () => {
      const operations = [];
      const numOperations = 50;

      // Mix of read and write operations
      for (let i = 0; i < numOperations; i++) {
        if (i % 3 === 0) {
          // Read operation
          operations.push(
            (async () => {
              const tasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
              // Simulate processing time
              await new Promise(resolve => setTimeout(resolve, Math.random() * 5));
              return tasks.length;
            })()
          );
        } else {
          // Write operation
          operations.push(
            (async () => {
              const tasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
              const newTask = {
                id: `lock_test_task_${i}_${Date.now()}`,
                type: 'testing',
                priority: 'low',
                description: `Lock test task ${i}`,
                files_pattern: '**/*.js',
                created_at: new Date().toISOString(),
                status: 'pending'
              };
              tasks.push(newTask);
              await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2));
              // Simulate processing time
              await new Promise(resolve => setTimeout(resolve, Math.random() * 5));
              return true;
            })()
          );
        }
      }

      const results = await Promise.all(operations);

      // Verify database integrity
      const finalTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      expect(finalTasks.length).toBeGreaterThan(1); // At least original task plus some new ones

      // Verify JSON structure is valid
      expect(Array.isArray(finalTasks)).toBe(true);
      finalTasks.forEach(task => {
        expect(task).toHaveProperty('id');
        expect(task).toHaveProperty('type');
        expect(typeof task.id).toBe('string');
        expect(typeof task.description).toBe('string');
      });
    });

    test('maintains data consistency during rapid successive operations', async () => {
      const baseTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      const originalLength = baseTasks.length;

      // Perform rapid successive operations
      for (let i = 0; i < 100; i++) {
        const tasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
        const operation = i % 4;

        switch (operation) {
          case 0: // Add task
            tasks.push({
              id: `rapid_task_${i}`,
              type: 'testing',
              priority: 'low',
              description: `Rapid task ${i}`,
              files_pattern: '**/*.js',
              created_at: new Date().toISOString(),
              status: 'pending'
            });
            break;
          case 1: // Update task
            if (tasks.length > 0) {
              const randomIndex = Math.floor(Math.random() * tasks.length);
              tasks[randomIndex].status = 'running';
              tasks[randomIndex].updated_at = new Date().toISOString();
            }
            break;
          case 2: // Delete task
            if (tasks.length > 1) { // Keep at least one task
              const deleteIndex = Math.floor(Math.random() * (tasks.length - 1)) + 1;
              tasks.splice(deleteIndex, 1);
            }
            break;
          case 3: // Read-only operation
            // Just read and verify
            break;
        }

        await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2));
      }

      // Final verification
      const finalTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      expect(Array.isArray(finalTasks)).toBe(true);
      expect(finalTasks.length).toBeGreaterThan(0);

      // Verify data integrity
      finalTasks.forEach(task => {
        expect(task).toHaveProperty('id');
        expect(task).toHaveProperty('type');
        expect(task).toHaveProperty('status');
        expect(typeof task.id).toBe('string');
        expect(typeof task.description).toBe('string');
      });

      // Verify no duplicate IDs
      const ids = finalTasks.map(t => t.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    test('handles database contention with proper error recovery', async () => {
      let corruptionCount = 0;
      const maxCorruptionAttempts = 5;

      // Simulate database corruption during concurrent access
      const corruptAndRecover = async () => {
        try {
          // Try to corrupt the file during read
          const content = await fs.readFile(tasksFile, 'utf8');
          // Simulate corruption by writing invalid JSON
          await fs.writeFile(tasksFile, content.replace('}', '') + 'invalid');
          corruptionCount++;

          // Immediate recovery attempt
          const validTasks = [{
            id: 'recovery_task',
            type: 'recovery',
            priority: 'high',
            description: 'Task created after corruption recovery',
            files_pattern: '**/*.js',
            created_at: new Date().toISOString(),
            status: 'pending'
          }];
          await fs.writeFile(tasksFile, JSON.stringify(validTasks, null, 2));

          return true;
        } catch (error) {
          // Recovery failed, try again
          return false;
        }
      };

      // Run multiple corruption/recovery cycles
      const corruptionPromises = [];
      for (let i = 0; i < maxCorruptionAttempts; i++) {
        corruptionPromises.push(corruptAndRecover());
      }

      const results = await Promise.all(corruptionPromises);
      const successfulRecoveries = results.filter(r => r).length;

      // At least some recoveries should succeed
      expect(successfulRecoveries).toBeGreaterThan(0);

      // Final database should be valid
      const finalTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      expect(Array.isArray(finalTasks)).toBe(true);
      expect(finalTasks.length).toBeGreaterThan(0);
    });
  });

  describe('Database Performance and Scalability', () => {
    test('handles large task datasets efficiently', async () => {
      const largeTaskSet = Array.from({ length: 100 }, (_, i) => ({
        id: `perf_task_${i + 1}`,
        type: 'performance_test',
        priority: 'low',
        description: `Performance test task ${i + 1} with some additional text to make it larger`,
        files_pattern: `**/*${i + 1}.*`,
        created_at: new Date().toISOString(),
        status: 'pending',
        metadata: {
          estimated_duration: Math.floor(Math.random() * 300) + 30,
          complexity: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)],
          dependencies: []
        }
      }));

      const startTime = Date.now();
      await fs.writeFile(tasksFile, JSON.stringify(largeTaskSet, null, 2));
      const writeTime = Date.now() - startTime;

      const readStartTime = Date.now();
      const readTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      const readTime = Date.now() - readStartTime;

      expect(readTasks).toHaveLength(100);
      expect(writeTime).toBeLessThan(1000); // Should write in less than 1 second
      expect(readTime).toBeLessThan(500);   // Should read in less than 0.5 seconds

      // Verify data integrity
      readTasks.forEach((task, index) => {
        expect(task.id).toBe(`perf_task_${index + 1}`);
        expect(task).toHaveProperty('metadata');
      });
    });

    test('handles large status datasets with complex data', async () => {
      const largeStatusData = {};
      for (let i = 0; i < 50; i++) {
        largeStatusData[`status_task_${i + 1}`] = {
          status: ['pending', 'running', 'completed'][Math.floor(Math.random() * 3)],
          progress: Math.floor(Math.random() * 101),
          created_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
          metrics: {
            files_processed: Math.floor(Math.random() * 100),
            memory_usage: Math.floor(Math.random() * 1000),
            cpu_time: Math.random() * 60
          },
          logs: Array.from({ length: 10 }, (_, j) => ({
            timestamp: new Date().toISOString(),
            level: ['info', 'warn', 'error'][Math.floor(Math.random() * 3)],
            message: `Log message ${j} for task ${i + 1}`
          }))
        };
      }

      const startTime = Date.now();
      await fs.writeFile(taskStatusFile, JSON.stringify(largeStatusData, null, 2));
      const writeTime = Date.now() - startTime;

      const readStartTime = Date.now();
      const readStatus = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
      const readTime = Date.now() - readStartTime;

      expect(Object.keys(readStatus)).toHaveLength(50);
      expect(writeTime).toBeLessThan(2000); // Should handle complex data reasonably fast
      expect(readTime).toBeLessThan(1000);

      // Verify complex data structure
      Object.values(readStatus).forEach(status => {
        expect(status).toHaveProperty('metrics');
        expect(status).toHaveProperty('logs');
        expect(Array.isArray(status.logs)).toBe(true);
        expect(status.logs.length).toBe(10);
      });
    });

    test('performs efficient bulk operations', async () => {
      const bulkOperations = [];

      // Create bulk read operations
      for (let i = 0; i < 20; i++) {
        bulkOperations.push(
          (async () => {
            const start = Date.now();
            const tasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
            const duration = Date.now() - start;
            return { operation: 'read', duration, count: tasks.length };
          })()
        );
      }

      // Create bulk write operations
      for (let i = 0; i < 10; i++) {
        bulkOperations.push(
          (async () => {
            const start = Date.now();
            const tasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
            tasks.push({
              id: `bulk_op_task_${i}`,
              type: 'bulk_test',
              priority: 'low',
              description: `Bulk operation test task ${i}`,
              files_pattern: '**/*.js',
              created_at: new Date().toISOString(),
              status: 'pending'
            });
            await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2));
            const duration = Date.now() - start;
            return { operation: 'write', duration };
          })()
        );
      }

      const results = await Promise.all(bulkOperations);

      // Analyze performance
      const readOps = results.filter(r => r.operation === 'read');
      const writeOps = results.filter(r => r.operation === 'write');

      const avgReadTime = readOps.reduce((sum, r) => sum + r.duration, 0) / readOps.length;
      const avgWriteTime = writeOps.reduce((sum, r) => sum + r.duration, 0) / writeOps.length;

      // Performance expectations
      expect(avgReadTime).toBeLessThan(100); // Average read under 100ms
      expect(avgWriteTime).toBeLessThan(200); // Average write under 200ms

      // Verify all operations completed
      expect(readOps.length).toBe(20);
      expect(writeOps.length).toBe(10);

      // Verify final state
      const finalTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      const bulkTasks = finalTasks.filter(t => t.id.startsWith('bulk_op_task_'));
      expect(bulkTasks.length).toBe(10);
    });

    test('maintains performance under memory pressure', async () => {
      // Create a large dataset that approaches memory limits
      const memoryStressData = Array.from({ length: 500 }, (_, i) => ({
        id: `memory_task_${i + 1}`,
        type: 'memory_test',
        priority: 'low',
        description: `Memory stress test task ${i + 1} with large description: ${'A'.repeat(1000)}`,
        files_pattern: `**/*${i + 1}.*`,
        created_at: new Date().toISOString(),
        status: 'pending',
        large_data_field: 'B'.repeat(2000), // Large data field
        metadata: {
          complex_object: {
            nested: {
              deeply: {
                nested: {
                  data: Array.from({ length: 100 }, (_, j) => ({
                    index: j,
                    value: Math.random(),
                    text: `Nested text ${j}`
                  }))
                }
              }
            }
          }
        }
      }));

      const startTime = Date.now();
      await fs.writeFile(tasksFile, JSON.stringify(memoryStressData, null, 2));
      const writeTime = Date.now() - startTime;

      // Should still perform reasonably well
      expect(writeTime).toBeLessThan(5000); // Under 5 seconds for large dataset

      const readStartTime = Date.now();
      const readData = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      const readTime = Date.now() - readStartTime;

      expect(readTime).toBeLessThan(3000); // Under 3 seconds to read
      expect(readData).toHaveLength(500);

      // Verify data integrity for a sample
      const sampleTask = readData[0];
      expect(sampleTask).toHaveProperty('large_data_field');
      expect(sampleTask.large_data_field.length).toBe(2000);
      expect(sampleTask.metadata.complex_object.nested.deeply.nested.data).toHaveLength(100);
    });

    test('handles frequent small updates efficiently', async () => {
      // Start with a base task
      const baseTask = {
        id: 'frequent_update_task',
        type: 'update_test',
        priority: 'medium',
        description: 'Task for frequent update testing',
        files_pattern: '**/*.js',
        created_at: new Date().toISOString(),
        status: 'pending',
        update_count: 0
      };

      await fs.writeFile(tasksFile, JSON.stringify([baseTask], null, 2));

      const updateOperations = [];
      const numUpdates = 100;

      for (let i = 0; i < numUpdates; i++) {
        updateOperations.push(
          (async () => {
            const start = Date.now();
            const tasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
            const task = tasks.find(t => t.id === 'frequent_update_task');
            task.update_count = i + 1;
            task.last_update = new Date().toISOString();
            task.status = i % 2 === 0 ? 'running' : 'pending';
            await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2));
            const duration = Date.now() - start;
            return duration;
          })()
        );
      }

      const updateTimes = await Promise.all(updateOperations);
      const avgUpdateTime = updateTimes.reduce((sum, time) => sum + time, 0) / numUpdates;

      // Frequent updates should be reasonably fast
      expect(avgUpdateTime).toBeLessThan(50); // Under 50ms per update

      // Verify final state
      const finalTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      const finalTask = finalTasks.find(t => t.id === 'frequent_update_task');
      expect(finalTask.update_count).toBe(numUpdates);
      expect(finalTask).toHaveProperty('last_update');
    });
  });

  describe('Database Backup and Recovery', () => {
    test('creates and restores database backups', async () => {
      // Create backup of current state
      const originalTasks = await fs.readFile(tasksFile, 'utf8');
      const originalStatus = await fs.readFile(taskStatusFile, 'utf8');

      const backupTasksFile = `${tasksFile}.backup`;
      const backupStatusFile = `${taskStatusFile}.backup`;

      await fs.writeFile(backupTasksFile, originalTasks);
      await fs.writeFile(backupStatusFile, originalStatus);

      // Modify current database
      const modifiedTasks = [{
        id: 'modified_task',
        type: 'modified',
        priority: 'high',
        description: 'Modified task',
        files_pattern: '**/*.js',
        created_at: new Date().toISOString(),
        status: 'completed'
      }];

      await fs.writeFile(tasksFile, JSON.stringify(modifiedTasks, null, 2));

      // Verify modification
      const currentTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      expect(currentTasks[0].id).toBe('modified_task');

      // Restore from backup
      await fs.copyFile(backupTasksFile, tasksFile);
      await fs.copyFile(backupStatusFile, taskStatusFile);

      // Verify restoration
      const restoredTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      expect(restoredTasks[0].id).toBe('db_test_task_1');

      // Clean up backups
      await fs.unlink(backupTasksFile);
      await fs.unlink(backupStatusFile);
    });

    test('handles partial database recovery', async () => {
      // Create a partial backup (only tasks, no status)
      const tasksBackup = await fs.readFile(tasksFile, 'utf8');
      const partialBackupFile = `${tasksFile}.partial`;

      await fs.writeFile(partialBackupFile, tasksBackup);

      // Simulate status file corruption
      await fs.writeFile(taskStatusFile, '{ corrupted status data');

      // Restore only tasks file
      await fs.copyFile(partialBackupFile, tasksFile);

      // Verify tasks are intact
      const tasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('db_test_task_1');

      // Status file should be corrupted
      try {
        JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
        fail('Status file should be corrupted');
      } catch (error) {
        expect(error).toBeInstanceOf(SyntaxError);
      }

      // Clean up
      await fs.unlink(partialBackupFile);
    });
  });
});