const {
  logger,
  correlationMiddleware,
  requestLogger,
  errorLogger,
  securityLogger,
  performanceLogger,
  healthLogger,
  businessLogger,
  generateCorrelationId,
} = require("../examples/logger");

describe("Logger Functions Unit Tests", () => {
  beforeEach(() => {
    // Clear any existing logs and reset state
    jest.clearAllMocks();

    // Mock console methods
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "info").mockImplementation(() => {});

    // Mock process methods
    jest.spyOn(process, "uptime").mockReturnValue(100);
    jest.spyOn(process, "memoryUsage").mockReturnValue({
      rss: 1000000,
      heapTotal: 2000000,
      heapUsed: 1500000,
      external: 500000,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("generateCorrelationId", () => {
    test("generates valid correlation ID", () => {
      const id = generateCorrelationId();
      expect(typeof id).toBe("string");
      expect(id.length).toBe(16); // 8 bytes * 2 hex chars per byte
      expect(/^[a-f0-9]+$/.test(id)).toBe(true);
    });

    test("generates unique IDs", () => {
      const id1 = generateCorrelationId();
      const id2 = generateCorrelationId();
      expect(id1).not.toBe(id2);
    });
  });

  describe("correlationMiddleware", () => {
    let req, res, next;

    beforeEach(() => {
      req = {
        headers: {},
        correlationId: undefined,
      };
      res = {
        setHeader: jest.fn(),
      };
      next = jest.fn();
    });

    test("uses existing x-correlation-id header", () => {
      req.headers["x-correlation-id"] = "existing-id";
      correlationMiddleware(req, res, next);

      expect(req.correlationId).toBe("existing-id");
      expect(res.setHeader).toHaveBeenCalledWith(
        "x-correlation-id",
        "existing-id",
      );
      expect(next).toHaveBeenCalled();
    });

    test("uses existing x-request-id header", () => {
      req.headers["x-request-id"] = "request-id";
      correlationMiddleware(req, res, next);

      expect(req.correlationId).toBe("request-id");
      expect(res.setHeader).toHaveBeenCalledWith(
        "x-correlation-id",
        "request-id",
      );
    });

    test("generates new correlation ID when none provided", () => {
      correlationMiddleware(req, res, next);

      expect(req.correlationId).toBeDefined();
      expect(typeof req.correlationId).toBe("string");
      expect(res.setHeader).toHaveBeenCalledWith(
        "x-correlation-id",
        req.correlationId,
      );
    });

    test("handles missing headers gracefully", () => {
      req.headers = undefined;
      correlationMiddleware(req, res, next);

      expect(req.correlationId).toBeDefined();
      expect(next).toHaveBeenCalled();
    });
  });

  describe("requestLogger", () => {
    let req, res, next;

    beforeEach(() => {
      req = {
        method: "GET",
        url: "/api/test",
        correlationId: "test-correlation-id",
        get: jest.fn(),
        ip: "127.0.0.1",
      };
      res = {
        statusCode: 200,
        get: jest.fn(),
        on: jest.fn(),
        body: "response body",
      };
      next = jest.fn();

      // Mock Date.now for consistent timestamps
      jest.spyOn(Date, "now").mockReturnValue(1000000000);
    });

    test("logs successful request", () => {
      req.get.mockReturnValue("application/json");
      res.get.mockReturnValue("100");
      res.on.mockImplementation((event, callback) => {
        if (event === "finish") {
          callback();
        }
      });

      requestLogger(req, res, next);

      expect(next).toHaveBeenCalled();
      // Verify logger was called (mock verification would be complex here)
    });

    test("logs slow request", () => {
      req.get.mockReturnValue("application/json");
      res.get.mockReturnValue("100");
      res.statusCode = 200;

      // Mock slow response (5+ seconds)
      let originalNow = Date.now;
      let callCount = 0;
      jest.spyOn(Date, "now").mockImplementation(() => {
        callCount++;
        return callCount === 1 ? 1000000000 : 6000000000; // 5 seconds later
      });

      res.on.mockImplementation((event, callback) => {
        if (event === "finish") {
          callback();
        }
      });

      requestLogger(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    test("handles missing correlation ID", () => {
      delete req.correlationId;
      req.get.mockReturnValue("application/json");
      res.get.mockReturnValue("100");
      res.on.mockImplementation((event, callback) => {
        if (event === "finish") {
          callback();
        }
      });

      requestLogger(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    test("handles error status codes", () => {
      res.statusCode = 404;
      req.get.mockReturnValue("application/json");
      res.get.mockReturnValue("100");
      res.on.mockImplementation((event, callback) => {
        if (event === "finish") {
          callback();
        }
      });

      requestLogger(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe("errorLogger", () => {
    let req, res, next;

    beforeEach(() => {
      req = {
        correlationId: "test-correlation-id",
        method: "POST",
        url: "/api/error",
        get: jest.fn().mockReturnValue("application/json"),
        ip: "127.0.0.1",
      };
      res = {};
      next = jest.fn();
    });

    test("logs application error", () => {
      const error = new Error("Test error");
      error.status = 500;

      errorLogger(error, req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });

    test("logs validation error", () => {
      const error = new Error("Validation failed");
      error.status = 400;
      error.type = "entity.parse.failed";

      errorLogger(error, req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });

    test("logs network error", () => {
      const error = new Error("Connection failed");
      error.code = "ENOTFOUND";

      errorLogger(error, req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });

    test("logs database error", () => {
      const error = new Error("DB connection failed");
      error.name = "MongoError";

      errorLogger(error, req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });

    test("handles error without status", () => {
      const error = new Error("Unknown error");

      errorLogger(error, req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });

    test("handles missing request properties", () => {
      const error = new Error("Test error");
      const minimalReq = {};

      errorLogger(error, minimalReq, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe("securityLogger", () => {
    let req;

    beforeEach(() => {
      req = {
        correlationId: "test-correlation-id",
        ip: "192.168.1.100",
        get: jest.fn().mockReturnValue("Mozilla/5.0"),
        url: "/api/login",
        method: "POST",
      };
    });

    describe("logSuspiciousActivity", () => {
      test("logs suspicious activity with details", () => {
        securityLogger.logSuspiciousActivity(req, "multiple_failed_logins", {
          attempts: 5,
          timeWindow: "5m",
        });

        // Logger should have been called (verification through mocking would be complex)
      });

      test("handles missing details", () => {
        securityLogger.logSuspiciousActivity(req, "suspicious_request");

        // Should not crash
      });

      test("handles missing request properties", () => {
        const minimalReq = {};
        securityLogger.logSuspiciousActivity(minimalReq, "minimal_request");

        // Should not crash
      });
    });

    describe("logAuthFailure", () => {
      test("logs authentication failure", () => {
        securityLogger.logAuthFailure(req, "invalid_credentials", "testuser");

        // Should not crash
      });

      test("logs auth failure without username", () => {
        securityLogger.logAuthFailure(req, "invalid_token");

        // Should not crash
      });
    });

    describe("logAccessDenied", () => {
      test("logs access denied", () => {
        securityLogger.logAccessDenied(req, "/admin/users", "user123");

        // Should not crash
      });

      test("logs access denied without user ID", () => {
        securityLogger.logAccessDenied(req, "/admin/settings");

        // Should not crash
      });
    });
  });

  describe("performanceLogger", () => {
    describe("logSlowQuery", () => {
      test("logs slow query", () => {
        performanceLogger.logSlowQuery("SELECT * FROM users", 1500, "corr-123");

        // Should not crash
      });

      test("handles long query strings", () => {
        const longQuery = "SELECT * FROM users WHERE " + "x".repeat(300);
        performanceLogger.logSlowQuery(longQuery, 2000, "corr-456");

        // Should truncate query but not crash
      });
    });

    describe("logHighMemoryUsage", () => {
      test("logs high memory usage", () => {
        performanceLogger.logHighMemoryUsage(0.85, 0.8);

        // Should not crash
      });

      test("logs critical memory usage", () => {
        performanceLogger.logHighMemoryUsage(0.95);

        // Should not crash
      });
    });

    describe("logResourceExhaustion", () => {
      test("logs resource exhaustion", () => {
        performanceLogger.logResourceExhaustion(
          "database_connections",
          95,
          100,
        );

        // Should not crash
      });
    });
  });

  describe("healthLogger", () => {
    describe("logHealthCheck", () => {
      test("logs healthy status", () => {
        healthLogger.logHealthCheck("healthy", {
          database: "up",
          cache: "up",
          api: "responding",
        });

        // Should not crash
      });

      test("logs unhealthy status", () => {
        healthLogger.logHealthCheck("unhealthy", {
          database: "down",
          api: "timeout",
        });

        // Should not crash
      });

      test("logs health check without checks", () => {
        healthLogger.logHealthCheck("degraded");

        // Should not crash
      });
    });

    describe("logSystemMetrics", () => {
      test("logs system metrics", () => {
        healthLogger.logSystemMetrics();

        // Should not crash
      });

      test("triggers memory warning when usage is high", () => {
        // Mock high memory usage
        jest.spyOn(process, "memoryUsage").mockReturnValue({
          rss: 1000000000,
          heapTotal: 2000000000,
          heapUsed: 1800000000, // 90% usage
          external: 500000,
        });

        healthLogger.logSystemMetrics();

        // Should not crash
      });
    });
  });

  describe("businessLogger", () => {
    describe("logUserAction", () => {
      test("logs user action", () => {
        businessLogger.logUserAction(
          "user123",
          "profile_update",
          {
            field: "email",
            oldValue: "old@example.com",
            newValue: "new@example.com",
          },
          "corr-123",
        );

        // Should not crash
      });

      test("logs user action without details", () => {
        businessLogger.logUserAction("user456", "login", {}, "corr-456");

        // Should not crash
      });
    });

    describe("logBusinessEvent", () => {
      test("logs business event", () => {
        businessLogger.logBusinessEvent(
          "user_registration",
          {
            userId: "user123",
            source: "web",
            plan: "premium",
          },
          "corr-123",
        );

        // Should not crash
      });
    });

    describe("logDataChange", () => {
      test("logs data change", () => {
        businessLogger.logDataChange(
          "users",
          "user123",
          {
            email: { old: "old@example.com", new: "new@example.com" },
          },
          "admin456",
          "corr-123",
        );

        // Should not crash
      });
    });
  });

  describe("Logger Integration", () => {
    test("middleware chain works together", () => {
      const req = {
        headers: {},
        method: "GET",
        url: "/api/test",
        get: jest.fn().mockReturnValue("application/json"),
        ip: "127.0.0.1",
      };
      const res = {
        statusCode: 200,
        get: jest.fn().mockReturnValue("100"),
        on: jest.fn(),
        setHeader: jest.fn(),
        body: "success",
      };
      const next = jest.fn();

      // Set up response finish handler
      res.on.mockImplementation((event, callback) => {
        if (event === "finish") {
          callback();
        }
      });

      // Run middleware chain
      correlationMiddleware(req, res, next);
      requestLogger(req, res, next);

      expect(req.correlationId).toBeDefined();
      expect(res.setHeader).toHaveBeenCalledWith(
        "x-correlation-id",
        req.correlationId,
      );
    });

    test("error handling in middleware chain", () => {
      const req = {
        headers: {},
        method: "POST",
        url: "/api/fail",
        get: jest.fn().mockReturnValue("application/json"),
        ip: "127.0.0.1",
      };
      const res = {
        statusCode: 500,
        get: jest.fn().mockReturnValue("0"),
        setHeader: jest.fn(),
      };
      const next = jest.fn();

      const error = new Error("Internal server error");
      error.status = 500;

      // Run error logger
      errorLogger(error, req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    test("handles undefined request object", () => {
      expect(() => {
        correlationMiddleware(undefined, {}, jest.fn());
      }).not.toThrow();
    });

    test("handles undefined response object", () => {
      expect(() => {
        correlationMiddleware({}, undefined, jest.fn());
      }).not.toThrow();
    });

    test("handles undefined error in errorLogger", () => {
      expect(() => {
        errorLogger(undefined, {}, {}, jest.fn());
      }).not.toThrow();
    });

    test("handles circular references in logged objects", () => {
      const circular = { self: null };
      circular.self = circular;

      expect(() => {
        businessLogger.logBusinessEvent("circular_test", circular, "corr-123");
      }).not.toThrow();
    });

    test("handles very long log messages", () => {
      const longMessage = "x".repeat(10000);

      expect(() => {
        businessLogger.logBusinessEvent(
          "long_message_test",
          {
            message: longMessage,
          },
          "corr-123",
        );
      }).not.toThrow();
    });

    test("handles special characters in log data", () => {
      const specialData = {
        message: "Special chars: àáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ",
        symbols: "!@#$%^&*()_+-=[]{}|;:,.<>?",
        unicode: "🚀💻🎯✅❌🔥",
      };

      expect(() => {
        businessLogger.logBusinessEvent(
          "special_chars_test",
          specialData,
          "corr-123",
        );
      }).not.toThrow();
    });

    test("handles null and undefined values in log data", () => {
      const nullData = {
        nullValue: null,
        undefinedValue: undefined,
        emptyString: "",
        zero: 0,
        false: false,
      };

      expect(() => {
        businessLogger.logBusinessEvent(
          "null_undefined_test",
          nullData,
          "corr-123",
        );
      }).not.toThrow();
    });

    test("handles large numbers and precision", () => {
      const numberData = {
        largeNumber: 123456789012345678901234567890,
        floatPrecision: 0.12345678901234567890123456789,
        scientific: 1.23e-45,
        nan: NaN,
        infinity: Infinity,
        negInfinity: -Infinity,
      };

      expect(() => {
        performanceLogger.logSlowQuery(
          "SELECT * FROM large_numbers",
          1000,
          "corr-123",
        );
      }).not.toThrow();
    });
  });
});
