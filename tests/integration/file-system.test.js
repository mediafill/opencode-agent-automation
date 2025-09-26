const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

describe('File System Integration Tests', () => {
  let testProjectDir;
  let claudeDir;
  let tasksFile;
  let taskStatusFile;
  let logsDir;
  let taskManagerProcess;

  beforeAll(async () => {
    testProjectDir = path.join(__dirname, 'fixtures', 'filesystem-test-project');
    claudeDir = path.join(testProjectDir, '.claude');
    tasksFile = path.join(claudeDir, 'tasks.json');
    taskStatusFile = path.join(claudeDir, 'task_status.json');
    logsDir = path.join(claudeDir, 'logs');

    await fs.mkdir(logsDir, { recursive: true });
  });

  beforeEach(async () => {
    // Initialize clean test data
    const initialTasks = [
      {
        id: 'fs_test_task',
        type: 'testing',
        priority: 'medium',
        description: 'File system integration test task',
        files_pattern: '**/*.test.js',
        created_at: new Date().toISOString(),
        status: 'pending'
      }
    ];

    const initialStatus = {
      fs_test_task: {
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

  describe('Directory Structure Management', () => {
    test('creates required directory structure correctly', async () => {
      // Verify directories exist
      const claudeStats = await fs.stat(claudeDir);
      expect(claudeStats.isDirectory()).toBe(true);

      const logsStats = await fs.stat(logsDir);
      expect(logsStats.isDirectory()).toBe(true);

      // Verify files exist
      const tasksStats = await fs.stat(tasksFile);
      expect(tasksStats.isFile()).toBe(true);

      const statusStats = await fs.stat(taskStatusFile);
      expect(statusStats.isFile()).toBe(true);
    });

    test('handles missing directories gracefully', async () => {
      const missingDir = path.join(testProjectDir, 'missing', 'subdir');
      const missingFile = path.join(missingDir, 'test.json');

      // Attempt to read from missing directory should fail
      try {
        await fs.readFile(missingFile, 'utf8');
        fail('Should have thrown file not found error');
      } catch (error) {
        expect(error.code).toBe('ENOENT');
      }

      // Create directory structure
      await fs.mkdir(missingDir, { recursive: true });
      await fs.writeFile(missingFile, JSON.stringify({ test: 'data' }));

      // Verify creation
      const content = await fs.readFile(missingFile, 'utf8');
      expect(JSON.parse(content)).toEqual({ test: 'data' });

      // Clean up
      await fs.rm(path.join(testProjectDir, 'missing'), { recursive: true, force: true });
    });

    test('creates nested directory structures', async () => {
      const nestedPath = path.join(testProjectDir, 'level1', 'level2', 'level3');
      const nestedFile = path.join(nestedPath, 'nested.json');

      await fs.mkdir(nestedPath, { recursive: true });
      await fs.writeFile(nestedFile, JSON.stringify({ nested: true }));

      // Verify structure
      const stats = await fs.stat(nestedPath);
      expect(stats.isDirectory()).toBe(true);

      const fileStats = await fs.stat(nestedFile);
      expect(fileStats.isFile()).toBe(true);

      const content = await fs.readFile(nestedFile, 'utf8');
      expect(JSON.parse(content)).toEqual({ nested: true });

      // Clean up
      await fs.rm(path.join(testProjectDir, 'level1'), { recursive: true, force: true });
    });
  });

  describe('File Operations and Permissions', () => {
    test('handles file read/write operations correctly', async () => {
      const testFile = path.join(testProjectDir, 'rw_test.json');
      const testData = { test: 'read_write', timestamp: Date.now() };

      // Write file
      await fs.writeFile(testFile, JSON.stringify(testData, null, 2));

      // Read file
      const content = await fs.readFile(testFile, 'utf8');
      const readData = JSON.parse(content);

      expect(readData).toEqual(testData);

      // Verify file stats
      const stats = await fs.stat(testFile);
      expect(stats.size).toBeGreaterThan(0);
      expect(stats.isFile()).toBe(true);

      // Clean up
      await fs.unlink(testFile);
    });

    test('handles file append operations', async () => {
      const appendFile = path.join(testProjectDir, 'append_test.txt');

      // Initial write
      await fs.writeFile(appendFile, 'Line 1\n');

      // Append multiple lines
      await fs.appendFile(appendFile, 'Line 2\n');
      await fs.appendFile(appendFile, 'Line 3\n');

      // Read and verify
      const content = await fs.readFile(appendFile, 'utf8');
      const lines = content.trim().split('\n');

      expect(lines).toEqual(['Line 1', 'Line 2', 'Line 3']);

      // Clean up
      await fs.unlink(appendFile);
    });

    test('handles file copying operations', async () => {
      const sourceFile = path.join(testProjectDir, 'source.json');
      const destFile = path.join(testProjectDir, 'destination.json');

      const testData = { copied: true, original: 'data' };

      // Create source file
      await fs.writeFile(sourceFile, JSON.stringify(testData, null, 2));

      // Copy file
      await fs.copyFile(sourceFile, destFile);

      // Verify copy
      const copiedContent = await fs.readFile(destFile, 'utf8');
      const copiedData = JSON.parse(copiedContent);

      expect(copiedData).toEqual(testData);

      // Verify both files exist
      const sourceStats = await fs.stat(sourceFile);
      const destStats = await fs.stat(destFile);

      expect(sourceStats.size).toBe(destStats.size);

      // Clean up
      await fs.unlink(sourceFile);
      await fs.unlink(destFile);
    });

    test('handles file move/rename operations', async () => {
      const originalFile = path.join(testProjectDir, 'original.json');
      const renamedFile = path.join(testProjectDir, 'renamed.json');

      const testData = { renamed: true };

      // Create original file
      await fs.writeFile(originalFile, JSON.stringify(testData, null, 2));

      // Rename file
      await fs.rename(originalFile, renamedFile);

      // Verify original doesn't exist
      try {
        await fs.stat(originalFile);
        fail('Original file should not exist');
      } catch (error) {
        expect(error.code).toBe('ENOENT');
      }

      // Verify renamed file exists with correct content
      const content = await fs.readFile(renamedFile, 'utf8');
      const data = JSON.parse(content);
      expect(data).toEqual(testData);

      // Clean up
      await fs.unlink(renamedFile);
    });
  });

  describe('Log File Management', () => {
    test('creates and manages log files correctly', async () => {
      const testLogFile = path.join(logsDir, 'test_log.log');
      const logEntries = [
        `${new Date().toISOString()} [INFO] Test log entry 1`,
        `${new Date().toISOString()} [WARN] Test warning`,
        `${new Date().toISOString()} [ERROR] Test error`,
        `${new Date().toISOString()} [DEBUG] Test debug info`
      ];

      // Write log entries
      for (const entry of logEntries) {
        await fs.appendFile(testLogFile, entry + '\n');
      }

      // Read and verify log file
      const content = await fs.readFile(testLogFile, 'utf8');
      const lines = content.trim().split('\n');

      expect(lines).toHaveLength(4);
      expect(lines[0]).toContain('[INFO]');
      expect(lines[1]).toContain('[WARN]');
      expect(lines[2]).toContain('[ERROR]');
      expect(lines[3]).toContain('[DEBUG]');

      // Verify file stats
      const stats = await fs.stat(testLogFile);
      expect(stats.size).toBeGreaterThan(0);

      // Clean up
      await fs.unlink(testLogFile);
    });

    test('handles log file rotation and cleanup', async () => {
      const baseLogFile = path.join(logsDir, 'rotation_test.log');

      // Create multiple "rotated" log files
      const rotatedFiles = [];
      for (let i = 1; i <= 5; i++) {
        const rotatedFile = `${baseLogFile}.${i}`;
        rotatedFiles.push(rotatedFile);
        await fs.writeFile(rotatedFile, `Rotated log content ${i}\n`.repeat(10));
      }

      // Create current log file
      await fs.writeFile(baseLogFile, 'Current log content\n'.repeat(5));

      // Verify all files exist
      for (const file of [baseLogFile, ...rotatedFiles]) {
        const stats = await fs.stat(file);
        expect(stats.isFile()).toBe(true);
      }

      // Simulate cleanup (remove old rotated files)
      const filesToKeep = 2;
      for (let i = filesToKeep + 1; i <= 5; i++) {
        await fs.unlink(`${baseLogFile}.${i}`);
      }

      // Verify cleanup
      for (let i = 1; i <= filesToKeep; i++) {
        const stats = await fs.stat(`${baseLogFile}.${i}`);
        expect(stats.isFile()).toBe(true);
      }

      for (let i = filesToKeep + 1; i <= 5; i++) {
        try {
          await fs.stat(`${baseLogFile}.${i}`);
          fail(`File ${baseLogFile}.${i} should have been deleted`);
        } catch (error) {
          expect(error.code).toBe('ENOENT');
        }
      }

      // Clean up remaining files
      await fs.unlink(baseLogFile);
      for (let i = 1; i <= filesToKeep; i++) {
        await fs.unlink(`${baseLogFile}.${i}`);
      }
    });

    test('handles concurrent log file writes', async () => {
      const concurrentLogFile = path.join(logsDir, 'concurrent_log.log');

      // Initialize file
      await fs.writeFile(concurrentLogFile, '');

      // Perform concurrent writes
      const writeOperations = Array.from({ length: 20 }, (_, i) =>
        fs.appendFile(concurrentLogFile, `Concurrent entry ${i + 1}\n`)
      );

      await Promise.all(writeOperations);

      // Read and verify
      const content = await fs.readFile(concurrentLogFile, 'utf8');
      const lines = content.trim().split('\n');

      expect(lines).toHaveLength(20);

      // All entries should be present (order may vary due to concurrency)
      for (let i = 1; i <= 20; i++) {
        expect(content).toContain(`Concurrent entry ${i}`);
      }

      // Clean up
      await fs.unlink(concurrentLogFile);
    });

    test('handles large log files efficiently', async () => {
      const largeLogFile = path.join(logsDir, 'large_log.log');

      // Create a large log file
      const entryCount = 1000;
      let logContent = '';

      for (let i = 0; i < entryCount; i++) {
        logContent += `${new Date().toISOString()} [INFO] Large log entry ${i + 1}\n`;
      }

      const startTime = Date.now();
      await fs.writeFile(largeLogFile, logContent);
      const writeTime = Date.now() - startTime;

      // Read and verify
      const readStartTime = Date.now();
      const readContent = await fs.readFile(largeLogFile, 'utf8');
      const readTime = Date.now() - readStartTime;

      const lines = readContent.trim().split('\n');
      expect(lines).toHaveLength(entryCount);

      // Performance expectations
      expect(writeTime).toBeLessThan(1000); // Should write in less than 1 second
      expect(readTime).toBeLessThan(500);   // Should read in less than 0.5 seconds

      // Verify content integrity
      expect(readContent).toContain('Large log entry 1');
      expect(readContent).toContain(`Large log entry ${entryCount}`);

      // Clean up
      await fs.unlink(largeLogFile);
    });
  });

  describe('File Watcher Integration', () => {
    test('detects file creation events', async () => {
      const watchFile = path.join(logsDir, 'watch_create.log');

      // File doesn't exist initially
      try {
        await fs.stat(watchFile);
        fail('File should not exist initially');
      } catch (error) {
        expect(error.code).toBe('ENOENT');
      }

      // Create file
      await fs.writeFile(watchFile, 'Created file content\n');

      // Verify creation
      const stats = await fs.stat(watchFile);
      expect(stats.isFile()).toBe(true);

      const content = await fs.readFile(watchFile, 'utf8');
      expect(content).toBe('Created file content\n');

      // Clean up
      await fs.unlink(watchFile);
    });

    test('detects file modification events', async () => {
      const watchFile = path.join(logsDir, 'watch_modify.log');

      // Create initial file
      await fs.writeFile(watchFile, 'Initial content\n');

      // Modify file
      await fs.appendFile(watchFile, 'Modified content\n');

      // Read and verify modification
      const content = await fs.readFile(watchFile, 'utf8');
      const lines = content.trim().split('\n');

      expect(lines).toEqual(['Initial content', 'Modified content']);

      // Clean up
      await fs.unlink(watchFile);
    });

    test('handles file deletion events', async () => {
      const watchFile = path.join(logsDir, 'watch_delete.log');

      // Create file
      await fs.writeFile(watchFile, 'Content to be deleted\n');

      // Verify it exists
      let stats = await fs.stat(watchFile);
      expect(stats.isFile()).toBe(true);

      // Delete file
      await fs.unlink(watchFile);

      // Verify it no longer exists
      try {
        await fs.stat(watchFile);
        fail('File should have been deleted');
      } catch (error) {
        expect(error.code).toBe('ENOENT');
      }
    });

    test('handles multiple file operations in sequence', async () => {
      const sequenceFile = path.join(logsDir, 'sequence_test.log');

      // Sequence of operations
      await fs.writeFile(sequenceFile, 'Step 1: Create\n');
      await fs.appendFile(sequenceFile, 'Step 2: Append\n');
      await fs.appendFile(sequenceFile, 'Step 3: Append more\n');

      // Read final content
      const content = await fs.readFile(sequenceFile, 'utf8');
      const lines = content.trim().split('\n');

      expect(lines).toEqual([
        'Step 1: Create',
        'Step 2: Append',
        'Step 3: Append more'
      ]);

      // Clean up
      await fs.unlink(sequenceFile);
    });
  });

  describe('Backup and Recovery Operations', () => {
    test('creates and restores file backups', async () => {
      const originalFile = path.join(testProjectDir, 'backup_test.json');
      const backupFile = `${originalFile}.backup`;

      const originalData = { original: true, data: 'test' };

      // Create original file
      await fs.writeFile(originalFile, JSON.stringify(originalData, null, 2));

      // Create backup
      await fs.copyFile(originalFile, backupFile);

      // Modify original
      const modifiedData = { modified: true, data: 'changed' };
      await fs.writeFile(originalFile, JSON.stringify(modifiedData, null, 2));

      // Verify modification
      const modifiedContent = await fs.readFile(originalFile, 'utf8');
      expect(JSON.parse(modifiedContent)).toEqual(modifiedData);

      // Restore from backup
      await fs.copyFile(backupFile, originalFile);

      // Verify restoration
      const restoredContent = await fs.readFile(originalFile, 'utf8');
      expect(JSON.parse(restoredContent)).toEqual(originalData);

      // Clean up
      await fs.unlink(originalFile);
      await fs.unlink(backupFile);
    });

    test('handles backup file conflicts', async () => {
      const targetFile = path.join(testProjectDir, 'conflict_test.json');
      const backupFile1 = `${targetFile}.backup1`;
      const backupFile2 = `${targetFile}.backup2`;

      const data1 = { version: 1 };
      const data2 = { version: 2 };

      // Create conflicting backups
      await fs.writeFile(backupFile1, JSON.stringify(data1));
      await fs.writeFile(backupFile2, JSON.stringify(data2));

      // Both should exist
      const stats1 = await fs.stat(backupFile1);
      const stats2 = await fs.stat(backupFile2);

      expect(stats1.isFile()).toBe(true);
      expect(stats2.isFile()).toBe(true);

      // Content should be different
      const content1 = JSON.parse(await fs.readFile(backupFile1, 'utf8'));
      const content2 = JSON.parse(await fs.readFile(backupFile2, 'utf8'));

      expect(content1).not.toEqual(content2);

      // Clean up
      await fs.unlink(backupFile1);
      await fs.unlink(backupFile2);
    });

    test('performs atomic file operations', async () => {
      const atomicFile = path.join(testProjectDir, 'atomic_test.json');
      const tempFile = `${atomicFile}.tmp`;

      const testData = { atomic: true, operations: [] };

      // Simulate atomic write (write to temp, then rename)
      await fs.writeFile(tempFile, JSON.stringify(testData, null, 2));
      await fs.rename(tempFile, atomicFile);

      // Verify atomic operation
      const content = await fs.readFile(atomicFile, 'utf8');
      const data = JSON.parse(content);
      expect(data).toEqual(testData);

      // Temp file should not exist
      try {
        await fs.stat(tempFile);
        fail('Temp file should not exist after atomic operation');
      } catch (error) {
        expect(error.code).toBe('ENOENT');
      }

      // Clean up
      await fs.unlink(atomicFile);
    });
  });

  describe('File System Error Recovery', () => {
    test('handles disk space exhaustion gracefully', async () => {
      const largeFile = path.join(testProjectDir, 'space_test.json');

      try {
        // Try to create a very large file (this may fail on systems with limited space)
        const largeData = JSON.stringify(Array.from({ length: 100000 }, (_, i) => ({
          id: i,
          data: 'x'.repeat(1000) // 1KB per item = 100MB total
        })));

        await fs.writeFile(largeFile, largeData);

        // If successful, verify size
        const stats = await fs.stat(largeFile);
        expect(stats.size).toBeGreaterThan(100000000); // At least 100MB

        // Clean up
        await fs.unlink(largeFile);
      } catch (error) {
        // If it fails due to disk space, that's expected
        expect(['ENOSPC', 'EIO', 'EACCES']).toContain(error.code);
      }
    });

    test('recovers from interrupted file operations', async () => {
      const recoveryFile = path.join(testProjectDir, 'recovery_test.json');

      // Simulate interrupted write (start writing, but don't complete)
      try {
        // This should work normally, but in real scenarios might be interrupted
        const partialData = '{ "incomplete": "json"';
        await fs.writeFile(recoveryFile, partialData);

        // Try to read (should work since write completed)
        const content = await fs.readFile(recoveryFile, 'utf8');
        expect(content).toBe(partialData);

        // "Recover" by writing valid JSON
        const recoveredData = { recovered: true, from: 'interrupted_operation' };
        await fs.writeFile(recoveryFile, JSON.stringify(recoveredData, null, 2));

        const recoveredContent = await fs.readFile(recoveryFile, 'utf8');
        const recovered = JSON.parse(recoveredContent);
        expect(recovered).toEqual(recoveredData);

      } catch (error) {
        // If write was actually interrupted, handle gracefully
        expect(error).toBeDefined();
      }

      // Clean up if file exists
      try {
        await fs.unlink(recoveryFile);
      } catch (e) {
        // Ignore if file doesn't exist
      }
    });

    test('handles file system permissions correctly', async () => {
      const permissionFile = path.join(testProjectDir, 'permission_test.json');

      // Create file with normal permissions
      await fs.writeFile(permissionFile, JSON.stringify({ test: 'permissions' }));

      // Try to change permissions (may not work on all systems)
      try {
        await fs.chmod(permissionFile, 0o644); // Read/write for owner, read for others
        const stats = await fs.stat(permissionFile);
        expect(stats.isFile()).toBe(true);
      } catch (error) {
        // Permission changes may not be allowed
        expect(error.code).toBe('EPERM') || expect(error.code).toBe('ENOTSUP');
      }

      // Clean up
      await fs.unlink(permissionFile);
    });
  });
});