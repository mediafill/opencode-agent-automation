const { spawn } = require("child_process");
const fs = require("fs").promises;
const path = require("path");

describe("Enhanced Task Management Integration Tests", () => {
  let testProjectDir;
  let claudeDir;
  let tasksFile;
  let taskStatusFile;
  let logsDir;
  let taskManagerProcess;

  beforeAll(async () => {
    testProjectDir = path.join(
      __dirname,
      "fixtures",
      "enhanced-task-management-test",
    );
    claudeDir = path.join(testProjectDir, ".claude");
    tasksFile = path.join(claudeDir, "tasks.json");
    taskStatusFile = path.join(claudeDir, "task_status.json");
    logsDir = path.join(claudeDir, "logs");

    await fs.mkdir(logsDir, { recursive: true });
  });

  beforeEach(async () => {
    // Initialize with complex task dependency structure
    const initialTasks = [
      {
        id: "base_task",
        type: "setup",
        priority: "high",
        description: "Base setup task",
        files_pattern: "**/*.config",
        created_at: new Date().toISOString(),
        status: "completed",
        metadata: {
          estimated_duration: 120,
          complexity: "low",
          dependencies: [],
        },
      },
      {
        id: "dependent_task_1",
        type: "testing",
        priority: "high",
        description: "Task dependent on base_task",
        files_pattern: "**/*.test.js",
        created_at: new Date().toISOString(),
        status: "pending",
        metadata: {
          estimated_duration: 300,
          complexity: "medium",
          dependencies: ["base_task"],
        },
      },
      {
        id: "dependent_task_2",
        type: "analysis",
        priority: "medium",
        description: "Task dependent on dependent_task_1",
        files_pattern: "**/*.js",
        created_at: new Date().toISOString(),
        status: "pending",
        metadata: {
          estimated_duration: 600,
          complexity: "high",
          dependencies: ["dependent_task_1"],
        },
      },
      {
        id: "parallel_task_1",
        type: "build",
        priority: "medium",
        description: "Parallel task independent of others",
        files_pattern: "**/*.build",
        created_at: new Date().toISOString(),
        status: "pending",
        metadata: {
          estimated_duration: 180,
          complexity: "medium",
          dependencies: [],
        },
      },
      {
        id: "parallel_task_2",
        type: "deploy",
        priority: "low",
        description: "Another parallel task",
        files_pattern: "**/*.deploy",
        created_at: new Date().toISOString(),
        status: "pending",
        metadata: {
          estimated_duration: 240,
          complexity: "low",
          dependencies: [],
        },
      },
    ];

    const initialStatus = {};
    initialTasks.forEach((task) => {
      initialStatus[task.id] = {
        status: task.status,
        progress: task.status === "completed" ? 100 : 0,
        created_at: task.created_at,
        ...(task.status === "completed" && { completed_at: task.created_at }),
      };
    });

    await fs.writeFile(tasksFile, JSON.stringify(initialTasks, null, 2));
    await fs.writeFile(taskStatusFile, JSON.stringify(initialStatus, null, 2));
  });

  afterEach(async () => {
    if (taskManagerProcess && !taskManagerProcess.killed) {
      taskManagerProcess.kill("SIGTERM");
      await new Promise((resolve) => {
        taskManagerProcess.on("close", resolve);
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

  describe("Task Dependencies and DAG Management", () => {
    test("resolves task dependencies correctly", async () => {
      const tasks = JSON.parse(await fs.readFile(tasksFile, "utf8"));

      // Build dependency graph
      const dependencyGraph = {};
      const reverseDeps = {};

      tasks.forEach((task) => {
        dependencyGraph[task.id] = task.metadata.dependencies || [];
        task.metadata.dependencies.forEach((dep) => {
          if (!reverseDeps[dep]) reverseDeps[dep] = [];
          reverseDeps[dep].push(task.id);
        });
      });

      // Verify dependency relationships
      expect(dependencyGraph["dependent_task_1"]).toEqual(["base_task"]);
      expect(dependencyGraph["dependent_task_2"]).toEqual(["dependent_task_1"]);
      expect(dependencyGraph["parallel_task_1"]).toEqual([]);
      expect(dependencyGraph["parallel_task_2"]).toEqual([]);

      // Check reverse dependencies
      expect(reverseDeps["base_task"]).toEqual(["dependent_task_1"]);
      expect(reverseDeps["dependent_task_1"]).toEqual(["dependent_task_2"]);

      // Test topological sort
      const visited = new Set();
      const tempVisited = new Set();
      const order = [];

      function visit(taskId) {
        if (tempVisited.has(taskId)) {
          throw new Error("Circular dependency detected");
        }
        if (visited.has(taskId)) {
          return;
        }

        tempVisited.add(taskId);

        dependencyGraph[taskId].forEach((dep) => visit(dep));

        tempVisited.delete(taskId);
        visited.add(taskId);
        order.push(taskId);
      }

      // Visit all tasks
      Object.keys(dependencyGraph).forEach((taskId) => {
        if (!visited.has(taskId)) {
          visit(taskId);
        }
      });

      // Verify execution order (base_task should come before dependent tasks)
      const baseTaskIndex = order.indexOf("base_task");
      const dep1Index = order.indexOf("dependent_task_1");
      const dep2Index = order.indexOf("dependent_task_2");

      expect(baseTaskIndex).toBeLessThan(dep1Index);
      expect(dep1Index).toBeLessThan(dep2Index);
    });

    test("handles circular dependencies gracefully", async () => {
      const tasks = JSON.parse(await fs.readFile(tasksFile, "utf8"));

      // Create circular dependency
      const circularTasks = [
        ...tasks,
        {
          id: "circular_task_a",
          type: "test",
          priority: "medium",
          description: "Task A in circular dependency",
          files_pattern: "**/*.a",
          created_at: new Date().toISOString(),
          status: "pending",
          metadata: {
            dependencies: ["circular_task_b"],
          },
        },
        {
          id: "circular_task_b",
          type: "test",
          priority: "medium",
          description: "Task B in circular dependency",
          files_pattern: "**/*.b",
          created_at: new Date().toISOString(),
          status: "pending",
          metadata: {
            dependencies: ["circular_task_a"],
          },
        },
      ];

      await fs.writeFile(tasksFile, JSON.stringify(circularTasks, null, 2));

      // Test cycle detection
      const dependencyGraph = {};
      circularTasks.forEach((task) => {
        dependencyGraph[task.id] = task.metadata.dependencies || [];
      });

      function hasCycle() {
        const visited = new Set();
        const recStack = new Set();

        function dfs(node) {
          if (recStack.has(node)) return true;
          if (visited.has(node)) return false;

          visited.add(node);
          recStack.add(node);

          for (const neighbor of dependencyGraph[node] || []) {
            if (dfs(neighbor)) return true;
          }

          recStack.delete(node);
          return false;
        }

        for (const node of Object.keys(dependencyGraph)) {
          if (dfs(node)) return true;
        }
        return false;
      }

      expect(hasCycle()).toBe(true);

      // Should handle circular dependency by breaking the cycle
      // (In a real system, this might involve marking tasks as blocked)
      const resolvedTasks = circularTasks.map((task) => ({
        ...task,
        status: task.metadata.dependencies.some((dep) =>
          circularTasks
            .find((t) => t.id === dep)
            ?.metadata.dependencies.includes(task.id),
        )
          ? "blocked"
          : task.status,
      }));

      const blockedTasks = resolvedTasks.filter((t) => t.status === "blocked");
      expect(blockedTasks.length).toBeGreaterThan(0);
    });

    test("manages complex dependency chains", async () => {
      // Create a complex dependency structure
      const complexTasks = [
        // Level 0 (no dependencies)
        { id: "task_a", dependencies: [] },
        { id: "task_b", dependencies: [] },

        // Level 1 (depends on level 0)
        { id: "task_c", dependencies: ["task_a"] },
        { id: "task_d", dependencies: ["task_b"] },
        { id: "task_e", dependencies: ["task_a", "task_b"] },

        // Level 2 (depends on level 1)
        { id: "task_f", dependencies: ["task_c", "task_d"] },
        { id: "task_g", dependencies: ["task_e"] },

        // Level 3 (depends on level 2)
        { id: "task_h", dependencies: ["task_f", "task_g"] },
      ];

      // Complete all tasks with proper structure
      const fullComplexTasks = complexTasks.map((task) => ({
        id: task.id,
        type: "complex_test",
        priority: "medium",
        description: `Complex task ${task.id}`,
        files_pattern: `**/*${task.id}.*`,
        created_at: new Date().toISOString(),
        status: "pending",
        metadata: {
          estimated_duration: 60,
          complexity: "medium",
          dependencies: task.dependencies,
        },
      }));

      await fs.writeFile(tasksFile, JSON.stringify(fullComplexTasks, null, 2));

      // Test dependency resolution
      function getExecutableTasks(completedTasks) {
        const completedSet = new Set(completedTasks);
        return fullComplexTasks.filter(
          (task) =>
            task.metadata.dependencies.every((dep) => completedSet.has(dep)) &&
            !completedSet.has(task.id),
        );
      }

      // Simulate execution order
      const executionOrder = [];
      let completed = ["task_a", "task_b"]; // Start with level 0 complete

      while (completed.length < fullComplexTasks.length) {
        const executable = getExecutableTasks(completed);
        expect(executable.length).toBeGreaterThan(0); // Should always have executable tasks

        // Execute all executable tasks
        executable.forEach((task) => {
          executionOrder.push(task.id);
          completed.push(task.id);
        });
      }

      // Verify execution order respects dependencies
      const taskIndices = {};
      executionOrder.forEach((taskId, index) => {
        taskIndices[taskId] = index;
      });

      // Level 0 should come first
      expect(taskIndices["task_a"]).toBeLessThan(taskIndices["task_c"]);
      expect(taskIndices["task_b"]).toBeLessThan(taskIndices["task_d"]);

      // Level 1 should come after level 0
      expect(taskIndices["task_c"]).toBeLessThan(taskIndices["task_f"]);
      expect(taskIndices["task_e"]).toBeLessThan(taskIndices["task_g"]);

      // Level 2 should come after level 1
      expect(taskIndices["task_f"]).toBeLessThan(taskIndices["task_h"]);
      expect(taskIndices["task_g"]).toBeLessThan(taskIndices["task_h"]);

      expect(executionOrder).toHaveLength(8);
    });
  });

  describe("Task Scheduling and Time Management", () => {
    test("handles scheduled task execution", async () => {
      const now = new Date();
      const futureTime = new Date(now.getTime() + 60000); // 1 minute from now
      const pastTime = new Date(now.getTime() - 60000); // 1 minute ago

      const scheduledTasks = [
        {
          id: "scheduled_future",
          type: "maintenance",
          priority: "low",
          description: "Future scheduled task",
          files_pattern: "**/*.maintenance",
          created_at: now.toISOString(),
          status: "scheduled",
          scheduled_time: futureTime.toISOString(),
          metadata: {
            estimated_duration: 120,
            is_scheduled: true,
          },
        },
        {
          id: "scheduled_past",
          type: "cleanup",
          priority: "medium",
          description: "Past scheduled task (should be ready)",
          files_pattern: "**/*.cleanup",
          created_at: pastTime.toISOString(),
          status: "scheduled",
          scheduled_time: pastTime.toISOString(),
          metadata: {
            estimated_duration: 60,
            is_scheduled: true,
          },
        },
      ];

      await fs.writeFile(tasksFile, JSON.stringify(scheduledTasks, null, 2));

      // Test scheduling logic
      function getReadyTasks() {
        return scheduledTasks.filter((task) => {
          if (task.status !== "scheduled") return false;
          const scheduledTime = new Date(task.scheduled_time);
          return scheduledTime <= now;
        });
      }

      function getUpcomingTasks() {
        return scheduledTasks.filter((task) => {
          if (task.status !== "scheduled") return false;
          const scheduledTime = new Date(task.scheduled_time);
          return scheduledTime > now;
        });
      }

      const readyTasks = getReadyTasks();
      const upcomingTasks = getUpcomingTasks();

      expect(readyTasks).toHaveLength(1);
      expect(readyTasks[0].id).toBe("scheduled_past");
      expect(upcomingTasks).toHaveLength(1);
      expect(upcomingTasks[0].id).toBe("scheduled_future");
    });

    test("manages task execution time limits", async () => {
      const tasksWithTimeouts = [
        {
          id: "quick_task",
          type: "fast",
          priority: "high",
          description: "Quick task",
          files_pattern: "**/*.fast",
          created_at: new Date().toISOString(),
          status: "running",
          started_at: new Date().toISOString(),
          timeout_seconds: 300, // 5 minutes
          metadata: {
            estimated_duration: 60,
          },
        },
        {
          id: "slow_task",
          type: "slow",
          priority: "medium",
          description: "Slow task that might timeout",
          files_pattern: "**/*.slow",
          created_at: new Date().toISOString(),
          status: "running",
          started_at: new Date(Date.now() - 600000).toISOString(), // Started 10 minutes ago
          timeout_seconds: 300, // 5 minutes timeout
          metadata: {
            estimated_duration: 600,
          },
        },
      ];

      await fs.writeFile(tasksFile, JSON.stringify(tasksWithTimeouts, null, 2));

      // Test timeout detection
      function checkTimeouts() {
        const now = new Date();
        const timedOutTasks = [];

        tasksWithTimeouts.forEach((task) => {
          if (
            task.status === "running" &&
            task.started_at &&
            task.timeout_seconds
          ) {
            const startTime = new Date(task.started_at);
            const elapsedSeconds = (now - startTime) / 1000;

            if (elapsedSeconds > task.timeout_seconds) {
              timedOutTasks.push({
                ...task,
                timeout_reason: "execution_timeout",
                elapsed_seconds: elapsedSeconds,
              });
            }
          }
        });

        return timedOutTasks;
      }

      const timedOutTasks = checkTimeouts();
      expect(timedOutTasks).toHaveLength(1);
      expect(timedOutTasks[0].id).toBe("slow_task");
      expect(timedOutTasks[0].timeout_reason).toBe("execution_timeout");
      expect(timedOutTasks[0].elapsed_seconds).toBeGreaterThan(300);
    });

    test("handles recurring and periodic tasks", async () => {
      const recurringTasks = [
        {
          id: "daily_backup",
          type: "backup",
          priority: "medium",
          description: "Daily backup task",
          files_pattern: "**/*.backup",
          created_at: new Date().toISOString(),
          status: "completed",
          last_run: new Date().toISOString(),
          schedule: {
            type: "recurring",
            interval: "daily",
            next_run: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
          },
          metadata: {
            estimated_duration: 180,
            is_recurring: true,
          },
        },
        {
          id: "hourly_health_check",
          type: "monitoring",
          priority: "low",
          description: "Hourly health check",
          files_pattern: "**/*.health",
          created_at: new Date().toISOString(),
          status: "pending",
          last_run: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
          schedule: {
            type: "recurring",
            interval: "hourly",
            next_run: new Date(Date.now() + 3600000).toISOString(), // Next hour
          },
          metadata: {
            estimated_duration: 30,
            is_recurring: true,
          },
        },
      ];

      await fs.writeFile(tasksFile, JSON.stringify(recurringTasks, null, 2));

      // Test recurring task scheduling
      function getDueRecurringTasks() {
        const now = new Date();
        return recurringTasks.filter((task) => {
          if (!task.schedule || task.schedule.type !== "recurring")
            return false;
          const nextRun = new Date(task.schedule.next_run);
          return nextRun <= now;
        });
      }

      function scheduleNextRun(task) {
        const now = new Date();
        let nextRun;

        switch (task.schedule.interval) {
          case "hourly":
            nextRun = new Date(now.getTime() + 3600000); // +1 hour
            break;
          case "daily":
            nextRun = new Date(now.getTime() + 86400000); // +1 day
            break;
          default:
            return task;
        }

        return {
          ...task,
          schedule: {
            ...task.schedule,
            next_run: nextRun.toISOString(),
          },
        };
      }

      const dueTasks = getDueRecurringTasks();
      expect(dueTasks).toHaveLength(1);
      expect(dueTasks[0].id).toBe("hourly_health_check");

      // Test rescheduling
      const rescheduledTask = scheduleNextRun(recurringTasks[0]);
      const nextRun = new Date(rescheduledTask.schedule.next_run);
      const expectedNextRun = new Date(Date.now() + 86400000);

      expect(Math.abs(nextRun - expectedNextRun)).toBeLessThan(1000); // Within 1 second
    });
  });

  describe("Task Resource Management and Allocation", () => {
    test("manages resource allocation across tasks", async () => {
      const resourceTasks = [
        {
          id: "cpu_intensive_task",
          type: "analysis",
          priority: "high",
          description: "CPU intensive task",
          files_pattern: "**/*.analysis",
          created_at: new Date().toISOString(),
          status: "running",
          resource_requirements: {
            cpu_cores: 4,
            memory_gb: 8,
            disk_space_gb: 10,
          },
          metadata: {
            estimated_duration: 600,
          },
        },
        {
          id: "memory_intensive_task",
          type: "processing",
          priority: "medium",
          description: "Memory intensive task",
          files_pattern: "**/*.processing",
          created_at: new Date().toISOString(),
          status: "pending",
          resource_requirements: {
            cpu_cores: 2,
            memory_gb: 16,
            disk_space_gb: 5,
          },
          metadata: {
            estimated_duration: 300,
          },
        },
        {
          id: "light_task",
          type: "utility",
          priority: "low",
          description: "Light utility task",
          files_pattern: "**/*.utility",
          created_at: new Date().toISOString(),
          status: "pending",
          resource_requirements: {
            cpu_cores: 1,
            memory_gb: 2,
            disk_space_gb: 1,
          },
          metadata: {
            estimated_duration: 60,
          },
        },
      ];

      await fs.writeFile(tasksFile, JSON.stringify(resourceTasks, null, 2));

      // Simulate resource allocation
      const systemResources = {
        total_cpu_cores: 8,
        total_memory_gb: 32,
        total_disk_space_gb: 100,
      };

      function allocateResources(availableResources, task) {
        const requirements = task.resource_requirements;

        if (
          availableResources.cpu_cores >= requirements.cpu_cores &&
          availableResources.memory_gb >= requirements.memory_gb &&
          availableResources.disk_space_gb >= requirements.disk_space_gb
        ) {
          return {
            ...availableResources,
            cpu_cores: availableResources.cpu_cores - requirements.cpu_cores,
            memory_gb: availableResources.memory_gb - requirements.memory_gb,
            disk_space_gb:
              availableResources.disk_space_gb - requirements.disk_space_gb,
          };
        }

        return null; // Cannot allocate
      }

      function getSchedulableTasks() {
        let availableResources = { ...systemResources };

        // Account for running tasks
        const runningTasks = resourceTasks.filter(
          (t) => t.status === "running",
        );
        runningTasks.forEach((task) => {
          availableResources = allocateResources(availableResources, task);
        });

        // Find tasks that can be scheduled
        return resourceTasks
          .filter((t) => t.status === "pending")
          .filter(
            (task) => allocateResources(availableResources, task) !== null,
          )
          .sort((a, b) => {
            // Sort by priority (high first) then by resource efficiency
            const priorityOrder = { high: 3, medium: 2, low: 1 };
            const aPriority = priorityOrder[a.priority] || 0;
            const bPriority = priorityOrder[b.priority] || 0;

            if (aPriority !== bPriority) return bPriority - aPriority;

            // Prefer tasks with lower resource requirements
            const aTotalResources =
              a.resource_requirements.cpu_cores +
              a.resource_requirements.memory_gb;
            const bTotalResources =
              b.resource_requirements.cpu_cores +
              b.resource_requirements.memory_gb;
            return aTotalResources - bTotalResources;
          });
      }

      const schedulableTasks = getSchedulableTasks();

      // Should schedule light_task first (lower resource requirements)
      expect(schedulableTasks[0].id).toBe("light_task");

      // memory_intensive_task should not be schedulable due to insufficient memory
      const memoryIntensiveIndex = schedulableTasks.findIndex(
        (t) => t.id === "memory_intensive_task",
      );
      expect(memoryIntensiveIndex).toBe(-1);
    });

    test("handles resource conflicts and preemption", async () => {
      const conflictTasks = [
        {
          id: "high_priority_task",
          type: "critical",
          priority: "critical",
          description: "High priority task",
          files_pattern: "**/*.critical",
          created_at: new Date().toISOString(),
          status: "pending",
          resource_requirements: {
            cpu_cores: 4,
            memory_gb: 8,
          },
          metadata: {
            can_preempt: true,
            estimated_duration: 300,
          },
        },
        {
          id: "running_task",
          type: "normal",
          priority: "medium",
          description: "Currently running task",
          files_pattern: "**/*.normal",
          created_at: new Date().toISOString(),
          status: "running",
          started_at: new Date().toISOString(),
          resource_requirements: {
            cpu_cores: 4,
            memory_gb: 8,
          },
          metadata: {
            can_be_preempted: true,
            estimated_duration: 600,
          },
        },
      ];

      await fs.writeFile(tasksFile, JSON.stringify(conflictTasks, null, 2));

      // Test preemption logic
      function resolveResourceConflicts() {
        const running = conflictTasks.filter((t) => t.status === "running");
        const pending = conflictTasks.filter((t) => t.status === "pending");

        const preemptions = [];

        pending.forEach((pendingTask) => {
          if (pendingTask.metadata.can_preempt) {
            // Find tasks that can be preempted
            const preemptableTasks = running.filter(
              (runningTask) =>
                runningTask.metadata.can_be_preempted &&
                runningTask.resource_requirements.cpu_cores ===
                  pendingTask.resource_requirements.cpu_cores &&
                runningTask.resource_requirements.memory_gb ===
                  pendingTask.resource_requirements.memory_gb,
            );

            preemptableTasks.forEach((task) => {
              preemptions.push({
                preempted_task: task.id,
                preempting_task: pendingTask.id,
                reason: "resource_conflict",
              });
            });
          }
        });

        return preemptions;
      }

      const preemptions = resolveResourceConflicts();

      expect(preemptions).toHaveLength(1);
      expect(preemptions[0].preempted_task).toBe("running_task");
      expect(preemptions[0].preempting_task).toBe("high_priority_task");
      expect(preemptions[0].reason).toBe("resource_conflict");
    });

    test("monitors and reports resource utilization", async () => {
      const monitoringTasks = [
        {
          id: "monitored_task_1",
          type: "computation",
          priority: "medium",
          description: "Monitored computation task",
          files_pattern: "**/*.compute",
          created_at: new Date().toISOString(),
          status: "running",
          started_at: new Date().toISOString(),
          resource_usage: {
            cpu_percent: 85,
            memory_mb: 2048,
            disk_io: 150,
          },
          metadata: {
            estimated_duration: 300,
          },
        },
        {
          id: "monitored_task_2",
          type: "io_bound",
          priority: "low",
          description: "IO bound monitored task",
          files_pattern: "**/*.io",
          created_at: new Date().toISOString(),
          status: "running",
          started_at: new Date().toISOString(),
          resource_usage: {
            cpu_percent: 15,
            memory_mb: 512,
            disk_io: 800,
          },
          metadata: {
            estimated_duration: 180,
          },
        },
      ];

      await fs.writeFile(tasksFile, JSON.stringify(monitoringTasks, null, 2));

      // Test resource monitoring and reporting
      function generateResourceReport() {
        const totalUsage = {
          total_cpu_percent: 0,
          total_memory_mb: 0,
          total_disk_io: 0,
          task_count: monitoringTasks.length,
        };

        const taskReports = monitoringTasks.map((task) => ({
          task_id: task.id,
          status: task.status,
          resource_usage: task.resource_usage,
          efficiency_score: calculateEfficiencyScore(task),
        }));

        taskReports.forEach((report) => {
          totalUsage.total_cpu_percent += report.resource_usage.cpu_percent;
          totalUsage.total_memory_mb += report.resource_usage.memory_mb;
          totalUsage.total_disk_io += report.resource_usage.disk_io;
        });

        return {
          summary: totalUsage,
          tasks: taskReports,
          alerts: generateAlerts(taskReports),
        };
      }

      function calculateEfficiencyScore(task) {
        // Simple efficiency calculation based on resource usage patterns
        const cpuEfficiency = task.resource_usage.cpu_percent / 100;
        const memoryEfficiency = Math.min(
          task.resource_usage.memory_mb / 4096,
          1,
        ); // Normalize to 4GB max
        const ioEfficiency = Math.min(task.resource_usage.disk_io / 1000, 1); // Normalize to 1000 IOPS max

        return (cpuEfficiency + memoryEfficiency + ioEfficiency) / 3;
      }

      function generateAlerts(taskReports) {
        const alerts = [];

        taskReports.forEach((report) => {
          if (report.resource_usage.cpu_percent > 90) {
            alerts.push({
              type: "high_cpu_usage",
              task_id: report.task_id,
              message: `High CPU usage: ${report.resource_usage.cpu_percent}%`,
            });
          }

          if (report.resource_usage.memory_mb > 3072) {
            // 3GB
            alerts.push({
              type: "high_memory_usage",
              task_id: report.task_id,
              message: `High memory usage: ${report.resource_usage.memory_mb}MB`,
            });
          }

          if (report.efficiency_score < 0.3) {
            alerts.push({
              type: "low_efficiency",
              task_id: report.task_id,
              message: `Low resource efficiency: ${(report.efficiency_score * 100).toFixed(1)}%`,
            });
          }
        });

        return alerts;
      }

      const report = generateResourceReport();

      expect(report.summary.task_count).toBe(2);
      expect(report.summary.total_cpu_percent).toBe(100);
      expect(report.summary.total_memory_mb).toBe(2560);
      expect(report.tasks).toHaveLength(2);
      expect(report.alerts.length).toBeGreaterThan(0); // Should have at least one alert for high CPU

      // Verify efficiency scores
      report.tasks.forEach((task) => {
        expect(task.efficiency_score).toBeGreaterThan(0);
        expect(task.efficiency_score).toBeLessThanOrEqual(1);
      });
    });
  });

  describe("Task Monitoring and Alerting", () => {
    test("monitors task health and performance", async () => {
      const healthTasks = [
        {
          id: "healthy_task",
          type: "normal",
          priority: "medium",
          description: "Healthy running task",
          files_pattern: "**/*.healthy",
          created_at: new Date().toISOString(),
          status: "running",
          started_at: new Date().toISOString(),
          health_metrics: {
            last_heartbeat: new Date().toISOString(),
            progress_rate: 2.5, // progress % per minute
            error_count: 0,
            warning_count: 1,
          },
          metadata: {
            estimated_duration: 240,
          },
        },
        {
          id: "unhealthy_task",
          type: "problematic",
          priority: "high",
          description: "Task with health issues",
          files_pattern: "**/*.unhealthy",
          created_at: new Date().toISOString(),
          status: "running",
          started_at: new Date(Date.now() - 300000).toISOString(), // 5 minutes ago
          health_metrics: {
            last_heartbeat: new Date(Date.now() - 120000).toISOString(), // 2 minutes ago
            progress_rate: 0, // No progress
            error_count: 5,
            warning_count: 10,
          },
          metadata: {
            estimated_duration: 180,
          },
        },
      ];

      await fs.writeFile(tasksFile, JSON.stringify(healthTasks, null, 2));

      // Test health monitoring
      function assessTaskHealth() {
        const now = new Date();
        const healthAssessments = [];

        healthTasks.forEach((task) => {
          const assessment = {
            task_id: task.id,
            overall_health: "healthy",
            issues: [],
          };

          // Check heartbeat
          const lastHeartbeat = new Date(task.health_metrics.last_heartbeat);
          const heartbeatAge = (now - lastHeartbeat) / 1000 / 60; // minutes

          if (heartbeatAge > 5) {
            assessment.issues.push("stale_heartbeat");
            assessment.overall_health = "unhealthy";
          } else if (heartbeatAge > 2) {
            assessment.issues.push("delayed_heartbeat");
            assessment.overall_health = "warning";
          }

          // Check progress rate
          if (
            task.health_metrics.progress_rate === 0 &&
            task.status === "running"
          ) {
            assessment.issues.push("no_progress");
            assessment.overall_health = "unhealthy";
          } else if (task.health_metrics.progress_rate < 0.5) {
            assessment.issues.push("slow_progress");
            assessment.overall_health = "warning";
          }

          // Check error rates
          if (task.health_metrics.error_count > 3) {
            assessment.issues.push("high_error_rate");
            assessment.overall_health = "unhealthy";
          } else if (task.health_metrics.error_count > 0) {
            assessment.issues.push("errors_present");
            assessment.overall_health = "warning";
          }

          healthAssessments.push(assessment);
        });

        return healthAssessments;
      }

      const healthAssessments = assessTaskHealth();

      expect(healthAssessments).toHaveLength(2);

      const healthyAssessment = healthAssessments.find(
        (a) => a.task_id === "healthy_task",
      );
      const unhealthyAssessment = healthAssessments.find(
        (a) => a.task_id === "unhealthy_task",
      );

      expect(healthyAssessment.overall_health).toBe("warning"); // Has warnings but no critical issues
      expect(unhealthyAssessment.overall_health).toBe("unhealthy"); // Multiple critical issues

      expect(unhealthyAssessment.issues).toContain("stale_heartbeat");
      expect(unhealthyAssessment.issues).toContain("no_progress");
      expect(unhealthyAssessment.issues).toContain("high_error_rate");
    });

    test("generates alerts for task anomalies", async () => {
      const anomalyTasks = [
        {
          id: "failed_task",
          type: "failing",
          priority: "high",
          description: "Task that keeps failing",
          files_pattern: "**/*.fail",
          created_at: new Date().toISOString(),
          status: "failed",
          retry_count: 3,
          max_retries: 3,
          last_error: "Connection timeout",
          error_history: [
            {
              timestamp: new Date(Date.now() - 300000).toISOString(),
              error: "Network error",
            },
            {
              timestamp: new Date(Date.now() - 240000).toISOString(),
              error: "Timeout",
            },
            {
              timestamp: new Date(Date.now() - 180000).toISOString(),
              error: "Connection failed",
            },
          ],
          metadata: {
            estimated_duration: 120,
          },
        },
        {
          id: "slow_task",
          type: "slow",
          priority: "medium",
          description: "Task running slower than expected",
          files_pattern: "**/*.slow",
          created_at: new Date().toISOString(),
          status: "running",
          started_at: new Date(Date.now() - 600000).toISOString(), // 10 minutes ago
          progress: 15, // Only 15% done after 10 minutes
          estimated_completion: 20, // Should be at 20% by now
          metadata: {
            estimated_duration: 600, // 10 minutes total
          },
        },
      ];

      await fs.writeFile(tasksFile, JSON.stringify(anomalyTasks, null, 2));

      // Test alert generation
      function generateAlerts() {
        const alerts = [];
        const now = new Date();

        anomalyTasks.forEach((task) => {
          // Check for failed tasks that have exhausted retries
          if (
            task.status === "failed" &&
            task.retry_count >= task.max_retries
          ) {
            alerts.push({
              type: "task_failure",
              severity: "critical",
              task_id: task.id,
              message: `Task ${task.id} has failed after ${task.retry_count} retries`,
              details: {
                last_error: task.last_error,
                error_count: task.error_history.length,
              },
            });
          }

          // Check for tasks running slower than expected
          if (task.status === "running" && task.started_at) {
            const startTime = new Date(task.started_at);
            const elapsedMinutes = (now - startTime) / 1000 / 60;
            const expectedProgress =
              (elapsedMinutes / (task.metadata.estimated_duration / 60)) * 100;

            if (task.progress < expectedProgress * 0.5) {
              // Less than 50% of expected progress
              alerts.push({
                type: "task_delay",
                severity: "warning",
                task_id: task.id,
                message: `Task ${task.id} is running slower than expected`,
                details: {
                  actual_progress: task.progress,
                  expected_progress: Math.round(expectedProgress),
                  elapsed_minutes: Math.round(elapsedMinutes),
                },
              });
            }
          }

          // Check for error patterns
          if (task.error_history && task.error_history.length >= 3) {
            const recentErrors = task.error_history.filter((error) => {
              const errorTime = new Date(error.timestamp);
              const minutesAgo = (now - errorTime) / 1000 / 60;
              return minutesAgo <= 10; // Errors in last 10 minutes
            });

            if (recentErrors.length >= 3) {
              alerts.push({
                type: "error_spike",
                severity: "warning",
                task_id: task.id,
                message: `Task ${task.id} has ${recentErrors.length} errors in the last 10 minutes`,
                details: {
                  error_count: recentErrors.length,
                  time_window: "10 minutes",
                },
              });
            }
          }
        });

        return alerts;
      }

      const alerts = generateAlerts();

      expect(alerts.length).toBeGreaterThanOrEqual(2); // Should have alerts for both tasks

      const failureAlert = alerts.find((a) => a.type === "task_failure");
      const delayAlert = alerts.find((a) => a.type === "task_delay");

      expect(failureAlert).toBeDefined();
      expect(failureAlert.severity).toBe("critical");
      expect(failureAlert.task_id).toBe("failed_task");

      expect(delayAlert).toBeDefined();
      expect(delayAlert.severity).toBe("warning");
      expect(delayAlert.task_id).toBe("slow_task");
    });

    test("tracks task performance metrics over time", async () => {
      const performanceTasks = [
        {
          id: "performance_task",
          type: "analysis",
          priority: "medium",
          description: "Task with performance tracking",
          files_pattern: "**/*.perf",
          created_at: new Date().toISOString(),
          status: "completed",
          started_at: new Date(Date.now() - 300000).toISOString(), // 5 minutes ago
          completed_at: new Date().toISOString(),
          performance_history: [
            {
              timestamp: new Date(Date.now() - 240000).toISOString(),
              cpu_usage: 45,
              memory_usage: 512,
            },
            {
              timestamp: new Date(Date.now() - 180000).toISOString(),
              cpu_usage: 67,
              memory_usage: 768,
            },
            {
              timestamp: new Date(Date.now() - 120000).toISOString(),
              cpu_usage: 89,
              memory_usage: 1024,
            },
            {
              timestamp: new Date(Date.now() - 60000).toISOString(),
              cpu_usage: 78,
              memory_usage: 896,
            },
          ],
          metadata: {
            estimated_duration: 240,
            actual_duration: 300,
          },
        },
      ];

      await fs.writeFile(tasksFile, JSON.stringify(performanceTasks, null, 2));

      // Test performance analysis
      function analyzePerformance() {
        const task = performanceTasks[0];
        const analysis = {
          task_id: task.id,
          total_duration: task.metadata.actual_duration,
          estimated_duration: task.metadata.estimated_duration,
          efficiency:
            task.metadata.estimated_duration / task.metadata.actual_duration,
          peak_cpu_usage: 0,
          average_cpu_usage: 0,
          peak_memory_usage: 0,
          average_memory_usage: 0,
          performance_trend: "stable",
        };

        // Calculate metrics from history
        const cpuUsages = task.performance_history.map((h) => h.cpu_usage);
        const memoryUsages = task.performance_history.map(
          (h) => h.memory_usage,
        );

        analysis.peak_cpu_usage = Math.max(...cpuUsages);
        analysis.average_cpu_usage =
          cpuUsages.reduce((a, b) => a + b, 0) / cpuUsages.length;
        analysis.peak_memory_usage = Math.max(...memoryUsages);
        analysis.average_memory_usage =
          memoryUsages.reduce((a, b) => a + b, 0) / memoryUsages.length;

        // Analyze trend
        const firstHalf = cpuUsages.slice(0, Math.floor(cpuUsages.length / 2));
        const secondHalf = cpuUsages.slice(Math.floor(cpuUsages.length / 2));

        const firstHalfAvg =
          firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
        const secondHalfAvg =
          secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

        if (secondHalfAvg > firstHalfAvg * 1.2) {
          analysis.performance_trend = "increasing";
        } else if (secondHalfAvg < firstHalfAvg * 0.8) {
          analysis.performance_trend = "decreasing";
        }

        return analysis;
      }

      const analysis = analyzePerformance();

      expect(analysis.efficiency).toBeLessThan(1); // Took longer than estimated
      expect(analysis.peak_cpu_usage).toBe(89);
      expect(analysis.average_cpu_usage).toBeGreaterThan(0);
      expect(analysis.peak_memory_usage).toBe(1024);
      expect(analysis.average_memory_usage).toBeGreaterThan(0);
      expect(["stable", "increasing", "decreasing"]).toContain(
        analysis.performance_trend,
      );

      // Verify performance data integrity
      expect(analysis.total_duration).toBe(300);
      expect(analysis.estimated_duration).toBe(240);
    });
  });
});
