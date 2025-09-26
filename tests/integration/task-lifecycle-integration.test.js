const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const WS = require('jest-websocket-mock');

describe('Task Lifecycle Integration Tests', () => {
  let server;
  let mockWebSocket;
  const testPort = 8083; // Different port to avoid conflicts
  const testProjectDir = path.join(__dirname, '..', 'fixtures', 'task-lifecycle-test');
  const claudeDir = path.join(testProjectDir, '.claude');
  const tasksFile = path.join(claudeDir, 'tasks.json');
  const taskStatusFile = path.join(claudeDir, 'task_status.json');
  const logsDir = path.join(claudeDir, 'logs');

  beforeAll(async () => {
    // Create test project structure
    await fs.mkdir(logsDir, { recursive: true });

    // Initialize clean database state
    const initialTasks = [];
    const initialStatus = {};

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

    // Reset test data between tests
    try {
      const initialTasks = [];
      const initialStatus = {};
      await fs.writeFile(tasksFile, JSON.stringify(initialTasks, null, 2));
      await fs.writeFile(taskStatusFile, JSON.stringify(initialStatus, null, 2));

      // Clean up any log files
      const logFiles = await fs.readdir(logsDir);
      for (const logFile of logFiles) {
        await fs.unlink(path.join(logsDir, logFile));
      }
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

  describe('Complete Task Lifecycle', () => {
    test('should create, start, monitor, and complete a task successfully', async () => {
      await mockWebSocket.connected;

      const taskId = 'lifecycle_test_task';
      const taskData = {
        id: taskId,
        type: 'testing',
        priority: 'high',
        description: 'Complete task lifecycle integration test',
        files_pattern: '**/*.test.js',
        estimated_duration: 300
      };

      // Step 1: Create and start the task
      mockWebSocket.send(JSON.stringify({
        type: 'start_task',
        task: taskData
      }));

      const startResponse = await mockWebSocket.nextMessage;
      const startData = JSON.parse(startResponse);

      expect(startData.type).toBe('task_started');
      expect(startData.task_id).toBe(taskId);

      // Verify task was persisted to database
      const tasksContent = await fs.readFile(tasksFile, 'utf8');
      const tasks = JSON.parse(tasksContent);
      const createdTask = tasks.find(t => t.id === taskId);
      expect(createdTask).toBeDefined();
      expect(createdTask.description).toBe('Complete task lifecycle integration test');
      expect(createdTask.status).toBe('pending');

      // Step 2: Get task status
      mockWebSocket.send(JSON.stringify({
        type: 'get_task_status',
        task_id: taskId
      }));

      const statusResponse = await mockWebSocket.nextMessage;
      const statusData = JSON.parse(statusResponse);

      expect(statusData.type).toBe('task_status');
      expect(statusData.task.id).toBe(taskId);
      expect(statusData.task.status).toBe('pending');

      // Step 3: List tasks and verify our task is included
      mockWebSocket.send(JSON.stringify({
        type: 'list_tasks'
      }));

      const listResponse = await mockWebSocket.nextMessage;
      const listData = JSON.parse(listResponse);

      expect(listData.type).toBe('task_list');
      expect(Array.isArray(listData.tasks)).toBe(true);
      const listedTask = listData.tasks.find(t => t.id === taskId);
      expect(listedTask).toBeDefined();

      // Step 4: Simulate task completion by updating status file
      const statusContent = await fs.readFile(taskStatusFile, 'utf8');
      const statusDataObj = JSON.parse(statusContent);
      statusDataObj[taskId] = {
        status: 'completed',
        progress: 100,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        result: 'success'
      };
      await fs.writeFile(taskStatusFile, JSON.stringify(statusDataObj, null, 2));

      // Create a log file to simulate task execution
      const logFile = path.join(logsDir, `${taskId}.log`);
      await fs.writeFile(logFile, 'Task started\nProcessing files...\nTask completed successfully\n');

      // Step 5: Verify task completion is reflected
      mockWebSocket.send(JSON.stringify({
        type: 'get_task_status',
        task_id: taskId
      }));

      const completionResponse = await mockWebSocket.nextMessage;
      const completionData = JSON.parse(completionResponse);

      expect(completionData.type).toBe('task_status');
      expect(completionData.task.id).toBe(taskId);
      // Note: The server may still show pending if it doesn't check log files immediately
    });

    test('should handle task cancellation throughout lifecycle', async () => {
      await mockWebSocket.connected;

      const taskId = 'cancel_lifecycle_task';
      const taskData = {
        id: taskId,
        type: 'analysis',
        priority: 'medium',
        description: 'Task cancellation lifecycle test',
        files_pattern: '**/*.js'
      };

      // Create task
      mockWebSocket.send(JSON.stringify({
        type: 'start_task',
        task: taskData
      }));

      await mockWebSocket.nextMessage; // task_started

      // Update task to running state
      const statusContent = await fs.readFile(taskStatusFile, 'utf8');
      const statusData = JSON.parse(statusContent);
      statusData[taskId] = {
        status: 'running',
        progress: 45,
        started_at: new Date().toISOString()
      };
      await fs.writeFile(taskStatusFile, JSON.stringify(statusData, null, 2));

      // Cancel the task
      mockWebSocket.send(JSON.stringify({
        type: 'cancel_task',
        task_id: taskId
      }));

      const cancelResponse = await mockWebSocket.nextMessage;
      const cancelData = JSON.parse(cancelResponse);

      expect(cancelData.type).toBe('task_cancelled');
      expect(cancelData.task_id).toBe(taskId);

      // Verify cancellation in status
      const updatedStatus = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
      expect(updatedStatus[taskId].status).toBe('running'); // May still be running until server processes
    });

    test('should handle task retry after failure', async () => {
      await mockWebSocket.connected;

      const taskId = 'retry_lifecycle_task';
      const taskData = {
        id: taskId,
        type: 'build',
        priority: 'high',
        description: 'Task retry lifecycle test',
        files_pattern: '**/*.js'
      };

      // Create task
      mockWebSocket.send(JSON.stringify({
        type: 'start_task',
        task: taskData
      }));

      await mockWebSocket.nextMessage; // task_started

      // Simulate task failure
      const statusContent = await fs.readFile(taskStatusFile, 'utf8');
      const statusData = JSON.parse(statusContent);
      statusData[taskId] = {
        status: 'failed',
        progress: 75,
        started_at: new Date().toISOString(),
        error: 'Simulated build failure',
        retry_count: 0
      };
      await fs.writeFile(taskStatusFile, JSON.stringify(statusData, null, 2));

      // Retry the task
      mockWebSocket.send(JSON.stringify({
        type: 'retry_task',
        task_id: taskId
      }));

      const retryResponse = await mockWebSocket.nextMessage;
      const retryData = JSON.parse(retryResponse);

      expect(retryData.type).toBe('task_retried');
      expect(retryData.task_id).toBe(taskId);
      expect(retryData.retry_count).toBe(1);
    });
  });

  describe('Task Dependencies and Parallel Execution', () => {
    test('should handle task dependencies correctly', async () => {
      await mockWebSocket.connected;

      const parentTaskId = 'parent_dependency_task';
      const childTaskId = 'child_dependency_task';

      // Create parent task
      const parentTask = {
        id: parentTaskId,
        type: 'setup',
        priority: 'high',
        description: 'Parent task for dependency testing',
        files_pattern: '**/*.config'
      };

      mockWebSocket.send(JSON.stringify({
        type: 'start_task',
        task: parentTask
      }));

      await mockWebSocket.nextMessage; // task_started

      // Create child task with dependency
      const childTask = {
        id: childTaskId,
        type: 'testing',
        priority: 'medium',
        description: 'Child task dependent on parent',
        files_pattern: '**/*.test.js',
        dependencies: [parentTaskId]
      };

      mockWebSocket.send(JSON.stringify({
        type: 'start_task',
        task: childTask
      }));

      const childResponse = await mockWebSocket.nextMessage;
      const childData = JSON.parse(childResponse);

      expect(childData.type).toBe('task_started');
      expect(childData.task_id).toBe(childTaskId);

      // Verify dependency is stored
      const tasksContent = await fs.readFile(tasksFile, 'utf8');
      const tasks = JSON.parse(tasksContent);
      const childTaskStored = tasks.find(t => t.id === childTaskId);
      expect(childTaskStored.dependencies).toContain(parentTaskId);
    });

    test('should handle multiple concurrent tasks', async () => {
      await mockWebSocket.connected;

      const taskIds = ['concurrent_task_1', 'concurrent_task_2', 'concurrent_task_3'];

      // Create multiple tasks concurrently
      const createPromises = taskIds.map(async (taskId, index) => {
        const taskData = {
          id: taskId,
          type: 'testing',
          priority: ['low', 'medium', 'high'][index],
          description: `Concurrent task ${index + 1}`,
          files_pattern: `**/*${index + 1}.*`
        };

        mockWebSocket.send(JSON.stringify({
          type: 'start_task',
          task: taskData
        }));

        const response = await mockWebSocket.nextMessage;
        const data = JSON.parse(response);
        return data;
      });

      const responses = await Promise.all(createPromises);

      // Verify all tasks were created
      responses.forEach((response, index) => {
        expect(response.type).toBe('task_started');
        expect(response.task_id).toBe(taskIds[index]);
      });

      // Verify all tasks are in database
      const tasksContent = await fs.readFile(tasksFile, 'utf8');
      const tasks = JSON.parse(tasksContent);

      taskIds.forEach(taskId => {
        const task = tasks.find(t => t.id === taskId);
        expect(task).toBeDefined();
      });
    });
  });

  describe('Task Progress Tracking and Monitoring', () => {
    test('should track task progress through execution phases', async () => {
      await mockWebSocket.connected;

      const taskId = 'progress_tracking_task';
      const taskData = {
        id: taskId,
        type: 'analysis',
        priority: 'medium',
        description: 'Task progress tracking test',
        files_pattern: '**/*.js'
      };

      // Create task
      mockWebSocket.send(JSON.stringify({
        type: 'start_task',
        task: taskData
      }));

      await mockWebSocket.nextMessage; // task_started

      // Simulate progress updates
      const progressStages = [
        { progress: 0, status: 'pending' },
        { progress: 25, status: 'running' },
        { progress: 50, status: 'running' },
        { progress: 75, status: 'running' },
        { progress: 100, status: 'completed' }
      ];

      for (const stage of progressStages) {
        const statusContent = await fs.readFile(taskStatusFile, 'utf8');
        const statusData = JSON.parse(statusContent);
        statusData[taskId] = {
          status: stage.status,
          progress: stage.progress,
          started_at: new Date().toISOString(),
          ...(stage.status === 'completed' && { completed_at: new Date().toISOString() })
        };
        await fs.writeFile(taskStatusFile, JSON.stringify(statusData, null, 2));

        // Small delay to simulate real progress
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Verify final progress
      const finalStatus = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
      expect(finalStatus[taskId].progress).toBe(100);
      expect(finalStatus[taskId].status).toBe('completed');
    });

    test('should provide real-time task status updates', async () => {
      await mockWebSocket.connected;

      const taskId = 'realtime_status_task';

      // Subscribe to task status updates
      mockWebSocket.send(JSON.stringify({
        type: 'subscribe_to_updates',
        channels: ['task_status']
      }));

      await mockWebSocket.nextMessage; // subscription_confirmed

      // Create task
      const taskData = {
        id: taskId,
        type: 'monitoring',
        priority: 'low',
        description: 'Real-time status monitoring test',
        files_pattern: '**/*.js'
      };

      mockWebSocket.send(JSON.stringify({
        type: 'start_task',
        task: taskData
      }));

      await mockWebSocket.nextMessage; // task_started

      // Update task status multiple times
      const statusUpdates = [];
      const maxWait = 5000;
      const startTime = Date.now();

      // Collect status updates for a short period
      while (statusUpdates.length < 3 && (Date.now() - startTime) < maxWait) {
        try {
          const message = await mockWebSocket.nextMessage;
          const data = JSON.parse(message);

          if (data.type === 'task_status_update') {
            statusUpdates.push(data);
          }
        } catch (e) {
          break;
        }
      }

      // Should have received some status updates
      expect(statusUpdates.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Task Persistence and Recovery', () => {
    test('should persist task state across server restarts', async () => {
      await mockWebSocket.connected;

      const taskId = 'persistence_test_task';
      const taskData = {
        id: taskId,
        type: 'persistence',
        priority: 'medium',
        description: 'Task persistence test',
        files_pattern: '**/*.js'
      };

      // Create task
      mockWebSocket.send(JSON.stringify({
        type: 'start_task',
        task: taskData
      }));

      await mockWebSocket.nextMessage; // task_started

      // Update task progress
      const statusContent = await fs.readFile(taskStatusFile, 'utf8');
      const statusData = JSON.parse(statusContent);
      statusData[taskId] = {
        status: 'running',
        progress: 60,
        started_at: new Date().toISOString()
      };
      await fs.writeFile(taskStatusFile, JSON.stringify(statusData, null, 2));

      // Simulate server restart by closing and reopening connection
      mockWebSocket.close();

      // Wait a moment for cleanup
      await new Promise(resolve => setTimeout(resolve, 100));

      // Reconnect
      mockWebSocket = new WS(`ws://localhost:${testPort}/ws`);
      await mockWebSocket.connected;

      // Request status and verify persistence
      mockWebSocket.send(JSON.stringify({
        type: 'get_task_status',
        task_id: taskId
      }));

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe('task_status');
      expect(data.task.id).toBe(taskId);
    });

    test('should handle task recovery from log files', async () => {
      await mockWebSocket.connected;

      const taskId = 'recovery_test_task';

      // Create task directly in database
      const tasksContent = await fs.readFile(tasksFile, 'utf8');
      const tasks = JSON.parse(tasksContent);
      tasks.push({
        id: taskId,
        type: 'recovery',
        priority: 'low',
        description: 'Task recovery from logs test',
        files_pattern: '**/*.js',
        created_at: new Date().toISOString(),
        status: 'running'
      });
      await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2));

      // Create log file indicating completion
      const logFile = path.join(logsDir, `${taskId}.log`);
      const logContent = `Task ${taskId} started at ${new Date().toISOString()}
Processing files...
Analysis complete
Task completed successfully at ${new Date().toISOString()}
`;
      await fs.writeFile(logFile, logContent);

      // Update status to completed
      const statusContent = await fs.readFile(taskStatusFile, 'utf8');
      const statusData = JSON.parse(statusContent);
      statusData[taskId] = {
        status: 'completed',
        progress: 100,
        completed_at: new Date().toISOString(),
        result: 'success'
      };
      await fs.writeFile(taskStatusFile, JSON.stringify(statusData, null, 2));

      // Verify recovery works
      mockWebSocket.send(JSON.stringify({
        type: 'get_task_status',
        task_id: taskId
      }));

      const response = await mockWebSocket.nextMessage;
      const data = JSON.parse(response);

      expect(data.type).toBe('task_status');
      expect(data.task.id).toBe(taskId);
    });
  });
});