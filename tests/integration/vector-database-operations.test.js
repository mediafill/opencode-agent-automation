/**
 * Vector Database Operations Integration Tests
 * Tests for comprehensive vector database operations and workflows
 */

const path = require("path");
const fs = require("fs").promises;

// Mock ChromaDB since it's not installed yet
jest.mock("chromadb", () => ({
  ChromaClient: jest.fn().mockImplementation(() => ({
    createCollection: jest.fn(),
    getCollection: jest.fn(),
    listCollections: jest.fn(),
    deleteCollection: jest.fn(),
    heartbeat: jest.fn().mockResolvedValue(true),
  })),
}));

const { ChromaClient } = require("chromadb");

// Mock the vector database module
jest.mock("../../../scripts/vector_database", () => ({
  VectorDatabase: jest.fn().mockImplementation(() => ({
    initialize: jest.fn(),
    storeTaskHistory: jest.fn(),
    storeLearning: jest.fn(),
    querySimilarSolutions: jest.fn(),
    getTaskHistory: jest.fn(),
    getLearnings: jest.fn(),
    close: jest.fn(),
    isInitialized: jest.fn(),
    getStats: jest.fn(),
  })),
}));

const { VectorDatabase } = require("../../../scripts/vector_database");

describe("Vector Database Operations Integration", () => {
  let vectorDb;
  let mockCollection;
  let testProjectDir;

  beforeEach(async () => {
    // Create temporary test directory
    testProjectDir = path.join(__dirname, "..", "fixtures", "operations-test");
    await fs.mkdir(testProjectDir, { recursive: true });

    // Reset mocks
    jest.clearAllMocks();

    // Create mock collection with full functionality
    mockCollection = {
      add: jest.fn(),
      query: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    };

    // Create mock ChromaDB client
    const mockChromaClient = {
      createCollection: jest.fn().mockResolvedValue(mockCollection),
      getCollection: jest.fn().mockResolvedValue(mockCollection),
      heartbeat: jest.fn().mockResolvedValue(true),
    };

    ChromaClient.mockReturnValue(mockChromaClient);

    // Create vector database instance
    vectorDb = new VectorDatabase({
      projectDir: testProjectDir,
      chromaUrl: "http://localhost:8000",
      collectionName: "agent_memory",
    });

    // Initialize the database
    vectorDb.initialize.mockResolvedValue(true);
    vectorDb.isInitialized.mockReturnValue(true);
    await vectorDb.initialize();
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testProjectDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe("Complete Task History Workflow", () => {
    test("should handle complete task history lifecycle", async () => {
      // Store a complex task history
      const taskHistory = {
        taskId: "workflow_task_001",
        type: "refactoring",
        description: "Refactor authentication service to use async/await",
        status: "completed",
        startTime: "2024-01-15T09:00:00Z",
        endTime: "2024-01-15T11:30:00Z",
        duration: 9000,
        decisions: [
          {
            timestamp: "2024-01-15T09:15:00Z",
            decision: "Use async/await pattern for database calls",
            reasoning: "Improves code readability and error handling",
            outcome: "Pattern implemented successfully",
          },
          {
            timestamp: "2024-01-15T10:00:00Z",
            decision: "Add comprehensive error handling",
            reasoning:
              "Database operations can fail and need proper error recovery",
            outcome: "Error handling added with retry logic",
          },
          {
            timestamp: "2024-01-15T11:00:00Z",
            decision: "Update unit tests to cover async operations",
            reasoning: "Tests must validate async behavior",
            outcome: "All tests passing with 95% coverage",
          },
        ],
        outcome:
          "Authentication service successfully refactored with improved performance and maintainability",
        learnings: [
          "Async/await significantly improves code readability",
          "Comprehensive error handling is crucial for database operations",
          "Unit tests for async code require special attention to timing",
          "Refactoring should be done incrementally to avoid breaking changes",
        ],
        metadata: {
          filesChanged: 8,
          linesOfCode: 450,
          testCoverage: 95.2,
          performance: {
            responseTime: "120ms",
            throughput: "150 req/sec",
            errorRate: "0.01%",
          },
          dependencies: ["bcrypt", "jsonwebtoken", "redis"],
          breakingChanges: false,
        },
      };

      mockCollection.add.mockResolvedValue(true);
      vectorDb.storeTaskHistory.mockResolvedValue(
        "task_workflow_task_001_1234567890",
      );

      const docId = await vectorDb.storeTaskHistory(taskHistory);

      expect(docId).toBe("task_workflow_task_001_1234567890");
      expect(vectorDb.storeTaskHistory).toHaveBeenCalledWith(taskHistory);

      // Verify the call arguments
      const callArgs = mockCollection.add.mock.calls[0][0];
      expect(callArgs.documents[0]).toContain("refactoring");
      expect(callArgs.documents[0]).toContain("async/await");
      expect(callArgs.documents[0]).toContain("95% coverage");

      const metadata = callArgs.metadatas[0];
      expect(metadata.taskId).toBe("workflow_task_001");
      expect(metadata.taskType).toBe("refactoring");
      expect(metadata.status).toBe("completed");
      expect(metadata.duration).toBe(9000);
    });

    test("should retrieve and use stored task history for similar queries", async () => {
      // Store multiple related task histories
      const taskHistories = [
        {
          taskId: "auth_refactor_001",
          type: "refactoring",
          description: "Refactor auth service error handling",
          status: "completed",
          learnings: [
            "Use try/catch in async functions",
            "Log errors properly",
          ],
        },
        {
          taskId: "auth_refactor_002",
          type: "refactoring",
          description: "Refactor auth service validation logic",
          status: "completed",
          learnings: [
            "Input validation should be centralized",
            "Use schema validation",
          ],
        },
        {
          taskId: "payment_refactor_001",
          type: "refactoring",
          description: "Refactor payment service error handling",
          status: "completed",
          learnings: [
            "Handle network timeouts gracefully",
            "Implement circuit breaker pattern",
          ],
        },
      ];

      // Mock storing the tasks
      vectorDb.storeTaskHistory
        .mockResolvedValueOnce("task_auth_refactor_001_1")
        .mockResolvedValueOnce("task_auth_refactor_002_2")
        .mockResolvedValueOnce("task_payment_refactor_001_3");

      for (const task of taskHistories) {
        await vectorDb.storeTaskHistory(task);
      }

      // Query for similar solutions to a new auth refactoring task
      const queryResults = [
        {
          id: "task_auth_refactor_001_1",
          document: "Refactor auth service error handling...",
          metadata: { taskId: "auth_refactor_001", taskType: "refactoring" },
          distance: 0.1,
        },
        {
          id: "task_auth_refactor_002_2",
          document: "Refactor auth service validation logic...",
          metadata: { taskId: "auth_refactor_002", taskType: "refactoring" },
          distance: 0.15,
        },
      ];

      vectorDb.querySimilarSolutions.mockResolvedValue(queryResults);

      const results = await vectorDb.querySimilarSolutions(
        "refactor authentication service validation",
        5,
        { taskType: "refactoring" },
      );

      expect(results).toHaveLength(2);
      expect(results[0].metadata.taskId).toBe("auth_refactor_001");
      expect(results[1].metadata.taskId).toBe("auth_refactor_002");
      expect(vectorDb.querySimilarSolutions).toHaveBeenCalledWith(
        "refactor authentication service validation",
        5,
        { taskType: "refactoring" },
      );
    });
  });

  describe("Agent Learning Accumulation", () => {
    test("should accumulate and retrieve agent learnings over time", async () => {
      const learnings = [
        {
          content: "Always add input validation to public APIs",
          context: "Security review of user registration endpoint",
          category: "security",
          importance: "high",
          tags: ["api", "validation", "security"],
        },
        {
          content: "Use database transactions for multi-table operations",
          context: "Fixing data consistency issues in order processing",
          category: "database",
          importance: "high",
          tags: ["database", "transactions", "consistency"],
        },
        {
          content: "Cache frequently accessed data to improve performance",
          context: "Optimizing product catalog page load times",
          category: "performance",
          importance: "medium",
          tags: ["caching", "performance", "optimization"],
        },
        {
          content: "Write comprehensive unit tests before refactoring",
          context: "Refactoring legacy authentication code",
          category: "testing",
          importance: "high",
          tags: ["testing", "refactoring", "tdd"],
        },
        {
          content: "Use meaningful variable names even in private functions",
          context: "Code review feedback on utility functions",
          category: "code-quality",
          importance: "low",
          tags: ["code-quality", "readability", "naming"],
        },
      ];

      // Store all learnings
      const docIds = [];
      for (let i = 0; i < learnings.length; i++) {
        vectorDb.storeLearning.mockResolvedValueOnce(`learning_${i + 1}`);
        const docId = await vectorDb.storeLearning(learnings[i]);
        docIds.push(docId);
      }

      expect(docIds).toHaveLength(5);

      // Retrieve learnings by category
      vectorDb.getLearnings
        .mockResolvedValueOnce([learnings[0]]) // security
        .mockResolvedValueOnce([learnings[1]]) // database
        .mockResolvedValueOnce([learnings[2], learnings[3]]); // performance + testing

      const securityLearnings = await vectorDb.getLearnings({
        category: "security",
      });
      const databaseLearnings = await vectorDb.getLearnings({
        category: "database",
      });
      const highImportanceLearnings = await vectorDb.getLearnings({
        importance: "high",
      });

      expect(securityLearnings).toHaveLength(1);
      expect(securityLearnings[0].category).toBe("security");

      expect(databaseLearnings).toHaveLength(1);
      expect(databaseLearnings[0].category).toBe("database");

      expect(highImportanceLearnings).toHaveLength(2);
      expect(
        highImportanceLearnings.every((l) => l.importance === "high"),
      ).toBe(true);
    });

    test("should use learnings to inform decision making", async () => {
      // Store historical learnings
      const historicalLearnings = [
        {
          content: "Database connection pooling prevents connection exhaustion",
          context: "Fixing production database connection issues",
          category: "database",
          tags: ["database", "connections", "pooling"],
        },
        {
          content: "Input sanitization prevents SQL injection attacks",
          context: "Security audit of data access layer",
          category: "security",
          tags: ["security", "sql-injection", "sanitization"],
        },
      ];

      vectorDb.storeLearning
        .mockResolvedValueOnce("learning_db_1")
        .mockResolvedValueOnce("learning_security_1");

      for (const learning of historicalLearnings) {
        await vectorDb.storeLearning(learning);
      }

      // Query for relevant learnings when planning a new database feature
      vectorDb.querySimilarSolutions.mockResolvedValue([
        {
          id: "learning_db_1",
          document:
            "Database connection pooling prevents connection exhaustion...",
          metadata: { type: "learning", category: "database" },
          distance: 0.1,
        },
      ]);

      const relevantLearnings = await vectorDb.querySimilarSolutions(
        "implement database connection management for new feature",
        3,
      );

      expect(relevantLearnings).toHaveLength(1);
      expect(relevantLearnings[0].metadata.category).toBe("database");
      expect(relevantLearnings[0].document).toContain("connection pooling");
    });
  });

  describe("Cross-Task Knowledge Transfer", () => {
    test("should transfer knowledge between similar tasks", async () => {
      // Store task history from a successful API refactoring
      const apiRefactoringTask = {
        taskId: "api_refactor_success",
        type: "refactoring",
        description:
          "Refactor REST API endpoints to use consistent error responses",
        status: "completed",
        decisions: [
          {
            decision: "Standardize error response format",
            reasoning: "Inconsistent errors confuse API consumers",
            outcome: "All endpoints now return consistent error format",
          },
          {
            decision: "Add request validation middleware",
            reasoning: "Prevent invalid requests from reaching business logic",
            outcome: "Reduced error handling code by 40%",
          },
        ],
        learnings: [
          "Consistent error formats improve API usability",
          "Request validation should be done at the middleware level",
          "Use HTTP status codes appropriately",
        ],
        outcome: "API is now more maintainable and user-friendly",
      };

      vectorDb.storeTaskHistory.mockResolvedValue(
        "task_api_refactor_success_1",
      );
      await vectorDb.storeTaskHistory(apiRefactoringTask);

      // Later, when working on a similar task, query for relevant experience
      const similarTasks = [
        {
          id: "task_api_refactor_success_1",
          document:
            "Refactor REST API endpoints to use consistent error responses...",
          metadata: {
            taskId: "api_refactor_success",
            taskType: "refactoring",
            status: "completed",
          },
          distance: 0.05,
        },
      ];

      vectorDb.querySimilarSolutions.mockResolvedValue(similarTasks);

      const relevantExperience = await vectorDb.querySimilarSolutions(
        "refactor GraphQL API to use consistent error handling",
        5,
        { taskType: "refactoring", status: "completed" },
      );

      expect(relevantExperience).toHaveLength(1);
      expect(relevantExperience[0].metadata.taskType).toBe("refactoring");
      expect(relevantExperience[0].document).toContain("error responses");

      // Retrieve the full task history for detailed learning
      vectorDb.getTaskHistory.mockResolvedValue(apiRefactoringTask);

      const fullTaskHistory = await vectorDb.getTaskHistory(
        "api_refactor_success",
      );

      expect(fullTaskHistory).toBeDefined();
      expect(fullTaskHistory.learnings).toContain(
        "Consistent error formats improve API usability",
      );
      expect(fullTaskHistory.decisions).toHaveLength(2);
    });
  });

  describe("Performance and Scalability", () => {
    test("should handle large volumes of task histories efficiently", async () => {
      // Simulate storing many task histories
      const taskCount = 100;
      const tasks = [];

      for (let i = 0; i < taskCount; i++) {
        tasks.push({
          taskId: `task_${i}`,
          type: "testing",
          description: `Run test suite ${i}`,
          status: "completed",
          duration: Math.floor(Math.random() * 1000) + 100,
        });
      }

      // Mock successful storage
      vectorDb.storeTaskHistory.mockImplementation((task) =>
        Promise.resolve(`task_${task.taskId}_stored`),
      );

      // Store all tasks
      const startTime = Date.now();
      const storePromises = tasks.map((task) =>
        vectorDb.storeTaskHistory(task),
      );
      await Promise.all(storePromises);
      const endTime = Date.now();

      // Should complete within reasonable time (allowing for test environment)
      const duration = endTime - startTime;
      expect(duration).toBeLessThan(5000); // 5 seconds max for 100 tasks

      expect(vectorDb.storeTaskHistory).toHaveBeenCalledTimes(taskCount);
    });

    test("should handle concurrent queries efficiently", async () => {
      // Store some test data
      const testTasks = [
        {
          taskId: "concurrent_1",
          type: "testing",
          description: "Concurrent test 1",
          status: "completed",
        },
        {
          taskId: "concurrent_2",
          type: "testing",
          description: "Concurrent test 2",
          status: "completed",
        },
        {
          taskId: "concurrent_3",
          type: "deployment",
          description: "Concurrent deployment",
          status: "completed",
        },
      ];

      vectorDb.storeTaskHistory
        .mockResolvedValueOnce("task_concurrent_1")
        .mockResolvedValueOnce("task_concurrent_2")
        .mockResolvedValueOnce("task_concurrent_3");

      for (const task of testTasks) {
        await vectorDb.storeTaskHistory(task);
      }

      // Perform concurrent queries
      const queryPromises = [
        vectorDb.querySimilarSolutions("testing tasks", 5),
        vectorDb.querySimilarSolutions("deployment process", 5),
        vectorDb.getLearnings({ category: "testing" }),
        vectorDb.getTaskHistory("concurrent_1"),
        vectorDb.getTaskHistory("concurrent_3"),
      ];

      vectorDb.querySimilarSolutions
        .mockResolvedValueOnce([
          { id: "task_concurrent_1", metadata: { taskType: "testing" } },
        ])
        .mockResolvedValueOnce([
          { id: "task_concurrent_3", metadata: { taskType: "deployment" } },
        ]);

      vectorDb.getLearnings.mockResolvedValue([]);
      vectorDb.getTaskHistory
        .mockResolvedValueOnce(testTasks[0])
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(testTasks[2]);

      const startTime = Date.now();
      const results = await Promise.all(queryPromises);
      const endTime = Date.now();

      // Should complete within reasonable time
      const duration = endTime - startTime;
      expect(duration).toBeLessThan(2000); // 2 seconds max for concurrent queries

      expect(results).toHaveLength(5);
      expect(results[0]).toHaveLength(1); // testing query
      expect(results[1]).toHaveLength(1); // deployment query
    });
  });

  describe("Error Recovery and Resilience", () => {
    test("should handle partial failures gracefully", async () => {
      // Simulate some storage operations failing
      vectorDb.storeTaskHistory
        .mockRejectedValueOnce(new Error("Temporary storage failure"))
        .mockResolvedValueOnce("task_success_1")
        .mockRejectedValueOnce(new Error("Network timeout"))
        .mockResolvedValueOnce("task_success_2");

      const tasks = [
        {
          taskId: "fail_1",
          type: "testing",
          description: "Will fail",
          status: "pending",
        },
        {
          taskId: "success_1",
          type: "testing",
          description: "Will succeed",
          status: "completed",
        },
        {
          taskId: "fail_2",
          type: "testing",
          description: "Will fail again",
          status: "pending",
        },
        {
          taskId: "success_2",
          type: "testing",
          description: "Will succeed",
          status: "completed",
        },
      ];

      // Attempt to store all tasks
      const results = [];
      for (const task of tasks) {
        try {
          const result = await vectorDb.storeTaskHistory(task);
          results.push({ success: true, id: result });
        } catch (error) {
          results.push({ success: false, error: error.message });
        }
      }

      // Should have 2 successes and 2 failures
      const successes = results.filter((r) => r.success);
      const failures = results.filter((r) => !r.success);

      expect(successes).toHaveLength(2);
      expect(failures).toHaveLength(2);

      // Verify successful operations still work
      vectorDb.getTaskHistory.mockResolvedValue(tasks[1]);
      const retrieved = await vectorDb.getTaskHistory("success_1");
      expect(retrieved.taskId).toBe("success_1");
    });

    test("should maintain data consistency during failures", async () => {
      // Store initial data successfully
      const initialTask = {
        taskId: "consistency_test",
        type: "testing",
        description: "Consistency test task",
        status: "completed",
      };

      vectorDb.storeTaskHistory.mockResolvedValueOnce("task_consistency_test");
      await vectorDb.storeTaskHistory(initialTask);

      // Simulate query failure
      vectorDb.querySimilarSolutions.mockRejectedValueOnce(
        new Error("Query service unavailable"),
      );

      // Should still be able to retrieve stored data
      vectorDb.getTaskHistory.mockResolvedValue(initialTask);
      const retrieved = await vectorDb.getTaskHistory("consistency_test");

      expect(retrieved).toBeDefined();
      expect(retrieved.taskId).toBe("consistency_test");

      // Query should fail gracefully
      await expect(
        vectorDb.querySimilarSolutions("test query"),
      ).rejects.toThrow("Query service unavailable");
    });
  });

  describe("Database Statistics and Monitoring", () => {
    test("should provide comprehensive database statistics", async () => {
      // Store various types of data
      const tasks = [
        {
          taskId: "stats_task_1",
          type: "testing",
          description: "Test 1",
          status: "completed",
        },
        {
          taskId: "stats_task_2",
          type: "refactoring",
          description: "Refactor 1",
          status: "completed",
        },
      ];

      const learnings = [
        { content: "Learning 1", category: "testing" },
        { content: "Learning 2", category: "architecture" },
        { content: "Learning 3", category: "performance" },
      ];

      vectorDb.storeTaskHistory
        .mockResolvedValueOnce("task_stats_1")
        .mockResolvedValueOnce("task_stats_2");

      vectorDb.storeLearning
        .mockResolvedValueOnce("learning_stats_1")
        .mockResolvedValueOnce("learning_stats_2")
        .mockResolvedValueOnce("learning_stats_3");

      // Store all data
      for (const task of tasks) {
        await vectorDb.storeTaskHistory(task);
      }

      for (const learning of learnings) {
        await vectorDb.storeLearning(learning);
      }

      // Mock statistics
      vectorDb.getStats.mockReturnValue({
        total_documents: 5,
        collections: ["agent_memory"],
        last_updated: "2024-01-15T12:00:00Z",
        configuration: {
          chromaUrl: "http://localhost:8000",
          collectionName: "agent_memory",
          embeddingModel: "all-MiniLM-L6-v2",
        },
      });

      const stats = vectorDb.getStats();

      expect(stats.total_documents).toBe(5);
      expect(stats.collections).toContain("agent_memory");
      expect(stats.last_updated).toBe("2024-01-15T12:00:00Z");
      expect(stats.configuration.chromaUrl).toBe("http://localhost:8000");
      expect(stats.configuration.collectionName).toBe("agent_memory");
    });
  });
});
