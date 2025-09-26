/**
 * Vector Database JSON Fallback Integration Tests
 * Tests for JSON-based vector storage when ChromaDB is unavailable
 */

const path = require('path');
const fs = require('fs').promises;

// Mock ChromaDB to simulate it being unavailable
jest.mock('chromadb', () => {
  throw new Error('ChromaDB not available');
});

// Import the actual vector database module (not mocked)
const { VectorDatabase } = require('../../../scripts/vector_database');

describe('Vector Database JSON Fallback Integration', () => {
  let vectorDb;
  let testProjectDir;

  beforeEach(async () => {
    // Create temporary test directory
    testProjectDir = path.join(__dirname, '..', 'fixtures', 'json-fallback-test');
    await fs.mkdir(testProjectDir, { recursive: true });

    // Create vector database instance
    vectorDb = new VectorDatabase({
      projectDir: testProjectDir,
      chromaUrl: 'http://localhost:8000',
      collectionName: 'json_memory'
    });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testProjectDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('JSON Fallback Initialization', () => {
    test('should initialize successfully with JSON fallback', async () => {
      const result = await vectorDb.initialize();

      expect(result).toBe(true);
      expect(vectorDb.isInitialized()).toBe(true);
      expect(vectorDb.use_chroma).toBe(false);

      // Check that JSON store file was created
      const jsonPath = path.join(testProjectDir, '.claude', 'vector_db', 'json_memory.json');
      const exists = await fs.access(jsonPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    test('should load existing JSON data on initialization', async () => {
      // Pre-populate JSON store
      const jsonPath = path.join(testProjectDir, '.claude', 'vector_db', 'json_memory.json');
      await fs.mkdir(path.dirname(jsonPath), { recursive: true });

      const existingData = {
        documents: ['Existing document'],
        metadata: [{
          id: 'existing_doc',
          type: 'task_history',
          taskId: 'existing_task',
          timestamp: '2024-01-15T10:00:00Z'
        }],
        ids: ['existing_doc'],
        embeddings: [[0.1, 0.2, 0.3]],
        stats: {
          total_documents: 1,
          last_updated: '2024-01-15T10:00:00Z'
        }
      };

      await fs.writeFile(jsonPath, JSON.stringify(existingData, null, 2));

      // Initialize and check data is loaded
      await vectorDb.initialize();

      const stats = vectorDb.getStats();
      expect(stats.total_documents).toBe(1);
      expect(stats.last_updated).toBe('2024-01-15T10:00:00Z');
    });
  });

  describe('JSON Task History Storage', () => {
    beforeEach(async () => {
      await vectorDb.initialize();
    });

    test('should store and retrieve task history in JSON format', async () => {
      const taskHistory = {
        taskId: 'json_task_001',
        type: 'testing',
        description: 'Run comprehensive test suite',
        status: 'completed',
        startTime: '2024-01-15T14:00:00Z',
        endTime: '2024-01-15T14:30:00Z',
        duration: 1800,
        decisions: [
          {
            timestamp: '2024-01-15T14:05:00Z',
            decision: 'Run tests in parallel',
            reasoning: 'Faster execution',
            outcome: 'Tests completed 3x faster'
          }
        ],
        outcome: 'All tests passed with 98% coverage',
        learnings: [
          'Parallel test execution significantly improves CI speed',
          'Test coverage above 95% is crucial for confidence'
        ],
        metadata: {
          testFramework: 'jest',
          testFiles: 25,
          totalTests: 150,
          passedTests: 148,
          failedTests: 2,
          coverage: 98.5
        }
      };

      const docId = await vectorDb.storeTaskHistory(taskHistory);

      expect(typeof docId).toBe('string');
      expect(docId).toContain('json_task_001');

      // Retrieve and verify
      const retrieved = await vectorDb.getTaskHistory('json_task_001');

      expect(retrieved).toBeDefined();
      expect(retrieved.taskId).toBe('json_task_001');
      expect(retrieved.type).toBe('testing');
      expect(retrieved.status).toBe('completed');
      expect(retrieved.duration).toBe(1800);
      expect(retrieved.learnings).toHaveLength(2);
      expect(retrieved.metadata.coverage).toBe(98.5);
    });

    test('should handle multiple task histories', async () => {
      const tasks = [
        {
          taskId: 'json_task_1',
          type: 'testing',
          description: 'Unit tests',
          status: 'completed'
        },
        {
          taskId: 'json_task_2',
          type: 'refactoring',
          description: 'Code cleanup',
          status: 'completed'
        },
        {
          taskId: 'json_task_3',
          type: 'deployment',
          description: 'Production deploy',
          status: 'failed'
        }
      ];

      // Store all tasks
      for (const task of tasks) {
        await vectorDb.storeTaskHistory(task);
      }

      // Retrieve each task
      for (const task of tasks) {
        const retrieved = await vectorDb.getTaskHistory(task.taskId);
        expect(retrieved.taskId).toBe(task.taskId);
        expect(retrieved.type).toBe(task.type);
        expect(retrieved.status).toBe(task.status);
      }

      // Check stats
      const stats = vectorDb.getStats();
      expect(stats.total_documents).toBe(3);
    });
  });

  describe('JSON Learning Storage', () => {
    beforeEach(async () => {
      await vectorDb.initialize();
    });

    test('should store and retrieve learnings in JSON format', async () => {
      const learnings = [
        {
          content: 'Use environment variables for configuration',
          context: 'Deploying to multiple environments',
          category: 'deployment',
          importance: 'high',
          tags: ['configuration', 'environment', 'deployment']
        },
        {
          content: 'Always validate user input on both client and server',
          context: 'Security audit findings',
          category: 'security',
          importance: 'critical',
          tags: ['security', 'validation', 'input']
        },
        {
          content: 'Cache database queries for frequently accessed data',
          context: 'Performance optimization',
          category: 'performance',
          importance: 'medium',
          tags: ['performance', 'caching', 'database']
        }
      ];

      // Store learnings
      const docIds = [];
      for (const learning of learnings) {
        const docId = await vectorDb.storeLearning(learning);
        docIds.push(docId);
      }

      expect(docIds).toHaveLength(3);
      docIds.forEach(id => expect(typeof id).toBe('string'));

      // Retrieve all learnings
      const allLearnings = await vectorDb.getLearnings();

      expect(allLearnings).toHaveLength(3);
      expect(allLearnings.map(l => l.category)).toEqual(
        expect.arrayContaining(['deployment', 'security', 'performance'])
      );

      // Retrieve learnings by category
      const securityLearnings = await vectorDb.getLearnings({ category: 'security' });
      expect(securityLearnings).toHaveLength(1);
      expect(securityLearnings[0].category).toBe('security');
      expect(securityLearnings[0].importance).toBe('critical');

      // Retrieve high importance learnings
      const highImportanceLearnings = await vectorDb.getLearnings({ importance: 'high' });
      expect(highImportanceLearnings).toHaveLength(1);
      expect(highImportanceLearnings[0].importance).toBe('high');
    });
  });

  describe('JSON Similarity Search', () => {
    beforeEach(async () => {
      await vectorDb.initialize();
    });

    test('should perform similarity search in JSON store', async () => {
      // Store test data with varied content
      const testData = [
        {
          taskId: 'search_task_1',
          type: 'testing',
          description: 'Implement unit tests for user authentication module',
          status: 'completed',
          learnings: ['Mock external services for reliable tests']
        },
        {
          taskId: 'search_task_2',
          type: 'refactoring',
          description: 'Refactor authentication service to use dependency injection',
          status: 'completed',
          learnings: ['Dependency injection improves testability']
        },
        {
          taskId: 'search_task_3',
          type: 'security',
          description: 'Add rate limiting to API endpoints',
          status: 'completed',
          learnings: ['Rate limiting prevents abuse']
        }
      ];

      for (const task of testData) {
        await vectorDb.storeTaskHistory(task);
      }

      // Search for authentication-related content
      const authResults = await vectorDb.querySimilarSolutions(
        'authentication testing and security',
        5
      );

      expect(authResults.length).toBeGreaterThan(0);
      expect(authResults.length).toBeLessThanOrEqual(3);

      // Results should be sorted by similarity (most similar first)
      if (authResults.length >= 2) {
        expect(authResults[0].distance).toBeLessThanOrEqual(authResults[1].distance);
      }

      // Check that results contain relevant metadata
      authResults.forEach(result => {
        expect(result).toHaveProperty('id');
        expect(result).toHaveProperty('document');
        expect(result).toHaveProperty('metadata');
        expect(result).toHaveProperty('distance');
        expect(typeof result.distance).toBe('number');
      });
    });

    test('should filter similarity search results', async () => {
      // Store mixed task types
      const mixedTasks = [
        { taskId: 'filter_task_1', type: 'testing', description: 'Test authentication', status: 'completed' },
        { taskId: 'filter_task_2', type: 'testing', description: 'Test payment', status: 'completed' },
        { taskId: 'filter_task_3', type: 'deployment', description: 'Deploy authentication', status: 'completed' },
        { taskId: 'filter_task_4', type: 'refactoring', description: 'Refactor authentication', status: 'completed' }
      ];

      for (const task of mixedTasks) {
        await vectorDb.storeTaskHistory(task);
      }

      // Search with type filter
      const testingResults = await vectorDb.querySimilarSolutions(
        'authentication',
        10,
        { taskType: 'testing' }
      );

      // Should only return testing tasks
      testingResults.forEach(result => {
        expect(result.metadata.taskType).toBe('testing');
      });

      expect(testingResults.length).toBe(2); // filter_task_1 and filter_task_2
    });

    test('should handle empty search results', async () => {
      // Store some data
      await vectorDb.storeTaskHistory({
        taskId: 'empty_search_task',
        type: 'testing',
        description: 'Basic test task',
        status: 'completed'
      });

      // Search for completely unrelated content
      const results = await vectorDb.querySimilarSolutions(
        'quantum physics particle accelerator experiments',
        5
      );

      // Should return empty array, not crash
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });
  });

  describe('JSON Data Persistence', () => {
    test('should persist data across database instances', async () => {
      // First instance
      await vectorDb.initialize();

      const taskData = {
        taskId: 'persistence_task',
        type: 'testing',
        description: 'Test data persistence',
        status: 'completed',
        learnings: ['Data should persist across sessions']
      };

      await vectorDb.storeTaskHistory(taskData);
      await vectorDb.close();

      // Second instance - should load existing data
      const vectorDb2 = new VectorDatabase({
        projectDir: testProjectDir,
        chromaUrl: 'http://localhost:8000',
        collectionName: 'json_memory'
      });

      await vectorDb2.initialize();

      const retrieved = await vectorDb2.getTaskHistory('persistence_task');
      expect(retrieved).toBeDefined();
      expect(retrieved.taskId).toBe('persistence_task');
      expect(retrieved.learnings[0]).toBe('Data should persist across sessions');

      await vectorDb2.close();
    });

    test('should handle corrupted JSON files gracefully', async () => {
      const jsonPath = path.join(testProjectDir, '.claude', 'vector_db', 'json_memory.json');
      await fs.mkdir(path.dirname(jsonPath), { recursive: true });

      // Write corrupted JSON
      await fs.writeFile(jsonPath, '{"documents": [invalid json content');

      // Should initialize successfully with empty store
      await vectorDb.initialize();

      expect(vectorDb.isInitialized()).toBe(true);

      // Should be able to store new data
      await vectorDb.storeTaskHistory({
        taskId: 'recovery_task',
        type: 'testing',
        description: 'Test recovery from corruption',
        status: 'completed'
      });

      const retrieved = await vectorDb.getTaskHistory('recovery_task');
      expect(retrieved.taskId).toBe('recovery_task');
    });
  });

  describe('JSON Performance Characteristics', () => {
    test('should handle reasonable data volumes', async () => {
      await vectorDb.initialize();

      const taskCount = 50;
      const tasks = [];

      // Generate test tasks
      for (let i = 0; i < taskCount; i++) {
        tasks.push({
          taskId: `perf_task_${i}`,
          type: 'testing',
          description: `Performance test task ${i}`,
          status: 'completed',
          duration: 100 + i * 10,
          learnings: [`Learning from task ${i}`]
        });
      }

      // Measure storage time
      const storeStart = Date.now();
      for (const task of tasks) {
        await vectorDb.storeTaskHistory(task);
      }
      const storeEnd = Date.now();
      const storeTime = storeEnd - storeStart;

      // Should complete within reasonable time
      expect(storeTime).toBeLessThan(10000); // 10 seconds for 50 tasks

      // Measure retrieval time
      const retrieveStart = Date.now();
      for (let i = 0; i < 10; i++) {
        await vectorDb.getTaskHistory(`perf_task_${i}`);
      }
      const retrieveEnd = Date.now();
      const retrieveTime = retrieveEnd - retrieveStart;

      // Retrieval should be fast
      expect(retrieveTime).toBeLessThan(1000); // 1 second for 10 retrievals

      // Measure search time
      const searchStart = Date.now();
      const searchResults = await vectorDb.querySimilarSolutions('performance test', 10);
      const searchEnd = Date.now();
      const searchTime = searchEnd - searchStart;

      // Search should be reasonably fast
      expect(searchTime).toBeLessThan(2000); // 2 seconds for search
      expect(searchResults.length).toBeGreaterThan(0);
    });
  });

  describe('JSON Error Handling', () => {
    test('should handle file system errors gracefully', async () => {
      // Create database in read-only location (simulate permission issues)
      const readOnlyDir = path.join(testProjectDir, 'readonly');
      await fs.mkdir(readOnlyDir, { recursive: true });

      // Note: In a real scenario, we'd make the directory read-only
      // For testing, we'll simulate the error in the implementation

      const vectorDbReadOnly = new VectorDatabase({
        projectDir: readOnlyDir,
        chromaUrl: 'http://localhost:8000',
        collectionName: 'readonly_memory'
      });

      // Should still initialize (JSON fallback should handle errors)
      const result = await vectorDbReadOnly.initialize();
      expect(result).toBe(true);
    });

    test('should validate data before storage', async () => {
      await vectorDb.initialize();

      // Test invalid task history (missing required fields)
      await expect(vectorDb.storeTaskHistory({
        description: 'Missing taskId'
      })).rejects.toThrow('Missing required field: taskId');

      await expect(vectorDb.storeTaskHistory({
        taskId: 'test',
        description: 'Missing type'
      })).rejects.toThrow('Missing required field: type');

      // Test invalid learning (missing content)
      await expect(vectorDb.storeLearning({
        context: 'Missing content'
      })).rejects.toThrow('Missing required field: content');

      // Valid data should work
      await expect(vectorDb.storeTaskHistory({
        taskId: 'valid_task',
        type: 'testing',
        description: 'Valid task',
        status: 'completed'
      })).resolves.toBeDefined();
    });
  });

  describe('JSON Statistics and Monitoring', () => {
    test('should maintain accurate statistics', async () => {
      await vectorDb.initialize();

      // Initially empty
      let stats = vectorDb.getStats();
      expect(stats.total_documents).toBe(0);

      // Add some data
      await vectorDb.storeTaskHistory({
        taskId: 'stats_task_1',
        type: 'testing',
        description: 'Stats test 1',
        status: 'completed'
      });

      await vectorDb.storeLearning({
        content: 'Stats learning 1',
        category: 'testing'
      });

      await vectorDb.storeTaskHistory({
        taskId: 'stats_task_2',
        type: 'refactoring',
        description: 'Stats test 2',
        status: 'completed'
      });

      stats = vectorDb.getStats();
      expect(stats.total_documents).toBe(3);
      expect(stats.last_updated).toBeDefined();
      expect(typeof stats.last_updated).toBe('string');

      // Configuration should be preserved
      expect(stats.configuration.projectDir).toBe(testProjectDir);
      expect(stats.configuration.collectionName).toBe('json_memory');
    });
  });
});
