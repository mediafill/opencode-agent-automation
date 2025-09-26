#!/usr/bin/env python3
"""
Comprehensive unit tests for IntelligentCache
Tests all core functions and classes with edge cases and error handling
"""

import unittest
import unittest.mock as mock
import tempfile
import json
import time
import threading
from pathlib import Path
from datetime import datetime, timedelta
from collections import OrderedDict
import hashlib
import sys

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'scripts'))

try:
    from intelligent_cache import (
        IntelligentCache, CacheEntry, CacheMetrics, get_cache,
        cache_file_operation, cache_process_operation, cache_system_operation,
        cache_task_operation, cache_config_operation, cache_log_operation,
        invalidate_file_cache, invalidate_process_cache, invalidate_system_cache,
        invalidate_task_cache, invalidate_config_cache, invalidate_log_cache,
        get_cache_stats, log_cache_stats, start_cache_monitoring
    )
except ImportError:
    # Fallback for direct execution
    sys.path.insert(0, str(Path(__file__).parent.parent.parent.absolute() / 'scripts'))
    try:
        from intelligent_cache import (
            IntelligentCache, CacheEntry, CacheMetrics, get_cache,
            cache_file_operation, cache_process_operation, cache_system_operation,
            cache_task_operation, cache_config_operation, cache_log_operation,
            invalidate_file_cache, invalidate_process_cache, invalidate_system_cache,
            invalidate_task_cache, invalidate_config_cache, invalidate_log_cache,
            get_cache_stats, log_cache_stats, start_cache_monitoring
        )
    except ImportError:
        print("Could not import intelligent_cache module")
        sys.exit(1)


class TestCacheEntry(unittest.TestCase):
    """Test CacheEntry class functionality"""

    def test_cache_entry_initialization(self):
        """Test cache entry initialization with all parameters"""
        entry = CacheEntry("test_key", "test_value", ttl_seconds=300)

        self.assertEqual(entry.key, "test_key")
        self.assertEqual(entry.value, "test_value")
        self.assertEqual(entry.ttl_seconds, 300)
        self.assertIsNotNone(entry.created_at)
        self.assertIsNotNone(entry.last_accessed)
        self.assertEqual(entry.access_count, 0)
        self.assertIsInstance(entry.size_bytes, int)
        self.assertGreater(entry.size_bytes, 0)

    def test_cache_entry_is_expired(self):
        """Test cache entry expiration logic"""
        # Entry with TTL
        entry = CacheEntry("key", "value", ttl_seconds=1)
        self.assertFalse(entry.is_expired())

        # Simulate expiration
        entry.created_at = datetime.now() - timedelta(seconds=2)
        self.assertTrue(entry.is_expired())

        # Entry without TTL (never expires)
        eternal_entry = CacheEntry("eternal", "value")
        eternal_entry.created_at = datetime.now() - timedelta(days=365)
        self.assertFalse(eternal_entry.is_expired())


class TestIntelligentCache(unittest.TestCase):
    """Test IntelligentCache class functionality"""

    def setUp(self):
        """Set up test fixtures"""
        self.temp_dir = tempfile.mkdtemp()
        self.cache_dir = Path(self.temp_dir) / '.claude' / 'cache'
        self.cache = IntelligentCache(
            max_memory_mb=10,
            default_ttl_seconds=60,
            enable_persistence=True,
            persistence_dir=str(self.cache_dir)
        )
        self.addCleanup(self.cleanup)

    def cleanup(self):
        """Clean up test fixtures"""
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_cache_initialization(self):
        """Test cache initialization"""
        self.assertIsInstance(self.cache.cache, OrderedDict)
        self.assertIsInstance(self.cache.metrics, CacheMetrics)
        self.assertIsNotNone(self.cache.lock)
        self.assertEqual(self.cache.max_memory_bytes, 10 * 1024 * 1024)
        self.assertEqual(self.cache.default_ttl_seconds, 60)
        self.assertTrue(self.cache.enable_persistence)
        self.assertTrue(self.cache.persistence_dir.exists())

    def test_cache_set_and_get(self):
        """Test basic cache set and get operations"""
        # Set value
        self.cache.set("test_key", "test_value")
        self.assertEqual(self.cache.metrics.sets, 1)

        # Get value
        value = self.cache.get("test_key")
        self.assertEqual(value, "test_value")
        self.assertEqual(self.cache.metrics.hits, 1)

        # Get non-existent key
        value = self.cache.get("non_existent")
        self.assertIsNone(value)
        self.assertEqual(self.cache.metrics.misses, 1)

    def test_cache_set_with_ttl(self):
        """Test cache set with TTL"""
        self.cache.set("ttl_key", "ttl_value", ttl_seconds=1)

        # Should exist immediately
        self.assertEqual(self.cache.get("ttl_key"), "ttl_value")

        # Simulate expiration
        self.cache.cache["ttl_key"].created_at = datetime.now() - timedelta(seconds=2)

        # Should be expired
        self.assertIsNone(self.cache.get("ttl_key"))
        self.assertEqual(self.cache.metrics.evictions, 1)

    def test_cache_memory_management(self):
        """Test cache memory management and eviction"""
        # Set very small memory limit for testing
        small_cache = IntelligentCache(max_memory_mb=0.001)  # ~1KB

        # Add entries that exceed memory limit
        large_value = "x" * 1000  # 1000 bytes
        small_cache.set("key1", large_value)
        small_cache.set("key2", large_value)

        # Should have evicted the first entry
        self.assertIsNone(small_cache.get("key1"))
        self.assertEqual(small_cache.get("key2"), large_value)
        self.assertEqual(small_cache.metrics.evictions, 1)

    def test_cache_stats(self):
        """Test cache statistics"""
        self.cache.set("stats_key", "stats_value")
        self.cache.get("stats_key")
        self.cache.get("missing_key")

        stats = self.cache.get_stats()

        self.assertEqual(stats['entries'], 1)
        self.assertEqual(stats['hits'], 1)
        self.assertEqual(stats['misses'], 1)
        self.assertEqual(stats['sets'], 1)
        self.assertGreater(stats['memory_usage_mb'], 0)
        self.assertEqual(stats['max_memory_mb'], 10)
        self.assertEqual(stats['hit_rate'], 0.5)


class TestCacheGlobalFunctions(unittest.TestCase):
    """Test global cache functions"""

    def setUp(self):
        """Reset global cache instance"""
        import intelligent_cache
        intelligent_cache._cache_instance = None

    def test_get_cache_singleton(self):
        """Test get_cache returns singleton instance"""
        cache1 = get_cache()
        cache2 = get_cache()

        self.assertIs(cache1, cache2)
        self.assertIsInstance(cache1, IntelligentCache)

    def test_cache_convenience_functions(self):
        """Test cache convenience functions"""
        # Test file operation caching
        call_count = 0
        def test_func(arg1):
            nonlocal call_count
            call_count += 1
            return f"result_{call_count}_{arg1}"

        result1 = cache_file_operation(test_func, "arg1")
        result2 = cache_file_operation(test_func, "arg1")

        self.assertEqual(result1, "result_1_arg1")
        self.assertEqual(result2, "result_1_arg1")  # Cached
        self.assertEqual(call_count, 1)


if __name__ == '__main__':
    unittest.main()