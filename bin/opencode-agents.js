#!/usr/bin/env node
/**
 * OpenCode Agent Automation CLI
 * NPM executable wrapper for the automation system
 */

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

// Simple structured logger for CLI
class StructuredLogger {
  constructor(name = "opencode-cli") {
    this.name = name;
    this.levels = {
      DEBUG: 0,
      INFO: 1,
      WARN: 2,
      ERROR: 3,
    };
    this.currentLevel = process.env.LOG_LEVEL
      ? this.levels[process.env.LOG_LEVEL.toUpperCase()]
      : this.levels.INFO;
  }

  _log(level, message, extra = {}) {
    if (this.levels[level] < this.currentLevel) return;

    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.name,
      environment: process.env.NODE_ENV || "development",
      message,
      ...extra,
    };

    // Console output with colors for CLI
    const colors = {
      DEBUG: "\x1b[36m", // cyan
      INFO: "\x1b[32m", // green
      WARN: "\x1b[33m", // yellow
      ERROR: "\x1b[31m", // red
    };
    const reset = "\x1b[0m";

    console.log(`${colors[level]}${level}${reset}: ${message}`);

    // Also write to file if in production or if log file exists
    try {
      const logDir = path.join(process.cwd(), ".claude", "logs");
      if (fs.existsSync(logDir)) {
        const logFile = path.join(logDir, "cli.log");
        fs.appendFileSync(logFile, JSON.stringify(logEntry) + "\n");
      }
    } catch (e) {
      // Ignore file logging errors in CLI
    }
  }

  debug(message, extra = {}) {
    this._log("DEBUG", message, extra);
  }
  info(message, extra = {}) {
    this._log("INFO", message, extra);
  }
  warn(message, extra = {}) {
    this._log("WARN", message, extra);
  }
  error(message, extra = {}) {
    this._log("ERROR", message, extra);
  }
}

const logger = new StructuredLogger();

// Colors for console output (keeping for backward compatibility)
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
};

// Get command line arguments
const args = process.argv.slice(2);
const command = args[0] || "help";

// Paths
const projectDir = process.cwd();
const claudeDir = path.join(projectDir, ".claude");
const installDir = path.join(__dirname, "..");

// Ensure .claude directory exists
if (!fs.existsSync(claudeDir)) {
  logger.info(`Setting up OpenCode agents in ${projectDir}...`);
  try {
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.mkdirSync(path.join(claudeDir, "logs"), { recursive: true });
    fs.mkdirSync(path.join(claudeDir, "tasks"), { recursive: true });

    // Copy templates
    const templatesDir = path.join(installDir, "templates");
    const scriptsDir = path.join(installDir, "scripts");

    try {
      // Copy template files
      fs.copyFileSync(
        path.join(templatesDir, "agentsync.md"),
        path.join(claudeDir, "agentsync.md"),
      );
      fs.copyFileSync(
        path.join(templatesDir, "tasks.json"),
        path.join(claudeDir, "tasks.json"),
      );
      fs.copyFileSync(
        path.join(templatesDir, "CLAUDE.md"),
        path.join(claudeDir, "CLAUDE.md"),
      );

      logger.info("✅ Setup complete!");
    } catch (templateError) {
      logger.error("Failed to copy template files", {
        error: templateError.message,
      });
    }
  } catch (setupError) {
    logger.error("Failed to setup OpenCode agents", {
      error: setupError.message,
    });
    process.exit(1);
  }
}
