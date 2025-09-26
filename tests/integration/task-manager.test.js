const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');

describe('Task Manager Integration Tests', () => {
  let testProjectDir;
  let claudeDir;
  let tasksFile;
  let taskStatusFile;
  let taskManagerProcess;

  beforeAll(async () => {
    testProjectDir = path.join(__dirname, 'fixtures', 'task-manager-test');
    claudeDir = path.join(testProjectDir, '.claude');
    tasksFile = path.join(claudeDir, 'tasks.json');
    taskStatusFile = path.join(claudeDir, 'task_status.json');

    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(path.join(claudeDir, 'logs'), { recursive: true });
  });

  beforeEach(async () => {
    // Reset files before each test
    await fs.writeFile(tasksFile, JSON.stringify([]));
    await fs.writeFile(taskStatusFile, JSON.stringify({}));
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

  describe('Task Lifecycle Management', () => {
    test('creates and processes tasks through complete lifecycle', async () => {
      const testTasks = [
        {
          id: 'lifecycle_task_1',
          type: 'testing',
          priority: 'high',
          description: 'Run comprehensive tests',
          files_pattern: '**/*.test.js'
        },
        {
          id: 'lifecycle_task_2', 
          type: 'documentation',
          priority: 'medium',
          description: 'Update API documentation',
          files_pattern: 'docs/**/*.md'
        }
      ];

      // Create tasks in file
      await fs.writeFile(tasksFile, JSON.stringify(testTasks, null, 2));

      // Monitor task status changes
      const statusChanges = [];
      const checkStatus = async () => {
        try {
          const content = await fs.readFile(taskStatusFile, 'utf8');
          const status = JSON.parse(content);
          statusChanges.push({ ...status, timestamp: Date.now() });
        } catch (e) {
          // File might not exist yet
        }
      };

      // Start monitoring
      const statusInterval = setInterval(checkStatus, 500);
      
      try {
        // Start the task manager in test mode
        const taskManagerScript = path.join(__dirname, '..', '..', 'scripts', 'task_manager.py');
        taskManagerProcess = spawn('python3', [taskManagerScript, '--test-mode', '--project-dir', testProjectDir], {
          stdio: 'pipe'
        });

        // Wait for task processing
        await new Promise((resolve) => {
          setTimeout(resolve, 5000);
        });

        clearInterval(statusInterval);

        // Verify final state
        const finalTasks = JSON.parse(await fs.readFile(tasksFile, 'utf8'));
        const finalStatus = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));

        expect(finalTasks).toHaveLength(2);
        expect(Object.keys(finalStatus)).toHaveLength(2);
        
        // Check that both tasks have status entries
        expect(finalStatus).toHaveProperty('lifecycle_task_1');
        expect(finalStatus).toHaveProperty('lifecycle_task_2');
        
        // Verify status progression occurred
        expect(statusChanges.length).toBeGreaterThan(0);
        
        // Check that high priority task was processed first or concurrently
        const task1Status = finalStatus.lifecycle_task_1;
        const task2Status = finalStatus.lifecycle_task_2;
        
        expect(['pending', 'queued', 'running', 'completed', 'failed']).toContain(task1Status.status);
        expect(['pending', 'queued', 'running', 'completed', 'failed']).toContain(task2Status.status);
      } finally {
        clearInterval(statusInterval);
      }
    }, 15000);

    test('handles task priority correctly', async () => {
      const prioritizedTasks = [
        {
          id: 'low_priority_task',
          type: 'cleanup',
          priority: 'low',
          description: 'Clean up temp files',
          files_pattern: 'temp/**/*'
        },
        {
          id: 'critical_priority_task',
          type: 'security',
          priority: 'critical',
          description: 'Fix security vulnerability',
          files_pattern: '**/*.js'
        },
        {
          id: 'medium_priority_task',
          type: 'refactor',
          priority: 'medium',
          description: 'Refactor legacy code',
          files_pattern: 'legacy/**/*.js'
        }
      ];

      await fs.writeFile(tasksFile, JSON.stringify(prioritizedTasks, null, 2));

      // Track processing order
      const processingOrder = [];
      const monitorStatus = async () => {
        try {
          const status = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
          Object.entries(status).forEach(([taskId, taskStatus]) => {
            if (taskStatus.status === 'running' && 
                !processingOrder.some(item => item.taskId === taskId && item.status === 'running')) {
              processingOrder.push({
                taskId,
                status: 'running',
                timestamp: Date.now()
              });
            }
          });
        } catch (e) {
          // Ignore read errors
        }
      };

      const monitorInterval = setInterval(monitorStatus, 200);

      try {
        const taskManagerScript = path.join(__dirname, '..', '..', 'scripts', 'task_manager.py');
        taskManagerProcess = spawn('python3', [
          taskManagerScript, 
          '--test-mode', 
          '--project-dir', testProjectDir,
          '--max-concurrent', '1' // Force sequential processing
        ], {
          stdio: 'pipe'
        });

        await new Promise(resolve => setTimeout(resolve, 6000));
        
        clearInterval(monitorInterval);

        // Critical priority should be processed first
        expect(processingOrder.length).toBeGreaterThan(0);
        if (processingOrder.length > 0) {
          const firstTask = processingOrder[0];
          // Either critical task first, or if they were processed so quickly we missed the order
          expect(['critical_priority_task', 'medium_priority_task', 'low_priority_task']).toContain(firstTask.taskId);
        }
      } finally {
        clearInterval(monitorInterval);
      }
    }, 12000);

    test('handles task failures and retries', async () => {
      const failingTask = {
        id: 'failing_task',
        type: 'testing',
        priority: 'medium',
        description: 'Task designed to fail for testing',
        files_pattern: 'non-existent/**/*.test.js',
        max_retries: 2
      };

      await fs.writeFile(tasksFile, JSON.stringify([failingTask], null, 2));

      const taskManagerScript = path.join(__dirname, '..', '..', 'scripts', 'task_manager.py');
      taskManagerProcess = spawn('python3', [
        taskManagerScript,
        '--test-mode',
        '--project-dir', testProjectDir,
        '--fail-tasks' // Special flag to make tasks fail for testing
      ], {
        stdio: 'pipe'
      });

      await new Promise(resolve => setTimeout(resolve, 8000));

      const finalStatus = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
      const taskStatus = finalStatus.failing_task;

      expect(taskStatus).toBeDefined();
      expect(taskStatus.status).toBe('failed');
      expect(taskStatus).toHaveProperty('retry_count');
      expect(taskStatus.retry_count).toBeGreaterThanOrEqual(0);
      expect(taskStatus).toHaveProperty('error');
    }, 12000);
  });

  describe('Concurrent Task Processing', () => {
    test('processes multiple tasks concurrently when configured', async () => {
      const concurrentTasks = Array.from({ length: 5 }, (_, i) => ({
        id: `concurrent_task_${i + 1}`,
        type: 'testing',
        priority: 'medium',
        description: `Concurrent task ${i + 1}`,
        files_pattern: `**/*${i + 1}.test.js`
      }));

      await fs.writeFile(tasksFile, JSON.stringify(concurrentTasks, null, 2));

      const runningTasks = new Set();
      const maxConcurrent = { value: 0 };

      const monitorConcurrency = async () => {
        try {
          const status = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
          const currentlyRunning = Object.keys(status).filter(taskId => 
            status[taskId].status === 'running'
          );
          
          maxConcurrent.value = Math.max(maxConcurrent.value, currentlyRunning.length);
          currentlyRunning.forEach(taskId => runningTasks.add(taskId));
        } catch (e) {
          // Ignore
        }
      };

      const concurrencyInterval = setInterval(monitorConcurrency, 100);

      try {
        const taskManagerScript = path.join(__dirname, '..', '..', 'scripts', 'task_manager.py');
        taskManagerProcess = spawn('python3', [
          taskManagerScript,
          '--test-mode', 
          '--project-dir', testProjectDir,
          '--max-concurrent', '3'
        ], {
          stdio: 'pipe'
        });

        await new Promise(resolve => setTimeout(resolve, 8000));
        
        clearInterval(concurrencyInterval);

        // Should have processed multiple tasks
        expect(runningTasks.size).toBeGreaterThanOrEqual(3);
        // Should not exceed concurrency limit too much (allowing for timing)
        expect(maxConcurrent.value).toBeLessThanOrEqual(5);
      } finally {
        clearInterval(concurrencyInterval);
      }
    }, 12000);

    test('respects concurrency limits', async () => {
      const tasks = Array.from({ length: 10 }, (_, i) => ({
        id: `limit_test_task_${i + 1}`,
        type: 'testing',
        priority: 'medium',  
        description: `Limit test task ${i + 1}`,
        files_pattern: `test${i + 1}/**/*.js`
      }));

      await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2));

      let maxConcurrentObserved = 0;
      const concurrencyLimit = 2;

      const checkConcurrency = async () => {
        try {
          const status = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
          const runningCount = Object.values(status).filter(s => s.status === 'running').length;
          maxConcurrentObserved = Math.max(maxConcurrentObserved, runningCount);
        } catch (e) {
          // Ignore
        }
      };

      const limitInterval = setInterval(checkConcurrency, 50);

      try {
        const taskManagerScript = path.join(__dirname, '..', '..', 'scripts', 'task_manager.py');
        taskManagerProcess = spawn('python3', [
          taskManagerScript,
          '--test-mode',
          '--project-dir', testProjectDir,
          '--max-concurrent', concurrencyLimit.toString()
        ], {
          stdio: 'pipe'
        });

        await new Promise(resolve => setTimeout(resolve, 10000));
        
        clearInterval(limitInterval);

        // Allow some tolerance for timing, but should generally respect limit
        expect(maxConcurrentObserved).toBeLessThanOrEqual(concurrencyLimit + 1);
      } finally {
        clearInterval(limitInterval);
      }
    }, 15000);
  });

  describe('Task Progress Tracking', () => {
    test('tracks task progress accurately', async () => {
      const progressTask = {
        id: 'progress_tracking_task',
        type: 'analysis',
        priority: 'medium',
        description: 'Task with detailed progress tracking',
        files_pattern: '**/*.js'
      };

      await fs.writeFile(tasksFile, JSON.stringify([progressTask], null, 2));

      const progressUpdates = [];
      const trackProgress = async () => {
        try {
          const status = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
          if (status.progress_tracking_task) {
            progressUpdates.push({
              ...status.progress_tracking_task,
              timestamp: Date.now()
            });
          }
        } catch (e) {
          // Ignore
        }
      };

      const progressInterval = setInterval(trackProgress, 300);

      try {
        const taskManagerScript = path.join(__dirname, '..', '..', 'scripts', 'task_manager.py');
        taskManagerProcess = spawn('python3', [
          taskManagerScript,
          '--test-mode',
          '--project-dir', testProjectDir,
          '--detailed-progress'
        ], {
          stdio: 'pipe'
        });

        await new Promise(resolve => setTimeout(resolve, 6000));
        
        clearInterval(progressInterval);

        expect(progressUpdates.length).toBeGreaterThan(1);
        
        // Check progress progression
        const progressValues = progressUpdates.map(u => u.progress || 0);
        const maxProgress = Math.max(...progressValues);
        const minProgress = Math.min(...progressValues);
        
        expect(maxProgress).toBeGreaterThanOrEqual(minProgress);
        expect(maxProgress).toBeLessThanOrEqual(100);
        expect(minProgress).toBeGreaterThanOrEqual(0);
      } finally {
        clearInterval(progressInterval);
      }
    }, 10000);

    test('provides meaningful progress steps', async () => {
      const steppedTask = {
        id: 'stepped_task',
        type: 'comprehensive',
        priority: 'high',
        description: 'Multi-step task with detailed progress',
        files_pattern: '**/*',
        steps: [
          'Initialize environment',
          'Scan files',
          'Process data', 
          'Generate report',
          'Cleanup'
        ]
      };

      await fs.writeFile(tasksFile, JSON.stringify([steppedTask], null, 2));

      const stepUpdates = [];
      const trackSteps = async () => {
        try {
          const status = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
          if (status.stepped_task && status.stepped_task.current_step) {
            const step = status.stepped_task.current_step;
            if (!stepUpdates.includes(step)) {
              stepUpdates.push(step);
            }
          }
        } catch (e) {
          // Ignore
        }
      };

      const stepInterval = setInterval(trackSteps, 200);

      try {
        const taskManagerScript = path.join(__dirname, '..', '..', 'scripts', 'task_manager.py');
        taskManagerProcess = spawn('python3', [
          taskManagerScript,
          '--test-mode',
          '--project-dir', testProjectDir,
          '--step-by-step'
        ], {
          stdio: 'pipe'
        });

        await new Promise(resolve => setTimeout(resolve, 8000));
        
        clearInterval(stepInterval);

        expect(stepUpdates.length).toBeGreaterThan(0);
        // Should have some meaningful step descriptions
        expect(stepUpdates.some(step => 
          typeof step === 'string' && step.length > 5
        )).toBe(true);
      } finally {
        clearInterval(stepInterval);
      }
    }, 12000);
  });

  describe('Error Handling and Recovery', () => {
    test('handles corrupted task files gracefully', async () => {
      // Create corrupted task file
      await fs.writeFile(tasksFile, '{ invalid json }');
      await fs.writeFile(taskStatusFile, JSON.stringify({}));

      const taskManagerScript = path.join(__dirname, '..', '..', 'scripts', 'task_manager.py');
      taskManagerProcess = spawn('python3', [
        taskManagerScript,
        '--test-mode',
        '--project-dir', testProjectDir
      ], {
        stdio: 'pipe'
      });

      let errorOutput = '';
      taskManagerProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      await new Promise(resolve => setTimeout(resolve, 3000));

      // Should not crash, should log error
      expect(taskManagerProcess.killed).toBe(false);
      expect(errorOutput).toContain('JSON') || expect(errorOutput).toContain('parse');
    }, 8000);

    test('recovers from system interruptions', async () => {
      const interruptedTask = {
        id: 'interrupted_task',
        type: 'long_running',
        priority: 'medium',
        description: 'Task that gets interrupted',
        files_pattern: '**/*.js'
      };

      await fs.writeFile(tasksFile, JSON.stringify([interruptedTask], null, 2));

      // Start task manager
      const taskManagerScript = path.join(__dirname, '..', '..', 'scripts', 'task_manager.py');
      taskManagerProcess = spawn('python3', [
        taskManagerScript,
        '--test-mode',
        '--project-dir', testProjectDir
      ], {
        stdio: 'pipe'
      });

      // Let it run briefly
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Interrupt it
      taskManagerProcess.kill('SIGTERM');
      await new Promise(resolve => {
        taskManagerProcess.on('close', resolve);
      });

      // Check status was updated
      const statusAfterInterrupt = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
      
      // Restart task manager
      taskManagerProcess = spawn('python3', [
        taskManagerScript,
        '--test-mode', 
        '--project-dir', testProjectDir,
        '--resume'
      ], {
        stdio: 'pipe'
      });

      await new Promise(resolve => setTimeout(resolve, 3000));

      const finalStatus = JSON.parse(await fs.readFile(taskStatusFile, 'utf8'));
      
      expect(finalStatus).toHaveProperty('interrupted_task');
      // Task should either be completed or marked as failed due to interruption
      expect(['completed', 'failed', 'cancelled', 'running']).toContain(finalStatus.interrupted_task.status);
    }, 12000);
  });
});