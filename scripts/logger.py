#!/usr/bin/env python3
"""
Enhanced structured logging configuration for the OpenCode delegation system
Provides DEBUG, INFO, WARN, ERROR, and CRITICAL logging levels with context
"""

import logging
import logging.handlers
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional, Union
import traceback


class StructuredFormatter(logging.Formatter):
    """Enhanced custom formatter for structured JSON logging with log levels"""

    def format(self, record: logging.LogRecord) -> str:
        log_entry = {
            "timestamp": datetime.fromtimestamp(record.created).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
            "process": record.process,
            "thread": record.thread,
        }

        # Add extra fields if present
        if hasattr(record, "extra_data") and getattr(record, "extra_data", None):
            extra_data = getattr(record, "extra_data")
            if isinstance(extra_data, dict):
                log_entry.update(extra_data)

        # Add exception info if present
        if record.exc_info:
            log_entry["exception"] = {
                "type": record.exc_info[0].__name__ if record.exc_info[0] else None,
                "message": str(record.exc_info[1]) if record.exc_info[1] else None,
                "traceback": self.formatException(record.exc_info),
            }

        # Add stack trace if requested
        if record.stack_info:
            log_entry["stack_trace"] = record.stack_info

        return json.dumps(log_entry, default=str, ensure_ascii=False)


class StructuredLogger:
    """Structured logger with context support"""

    def __init__(self, name: str, log_dir: Optional[Path] = None, level: str = "INFO"):
        self.logger = logging.getLogger(name)
        self.logger.setLevel(getattr(logging, level.upper(), logging.INFO))

        # Clear existing handlers to avoid duplication
        self.logger.handlers.clear()

        # Set up log directory
        if log_dir is None:
            log_dir = Path.cwd() / ".claude" / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)

        # Console handler with simple format
        console_handler = logging.StreamHandler()
        console_formatter = logging.Formatter(
            "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
        )
        console_handler.setFormatter(console_formatter)
        console_handler.setLevel(logging.INFO)
        self.logger.addHandler(console_handler)

        # File handler for all logs with structured format
        all_logs_file = log_dir / "app.log"
        file_handler = logging.handlers.RotatingFileHandler(
            str(all_logs_file), maxBytes=10 * 1024 * 1024, backupCount=5  # 10MB
        )
        file_handler.setFormatter(StructuredFormatter())
        file_handler.setLevel(logging.DEBUG)
        self.logger.addHandler(file_handler)

        # Error-specific file handler
        error_logs_file = log_dir / "error.log"
        error_handler = logging.handlers.RotatingFileHandler(
            str(error_logs_file), maxBytes=5 * 1024 * 1024, backupCount=3  # 5MB
        )
        error_handler.setFormatter(StructuredFormatter())
        error_handler.setLevel(logging.ERROR)
        self.logger.addHandler(error_handler)

    def _log_with_context(self, level: int, message: str, **kwargs):
        """Log message with additional context data"""
        extra_data = {k: v for k, v in kwargs.items() if v is not None}
        self.logger.log(level, message, extra={"extra_data": extra_data})

    def debug(self, message: str, **kwargs):
        """Log debug message with context"""
        self._log_with_context(logging.DEBUG, message, **kwargs)

    def info(self, message: str, **kwargs):
        """Log info message with context"""
        self._log_with_context(logging.INFO, message, **kwargs)

    def warning(self, message: str, **kwargs):
        """Log warning message with context"""
        self._log_with_context(logging.WARNING, message, **kwargs)

    def error(self, message: str, exception: Optional[Exception] = None, **kwargs):
        """Log error message with context and optional exception"""
        if exception:
            kwargs["error_type"] = type(exception).__name__
            kwargs["error_message"] = str(exception)
            self.logger.error(message, exc_info=True, extra={"extra_data": kwargs})
        else:
            self._log_with_context(logging.ERROR, message, **kwargs)

    def critical(self, message: str, exception: Optional[Exception] = None, **kwargs):
        """Log critical message with context and optional exception"""
        if exception:
            kwargs["error_type"] = type(exception).__name__
            kwargs["error_message"] = str(exception)
            self.logger.critical(message, exc_info=True, extra={"extra_data": kwargs})
        else:
            self._log_with_context(logging.CRITICAL, message, **kwargs)


def get_logger(
    name: str, log_dir: Optional[Path] = None, level: Optional[str] = None
) -> StructuredLogger:
    """Get a structured logger instance"""
    if level is None:
        level = os.getenv("LOG_LEVEL", "INFO")
    return StructuredLogger(name, log_dir, level)
