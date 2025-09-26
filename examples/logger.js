const winston = require("winston");
const path = require("path");
const crypto = require("crypto");

const customFormat = winston.format.printf(
  ({
    timestamp,
    level,
    message,
    service,
    environment,
    correlationId,
    ...meta
  }) => {
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      service,
      environment,
      correlationId,
      message,
      ...meta,
    };

    return JSON.stringify(logEntry);
  },
);

const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: "YYYY-MM-DDTHH:mm:ss.SSSZ",
  }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  customFormat,
);

const consoleFormat = winston.format.combine(
  winston.format.timestamp({
    format: "YYYY-MM-DD HH:mm:ss",
  }),
  winston.format.colorize(),
  winston.format.printf(
    ({ timestamp, level, message, correlationId, ...meta }) => {
      const metaStr = Object.keys(meta).length
        ? JSON.stringify(meta, null, 2)
        : "";
      const correlation = correlationId ? `[${correlationId}]` : "";
      return `${timestamp} ${level} ${correlation} ${message} ${metaStr}`;
    },
  ),
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: logFormat,
  defaultMeta: {
    service: "test-api",
    environment: process.env.NODE_ENV || "development",
    hostname: require("os").hostname(),
    pid: process.pid,
  },
  transports: [
    new winston.transports.File({
      filename: path.join(__dirname, "logs", "error.log"),
      level: "error",
      maxsize: 5242880,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(__dirname, "logs", "combined.log"),
      maxsize: 5242880,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(__dirname, "logs", "security.log"),
      level: "warn",
      maxsize: 5242880,
      maxFiles: 10,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
      ),
    }),
  ],
});

if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: consoleFormat,
    }),
  );
}

const generateCorrelationId = () => crypto.randomBytes(8).toString("hex");

const correlationMiddleware = (req, res, next) => {
  req.correlationId =
    req.headers["x-correlation-id"] ||
    req.headers["x-request-id"] ||
    generateCorrelationId();
  res.setHeader("x-correlation-id", req.correlationId);
  next();
};

const requestLogger = (req, res, next) => {
  const start = Date.now();
  const originalSend = res.send;

  res.send = function (body) {
    res.body = body;
    return originalSend.call(this, body);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    const logLevel =
      res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";

    const logData = {
      correlationId: req.correlationId,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.get("User-Agent"),
      ip: req.ip || req.connection.remoteAddress,
      requestSize: req.get("content-length") || 0,
      responseSize:
        res.get("content-length") ||
        (res.body ? Buffer.byteLength(res.body) : 0),
      referrer: req.get("Referrer") || req.get("Referer"),
    };

    if (res.statusCode >= 400) {
      logData.errorCategory =
        res.statusCode >= 500 ? "server_error" : "client_error";
    }

    if (duration > 5000) {
      logData.performanceIssue = "slow_request";
      logger.warn("Slow request detected", logData);
    } else {
      logger[logLevel]("HTTP Request", logData);
    }
  });

  next();
};

const errorLogger = (err, req, res, next) => {
  const errorData = {
    correlationId: req.correlationId,
    error: err.message,
    errorType: err.name || "UnknownError",
    stack: err.stack,
    method: req.method,
    url: req.url,
    userAgent: req.get("User-Agent"),
    ip: req.ip || req.connection.remoteAddress,
    statusCode: err.status || err.statusCode || 500,
    timestamp: new Date().toISOString(),
  };

  if (err.status >= 500 || !err.status) {
    errorData.severity = "high";
    errorData.alertRequired = true;
  } else if (err.status >= 400) {
    errorData.severity = "medium";
  }

  if (err.type === "entity.parse.failed" || err.name === "ValidationError") {
    errorData.category = "validation_error";
  } else if (err.code === "ENOTFOUND" || err.code === "ECONNREFUSED") {
    errorData.category = "network_error";
  } else if (err.name === "MongoError" || err.name === "SequelizeError") {
    errorData.category = "database_error";
  } else {
    errorData.category = "application_error";
  }

  logger.error("Application Error", errorData);
  next(err);
};

const securityLogger = {
  logSuspiciousActivity: (req, activity, details = {}) => {
    logger.warn("Security Alert", {
      correlationId: req.correlationId,
      activity,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get("User-Agent"),
      url: req.url,
      method: req.method,
      timestamp: new Date().toISOString(),
      ...details,
    });
  },

  logAuthFailure: (req, reason, username = null) => {
    logger.warn("Authentication Failure", {
      correlationId: req.correlationId,
      reason,
      username,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get("User-Agent"),
      timestamp: new Date().toISOString(),
    });
  },

  logAccessDenied: (req, resource, userId = null) => {
    logger.warn("Access Denied", {
      correlationId: req.correlationId,
      resource,
      userId,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get("User-Agent"),
      url: req.url,
      timestamp: new Date().toISOString(),
    });
  },
};

const performanceLogger = {
  logSlowQuery: (query, duration, correlationId) => {
    logger.warn("Slow Query Detected", {
      correlationId,
      query: query.substring(0, 200),
      duration: `${duration}ms`,
      threshold: "1000ms",
      timestamp: new Date().toISOString(),
    });
  },

  logHighMemoryUsage: (usage, threshold = 0.8) => {
    logger.warn("High Memory Usage", {
      memoryUsage: usage,
      threshold,
      timestamp: new Date().toISOString(),
      alertRequired: usage > 0.9,
    });
  },

  logResourceExhaustion: (resource, current, limit) => {
    logger.error("Resource Exhaustion", {
      resource,
      currentUsage: current,
      limit,
      timestamp: new Date().toISOString(),
      alertRequired: true,
    });
  },
};

const createLogDir = () => {
  const fs = require("fs");
  const logDir = path.join(__dirname, "logs");
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
};

const healthLogger = {
  logHealthCheck: (status, checks = {}) => {
    const logLevel = status === "healthy" ? "info" : "error";
    logger[logLevel]("Health Check", {
      status,
      checks,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    });
  },

  logSystemMetrics: () => {
    const usage = process.memoryUsage();
    const memoryUsagePercent = usage.heapUsed / usage.heapTotal;

    logger.info("System Metrics", {
      uptime: process.uptime(),
      memoryUsage: usage,
      memoryUsagePercent: Math.round(memoryUsagePercent * 100),
      cpuUsage: process.cpuUsage(),
      timestamp: new Date().toISOString(),
    });

    if (memoryUsagePercent > 0.8) {
      performanceLogger.logHighMemoryUsage(memoryUsagePercent);
    }
  },
};

const businessLogger = {
  logUserAction: (userId, action, details = {}, correlationId) => {
    logger.info("User Action", {
      correlationId,
      userId,
      action,
      timestamp: new Date().toISOString(),
      ...details,
    });
  },

  logBusinessEvent: (event, data = {}, correlationId) => {
    logger.info("Business Event", {
      correlationId,
      event,
      timestamp: new Date().toISOString(),
      ...data,
    });
  },

  logDataChange: (entity, entityId, changes, userId, correlationId) => {
    logger.info("Data Change", {
      correlationId,
      entity,
      entityId,
      changes,
      userId,
      timestamp: new Date().toISOString(),
    });
  },
};

createLogDir();

setInterval(
  () => {
    healthLogger.logSystemMetrics();
  },
  5 * 60 * 1000,
);

module.exports = {
  logger,
  correlationMiddleware,
  requestLogger,
  errorLogger,
  securityLogger,
  performanceLogger,
  healthLogger,
  businessLogger,
  generateCorrelationId,
};
