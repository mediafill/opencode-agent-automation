#!/usr/bin/env python3
"""
Intelligent Caching System for OpenCode Agent Automation
Provides centralized caching with TTL, LRU eviction, and performance monitoring
"""

import time
import threading
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Callable, Union
from collections import OrderedDict
import hashlib
import json
import os
from pathlib import Path
import psutil
import logging

try:
    from logger import StructuredLogger

    logger = StructuredLogger(__name__)
except ImportError:
    import logging

    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)


class CacheEntry:
    """Represents a single cache entry with metadata"""

    def __init__(
        self,
        key: str,
        value: Any,
        ttl_seconds: Optional[int] = None,
        created_at: Optional[datetime] = None,
        access_count: int = 0,
    ):
        self.key = key
        self.value = value
        self.ttl_seconds = ttl_seconds
        self.created_at = created_at or datetime.now()
        self.last_accessed = self.created_at
        self.access_count = access_count
        self.size_bytes = self._estimate_size()

    def _estimate_size(self) -> int:
        """Estimate memory size of the cached value"""
        try:
            if isinstance(self.value, (str, bytes)):
                return len(self.value)
            elif isinstance(self.value, dict):
                return len(json.dumps(self.value))
            elif isinstance(self.value, list):
                return sum(
                    len(json.dumps(item)) if isinstance(item, dict) else len(str(item))
                    for item in self.value
                )
            else:
                return len(str(self.value))
        except:
            return 1024  # Default estimate

    def is_expired(self) -> bool:
        """Check if cache entry has expired"""
        if self.ttl_seconds is None:
            return False
        return (datetime.now() - self.created_at).total_seconds() > self.ttl_seconds

    def touch(self):
        """Update last accessed time and increment access count"""
        self.last_accessed = datetime.now()
        self.access_count += 1

    def to_dict(self) -> Dict:
        """Convert to dictionary for serialization"""
        return {
            "key": self.key,
            "value": self.value,
            "ttl_seconds": self.ttl_seconds,
            "created_at": self.created_at.isoformat(),
            "last_accessed": self.last_accessed.isoformat(),
            "access_count": self.access_count,
            "size_bytes": self.size_bytes,
        }


class CacheMetrics:
    """Cache performance metrics"""

    def __init__(self):
        self.hits = 0
        self.misses = 0
        self.evictions = 0
        self.sets = 0
        self.deletes = 0
        self.total_memory_bytes = 0
        self.start_time = datetime.now()

    def hit_rate(self) -> float:
        """Calculate cache hit rate"""
        total = self.hits + self.misses
        return self.hits / total if total > 0 else 0.0

    def reset(self):
        """Reset all metrics"""
        self.hits = self.misses = self.evictions = self.sets = self.deletes = 0
        self.start_time = datetime.now()


class IntelligentCache:
    """Intelligent caching system with TTL, LRU eviction, and multiple cache types"""

    def __init__(
        self,
        max_memory_mb: int = 100,
        default_ttl_seconds: int = 300,
        enable_persistence: bool = True,
        persistence_dir: Optional[str] = None,
    ):
        self.max_memory_bytes = max_memory_mb * 1024 * 1024
        self.default_ttl_seconds = default_ttl_seconds
        self.enable_persistence = enable_persistence
        self.persistence_dir = (
            Path(persistence_dir) if persistence_dir else Path(".claude/cache")
        )
        self.lock = threading.RLock()

        # Cache storage: key -> CacheEntry
        self.cache: OrderedDict[str, CacheEntry] = OrderedDict()

        # Metrics
        self.metrics = CacheMetrics()

        # Cache types with different TTLs
        self.cache_types = {
            "file": 600,  # File operations - 10 minutes
            "process": 30,  # Process data - 30 seconds
            "system": 10,  # System resources - 10 seconds
            "task": 60,  # Task status - 1 minute
            "config": 1800,  # Configuration - 30 minutes
            "log": 120,  # Log content - 2 minutes
        }

        # Setup persistence
        if self.enable_persistence:
            self.persistence_dir.mkdir(parents=True, exist_ok=True)
            self._load_persistent_cache()

        # Start cleanup thread
        self.cleanup_thread = threading.Thread(target=self._cleanup_worker, daemon=True)
        self.cleanup_thread.start()

    def _generate_key(self, *args, **kwargs) -> str:
        """Generate a consistent cache key from arguments"""
        key_parts = [str(arg) for arg in args]
        if kwargs:
            key_parts.extend(f"{k}:{v}" for k, v in sorted(kwargs.items()))
        key_string = "|".join(key_parts)
        return hashlib.md5(key_string.encode()).hexdigest()

    def get(self, key: str, default: Any = None) -> Any:
        """Get value from cache"""
        with self.lock:
            if key in self.cache:
                entry = self.cache[key]
                if not entry.is_expired():
                    entry.touch()
                    self.cache.move_to_end(key)  # Mark as recently used
                    self.metrics.hits += 1
                    return entry.value
                else:
                    # Remove expired entry
                    del self.cache[key]
                    self.metrics.evictions += 1

            self.metrics.misses += 1
            return default

    def set(
        self,
        key: str,
        value: Any,
        ttl_seconds: Optional[int] = None,
        cache_type: Optional[str] = None,
    ) -> None:
        """Set value in cache with optional TTL"""
        with self.lock:
            # Use cache type TTL if specified, otherwise use default
            if cache_type and cache_type in self.cache_types:
                ttl_seconds = self.cache_types[cache_type]
            elif ttl_seconds is None:
                ttl_seconds = self.default_ttl_seconds

            entry = CacheEntry(key, value, ttl_seconds)

            # Evict entries if necessary to stay within memory limits
            # Uses LRU (Least Recently Used) eviction policy
            while (
                self._current_memory_usage() + entry.size_bytes > self.max_memory_bytes
                and self.cache
            ):
                # Remove least recently used entry (first in OrderedDict)
                _, evicted_entry = self.cache.popitem(last=False)
                self.metrics.evictions += 1
                self.metrics.total_memory_bytes -= evicted_entry.size_bytes

            # Add new entry, updating memory usage tracking
            if key in self.cache:
                old_entry = self.cache[key]
                self.metrics.total_memory_bytes -= old_entry.size_bytes
            else:
                self.metrics.sets += 1

            self.cache[key] = entry
            self.cache.move_to_end(key)  # Mark as most recently used
            self.metrics.total_memory_bytes += entry.size_bytes

    def delete(self, key: str) -> bool:
        """Delete entry from cache"""
        with self.lock:
            if key in self.cache:
                entry = self.cache[key]
                self.metrics.total_memory_bytes -= entry.size_bytes
                del self.cache[key]
                self.metrics.deletes += 1
                return True
            return False

    def clear(self, pattern: Optional[str] = None) -> int:
        """Clear cache entries, optionally matching a pattern"""
        with self.lock:
            if pattern:
                keys_to_remove = [k for k in self.cache.keys() if pattern in k]
            else:
                keys_to_remove = list(self.cache.keys())

            for key in keys_to_remove:
                if key in self.cache:
                    entry = self.cache[key]
                    self.metrics.total_memory_bytes -= entry.size_bytes
                    del self.cache[key]
                    self.metrics.deletes += 1

            return len(keys_to_remove)

    def get_or_set(
        self,
        key: str,
        func: Callable,
        ttl_seconds: Optional[int] = None,
        cache_type: Optional[str] = None,
        force_refresh: bool = False,
    ) -> Any:
        """Get from cache or compute and cache the value"""
        if not force_refresh:
            cached_value = self.get(key)
            if cached_value is not None:
                return cached_value

        # Compute new value using provided function
        # This allows expensive operations to be cached transparently
        value = func()
        self.set(key, value, ttl_seconds, cache_type)
        return value

    def _current_memory_usage(self) -> int:
        """Get current memory usage of cache"""
        return self.metrics.total_memory_bytes

    def get_stats(self) -> Dict:
        """Get cache statistics"""
        with self.lock:
            return {
                "entries": len(self.cache),
                "memory_usage_mb": self._current_memory_usage() / (1024 * 1024),
                "max_memory_mb": self.max_memory_bytes / (1024 * 1024),
                "hit_rate": self.metrics.hit_rate(),
                "hits": self.metrics.hits,
                "misses": self.metrics.misses,
                "evictions": self.metrics.evictions,
                "sets": self.metrics.sets,
                "deletes": self.metrics.deletes,
                "uptime_seconds": (
                    datetime.now() - self.metrics.start_time
                ).total_seconds(),
                "cache_types": self.cache_types.copy(),
            }

    def _cleanup_worker(self):
        """Background cleanup worker for expired entries"""
        while True:
            try:
                time.sleep(60)  # Run cleanup every minute
                self._cleanup_expired()
            except Exception as e:
                logger.error(f"Error in cache cleanup worker: {e}")

    def _cleanup_expired(self):
        """Remove expired cache entries"""
        with self.lock:
            expired_keys = []
            for key, entry in self.cache.items():
                if entry.is_expired():
                    expired_keys.append(key)
                    self.metrics.total_memory_bytes -= entry.size_bytes
                    self.metrics.evictions += 1

            for key in expired_keys:
                del self.cache[key]

    def _load_persistent_cache(self):
        """Load persistent cache from disk"""
        try:
            cache_file = self.persistence_dir / "persistent_cache.json"
            if cache_file.exists():
                with open(cache_file, "r") as f:
                    data = json.load(f)

                for entry_data in data.get("entries", []):
                    # Only load if not expired
                    created_at = datetime.fromisoformat(entry_data["created_at"])
                    ttl_seconds = entry_data.get("ttl_seconds")
                    if (
                        ttl_seconds
                        and (datetime.now() - created_at).total_seconds() < ttl_seconds
                    ):
                        entry = CacheEntry(
                            entry_data["key"],
                            entry_data["value"],
                            ttl_seconds,
                            created_at,
                            entry_data.get("access_count", 0),
                        )
                        self.cache[entry.key] = entry
                        self.metrics.total_memory_bytes += entry.size_bytes

                logger.info(f"Loaded {len(self.cache)} entries from persistent cache")
        except Exception as e:
            logger.error(f"Error loading persistent cache: {e}")

    def _save_persistent_cache(self):
        """Save persistent cache to disk"""
        if not self.enable_persistence:
            return

        try:
            cache_file = self.persistence_dir / "persistent_cache.json"
            entries_data = []

            with self.lock:
                for entry in self.cache.values():
                    # Only persist entries that should be persistent (longer TTL)
                    if entry.ttl_seconds and entry.ttl_seconds > 300:  # > 5 minutes
                        entries_data.append(entry.to_dict())

            with open(cache_file, "w") as f:
                json.dump(
                    {"entries": entries_data, "saved_at": datetime.now().isoformat()},
                    f,
                    indent=2,
                )

        except Exception as e:
            logger.error(f"Error saving persistent cache: {e}")


# Global cache instance
_cache_instance = None
_cache_lock = threading.Lock()


def get_cache() -> IntelligentCache:
    """Get the global cache instance"""
    global _cache_instance
    if _cache_instance is None:
        with _cache_lock:
            if _cache_instance is None:
                _cache_instance = IntelligentCache()
    return _cache_instance


# Convenience functions for different cache types
def cache_file_operation(func: Callable, *args, **kwargs) -> Any:
    """Cache file operations"""
    cache = get_cache()
    key = cache._generate_key("file", func.__name__, *args, kwargs)
    return cache.get_or_set(key, lambda: func(*args, **kwargs), cache_type="file")


def cache_process_operation(func: Callable, *args, **kwargs) -> Any:
    """Cache process-related operations"""
    cache = get_cache()
    key = cache._generate_key("process", func.__name__, *args, kwargs)
    return cache.get_or_set(key, lambda: func(*args, **kwargs), cache_type="process")


def cache_system_operation(func: Callable, *args, **kwargs) -> Any:
    """Cache system resource operations"""
    cache = get_cache()
    key = cache._generate_key("system", func.__name__, *args, kwargs)
    return cache.get_or_set(key, lambda: func(*args, **kwargs), cache_type="system")


def cache_task_operation(func: Callable, *args, **kwargs) -> Any:
    """Cache task-related operations"""
    cache = get_cache()
    key = cache._generate_key("task", func.__name__, *args, kwargs)
    return cache.get_or_set(key, lambda: func(*args, **kwargs), cache_type="task")


def cache_config_operation(func: Callable, *args, **kwargs) -> Any:
    """Cache configuration operations"""
    cache = get_cache()
    key = cache._generate_key("config", func.__name__, *args, kwargs)
    return cache.get_or_set(key, lambda: func(*args, **kwargs), cache_type="config")


def cache_log_operation(func: Callable, *args, **kwargs) -> Any:
    """Cache log operations"""
    cache = get_cache()
    key = cache._generate_key("log", func.__name__, *args, kwargs)
    return cache.get_or_set(key, lambda: func(*args, **kwargs), cache_type="log")


# Cache invalidation helpers
def invalidate_file_cache(pattern: Optional[str] = None):
    """Invalidate file-related cache entries"""
    cache = get_cache()
    return cache.clear(f"file{pattern or ''}")


def invalidate_process_cache(pattern: Optional[str] = None):
    """Invalidate process-related cache entries"""
    cache = get_cache()
    return cache.clear(f"process{pattern or ''}")


def invalidate_system_cache(pattern: Optional[str] = None):
    """Invalidate system-related cache entries"""
    cache = get_cache()
    return cache.clear(f"system{pattern or ''}")


def invalidate_task_cache(pattern: Optional[str] = None):
    """Invalidate task-related cache entries"""
    cache = get_cache()
    return cache.clear(f"task{pattern or ''}")


def invalidate_config_cache(pattern: Optional[str] = None):
    """Invalidate config-related cache entries"""
    cache = get_cache()
    return cache.clear(f"config{pattern or ''}")


def invalidate_log_cache(pattern: Optional[str] = None):
    """Invalidate log-related cache entries"""
    cache = get_cache()
    return cache.clear(f"log{pattern or ''}")


def get_cache_stats() -> Dict:
    """Get comprehensive cache statistics"""
    cache = get_cache()
    return cache.get_stats()


def log_cache_stats():
    """Log current cache statistics"""
    stats = get_cache_stats()
    logger.info(
        f"Cache Stats - Entries: {stats['entries']}, "
        f"Memory: {stats['memory_usage_mb']:.2f}MB/{stats['max_memory_mb']:.2f}MB, "
        f"Hit Rate: {stats['hit_rate']:.2%}"
    )


# Periodic cache monitoring
def warm_cache_from_filesystem(cache_warming_config: Optional[Dict] = None):
    """Warm cache by pre-loading frequently accessed files and data.

    Args:
        cache_warming_config: Configuration for what to warm up
    """
    if not cache_warming_config:
        cache_warming_config = {
            "config_files": ["orchestrator_config.json", "package.json", "README.md"],
            "data_directories": [".claude"],
            "file_patterns": ["*.json", "*.md"],
            "max_files_per_directory": 10
        }

    cache = get_cache()
    warmed_count = 0

    try:
        # Warm config files
        for config_file in cache_warming_config.get("config_files", []):
            try:
                if os.path.exists(config_file):
                    with open(config_file, 'r', encoding='utf-8') as f:
                        content = f.read()
                        cache_key = f"config_{config_file}"
                        cache.set(cache_key, content, cache_type='config')
                        warmed_count += 1
                        logger.debug(f"Warmed cache for config file: {config_file}")
            except Exception as e:
                logger.warning(f"Failed to warm cache for config file {config_file}: {e}")

        # Warm data directories
        for data_dir in cache_warming_config.get("data_directories", []):
            if os.path.exists(data_dir):
                try:
                    max_files = cache_warming_config.get("max_files_per_directory", 10)
                    file_count = 0

                    for root, dirs, files in os.walk(data_dir):
                        for file in files:
                            if file_count >= max_files:
                                break

                            file_path = os.path.join(root, file)
                            try:
                                # Only warm small files to avoid memory issues
                                if os.path.getsize(file_path) < 1024 * 1024:  # 1MB limit
                                    with open(file_path, 'r', encoding='utf-8') as f:
                                        content = f.read()
                                        cache_key = f"file_{file_path}"
                                        cache.set(cache_key, content, cache_type='file')
                                        warmed_count += 1
                                        file_count += 1
                            except (UnicodeDecodeError, OSError) as e:
                                # Skip binary files or files that can't be read
                                continue

                        if file_count >= max_files:
                            break

                    logger.debug(f"Warmed cache for {file_count} files in directory: {data_dir}")

                except Exception as e:
                    logger.warning(f"Failed to warm cache for directory {data_dir}: {e}")

        logger.info(f"Cache warming completed. Warmed {warmed_count} items.")

    except Exception as e:
        logger.error(f"Error during cache warming: {e}")


def get_cache_warming_stats() -> Dict:
    """Get statistics about cache warming effectiveness."""
    cache = get_cache()
    stats = cache.get_stats()

    return {
        "cache_stats": stats,
        "warming_recommendations": {
            "increase_memory_limit": stats["memory_usage_mb"] > stats["max_memory_mb"] * 0.8,
            "optimize_ttl_settings": stats["hit_rate"] < 0.5,
            "add_more_warming": stats["entries"] < 50
        }
    }
