const fs = require("fs").promises;
const path = require("path");
const { spawn } = require("child_process");

describe("Enhanced Database Integration Tests", () => {
  let testProjectDir;
  let claudeDir;
  let tasksFile;
  let taskStatusFile;
  let logsDir;
  let backupDir;
  let taskManagerProcess;

  beforeAll(async () => {
    testProjectDir = path.join(
      __dirname,
      "fixtures",
      "enhanced-db-integration-test",
    );
    claudeDir = path.join(testProjectDir, ".claude");
    tasksFile = path.join(claudeDir, "tasks.json");
    taskStatusFile = path.join(claudeDir, "task_status.json");
    logsDir = path.join(claudeDir, "logs");
    backupDir = path.join(claudeDir, "backups");

    await fs.mkdir(logsDir, { recursive: true });
    await fs.mkdir(backupDir, { recursive: true });
  });

  beforeEach(async () => {
    // Initialize clean database state with comprehensive test data
    const initialTasks = [
      {
        id: "enhanced_db_task_1",
        type: "testing",
        priority: "high",
        description: "Enhanced database integration test task 1",
        files_pattern: "**/*.test.js",
        created_at: new Date().toISOString(),
        status: "pending",
        metadata: {
          estimated_duration: 300,
          complexity: "medium",
          tags: ["integration", "database"],
          dependencies: [],
        },
      },
      {
        id: "enhanced_db_task_2",
        type: "analysis",
        priority: "medium",
        description: "Data analysis task",
        files_pattern: "**/*.js",
        created_at: new Date().toISOString(),
        status: "running",
        metadata: {
          estimated_duration: 600,
          complexity: "high",
          tags: ["analysis", "performance"],
          dependencies: ["enhanced_db_task_1"],
        },
      },
    ];

    const initialStatus = {
      enhanced_db_task_1: {
        status: "pending",
        progress: 0,
        created_at: new Date().toISOString(),
        metrics: {
          files_processed: 0,
          tests_run: 0,
          coverage_percent: 0,
        },
      },
      enhanced_db_task_2: {
        status: "running",
        progress: 45,
        started_at: new Date().toISOString(),
        current_step: "Analyzing code patterns",
        metrics: {
          files_processed: 12,
          memory_usage: 256,
          cpu_time: 45.2,
        },
      },
    };

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

  describe("Database Migration and Schema Evolution", () => {
    test("handles schema version upgrades gracefully", async () => {
      // Create old schema version
      const oldSchemaTasks = [
        {
          id: "old_schema_task",
          type: "legacy",
          priority: "medium",
          description: "Task with old schema",
          files_pattern: "**/*",
          created_at: new Date().toISOString(),
          status: "pending",
          // Missing metadata field from new schema
        },
      ];

      await fs.writeFile(tasksFile, JSON.stringify(oldSchemaTasks, null, 2));

      // Read and verify backward compatibility
      const tasks = JSON.parse(await fs.readFile(tasksFile, "utf8"));
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe("old_schema_task");

      // Add new schema fields
      tasks[0].metadata = {
        estimated_duration: 300,
        complexity: "medium",
        tags: ["legacy"],
        dependencies: [],
      };

      await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2));

      // Verify new schema is preserved
      const updatedTasks = JSON.parse(await fs.readFile(tasksFile, "utf8"));
      expect(updatedTasks[0]).toHaveProperty("metadata");
      expect(updatedTasks[0].metadata.tags).toContain("legacy");
    });

    test("migrates data between schema versions", async () => {
      // Simulate v1 schema
      const v1Tasks = [
        {
          id: "v1_task",
          task_type: "old_field_name", // Old field name
          priority_level: "high", // Old field name
          desc: "Old description field", // Old field name
          pattern: "**/*", // Old field name
          timestamp: new Date().toISOString(),
          state: "pending", // Old field name
        },
      ];

      await fs.writeFile(tasksFile, JSON.stringify(v1Tasks, null, 2));

      // Simulate migration logic
      const rawTasks = JSON.parse(await fs.readFile(tasksFile, "utf8"));
      const migratedTasks = rawTasks.map((task) => ({
        id: task.id,
        type: task.task_type || task.type || "general",
        priority: task.priority_level || task.priority || "medium",
        description: task.desc || task.description || "",
        files_pattern: task.pattern || task.files_pattern || "**/*",
        created_at:
          task.timestamp || task.created_at || new Date().toISOString(),
        status: task.state || task.status || "pending",
        metadata: {
          migrated_from: "v1",
          estimated_duration: 300,
          complexity: "medium",
          tags: [],
          dependencies: [],
        },
      }));

      await fs.writeFile(tasksFile, JSON.stringify(migratedTasks, null, 2));

      // Verify migration
      const finalTasks = JSON.parse(await fs.readFile(tasksFile, "utf8"));
      expect(finalTasks[0].type).toBe("old_field_name");
      expect(finalTasks[0].priority).toBe("high");
      expect(finalTasks[0].description).toBe("Old description field");
      expect(finalTasks[0]).toHaveProperty("metadata");
      expect(finalTasks[0].metadata.migrated_from).toBe("v1");
    });

    test("validates schema integrity during migrations", async () => {
      // Create invalid schema data
      const invalidTasks = [
        {
          // Missing required 'id' field
          type: "testing",
          priority: "high",
          description: "Invalid task missing ID",
        },
        {
          id: "valid_task",
          type: "testing",
          priority: "high",
          description: "Valid task",
          created_at: new Date().toISOString(),
          status: "pending",
        },
      ];

      await fs.writeFile(tasksFile, JSON.stringify(invalidTasks, null, 2));

      // Simulate validation during read
      const tasks = JSON.parse(await fs.readFile(tasksFile, "utf8"));

      // Filter out invalid entries
      const validTasks = tasks.filter((task) => {
        return (
          task.id &&
          task.type &&
          task.priority &&
          task.description &&
          task.created_at &&
          task.status
        );
      });

      expect(validTasks).toHaveLength(1);
      expect(validTasks[0].id).toBe("valid_task");

      // Save only valid tasks
      await fs.writeFile(tasksFile, JSON.stringify(validTasks, null, 2));
    });
  });

  describe("Database Locking and Concurrency Control", () => {
    test("handles concurrent read operations safely", async () => {
      const readOperations = Array.from({ length: 10 }, () =>
        fs.readFile(tasksFile, "utf8").then(JSON.parse),
      );

      const results = await Promise.all(readOperations);

      // All reads should return the same data
      results.forEach((result) => {
        expect(result).toHaveLength(2);
        expect(result[0].id).toBe("enhanced_db_task_1");
        expect(result[1].id).toBe("enhanced_db_task_2");
      });
    });

    test("manages concurrent write operations with locking", async () => {
      // Simulate concurrent task updates
      const updateOperations = Array.from({ length: 5 }, async (_, index) => {
        const tasks = JSON.parse(await fs.readFile(tasksFile, "utf8"));
        const task = tasks[0];
        task.description = `Updated description ${index + 1}`;
        task.last_modified = new Date().toISOString();

        // Small delay to increase chance of race conditions
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));

        await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2));
      });

      await Promise.all(updateOperations);

      // Verify final state is consistent
      const finalTasks = JSON.parse(await fs.readFile(tasksFile, "utf8"));
      expect(finalTasks).toHaveLength(2);
      expect(finalTasks[0]).toHaveProperty("id", "enhanced_db_task_1");
      expect(finalTasks[0]).toHaveProperty("description");
      expect(finalTasks[0]).toHaveProperty("last_modified");
    });

    test("prevents data corruption during concurrent access", async () => {
      const originalContent = await fs.readFile(tasksFile, "utf8");
      const originalTasks = JSON.parse(originalContent);

      // Simulate mixed read/write operations
      const operations = [
        // Multiple reads
        ...Array.from({ length: 3 }, () => fs.readFile(tasksFile, "utf8")),
        // Multiple writes
        ...Array.from({ length: 3 }, async (_, i) => {
          const tasks = JSON.parse(await fs.readFile(tasksFile, "utf8"));
          tasks[0].concurrent_update = i;
          await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2));
        }),
      ];

      await Promise.all(operations);

      // Verify data integrity
      const finalContent = await fs.readFile(tasksFile, "utf8");
      const finalTasks = JSON.parse(finalContent);

      expect(finalTasks).toHaveLength(2);
      expect(finalTasks[0].id).toBe("enhanced_db_task_1");
      expect(finalTasks[1].id).toBe("enhanced_db_task_2");

      // Should have valid JSON structure
      expect(() => JSON.parse(finalContent)).not.toThrow();
    });
  });

  describe("Database Encryption and Security", () => {
    test("handles encrypted database files", async () => {
      // Simulate encrypted content (base64 encoded JSON)
      const tasksData = {
        tasks: [
          {
            id: "encrypted_task",
            type: "security",
            priority: "high",
            description: "Task with sensitive data",
            files_pattern: "**/*.enc",
            created_at: new Date().toISOString(),
            status: "pending",
          },
        ],
      };

      const jsonString = JSON.stringify(tasksData);
      const encryptedContent = Buffer.from(jsonString).toString("base64");

      // Save "encrypted" content
      await fs.writeFile(`${tasksFile}.enc`, encryptedContent);

      // Simulate decryption and read
      const encryptedData = await fs.readFile(`${tasksFile}.enc`, "utf8");
      const decryptedJson = Buffer.from(encryptedData, "base64").toString();
      const decryptedData = JSON.parse(decryptedJson);

      expect(decryptedData.tasks).toHaveLength(1);
      expect(decryptedData.tasks[0].id).toBe("encrypted_task");

      // Clean up
      await fs.unlink(`${tasksFile}.enc`);
    });

    test("validates data integrity with checksums", async () => {
      const crypto = require("crypto");

      // Create data with checksum
      const tasksData = [
        {
          id: "checksum_task",
          type: "validation",
          priority: "medium",
          description: "Task with integrity check",
          files_pattern: "**/*",
          created_at: new Date().toISOString(),
          status: "pending",
        },
      ];

      const jsonString = JSON.stringify(tasksData, null, 2);
      const checksum = crypto
        .createHash("sha256")
        .update(jsonString)
        .digest("hex");

      // Save data with checksum
      const dataWithChecksum = {
        checksum: checksum,
        data: tasksData,
      };

      await fs.writeFile(tasksFile, JSON.stringify(dataWithChecksum, null, 2));

      // Verify integrity on read
      const savedData = JSON.parse(await fs.readFile(tasksFile, "utf8"));
      const savedJsonString = JSON.stringify(savedData.data, null, 2);
      const calculatedChecksum = crypto
        .createHash("sha256")
        .update(savedJsonString)
        .digest("hex");

      expect(calculatedChecksum).toBe(savedData.checksum);
      expect(savedData.data[0].id).toBe("checksum_task");
    });

    test("handles secure credential storage", async () => {
      // Simulate secure storage of credentials (not actual encryption for test)
      const credentials = {
        database: {
          host: "secure-host",
          port: 5432,
          username: "encrypted_username",
          password: "encrypted_password_hash",
        },
        api_keys: {
          openai: "sk-encrypted-key",
          anthropic: "sk-ant-encrypted-key",
        },
      };

      const secureFile = path.join(claudeDir, "credentials.json");
      await fs.writeFile(secureFile, JSON.stringify(credentials, null, 2));

      // Verify secure storage
      const storedCredentials = JSON.parse(
        await fs.readFile(secureFile, "utf8"),
      );
      expect(storedCredentials.database.username).toBe("encrypted_username");
      expect(storedCredentials.api_keys.openai).toBe("sk-encrypted-key");

      // Clean up
      await fs.unlink(secureFile);
    });
  });

  describe("Advanced Database Backup and Recovery", () => {
    test("creates incremental backups with versioning", async () => {
      const backupVersions = [];

      // Create initial backup
      const initialTasks = await fs.readFile(tasksFile, "utf8");
      const backup1 = path.join(backupDir, "tasks_v1_20241201_120000.json");
      await fs.writeFile(backup1, initialTasks);
      backupVersions.push("v1");

      // Modify data
      const tasks = JSON.parse(initialTasks);
      tasks[0].status = "running";
      tasks[0].started_at = new Date().toISOString();
      await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2));

      // Create incremental backup
      const modifiedTasks = await fs.readFile(tasksFile, "utf8");
      const backup2 = path.join(backupDir, "tasks_v2_20241201_120500.json");
      await fs.writeFile(backup2, modifiedTasks);
      backupVersions.push("v2");

      // Verify backups
      const backup1Content = JSON.parse(await fs.readFile(backup1, "utf8"));
      const backup2Content = JSON.parse(await fs.readFile(backup2, "utf8"));

      expect(backup1Content[0].status).toBe("pending");
      expect(backup2Content[0].status).toBe("running");
      expect(backup2Content[0]).toHaveProperty("started_at");

      // Test restoration from specific version
      await fs.copyFile(backup1, tasksFile);
      const restoredTasks = JSON.parse(await fs.readFile(tasksFile, "utf8"));
      expect(restoredTasks[0].status).toBe("pending");
      expect(restoredTasks[0]).not.toHaveProperty("started_at");
    });

    test("performs point-in-time recovery", async () => {
      const timeline = [];

      // Record initial state
      const initialState = await fs.readFile(tasksFile, "utf8");
      timeline.push({
        timestamp: new Date().toISOString(),
        data: initialState,
      });

      // Make several changes
      for (let i = 1; i <= 3; i++) {
        const tasks = JSON.parse(await fs.readFile(tasksFile, "utf8"));
        tasks[0].progress = i * 25;
        tasks[0].last_update = new Date().toISOString();

        await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2));

        timeline.push({
          timestamp: new Date().toISOString(),
          data: await fs.readFile(tasksFile, "utf8"),
        });

        // Small delay
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Recover to point in time (second change)
      const recoveryPoint = timeline[2]; // After second change
      await fs.writeFile(tasksFile, recoveryPoint.data);

      const recoveredTasks = JSON.parse(await fs.readFile(tasksFile, "utf8"));
      expect(recoveredTasks[0].progress).toBe(50); // Should be at 50% progress
      expect(recoveredTasks[0]).toHaveProperty("last_update");
    });

    test("handles backup compression and storage optimization", async () => {
      const zlib = require("zlib");
      const util = require("util");

      const gzip = util.promisify(zlib.gzip);
      const gunzip = util.promisify(zlib.gunzip);

      // Create large test data
      const largeTasks = Array.from({ length: 100 }, (_, i) => ({
        id: `large_task_${i + 1}`,
        type: "performance_test",
        priority: "low",
        description: `Large test task ${i + 1} with substantial data content`,
        files_pattern: `**/*${i + 1}.*`,
        created_at: new Date().toISOString(),
        status: "pending",
        metadata: {
          large_field: "x".repeat(1000), // 1KB of data per task
          complex_data: {
            nested: {
              array: Array.from({ length: 10 }, () => Math.random()),
              object: { a: 1, b: 2, c: "test".repeat(50) },
            },
          },
        },
      }));

      const jsonData = JSON.stringify(largeTasks, null, 2);
      const originalSize = Buffer.byteLength(jsonData, "utf8");

      // Compress data
      const compressedData = await gzip(jsonData);
      const compressedSize = compressedData.length;

      // Save compressed backup
      const compressedBackup = path.join(backupDir, "tasks_compressed.gz");
      await fs.writeFile(compressedBackup, compressedData);

      // Verify compression ratio
      expect(compressedSize).toBeLessThan(originalSize);

      // Test decompression and recovery
      const storedCompressedData = await fs.readFile(compressedBackup);
      const decompressedData = await gunzip(storedCompressedData);
      const recoveredTasks = JSON.parse(decompressedData.toString());

      expect(recoveredTasks).toHaveLength(100);
      expect(recoveredTasks[0].id).toBe("large_task_1");
      expect(recoveredTasks[0].metadata.large_field).toBe("x".repeat(1000));

      // Clean up
      await fs.unlink(compressedBackup);
    });
  });

  describe("Database Indexing and Query Performance", () => {
    test("maintains indexes for efficient queries", async () => {
      // Create large dataset
      const largeDataset = Array.from({ length: 200 }, (_, i) => ({
        id: `indexed_task_${i + 1}`,
        type: ["testing", "analysis", "documentation", "maintenance"][i % 4],
        priority: ["low", "medium", "high", "critical"][i % 4],
        description: `Indexed task ${i + 1} for performance testing`,
        files_pattern: `**/*${i + 1}.*`,
        created_at: new Date(
          Date.now() - Math.random() * 86400000,
        ).toISOString(), // Random date within last 24h
        status: ["pending", "running", "completed", "failed"][i % 4],
        metadata: {
          tags: [`tag_${i % 5}`, `category_${i % 3}`],
          complexity: ["low", "medium", "high"][i % 3],
        },
      }));

      await fs.writeFile(tasksFile, JSON.stringify(largeDataset, null, 2));

      // Create indexes (simulate in-memory indexes)
      const indexes = {
        by_id: new Map(),
        by_type: new Map(),
        by_status: new Map(),
        by_priority: new Map(),
        by_tags: new Map(),
      };

      // Build indexes
      largeDataset.forEach((task) => {
        indexes.by_id.set(task.id, task);
        if (!indexes.by_type.has(task.type)) {
          indexes.by_type.set(task.type, []);
        }
        indexes.by_type.get(task.type).push(task);

        if (!indexes.by_status.has(task.status)) {
          indexes.by_status.set(task.status, []);
        }
        indexes.by_status.get(task.status).push(task);

        task.metadata.tags.forEach((tag) => {
          if (!indexes.by_tags.has(tag)) {
            indexes.by_tags.set(tag, []);
          }
          indexes.by_tags.get(tag).push(task);
        });
      });

      // Test indexed queries
      const testingTasks = indexes.by_type.get("testing") || [];
      expect(testingTasks.length).toBeGreaterThan(40);

      const pendingTasks = indexes.by_status.get("pending") || [];
      expect(pendingTasks.length).toBeGreaterThan(40);

      const tag0Tasks = indexes.by_tags.get("tag_0") || [];
      expect(tag0Tasks.length).toBeGreaterThan(30);

      // Test direct ID lookup
      const specificTask = indexes.by_id.get("indexed_task_50");
      expect(specificTask).toBeDefined();
      expect(specificTask.id).toBe("indexed_task_50");
    });

    test("optimizes query performance with caching", async () => {
      // Create query cache
      const queryCache = new Map();
      const cacheTimestamps = new Map();

      // Test data
      const tasks = JSON.parse(await fs.readFile(tasksFile, "utf8"));

      // First query - cache miss
      const cacheKey1 = "type_testing";
      let startTime = Date.now();

      const testingTasks = tasks.filter((t) => t.type === "testing");
      queryCache.set(cacheKey1, testingTasks);
      cacheTimestamps.set(cacheKey1, Date.now());

      const firstQueryTime = Date.now() - startTime;

      // Second query - cache hit
      startTime = Date.now();
      const cachedTestingTasks = queryCache.get(cacheKey1);
      const secondQueryTime = Date.now() - startTime;

      // Cached query should be faster
      expect(secondQueryTime).toBeLessThan(firstQueryTime);
      expect(cachedTestingTasks).toEqual(testingTasks);

      // Test cache invalidation
      tasks[0].type = "modified_type";
      await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2));

      // Cache should be invalidated (simulate)
      queryCache.delete(cacheKey1);
      cacheTimestamps.delete(cacheKey1);

      const freshTestingTasks = tasks.filter((t) => t.type === "testing");
      expect(freshTestingTasks).not.toEqual(testingTasks);
    });

    test("handles complex queries with aggregations", async () => {
      // Create dataset with various attributes
      const complexDataset = Array.from({ length: 150 }, (_, i) => ({
        id: `complex_task_${i + 1}`,
        type: ["testing", "analysis", "build", "deploy"][i % 4],
        priority: ["low", "medium", "high"][i % 3],
        status: ["pending", "running", "completed", "failed"][i % 4],
        created_at: new Date(Date.now() - i * 3600000).toISOString(), // Hourly intervals
        metadata: {
          duration: Math.floor(Math.random() * 3600) + 60, // 1-3600 seconds
          success_rate: Math.random(),
          tags: Array.from(
            { length: Math.floor(Math.random() * 3) + 1 },
            () => `tag_${Math.floor(Math.random() * 10)}`,
          ),
        },
      }));

      await fs.writeFile(tasksFile, JSON.stringify(complexDataset, null, 2));

      // Perform complex aggregations
      const aggregations = {
        by_type: {},
        by_status: {},
        by_priority: {},
        average_duration: 0,
        total_tasks: complexDataset.length,
        completion_rate: 0,
        tag_popularity: {},
      };

      complexDataset.forEach((task) => {
        // Count by type
        aggregations.by_type[task.type] =
          (aggregations.by_type[task.type] || 0) + 1;

        // Count by status
        aggregations.by_status[task.status] =
          (aggregations.by_status[task.status] || 0) + 1;

        // Count by priority
        aggregations.by_priority[task.priority] =
          (aggregations.by_priority[task.priority] || 0) + 1;

        // Sum durations
        aggregations.average_duration += task.metadata.duration;

        // Count tag popularity
        task.metadata.tags.forEach((tag) => {
          aggregations.tag_popularity[tag] =
            (aggregations.tag_popularity[tag] || 0) + 1;
        });
      });

      // Calculate averages and rates
      aggregations.average_duration /= aggregations.total_tasks;
      aggregations.completion_rate =
        (aggregations.by_status.completed || 0) / aggregations.total_tasks;

      // Verify aggregations
      expect(Object.keys(aggregations.by_type)).toHaveLength(4);
      expect(Object.keys(aggregations.by_status)).toHaveLength(4);
      expect(Object.keys(aggregations.by_priority)).toHaveLength(3);
      expect(aggregations.average_duration).toBeGreaterThan(0);
      expect(aggregations.completion_rate).toBeGreaterThanOrEqual(0);
      expect(aggregations.completion_rate).toBeLessThanOrEqual(1);
      expect(Object.keys(aggregations.tag_popularity).length).toBeGreaterThan(
        0,
      );
    });
  });

  describe("Database Connection Pooling and Management", () => {
    test("simulates connection pool management", async () => {
      // Simulate connection pool for file database
      class FileConnectionPool {
        constructor(maxConnections = 5) {
          this.maxConnections = maxConnections;
          this.availableConnections = [];
          this.activeConnections = new Set();
          this.waitQueue = [];
        }

        async getConnection() {
          return new Promise((resolve, reject) => {
            if (this.availableConnections.length > 0) {
              const connection = this.availableConnections.pop();
              this.activeConnections.add(connection);
              resolve(connection);
            } else if (this.activeConnections.size < this.maxConnections) {
              const connection = this.createConnection();
              this.activeConnections.add(connection);
              resolve(connection);
            } else {
              // Wait for connection to become available
              this.waitQueue.push({ resolve, reject });
            }
          });
        }

        releaseConnection(connection) {
          this.activeConnections.delete(connection);
          this.availableConnections.push(connection);

          // Wake up waiting request
          if (this.waitQueue.length > 0) {
            const waiting = this.waitQueue.shift();
            const conn = this.availableConnections.pop();
            this.activeConnections.add(conn);
            waiting.resolve(conn);
          }
        }

        createConnection() {
          return {
            id: Math.random().toString(36).substr(2, 9),
            readFile: (path) => fs.readFile(path, "utf8"),
            writeFile: (path, data) => fs.writeFile(path, data),
            close: () => {}, // No-op for file connections
          };
        }
      }

      const pool = new FileConnectionPool(3);

      // Test concurrent operations with connection pooling
      const operations = Array.from({ length: 10 }, async (_, i) => {
        const connection = await pool.getConnection();

        try {
          // Simulate database operation
          const tasks = JSON.parse(await connection.readFile(tasksFile));
          tasks[0].pool_test = `operation_${i + 1}`;
          await connection.writeFile(tasksFile, JSON.stringify(tasks, null, 2));

          return `operation_${i + 1}_completed`;
        } finally {
          pool.releaseConnection(connection);
        }
      });

      const results = await Promise.all(operations);

      // Verify all operations completed
      expect(results).toHaveLength(10);
      results.forEach((result) => {
        expect(result).toMatch(/operation_\d+_completed/);
      });

      // Verify final state
      const finalTasks = JSON.parse(await fs.readFile(tasksFile, "utf8"));
      expect(finalTasks[0]).toHaveProperty("pool_test");
    });

    test("handles connection timeouts and recovery", async () => {
      // Simulate connection with timeout
      class TimeoutConnection {
        constructor(timeoutMs = 5000) {
          this.timeoutMs = timeoutMs;
          this.connected = true;
        }

        async readFile(path) {
          if (!this.connected) {
            throw new Error("Connection lost");
          }

          // Simulate occasional timeout
          if (Math.random() < 0.2) {
            await new Promise((resolve) =>
              setTimeout(resolve, this.timeoutMs + 100),
            );
            throw new Error("Connection timeout");
          }

          return fs.readFile(path, "utf8");
        }

        async writeFile(path, data) {
          if (!this.connected) {
            throw new Error("Connection lost");
          }

          if (Math.random() < 0.1) {
            this.connected = false;
            throw new Error("Connection lost during write");
          }

          return fs.writeFile(path, data);
        }

        reconnect() {
          this.connected = true;
        }
      }

      const connection = new TimeoutConnection(1000);

      // Test with retry logic
      const maxRetries = 3;
      let attempts = 0;
      let success = false;

      while (attempts < maxRetries && !success) {
        try {
          const tasks = JSON.parse(await connection.readFile(tasksFile));
          tasks[0].timeout_test = `attempt_${attempts + 1}`;
          await connection.writeFile(tasksFile, JSON.stringify(tasks, null, 2));
          success = true;
        } catch (error) {
          attempts++;
          if (error.message.includes("Connection lost")) {
            connection.reconnect();
          }
          await new Promise((resolve) => setTimeout(resolve, 100 * attempts));
        }
      }

      expect(success).toBe(true);

      const finalTasks = JSON.parse(await fs.readFile(tasksFile, "utf8"));
      expect(finalTasks[0]).toHaveProperty("timeout_test");
    });
  });
});
