/**
 * Vector Database Task History Storage Tests
 * Tests for storing and retrieving agent task history and decisions
 */

const path = require("path");
const fs = require("fs").promises;

// Mock ChromaDB - handle case where it's not installed
let ChromaClient;
try {
  jest.mock("chromadb", () => ({
    ChromaClient: jest.fn().mockImplementation(() => ({
      createCollection: jest.fn(),
      getCollection: jest.fn(),
      listCollections: jest.fn(),
      deleteCollection: jest.fn(),
      heartbeat: jest.fn().mockResolvedValue(true),
    })),
  }));
  ChromaClient = require("chromadb").ChromaClient;
} catch (e) {
  // ChromaDB not available, skip tests
  ChromaClient = null;
}

// Mock the vector database module
jest.mock("../../scripts/vector_database", () => ({
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

const { VectorDatabase } = require("../../scripts/vector_database");

describe("Vector Database Task History Storage", () => {
  // Skip tests if ChromaDB is not available
  if (!ChromaClient) {
    test.skip("ChromaDB not available - skipping vector database tests", () => {});
    return;
  }
  let vectorDb;
  let mockCollection;
  let testProjectDir;

  beforeEach(async () => {
    // Create temporary test directory
    testProjectDir = path.join(
      __dirname,
      "..",
      "fixtures",
      "task-history-test",
    );
    await fs.mkdir(testProjectDir, { recursive: true });

    // Reset mocks
    jest.clearAllMocks();

    // Create mock collection
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

  describe("Task History Storage", () => {
    test("should store successful task execution history", async () => {
      const taskHistory = {
        taskId: "task_123",
        type: "testing",
        description: "Run unit tests for authentication module",
        filesPattern: "src/auth/**/*.test.js",
        status: "completed",
        startTime: "2024-01-15T10:00:00Z",
        endTime: "2024-01-15T10:05:30Z",
        duration: 330,
        decisions: [
          {
            timestamp: "2024-01-15T10:00:15Z",
            decision: "Run tests with coverage",
            reasoning: "Need to ensure code coverage meets requirements",
            outcome: "Coverage: 95%",
          },
          {
            timestamp: "2024-01-15T10:02:00Z",
            decision: "Fix failing test for password validation",
            reasoning: "Test was failing due to edge case in regex pattern",
            outcome: "Test passed after regex fix",
          },
        ],
        outcome: "All tests passed with 95% coverage",
        learnings: [
          "Password validation regex needs to handle special characters",
          "Test coverage improved by 5% after adding edge case tests",
        ],
        metadata: {
          testFramework: "jest",
          testFiles: 12,
          totalTests: 45,
          passedTests: 45,
          failedTests: 0,
        },
      };

      mockCollection.add.mockResolvedValue(true);
      vectorDb.storeTaskHistory.mockResolvedValue("history_123");

      const result = await vectorDb.storeTaskHistory(taskHistory);

      expect(result).toBe("history_123");
      expect(vectorDb.storeTaskHistory).toHaveBeenCalledWith(taskHistory);
      expect(mockCollection.add).toHaveBeenCalled();

      const callArgs = mockCollection.add.mock.calls[0][0];
      expect(callArgs).toHaveProperty("documents");
      expect(callArgs).toHaveProperty("metadatas");
      expect(callArgs).toHaveProperty("ids");

      // Verify document content includes task details
      const document = callArgs.documents[0];
      expect(document).toContain("testing");
      expect(document).toContain("authentication module");
      expect(document).toContain("All tests passed");

      // Verify metadata includes task information
      const metadata = callArgs.metadatas[0];
      expect(metadata).toHaveProperty("taskId", "task_123");
      expect(metadata).toHaveProperty("type", "testing");
      expect(metadata).toHaveProperty("status", "completed");
      expect(metadata).toHaveProperty("duration", 330);
    });

    test("should store failed task execution history", async () => {
      const failedTaskHistory = {
        taskId: "task_456",
        type: "refactoring",
        description: "Refactor user service to use dependency injection",
        filesPattern: "src/services/userService.js",
        status: "failed",
        startTime: "2024-01-15T11:00:00Z",
        endTime: "2024-01-15T11:02:15Z",
        duration: 135,
        decisions: [
          {
            timestamp: "2024-01-15T11:00:30Z",
            decision: "Use constructor injection pattern",
            reasoning: "Constructor injection provides better testability",
            outcome: "Pattern implemented but caused circular dependency",
          },
        ],
        error:
          "Circular dependency detected between UserService and AuthService",
        outcome: "Task failed due to architectural issue",
        learnings: [
          "Constructor injection can create circular dependencies",
          "Consider using setter injection or factory pattern instead",
        ],
        metadata: {
          errorType: "CircularDependencyError",
          affectedFiles: 3,
          rollbackSuccessful: true,
        },
      };

      mockCollection.add.mockResolvedValue(true);
      vectorDb.storeTaskHistory.mockResolvedValue("history_456");

      const result = await vectorDb.storeTaskHistory(failedTaskHistory);

      expect(result).toBe("history_456");

      const callArgs = mockCollection.add.mock.calls[0][0];
      const document = callArgs.documents[0];
      const metadata = callArgs.metadatas[0];

      expect(document).toContain("failed");
      expect(document).toContain("Circular dependency");
      expect(metadata).toHaveProperty("status", "failed");
      expect(metadata).toHaveProperty("errorType", "CircularDependencyError");
    });

    test("should store task history with complex decision trees", async () => {
      const complexTaskHistory = {
        taskId: "task_789",
        type: "optimization",
        description: "Optimize database query performance",
        status: "completed",
        decisions: [
          {
            timestamp: "2024-01-15T12:00:00Z",
            decision: "Analyze slow queries using EXPLAIN",
            reasoning: "Need to identify bottlenecks",
            outcome: "Found missing index on user_id column",
          },
          {
            timestamp: "2024-01-15T12:15:00Z",
            decision: "Add composite index on (user_id, created_at)",
            reasoning: "Composite index will speed up time-based queries",
            outcome: "Query performance improved by 70%",
          },
          {
            timestamp: "2024-01-15T12:30:00Z",
            decision: "Implement query result caching",
            reasoning: "Frequently accessed data should be cached",
            outcome: "Added Redis caching layer",
          },
        ],
        outcome: "Database performance improved by 85%",
        learnings: [
          "Always analyze queries before optimization",
          "Composite indexes are more effective than single-column indexes",
          "Caching should be considered for read-heavy workloads",
        ],
      };

      mockCollection.add.mockResolvedValue(true);
      vectorDb.storeTaskHistory.mockResolvedValue("history_789");

      await vectorDb.storeTaskHistory(complexTaskHistory);

      const callArgs = mockCollection.add.mock.calls[0][0];
      const document = callArgs.documents[0];

      expect(document).toContain("EXPLAIN");
      expect(document).toContain("composite index");
      expect(document).toContain("Redis caching");
      expect(document).toContain("85%");
    });

    test("should handle empty decisions array", async () => {
      const minimalTaskHistory = {
        taskId: "task_minimal",
        type: "simple",
        description: "Simple task with no decisions",
        status: "completed",
        startTime: "2024-01-15T13:00:00Z",
        endTime: "2024-01-15T13:00:05Z",
        duration: 5,
        decisions: [],
        outcome: "Task completed successfully",
        learnings: [],
      };

      mockCollection.add.mockResolvedValue(true);
      vectorDb.storeTaskHistory.mockResolvedValue("history_minimal");

      await vectorDb.storeTaskHistory(minimalTaskHistory);

      const callArgs = mockCollection.add.mock.calls[0][0];
      expect(callArgs.documents[0]).toContain("Simple task");
      expect(callArgs.documents[0]).toContain("completed successfully");
    });

    test("should validate task history data structure", async () => {
      const invalidTaskHistory = {
        // Missing required fields
        description: "Invalid task",
      };

      await expect(
        vectorDb.storeTaskHistory(invalidTaskHistory),
      ).rejects.toThrow("Invalid task history data");

      expect(mockCollection.add).not.toHaveBeenCalled();
    });

    test("should handle storage errors gracefully", async () => {
      const taskHistory = {
        taskId: "task_error",
        type: "testing",
        description: "Task that will fail to store",
        status: "completed",
      };

      mockCollection.add.mockRejectedValue(new Error("Storage backend error"));
      vectorDb.storeTaskHistory.mockRejectedValue(
        new Error("Storage backend error"),
      );

      await expect(vectorDb.storeTaskHistory(taskHistory)).rejects.toThrow(
        "Storage backend error",
      );
    });
  });

  describe("Task History Retrieval", () => {
    test("should retrieve task history by task ID", async () => {
      const taskId = "task_123";
      const expectedHistory = {
        taskId,
        type: "testing",
        description: "Run unit tests",
        status: "completed",
        decisions: [],
        outcome: "Tests passed",
      };

      mockCollection.get.mockResolvedValue({
        documents: ["Task history document content"],
        metadatas: [
          {
            taskId,
            type: "testing",
            status: "completed",
            timestamp: "2024-01-15T10:00:00Z",
          },
        ],
        ids: ["history_123"],
      });

      vectorDb.getTaskHistory.mockResolvedValue(expectedHistory);

      const result = await vectorDb.getTaskHistory(taskId);

      expect(result).toEqual(expectedHistory);
      expect(vectorDb.getTaskHistory).toHaveBeenCalledWith(taskId);
    });

    test("should return null for non-existent task history", async () => {
      const taskId = "non_existent_task";

      mockCollection.get.mockResolvedValue({
        documents: [],
        metadatas: [],
        ids: [],
      });

      vectorDb.getTaskHistory.mockResolvedValue(null);

      const result = await vectorDb.getTaskHistory(taskId);

      expect(result).toBeNull();
    });

    test("should retrieve multiple task histories", async () => {
      const taskIds = ["task_1", "task_2", "task_3"];

      const expectedHistories = [
        { taskId: "task_1", status: "completed" },
        { taskId: "task_2", status: "failed" },
        { taskId: "task_3", status: "completed" },
      ];

      vectorDb.getTaskHistory
        .mockResolvedValueOnce(expectedHistories[0])
        .mockResolvedValueOnce(expectedHistories[1])
        .mockResolvedValueOnce(expectedHistories[2]);

      const results = await Promise.all(
        taskIds.map((id) => vectorDb.getTaskHistory(id)),
      );

      expect(results).toEqual(expectedHistories);
    });
  });

  describe("Task History Metadata", () => {
    test("should store and retrieve task execution metadata", async () => {
      const taskWithMetadata = {
        taskId: "task_metadata",
        type: "deployment",
        description: "Deploy application to production",
        status: "completed",
        metadata: {
          environment: "production",
          version: "v2.1.0",
          deploymentTime: 450,
          rollbackTime: null,
          affectedServices: ["api", "web", "worker"],
          databaseMigrations: 3,
          cacheInvalidation: true,
          monitoring: {
            responseTime: "150ms",
            errorRate: "0.01%",
            throughput: "1000 req/min",
          },
        },
      };

      mockCollection.add.mockResolvedValue(true);
      vectorDb.storeTaskHistory.mockResolvedValue("history_metadata");

      await vectorDb.storeTaskHistory(taskWithMetadata);

      const callArgs = mockCollection.add.mock.calls[0][0];
      const metadata = callArgs.metadatas[0];

      expect(metadata).toHaveProperty("environment", "production");
      expect(metadata).toHaveProperty("version", "v2.1.0");
      expect(metadata).toHaveProperty("deploymentTime", 450);
      expect(metadata.monitoring).toHaveProperty("responseTime", "150ms");
    });

    test("should handle large metadata objects", async () => {
      const largeMetadata = {
        taskId: "task_large",
        type: "analysis",
        metadata: {
          codeMetrics: {
            linesOfCode: 15420,
            cyclomaticComplexity: 45,
            maintainabilityIndex: 78,
            technicalDebt: "2.5 hours",
          },
          testCoverage: {
            statements: 92.3,
            branches: 88.7,
            functions: 95.1,
            lines: 91.8,
          },
          performanceMetrics: {
            executionTime: "45.2s",
            memoryUsage: "256MB",
            cpuUsage: "15%",
          },
          securityScan: {
            vulnerabilities: 0,
            warnings: 3,
            info: 12,
          },
        },
      };

      mockCollection.add.mockResolvedValue(true);
      vectorDb.storeTaskHistory.mockResolvedValue("history_large");

      await vectorDb.storeTaskHistory(largeMetadata);

      expect(mockCollection.add).toHaveBeenCalled();
      const callArgs = mockCollection.add.mock.calls[0][0];
      expect(callArgs.metadatas[0]).toHaveProperty("codeMetrics");
      expect(callArgs.metadatas[0].codeMetrics).toHaveProperty(
        "linesOfCode",
        15420,
      );
    });
  });
});
