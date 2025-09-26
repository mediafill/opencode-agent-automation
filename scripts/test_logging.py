#!/usr/bin/env python3
"""
Test script for structured logging
"""

import sys
import os
from pathlib import Path

# Add the current directory to Python path
sys.path.insert(0, str(Path(__file__).parent))

from logger import get_logger

def test_structured_logging():
    """Test the structured logging functionality"""
    logger = get_logger('test_logger', log_dir=Path(__file__).parent / 'logs')

    print("Testing structured logging...")

    # Test different log levels with structured data
    logger.debug("Debug message with context",
                user_id=123,
                session="abc123",
                module="authentication")

    logger.info("User logged in successfully",
               user_id=456,
               username="john_doe",
               ip_address="192.168.1.100")

    logger.warning("Rate limit approaching",
                  user_id=789,
                  current_requests=95,
                  limit=100,
                  window_minutes=15)

    logger.error("Database connection failed",
                database="users",
                connection_string="postgresql://***",
                retry_count=3)

    # Test error logging with exception
    try:
        raise ValueError("Test exception for logging")
    except Exception as e:
        logger.error("Exception caught during processing",
                    exception=e,
                    user_id=999,
                    operation="user_creation")

    print("Structured logging test completed successfully!")
    return True

if __name__ == "__main__":
    test_structured_logging()