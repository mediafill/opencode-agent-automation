"""
Logging utilities for the OpenCode Agent System
Provides centralized logging with configurable levels and structured output
"""

import logging
import logging.handlers
import json
import sys
from pathlib import Path
from typing import Dict, Any, Optional
from datetime import datetime

class AgentLogger:
    """Centralized logging system for agents"""

    def __init__(self, name: str = "agent_system", config: Optional[Dict[str, Any]] = None):
        self.name = name
        self.config = config or {}
        self.logger = self._setup_logger()

    def _setup_logger(self) -> logging.Logger:
        """Setup the logger with appropriate handlers"""
        logger = logging.getLogger(self.name)
        logger.setLevel(self._get_log_level())

        # Clear existing handlers to avoid duplicates
        logger.handlers.clear()

        # Console handler
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(self._get_log_level())
        console_formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        console_handler.setFormatter(console_formatter)
        logger.addHandler(console_handler)

        # File handler (if logs directory exists)
        try:
            logs_dir = Path(__file__).parent / "logs"
            logs_dir.mkdir(exist_ok=True)

            file_handler = logging.handlers.RotatingFileHandler(
                logs_dir / f"{self.name}.log",
                maxBytes=10*1024*1024,  # 10MB
                backupCount=5
            )
            file_handler.setLevel(logging.DEBUG)
            file_formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(funcName)s:%(lineno)d - %(message)s'
            )
            file_handler.setFormatter(file_formatter)
            logger.addHandler(file_handler)
        except (OSError, PermissionError) as e:
            # If we can't create file handler, log to console only
            logger.warning(f"Could not setup file logging: {e}")

        return logger

    def _get_log_level(self) -> int:
        """Get log level from config or default to INFO"""
        level_str = self.config.get("log_level", "INFO").upper()
        level_map = {
            "DEBUG": logging.DEBUG,
            "INFO": logging.INFO,
            "WARNING": logging.WARNING,
            "ERROR": logging.ERROR,
            "CRITICAL": logging.CRITICAL
        }
        return level_map.get(level_str, logging.INFO)

    def debug(self, message: str, extra: Optional[Dict[str, Any]] = None):
        """Log debug message"""
        self._log(logging.DEBUG, message, extra)

    def info(self, message: str, extra: Optional[Dict[str, Any]] = None):
        """Log info message"""
        self._log(logging.INFO, message, extra)

    def warning(self, message: str, extra: Optional[Dict[str, Any]] = None):
        """Log warning message"""
        self._log(logging.WARNING, message, extra)

    def error(self, message: str, exc_info: Optional[Exception] = None, extra: Optional[Dict[str, Any]] = None):
        """Log error message"""
        if exc_info:
            self.logger.error(message, exc_info=exc_info, extra=extra or {})
        else:
            self._log(logging.ERROR, message, extra)

    def critical(self, message: str, exc_info: Optional[Exception] = None, extra: Optional[Dict[str, Any]] = None):
        """Log critical message"""
        if exc_info:
            self.logger.critical(message, exc_info=exc_info, extra=extra or {})
        else:
            self._log(logging.CRITICAL, message, extra)

    def _log(self, level: int, message: str, extra: Optional[Dict[str, Any]] = None):
        """Internal logging method"""
        if extra:
            # Add structured data to the message
            if isinstance(extra, dict):
                try:
                    extra_str = json.dumps(extra, default=str)
                    message = f"{message} | {extra_str}"
                except (TypeError, ValueError) as e:
                    # If JSON serialization fails, convert manually
                    extra_str = str(extra)
                    message = f"{message} | {extra_str}"
        self.logger.log(level, message, extra=extra or {})

    def log_task_start(self, task_id: str, objective: str):
        """Log task start"""
        self.info(f"Task started: {task_id}", {
            "task_id": task_id,
            "objective": objective,
            "event": "task_start"
        })

    def log_task_complete(self, task_id: str, status: str, duration: Optional[float] = None):
        """Log task completion"""
        extra: Dict[str, Any] = {
            "task_id": task_id,
            "status": status,
            "event": "task_complete"
        }
        if duration is not None:
            extra["duration_seconds"] = duration

        self.info(f"Task completed: {task_id} ({status})", extra)

    def log_task_error(self, task_id: str, error: str, exc_info: Optional[Exception] = None):
        """Log task error"""
        self.error(f"Task error: {task_id} - {error}", exc_info, {
            "task_id": task_id,
            "error": error,
            "event": "task_error"
        })

    def log_agent_action(self, agent_id: str, action: str, details: Optional[Dict[str, Any]] = None):
        """Log agent action"""
        self.info(f"Agent action: {agent_id} - {action}", {
            "agent_id": agent_id,
            "action": action,
            "event": "agent_action",
            **(details or {})
        })

# Global logger instance
_logger_instance = None

def get_logger(name: str = "agent_system", config: Optional[Dict[str, Any]] = None) -> AgentLogger:
    """Get or create a logger instance"""
    global _logger_instance
    if _logger_instance is None or name != "agent_system":
        _logger_instance = AgentLogger(name, config)
    return _logger_instance

def setup_global_logging(config: Optional[Dict[str, Any]] = None):
    """Setup global logging configuration"""
    logger = get_logger(config=config)
    # Set up any global logging configuration here
    return logger