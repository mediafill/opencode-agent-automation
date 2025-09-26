const fs = require('fs').promises;
const path = require('path');

describe('File-Based Database Integration Tests', () => {
  let testProjectDir;
  let claudeDir;
  let tasksFile;
  let taskStatusFile;
  let logsDir;

  beforeAll(async () => {
    testProjectDir = path.join(__dirname, 'fixtures', 'test-db-project');
    claudeDir = path.join(testProjectDir, '.claude');
    tasksFile = path.join(claudeDir, 'tasks.json');
    taskStatusFile = path.join(claudeDir, 'task_status.json');
    logsDir = path.join(claudeDir, 'logs');

    await fs.mkdir(logsDir, { recursive: true });
  });

  beforeEach(async () => {
    // Initialize with clean state
    await fs.writeFile(tasksFile, JSON.stringify([]));
    await fs.writeFile(taskStatusFile, JSON.stringify({}));
  });

  afterAll(async () => {
    try {
      await fs.rm(testProjectDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('Tasks File Operations', () => {
    test('creates and reads tasks correctly', async () => {
      const testTasks = [
        {
          id: 'task_1',
          type: 'testing',
          priority: 'high',
          description: 'Write unit tests',
          files_pattern: '**/*.test.js',
          created_at: new Date().toISOString(),
          status: 'pending'
        },
        {
          id: 'task_2',
          type: 'documentation',
          priority: 'medium',
          description: 'Update README',
          files_pattern: 'README.md',
          created_at: new Date().toISOString(),
          status: 'in_progress'
        }
      ];

      await fs.writeFile(tasksFile, JSON.stringify(testTasks, null, 2));

      const readTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));

      expect(readTasks).toHaveLength(2);
      expect(readTasks[0]).toMatchObject({
        id: 'task_1',
        type: 'testing',
        priority: 'high',
        status: 'pending'
      });
      expect(readTasks[1]).toMatchObject({
        id: 'task_2',
        type: 'documentation',
        priority: 'medium',
        status: 'in_progress'
      });
    });

    test('handles concurrent task updates', async () => {
      const initialTasks = [
        { id: 'task_1', type: 'testing', status: 'pending' },
        { id: 'task_2', type: 'review', status: 'pending' }
      ];

      await fs.writeFile(tasksFile, JSON.stringify(initialTasks));

      // Simulate concurrent updates
      const updates = [
        (async () => {
          const tasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
          tasks[0].status = 'in_progress';
          tasks[0].started_at = new Date().toISOString();
          await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2));
        })(),
        (async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          const tasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
          tasks[1].status = 'in_progress';
          tasks[1].started_at = new Date().toISOString();
          await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2));
        })()
      ];

      await Promise.all(updates);

      const finalTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      expect(finalTasks).toHaveLength(2);
      expect(finalTasks.some(t => t.status === 'in_progress')).toBe(true);
    });

    test('validates task data integrity', async () => {
      const validTask = {
        id: 'task_valid',
        type: 'testing',
        priority: 'high',
        description: 'Valid task',
        files_pattern: '**/*.js',
        created_at: new Date().toISOString(),
        status: 'pending',
        metadata: {
          estimated_duration: 30,
          complexity: 'medium',
          dependencies: []
        }
      };

      await fs.writeFile(tasksFile, JSON.stringify([validTask], null, 2));
      const readTask = JSON.parse(await fs.readFile(tasksFile, 'utf8'))[0];

      // Validate all required fields are present
      expect(readTask).toHaveProperty('id');
      expect(readTask).toHaveProperty('type');
      expect(readTask).toHaveProperty('priority');
      expect(readTask).toHaveProperty('description');
      expect(readTask).toHaveProperty('status');
      expect(readTask).toHaveProperty('created_at');

      // Validate data types
      expect(typeof readTask.id).toBe('string');
      expect(typeof readTask.type).toBe('string');
      expect(typeof readTask.description).toBe('string');
      expect(['pending', 'in_progress', 'completed', 'failed', 'cancelled']).toContain(readTask.status);
      expect(['low', 'medium', 'high', 'critical']).toContain(readTask.priority);
    });

    test('handles malformed task data gracefully', async () => {
      const malformedTasks = [
        { id: 'task_1' }, // Missing required fields
        { type: 'testing', description: 'No ID' }, // Missing ID
        null, // Null task
        'invalid_task' // String instead of object
      ];

      await fs.writeFile(tasksFile, JSON.stringify(malformedTasks));

      // Should be able to read the file even with malformed data
      const tasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      expect(Array.isArray(tasks)).toBe(true);
      expect(tasks).toHaveLength(4);

      // Filter out valid tasks programmatically
      const validTasks = tasks.filter(task => 
        task && 
        typeof task === 'object' && 
        task.id && 
        typeof task.id === 'string'
      );

      expect(validTasks).toHaveLength(1);
      expect(validTasks[0].id).toBe('task_1');
    });
  });

  describe('Task Status File Operations', () => {
    test('tracks task status changes correctly', async () => {
      const statusData = {
        task_1: {
          status: 'completed',
          progress: 100,
          completed_at: new Date().toISOString(),
          result: 'success',
          execution_time: 45.6,
          output: 'Task completed successfully'
        },
        task_2: {
          status: 'in_progress',
          progress: 75,
          started_at: new Date().toISOString(),
          last_update: new Date().toISOString(),
          current_step: 'Running tests'
        }
      };

      await fs.writeFile(taskStatusFile, JSON.stringify(statusData, null, 2));

      const readStatus = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));

      expect(readStatus).toHaveProperty('task_1');
      expect(readStatus).toHaveProperty('task_2');
      expect(readStatus.task_1.status).toBe('completed');
      expect(readStatus.task_1.progress).toBe(100);
      expect(readStatus.task_2.status).toBe('in_progress');
      expect(readStatus.task_2.progress).toBe(75);
    });

    test('handles status updates for multiple tasks', async () => {
      // Initialize with empty status
      await fs.writeFile(taskStatusFile, JSON.stringify({}));

      // Update status for task 1
      let statusData = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
      statusData.task_1 = {
        status: 'in_progress',
        progress: 25,
        started_at: new Date().toISOString()
      };
      await fs.writeFile(taskStatusFile, JSON.stringify(statusData, null, 2));

      // Update status for task 2
      statusData = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
      statusData.task_2 = {
        status: 'pending',
        progress: 0,
        queued_at: new Date().toISOString()
      };
      await fs.writeFile(taskStatusFile, JSON.stringify(statusData, null, 2));

      // Update progress for task 1
      statusData = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
      statusData.task_1.progress = 50;
      statusData.task_1.last_update = new Date().toISOString();
      statusData.task_1.current_step = 'Processing files';
      await fs.writeFile(taskStatusFile, JSON.stringify(statusData, null, 2));

      const finalStatus = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
      expect(Object.keys(finalStatus)).toHaveLength(2);
      expect(finalStatus.task_1.progress).toBe(50);
      expect(finalStatus.task_1).toHaveProperty('current_step');
      expect(finalStatus.task_2.status).toBe('pending');
    });

    test('maintains status history and metadata', async () => {
      const complexStatus = {
        task_complex: {
          status: 'completed',
          progress: 100,
          created_at: '2023-01-01T10:00:00.000Z',
          started_at: '2023-01-01T10:05:00.000Z',
          completed_at: '2023-01-01T10:45:00.000Z',
          execution_time: 2400, // seconds
          result: 'success',
          output: 'All tests passed',
          error: null,
          steps_completed: [
            'Setup environment',
            'Run unit tests',
            'Run integration tests',
            'Generate report'
          ],
          metrics: {
            files_processed: 45,
            tests_run: 120,
            coverage_percent: 85.5,
            memory_usage_mb: 128
          },
          logs: [
            { timestamp: '2023-01-01T10:05:00.000Z', level: 'info', message: 'Task started' },
            { timestamp: '2023-01-01T10:15:00.000Z', level: 'info', message: 'Tests running' },
            { timestamp: '2023-01-01T10:45:00.000Z', level: 'info', message: 'Task completed' }
          ]
        }
      };

      await fs.writeFile(taskStatusFile, JSON.stringify(complexStatus, null, 2));

      const readStatus = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
      const task = readStatus.task_complex;

      expect(task).toHaveProperty('steps_completed');
      expect(task).toHaveProperty('metrics');
      expect(task).toHaveProperty('logs');
      expect(task.steps_completed).toHaveLength(4);
      expect(task.metrics.files_processed).toBe(45);
      expect(task.logs).toHaveLength(3);
      expect(task.logs[0]).toHaveProperty('timestamp');
      expect(task.logs[0]).toHaveProperty('level');
      expect(task.logs[0]).toHaveProperty('message');
    });
  });

  describe('Log File Operations', () => {
    test('creates and appends to log files correctly', async () => {
      const testLogFile = path.join(logsDir, 'test_integration.log');
      const logEntries = [
        '2023-01-01T10:00:00.000Z [INFO] Integration test started',
        '2023-01-01T10:01:00.000Z [DEBUG] Processing test data',
        '2023-01-01T10:02:00.000Z [WARN] Memory usage high',
        '2023-01-01T10:03:00.000Z [INFO] Integration test completed'
      ];

      // Create initial log file
      await fs.writeFile(testLogFile, logEntries[0] + '\n');

      // Append additional entries
      for (let i = 1; i < logEntries.length; i++) {
        await fs.appendFile(testLogFile, logEntries[i] + '\n');
      }

      const logContent = await fs.readFile(testLogFile, 'utf8');
      const lines = logContent.trim().split('\n');

      expect(lines).toHaveLength(4);
      expect(lines[0]).toBe(logEntries[0]);
      expect(lines[3]).toBe(logEntries[3]);
      expect(logContent).toContain('[INFO]');
      expect(logContent).toContain('[DEBUG]');
      expect(logContent).toContain('[WARN]');
    });

    test('handles multiple log files simultaneously', async () => {
      const logFiles = [
        path.join(logsDir, 'agent_1.log'),
        path.join(logsDir, 'agent_2.log'),
        path.join(logsDir, 'system.log')
      ];

      const writePromises = logFiles.map((file, index) => 
        fs.writeFile(file, `Log file ${index + 1} initialized\n`)
      );

      await Promise.all(writePromises);

      // Append to all files concurrently
      const appendPromises = logFiles.map((file, index) =>
        fs.appendFile(file, `Additional entry for log ${index + 1}\n`)
      );

      await Promise.all(appendPromises);

      // Verify all files were written correctly
      const readPromises = logFiles.map(file => fs.readFile(file, 'utf8'));
      const contents = await Promise.all(readPromises);

      contents.forEach((content, index) => {
        const lines = content.trim().split('\n');
        expect(lines).toHaveLength(2);
        expect(lines[0]).toBe(`Log file ${index + 1} initialized`);
        expect(lines[1]).toBe(`Additional entry for log ${index + 1}`);
      });
    });

    test('handles large log file operations efficiently', async () => {
      const largeLogFile = path.join(logsDir, 'large_test.log');
      const entryCount = 1000;
      
      const startTime = Date.now();

      // Write many entries
      let logContent = '';
      for (let i = 0; i < entryCount; i++) {
        logContent += `2023-01-01T10:${String(i % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z [INFO] Log entry ${i}\n`;
      }

      await fs.writeFile(largeLogFile, logContent);

      const writeTime = Date.now() - startTime;

      // Read and verify
      const readStartTime = Date.now();
      const readContent = await fs.readFile(largeLogFile, 'utf8');
      const readTime = Date.now() - readStartTime;

      const lines = readContent.trim().split('\n');
      expect(lines).toHaveLength(entryCount);
      expect(lines[0]).toContain('Log entry 0');
      expect(lines[entryCount - 1]).toContain('Log entry 999');

      // Performance expectations (should be reasonable)
      expect(writeTime).toBeLessThan(1000); // Less than 1 second
      expect(readTime).toBeLessThan(500);   // Less than 0.5 second
    });
  });

  describe('Data Consistency and Integrity', () => {
    test('maintains consistency between tasks and status files', async () => {
      const tasks = [
        { id: 'task_1', type: 'testing', status: 'in_progress' },
        { id: 'task_2', type: 'review', status: 'completed' },
        { id: 'task_3', type: 'documentation', status: 'pending' }
      ];

      const statuses = {
        task_1: { status: 'in_progress', progress: 50 },
        task_2: { status: 'completed', progress: 100 },
        task_3: { status: 'pending', progress: 0 }
      };

      await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2));
      await fs.writeFile(taskStatusFile, JSON.stringify(statuses, null, 2));

      const readTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      const readStatuses = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));

      // Verify consistency
      readTasks.forEach(task => {
        expect(readStatuses).toHaveProperty(task.id);
        expect(readStatuses[task.id].status).toBe(task.status);
      });

      Object.keys(readStatuses).forEach(taskId => {
        const task = readTasks.find(t => t.id === taskId);
        expect(task).toBeDefined();
        expect(task.status).toBe(readStatuses[taskId].status);
      });
    });

    test('handles file corruption gracefully', async () => {
      // Create corrupted JSON file
      await fs.writeFile(tasksFile, '{ invalid json content }');

      // Should handle corruption gracefully in application logic
      try {
        JSON.parse(await fs.readFile(tasksFile, 'utf8'));
        fail('Should have thrown JSON parse error');
      } catch (error) {
        expect(error).toBeInstanceOf(SyntaxError);
      }

      // Recovery: write valid data
      await fs.writeFile(tasksFile, JSON.stringify([]));
      const recovered = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
      expect(Array.isArray(recovered)).toBe(true);
      expect(recovered).toHaveLength(0);
    });

    test('handles concurrent file access safely', async () => {
      const initialTasks = [{ id: 'task_1', status: 'pending' }];
      await fs.writeFile(tasksFile, JSON.stringify(initialTasks));

      // Multiple concurrent readers
      const readPromises = Array(5).fill(0).map(() => 
        fs.readFile(tasksFile, 'utf8').then(data => JSON.parse(data))
      );

      const results = await Promise.all(readPromises);
      
      // All readers should get consistent data
      results.forEach(result => {
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('task_1');
      });
    });
  });

  describe('Directory Structure Management', () => {
    test('creates required directory structure', async () => {
      const newProjectDir = path.join(__dirname, 'fixtures', 'new-project');
      const newClaudeDir = path.join(newProjectDir, '.claude');
      const newLogsDir = path.join(newClaudeDir, 'logs');

      await fs.mkdir(newLogsDir, { recursive: true });

      const stats = await fs.stat(newClaudeDir);
      expect(stats.isDirectory()).toBe(true);

      const logStats = await fs.stat(newLogsDir);
      expect(logStats.isDirectory()).toBe(true);

      // Clean up
      await fs.rm(newProjectDir, { recursive: true, force: true });
    });

    test('handles missing directories gracefully', async () => {
      const missingDir = path.join(__dirname, 'fixtures', 'missing-project', '.claude');
      const missingFile = path.join(missingDir, 'tasks.json');

      // Attempt to read from missing directory should fail gracefully
      try {
        await fs.readFile(missingFile, 'utf8');
        fail('Should have thrown file not found error');
      } catch (error) {
        expect(error.code).toBe('ENOENT');
      }

      // Create directory and file should work
      await fs.mkdir(missingDir, { recursive: true });
      await fs.writeFile(missingFile, JSON.stringify([]));

      const content = JSON.parse(await fs.readFile(missingFile, 'utf8'));
      expect(Array.isArray(content)).toBe(true);

      // Clean up
      await fs.rm(path.join(__dirname, 'fixtures', 'missing-project'), { 
        recursive: true, 
        force: true 
      });
    });
  });
});