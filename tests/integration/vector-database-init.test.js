/**
 * Vector Database Integration Tests
 * Tests for vector database initialization, configuration, and basic operations
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

// Mock the vector database module (to be implemented)
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

describe("Vector Database Initialization and Configuration", () => {
  let vectorDb;
  let mockChromaClient;
  let testProjectDir;

  beforeEach(async () => {
    // Create temporary test directory
    testProjectDir = path.join(__dirname, "..", "fixtures", "vector-db-test");
    await fs.mkdir(testProjectDir, { recursive: true });

    // Reset mocks
    jest.clearAllMocks();

    // Create mock ChromaDB client
    mockChromaClient = {
      createCollection: jest.fn(),
      getCollection: jest.fn(),
      listCollections: jest.fn(),
      deleteCollection: jest.fn(),
      heartbeat: jest.fn().mockResolvedValue(true),
    };

    ChromaClient.mockReturnValue(mockChromaClient);

    // Create vector database instance
    vectorDb = new VectorDatabase({
      projectDir: testProjectDir,
      chromaUrl: "http://localhost:8000",
      collectionName: "agent_memory",
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

  describe("Initialization", () => {
    test("should initialize with default configuration", async () => {
      const defaultConfig = {
        projectDir: testProjectDir,
        chromaUrl: "http://localhost:8000",
        collectionName: "agent_memory",
        embeddingModel: "all-MiniLM-L6-v2",
        maxRetries: 3,
        retryDelay: 1000,
      };

      vectorDb = new VectorDatabase(defaultConfig);

      mockChromaClient.createCollection.mockResolvedValue({
        name: "agent_memory",
        add: jest.fn(),
        query: jest.fn(),
        get: jest.fn(),
      });

      const result = await vectorDb.initialize();

      expect(result).toBe(true);
      expect(ChromaClient).toHaveBeenCalledWith({
        path: defaultConfig.chromaUrl,
      });
      expect(mockChromaClient.createCollection).toHaveBeenCalledWith({
        name: defaultConfig.collectionName,
        metadata: {
          description: "Agent memory and learning database",
        },
      });
    });

    test("should initialize with custom configuration", async () => {
      const customConfig = {
        projectDir: testProjectDir,
        chromaUrl: "http://custom-host:9000",
        collectionName: "custom_memory",
        embeddingModel: "text-embedding-ada-002",
        maxRetries: 5,
        retryDelay: 2000,
      };

      vectorDb = new VectorDatabase(customConfig);

      mockChromaClient.createCollection.mockResolvedValue({
        name: "custom_memory",
        add: jest.fn(),
        query: jest.fn(),
        get: jest.fn(),
      });

      const result = await vectorDb.initialize();

      expect(result).toBe(true);
      expect(ChromaClient).toHaveBeenCalledWith({
        path: customConfig.chromaUrl,
      });
      expect(mockChromaClient.createCollection).toHaveBeenCalledWith({
        name: customConfig.collectionName,
        metadata: {
          description: "Agent memory and learning database",
        },
      });
    });

    test("should handle ChromaDB connection failure", async () => {
      mockChromaClient.heartbeat.mockRejectedValue(
        new Error("Connection failed"),
      );

      vectorDb = new VectorDatabase({
        projectDir: testProjectDir,
        chromaUrl: "http://invalid-host:8000",
      });

      await expect(vectorDb.initialize()).rejects.toThrow(
        "Failed to connect to ChromaDB",
      );
      expect(vectorDb.isInitialized()).toBe(false);
    });

    test("should handle collection creation failure", async () => {
      mockChromaClient.createCollection.mockRejectedValue(
        new Error("Collection creation failed"),
      );

      vectorDb = new VectorDatabase({
        projectDir: testProjectDir,
        chromaUrl: "http://localhost:8000",
      });

      await expect(vectorDb.initialize()).rejects.toThrow(
        "Failed to create collection",
      );
      expect(vectorDb.isInitialized()).toBe(false);
    });

    test("should reuse existing collection if it exists", async () => {
      const existingCollection = {
        name: "agent_memory",
        add: jest.fn(),
        query: jest.fn(),
        get: jest.fn(),
      };

      mockChromaClient.getCollection.mockResolvedValue(existingCollection);

      vectorDb = new VectorDatabase({
        projectDir: testProjectDir,
        chromaUrl: "http://localhost:8000",
      });

      const result = await vectorDb.initialize();

      expect(result).toBe(true);
      expect(mockChromaClient.getCollection).toHaveBeenCalledWith({
        name: "agent_memory",
      });
      expect(mockChromaClient.createCollection).not.toHaveBeenCalled();
    });

    test("should handle initialization retries", async () => {
      mockChromaClient.createCollection
        .mockRejectedValueOnce(new Error("Temporary failure"))
        .mockRejectedValueOnce(new Error("Another failure"))
        .mockResolvedValueOnce({
          name: "agent_memory",
          add: jest.fn(),
          query: jest.fn(),
          get: jest.fn(),
        });

      vectorDb = new VectorDatabase({
        projectDir: testProjectDir,
        chromaUrl: "http://localhost:8000",
        maxRetries: 3,
        retryDelay: 100,
      });

      const result = await vectorDb.initialize();

      expect(result).toBe(true);
      expect(mockChromaClient.createCollection).toHaveBeenCalledTimes(3);
    });

    test("should fail after max retries exceeded", async () => {
      mockChromaClient.createCollection.mockRejectedValue(
        new Error("Persistent failure"),
      );

      vectorDb = new VectorDatabase({
        projectDir: testProjectDir,
        chromaUrl: "http://localhost:8000",
        maxRetries: 2,
        retryDelay: 50,
      });

      await expect(vectorDb.initialize()).rejects.toThrow(
        "Failed to create collection",
      );
      expect(mockChromaClient.createCollection).toHaveBeenCalledTimes(3); // initial + 2 retries
    });
  });

  describe("Configuration Validation", () => {
    test("should validate required configuration parameters", () => {
      expect(() => new VectorDatabase({})).toThrow("projectDir is required");
      expect(() => new VectorDatabase({ projectDir: testProjectDir })).toThrow(
        "chromaUrl is required",
      );
      expect(
        () =>
          new VectorDatabase({
            projectDir: testProjectDir,
            chromaUrl: "http://localhost:8000",
          }),
      ).toThrow("collectionName is required");
    });

    test("should validate ChromaDB URL format", () => {
      expect(
        () =>
          new VectorDatabase({
            projectDir: testProjectDir,
            chromaUrl: "invalid-url",
            collectionName: "test",
          }),
      ).toThrow("Invalid ChromaDB URL format");

      expect(
        () =>
          new VectorDatabase({
            projectDir: testProjectDir,
            chromaUrl: "http://valid-host:8000",
            collectionName: "test",
          }),
      ).not.toThrow();
    });

    test("should validate collection name format", () => {
      expect(
        () =>
          new VectorDatabase({
            projectDir: testProjectDir,
            chromaUrl: "http://localhost:8000",
            collectionName: "invalid name with spaces",
          }),
      ).toThrow("Collection name must be alphanumeric");

      expect(
        () =>
          new VectorDatabase({
            projectDir: testProjectDir,
            chromaUrl: "http://localhost:8000",
            collectionName: "valid_name_123",
          }),
      ).not.toThrow();
    });

    test("should validate embedding model configuration", () => {
      const validModels = [
        "all-MiniLM-L6-v2",
        "text-embedding-ada-002",
        "sentence-transformers",
      ];

      validModels.forEach((model) => {
        expect(
          () =>
            new VectorDatabase({
              projectDir: testProjectDir,
              chromaUrl: "http://localhost:8000",
              collectionName: "test",
              embeddingModel: model,
            }),
        ).not.toThrow();
      });

      expect(
        () =>
          new VectorDatabase({
            projectDir: testProjectDir,
            chromaUrl: "http://localhost:8000",
            collectionName: "test",
            embeddingModel: "invalid-model",
          }),
      ).toThrow("Unsupported embedding model");
    });
  });

  describe("Database Statistics", () => {
    test("should return correct initialization status", async () => {
      expect(vectorDb.isInitialized()).toBe(false);

      mockChromaClient.createCollection.mockResolvedValue({
        name: "agent_memory",
        add: jest.fn(),
        query: jest.fn(),
        get: jest.fn(),
      });

      await vectorDb.initialize();

      expect(vectorDb.isInitialized()).toBe(true);
    });

    test("should provide database statistics", async () => {
      mockChromaClient.createCollection.mockResolvedValue({
        name: "agent_memory",
        add: jest.fn(),
        query: jest.fn(),
        get: jest.fn(),
        count: jest.fn().mockResolvedValue(150),
      });

      await vectorDb.initialize();

      const stats = vectorDb.getStats();

      expect(stats).toHaveProperty("totalDocuments");
      expect(stats).toHaveProperty("collections");
      expect(stats).toHaveProperty("lastUpdated");
      expect(stats).toHaveProperty("configuration");
      expect(stats.configuration).toHaveProperty("chromaUrl");
      expect(stats.configuration).toHaveProperty("collectionName");
      expect(stats.configuration).toHaveProperty("embeddingModel");
    });
  });

  describe("Cleanup", () => {
    test("should properly close database connection", async () => {
      mockChromaClient.createCollection.mockResolvedValue({
        name: "agent_memory",
        add: jest.fn(),
        query: jest.fn(),
        get: jest.fn(),
      });

      await vectorDb.initialize();

      await vectorDb.close();

      expect(vectorDb.isInitialized()).toBe(false);
    });

    test("should handle close on uninitialized database", async () => {
      await expect(vectorDb.close()).resolves.not.toThrow();
    });
  });
});
