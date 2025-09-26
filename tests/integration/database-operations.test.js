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

  describe('Database Consistency and Synchronization', () => {
    test('maintains consistency between tasks and status databases', async () => {
      // Add a new task
      const tasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      const newTask = {
        id: 'consistency_test_task',
        type: 'analysis',
        priority: 'medium',
        description: 'Consistency test task',
        files_pattern: '**/*.js',
        created_at: new Date().toISOString(),
        status: 'pending'
      };
      tasks.push(newTask);
      await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2));

      // Add corresponding status
      const statusData = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
      statusData.consistency_test_task = {
        status: 'pending',
        progress: 0,
        created_at: new Date().toISOString()
      };
      await fs.writeFile(taskStatusFile, JSON.stringify(statusData, null, 2));

      // Verify consistency
      const finalTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      const finalStatus = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));

      const task = finalTasks.find(t => t.id === 'consistency_test_task');
      expect(task).toBeDefined();
      expect(finalStatus).toHaveProperty('consistency_test_task');
      expect(task.status).toBe(finalStatus.consistency_test_task.status);
    });

    test('handles database synchronization during concurrent operations', async () => {
      const operations = [];

      // Simulate concurrent task updates
      for (let i = 0; i < 5; i++) {
        operations.push(
          (async () => {
            const tasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
            const task = tasks[0];
            task.status = `status_update_${i}`;
            task.last_modified = new Date().toISOString();
            await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2));
          })()
        );
      }

      await Promise.all(operations);

      // Verify final state is consistent
      const finalTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      expect(finalTasks).toHaveLength(1);
      expect(finalTasks[0]).toHaveProperty('id', 'db_test_task_1');
      expect(finalTasks[0]).toHaveProperty('status');
    });

    test('recovers from database corruption', async () => {
      // Corrupt the tasks file
      await fs.writeFile(tasksFile, '{ invalid json content');

      // Attempt to read should fail
      try {
        JSON.parse(await fs.readFile(tasksFile, 'utf8'));
        fail('Should have thrown JSON parse error');
      } catch (error) {
        expect(error).toBeInstanceOf(SyntaxError);
      }

      // Recover by writing valid data
      const recoveryTasks = [{
        id: 'recovered_task',
        type: 'recovery',
        priority: 'high',
        description: 'Task recovered after corruption',
        files_pattern: '**/*.js',
        created_at: new Date().toISOString(),
        status: 'pending'
      }];

      await fs.writeFile(tasksFile, JSON.stringify(recoveryTasks, null, 2));

      const recoveredTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      expect(recoveredTasks).toHaveLength(1);
      expect(recoveredTasks[0].id).toBe('recovered_task');
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