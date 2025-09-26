#!/usr/bin/env python3
"""
Structured logging system for Python components
Provides consistent logging with correlation IDs, structured data, and error categorization
"""

import logging
import json
import sys
import time
import traceback
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional, Union


class StructuredFormatter(logging.Formatter):
    """Custom formatter for structured JSON logging"""

    def format(self, record: logging.LogRecord) -> str:
        log_entry = {
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'level': record.levelname,
            'service': getattr(record, 'service', 'python-service'),
            'environment': getattr(record, 'environment', 'development'),
            'logger': record.name,
            'message': record.getMessage(),
            'module': record.module,
            'function': record.funcName,
            'line': record.lineno,
            'process_id': record.process,
            'thread_id': record.thread
        }

        # Add correlation ID if available
        correlation_id = getattr(record, 'correlation_id', None)
        if correlation_id:
            log_entry['correlationId'] = correlation_id

        # Add custom fields
        extra_fields = getattr(record, 'extra_fields', None)
        if extra_fields:
            log_entry.update(extra_fields)

        # Add exception info if available
        if record.exc_info:
            log_entry['exception'] = {
                'type': record.exc_info[0].__name__ if record.exc_info[0] else 'Unknown',
                'message': str(record.exc_info[1]) if record.exc_info[1] else '',
                'stack': traceback.format_exception(*record.exc_info)
            }

        return json.dumps(log_entry, ensure_ascii=False)


class StructuredLogger:
    """Enhanced logger with structured logging capabilities"""

    def __init__(self, name: str = __name__, log_dir: Optional[Path] = None):
        self.logger = logging.getLogger(name)
        self.logger.setLevel(logging.DEBUG)

        # Clear existing handlers
        self.logger.handlers.clear()

        # Create log directory
        if log_dir is None:
            log_dir = Path(__file__).parent / 'logs'
        log_dir.mkdir(exist_ok=True)

        # File handler for all logs
        file_handler = logging.FileHandler(log_dir / 'python_combined.log')
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(StructuredFormatter())
        self.logger.addHandler(file_handler)

        # File handler for errors only
        error_handler = logging.FileHandler(log_dir / 'python_errors.log')
        error_handler.setLevel(logging.ERROR)
        error_handler.setFormatter(StructuredFormatter())
        self.logger.addHandler(error_handler)

        # Console handler for development
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(logging.INFO)
        console_formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        console_handler.setFormatter(console_formatter)
        self.logger.addHandler(console_handler)

        self.correlation_id: Optional[str] = None

    def set_correlation_id(self, correlation_id: Optional[str] = None) -> str:
        """Set correlation ID for request tracing"""
        if correlation_id is None:
            correlation_id = str(uuid.uuid4())[:8]
        self.correlation_id = correlation_id
        return correlation_id

    def _log_with_context(self, level: int, message: str, extra_fields: Optional[Dict[str, Any]] = None,
                         correlation_id: Optional[str] = None, exc_info: bool = False) -> None:
        """Internal method to log with structured context"""
        extra: Dict[str, Any] = {
            'service': 'task-delegator',
            'environment': 'development'
        }

        correlation_id_to_use = correlation_id or self.correlation_id
        if correlation_id_to_use:
            extra['correlation_id'] = correlation_id_to_use

        if extra_fields:
            extra['extra_fields'] = extra_fields

        self.logger.log(level, message, extra=extra, exc_info=exc_info)

    def debug(self, message: str, extra_fields: Optional[Dict[str, Any]] = None,
              correlation_id: Optional[str] = None) -> None:
        """Log debug message with structured context"""
        self._log_with_context(logging.DEBUG, message, extra_fields, correlation_id)

    def info(self, message: str, extra_fields: Optional[Dict[str, Any]] = None,
             correlation_id: Optional[str] = None) -> None:
        """Log info message with structured context"""
        self._log_with_context(logging.INFO, message, extra_fields, correlation_id)

    def warning(self, message: str, extra_fields: Optional[Dict[str, Any]] = None,
                correlation_id: Optional[str] = None) -> None:
        """Log warning message with structured context"""
        self._log_with_context(logging.WARNING, message, extra_fields, correlation_id)

    def error(self, message: str, extra_fields: Optional[Dict[str, Any]] = None,
              correlation_id: Optional[str] = None, exc_info: bool = True) -> None:
        """Log error message with structured context and exception info"""
        self._log_with_context(logging.ERROR, message, extra_fields, correlation_id, exc_info)

    def critical(self, message: str, extra_fields: Optional[Dict[str, Any]] = None,
                 correlation_id: Optional[str] = None, exc_info: bool = True) -> None:
        """Log critical message with structured context and exception info"""
        self._log_with_context(logging.CRITICAL, message, extra_fields, correlation_id, exc_info)

    def log_performance(self, operation: str, duration: float,
                       extra_fields: Optional[Dict[str, Any]] = None,
                       correlation_id: Optional[str] = None) -> None:
        """Log performance metrics"""
        perf_data = {
            'operation': operation,
            'duration_ms': round(duration * 1000, 2),
            'category': 'performance'
        }
        if extra_fields:
            perf_data.update(extra_fields)

        level = logging.WARNING if duration > 5.0 else logging.INFO
        self._log_with_context(level, f"Performance metric: {operation}", perf_data, correlation_id)

    def log_security_event(self, event_type: str, details: Optional[Dict[str, Any]] = None,
                          correlation_id: Optional[str] = None) -> None:
        """Log security-related events"""
        security_data = {
            'event_type': event_type,
            'category': 'security',
            'severity': 'high' if event_type in ['unauthorized_access', 'injection_attempt'] else 'medium'
        }
        if details:
            security_data.update(details)

        self._log_with_context(logging.WARNING, f"Security event: {event_type}",
                             security_data, correlation_id)

    def log_business_event(self, event: str, details: Optional[Dict[str, Any]] = None,
                          correlation_id: Optional[str] = None) -> None:
        """Log business logic events"""
        business_data = {
            'event': event,
            'category': 'business'
        }
        if details:
            business_data.update(details)

        self._log_with_context(logging.INFO, f"Business event: {event}",
                             business_data, correlation_id)


class PerformanceMonitor:
    """Context manager for performance monitoring"""

    def __init__(self, logger: StructuredLogger, operation: str,
                 correlation_id: Optional[str] = None, threshold: float = 1.0):
        self.logger = logger
        self.operation = operation
        self.correlation_id = correlation_id
        self.threshold = threshold
        self.start_time: Optional[float] = None

    def __enter__(self) -> 'PerformanceMonitor':
        self.start_time = time.time()
        self.logger.debug(f"Starting operation: {self.operation}",
                         correlation_id=self.correlation_id)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        if self.start_time is not None:
            duration = time.time() - self.start_time

            if exc_type is not None:
                self.logger.error(f"Operation failed: {self.operation}", {
                    'duration_ms': round(duration * 1000, 2),
                    'exception_type': exc_type.__name__,
                    'exception_message': str(exc_val)
                }, self.correlation_id)
            else:
                self.logger.log_performance(self.operation, duration,
                                          correlation_id=self.correlation_id)

                if duration > self.threshold:
                    self.logger.warning(f"Slow operation detected: {self.operation}", {
                        'duration_ms': round(duration * 1000, 2),
                        'threshold_ms': round(self.threshold * 1000, 2)
                    }, self.correlation_id)


# Global logger instance
structured_logger = StructuredLogger()

# Convenience functions
def get_logger() -> StructuredLogger:
    """Get the global structured logger instance"""
    return structured_logger

def set_correlation_id(correlation_id: Optional[str] = None) -> str:
    """Set global correlation ID"""
    return structured_logger.set_correlation_id(correlation_id)

def monitor_performance(operation: str, threshold: float = 1.0,
                       correlation_id: Optional[str] = None) -> PerformanceMonitor:
    """Decorator/context manager for performance monitoring"""
    return PerformanceMonitor(structured_logger, operation, correlation_id, threshold)