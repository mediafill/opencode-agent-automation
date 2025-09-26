#!/usr/bin/env python3
"""
Optimized Database Layer for OpenCode Agent
Provides efficient database operations with indexing, caching, and query optimization
"""

import json
import time
import threading
from pathlib import Path
from typing import Dict, List, Optional, Any, Set, Tuple
from collections import OrderedDict
import hashlib

try:
    from logger import StructuredLogger
    logger = StructuredLogger(__name__)
except ImportError:
    import logging
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)


class OptimizedDatabase:
    """
    Optimized database layer with indexing, caching, and query optimization
    """

    def __init__(self, base_dir: Path, cache_ttl: int = 300, max_cache_size: int = 1000):
        self.base_dir = base_dir
        self.cache_ttl = cache_ttl
        self.max_cache_size = max_cache_size

        # File paths
        self.tasks_file = base_dir / 'tasks.json'
        self.status_file = base_dir / 'task_status.json'

        # Caching system
        self._data_cache: Dict[str, Dict] = {}  # file_key -> data
        self._cache_timestamps: Dict[str, float] = {}  # file_key -> timestamp
        self._cache_lock = threading.RLock()

        # Indexing system
        self._indexes: Dict[str, Dict[str, Any]] = {}
        self._index_lock = threading.RLock()

        # Query result cache
        self._query_cache: OrderedDict = OrderedDict()  # LRU cache for query results
        self._query_cache_lock = threading.RLock()

        # Batch operation buffers
        self._pending_writes: Dict[str, Dict] = {}
        self._batch_lock = threading.RLock()
        self._batch_timer: Optional[threading.Timer] = None

        # Statistics
        self.stats = {
            'cache_hits': 0,
            'cache_misses': 0,
            'file_reads': 0,
            'file_writes': 0,
            'index_hits': 0,
            'index_misses': 0,
            'query_cache_hits': 0,
            'query_cache_misses': 0
        }

    def _get_file_key(self, file_path: Path) -> str:
        """Generate cache key for file"""
        return str(file_path.relative_to(self.base_dir))

    def _is_cache_valid(self, file_key: str) -> bool:
        """Check if cache entry is still valid"""
        if file_key not in self._cache_timestamps:
            return False
        return (time.time() - self._cache_timestamps[file_key]) < self.cache_ttl

    def _get_cached_data(self, file_path: Path) -> Optional[Dict]:
        """Get data from cache or load from file"""
        file_key = self._get_file_key(file_path)

        with self._cache_lock:
            if self._is_cache_valid(file_key):
                self.stats['cache_hits'] += 1
                return self._data_cache[file_key].copy()

        # Cache miss - load from file
        self.stats['cache_misses'] += 1
        self.stats['file_reads'] += 1

        try:
            if file_path.exists():
                with open(file_path, 'r') as f:
                    data = json.load(f)

                with self._cache_lock:
                    self._data_cache[file_key] = data
                    self._cache_timestamps[file_key] = time.time()

                    # Maintain cache size limit
                    if len(self._data_cache) > self.max_cache_size:
                        oldest_key = min(self._cache_timestamps.keys(),
                                       key=lambda k: self._cache_timestamps[k])
                        del self._data_cache[oldest_key]
                        del self._cache_timestamps[oldest_key]

                return data.copy()
        except Exception as e:
            logger.error(f"Error loading {file_path}: {e}")

        return None

    def _invalidate_cache(self, file_key: str):
        """Invalidate cache entry"""
        with self._cache_lock:
            if file_key in self._data_cache:
                del self._data_cache[file_key]
            if file_key in self._cache_timestamps:
                del self._cache_timestamps[file_key]

    def _write_data(self, file_path: Path, data: Dict):
        """Write data to file and update cache"""
        file_key = self._get_file_key(file_path)
        self.stats['file_writes'] += 1

        try:
            with open(file_path, 'w') as f:
                json.dump(data, f, indent=2)

            # Update cache
            with self._cache_lock:
                self._data_cache[file_key] = data.copy()
                self._cache_timestamps[file_key] = time.time()

            # Invalidate related indexes
            self._invalidate_indexes_for_file(file_key)

        except Exception as e:
            logger.error(f"Error writing {file_path}: {e}")
            raise

    def _invalidate_indexes_for_file(self, file_key: str):
        """Invalidate indexes that depend on the given file"""
        with self._index_lock:
            # For now, invalidate all indexes when data changes
            # In a more sophisticated implementation, we'd track dependencies
            self._indexes.clear()

    def _ensure_indexes(self, file_key: str):
        """Ensure indexes exist for the given file"""
        if file_key in self._indexes:
            return

        data = self._get_cached_data(self.base_dir / file_key)
        if not data:
            return

        with self._index_lock:
            if file_key == 'tasks.json' and 'tasks' in data:
                self._build_task_indexes(data['tasks'])
            elif file_key == 'task_status.json':
                self._build_status_indexes(data)

    def _build_task_indexes(self, tasks: List[Dict]):
        """Build indexes for tasks data"""
        indexes = {
            'by_id': {},
            'by_type': {},
            'by_status': {},
            'by_priority': {},
            'by_created_date': {},
            'by_files_pattern': set()
        }

        for task in tasks:
            task_id = task.get('id')
            if not task_id:
                continue

            # Primary index
            indexes['by_id'][task_id] = task

            # Type index
            task_type = task.get('type', 'general')
            if task_type not in indexes['by_type']:
                indexes['by_type'][task_type] = []
            indexes['by_type'][task_type].append(task)

            # Status index
            status = task.get('status', 'pending')
            if status not in indexes['by_status']:
                indexes['by_status'][status] = []
            indexes['by_status'][status].append(task)

            # Priority index
            priority = task.get('priority', 'medium')
            if priority not in indexes['by_priority']:
                indexes['by_priority'][priority] = []
            indexes['by_priority'][priority].append(task)

            # Files pattern index (for quick matching)
            files_pattern = task.get('files_pattern', '**/*')
            indexes['by_files_pattern'].add(files_pattern)

        self._indexes['tasks.json'] = indexes

    def _build_status_indexes(self, status_data: Dict):
        """Build indexes for status data"""
        indexes = {
            'by_task_id': {},
            'running_tasks': [],
            'completed_tasks': [],
            'failed_tasks': []
        }

        # Index running tasks
        for task_id, task_data in status_data.get('running_tasks', {}).items():
            indexes['by_task_id'][task_id] = task_data
            indexes['running_tasks'].append(task_data)

        # Index completed tasks
        for task_id, task_data in status_data.get('completed_tasks', {}).items():
            indexes['by_task_id'][task_id] = task_data
            indexes['completed_tasks'].append(task_data)

        # Index failed tasks
        for task_data in indexes['completed_tasks']:
            if task_data.get('error'):
                indexes['failed_tasks'].append(task_data)

        self._indexes['task_status.json'] = indexes

    def _get_query_cache_key(self, query_type: str, **params) -> str:
        """Generate cache key for query"""
        param_str = json.dumps(params, sort_keys=True)
        return f"{query_type}:{hashlib.md5(param_str.encode()).hexdigest()}"

    def _get_cached_query_result(self, cache_key: str) -> Optional[Any]:
        """Get cached query result"""
        with self._query_cache_lock:
            if cache_key in self._query_cache:
                # Move to end (most recently used)
                self._query_cache.move_to_end(cache_key)
                self.stats['query_cache_hits'] += 1
                return self._query_cache[cache_key]
        self.stats['query_cache_misses'] += 1
        return None

    def _cache_query_result(self, cache_key: str, result: Any):
        """Cache query result"""
        with self._query_cache_lock:
            self._query_cache[cache_key] = result
            self._query_cache.move_to_end(cache_key)

            # Maintain cache size
            if len(self._query_cache) > 500:  # Max 500 cached queries
                self._query_cache.popitem(last=False)

    # Public API methods

    def get_tasks(self, filters: Optional[Dict] = None, use_cache: bool = True) -> List[Dict]:
        """Get tasks with optional filtering and caching"""
        cache_key = self._get_query_cache_key('get_tasks', filters=filters or {})

        if use_cache:
            cached_result = self._get_cached_query_result(cache_key)
            if cached_result is not None:
                return cached_result.copy()

        # Ensure indexes are built
        self._ensure_indexes('tasks.json')

        data = self._get_cached_data(self.tasks_file)
        if not data or 'tasks' not in data:
            return []

        tasks = data['tasks']

        # Apply filters using indexes when possible
        if filters:
            tasks = self._apply_task_filters(tasks, filters)

        if use_cache:
            self._cache_query_result(cache_key, tasks)

        return tasks.copy()

    def _apply_task_filters(self, tasks: List[Dict], filters: Dict) -> List[Dict]:
        """Apply filters to tasks using indexes when possible"""
        filtered_tasks = tasks

        # Use indexes for efficient filtering
        with self._index_lock:
            indexes = self._indexes.get('tasks.json', {})

            if 'type' in filters and 'by_type' in indexes:
                type_tasks = set()
                for task in indexes['by_type'].get(filters['type'], []):
                    type_tasks.add(task['id'])
                filtered_tasks = [t for t in filtered_tasks if t['id'] in type_tasks]

            if 'status' in filters and 'by_status' in indexes:
                status_tasks = set()
                for task in indexes['by_status'].get(filters['status'], []):
                    status_tasks.add(task['id'])
                filtered_tasks = [t for t in filtered_tasks if t['id'] in status_tasks]

            if 'priority' in filters and 'by_priority' in indexes:
                priority_tasks = set()
                for task in indexes['by_priority'].get(filters['priority'], []):
                    priority_tasks.add(task['id'])
                filtered_tasks = [t for t in filtered_tasks if t['id'] in priority_tasks]

        # Apply remaining filters (non-indexed)
        for key, value in filters.items():
            if key not in ['type', 'status', 'priority']:  # Already handled above
                if key == 'id':
                    filtered_tasks = [t for t in filtered_tasks if t.get('id') == value]
                elif key == 'files_pattern':
                    filtered_tasks = [t for t in filtered_tasks if value in t.get('files_pattern', '')]
                else:
                    filtered_tasks = [t for t in filtered_tasks if t.get(key) == value]

        return filtered_tasks

    def get_task_by_id(self, task_id: str) -> Optional[Dict]:
        """Get a single task by ID using index"""
        self._ensure_indexes('tasks.json')

        with self._index_lock:
            indexes = self._indexes.get('tasks.json', {})
            if 'by_id' in indexes:
                self.stats['index_hits'] += 1
                return indexes['by_id'].get(task_id)
            else:
                self.stats['index_misses'] += 1

        # Fallback to full scan
        tasks = self.get_tasks()
        return next((t for t in tasks if t.get('id') == task_id), None)

    def get_task_status(self, task_id: str) -> Optional[Dict]:
        """Get task status using index"""
        self._ensure_indexes('task_status.json')

        with self._index_lock:
            indexes = self._indexes.get('task_status.json', {})
            if 'by_task_id' in indexes:
                self.stats['index_hits'] += 1
                return indexes['by_task_id'].get(task_id)
            else:
                self.stats['index_misses'] += 1

        # Fallback
        status_data = self._get_cached_data(self.status_file)
        if status_data:
            for section in ['running_tasks', 'completed_tasks']:
                if section in status_data and task_id in status_data[section]:
                    return status_data[section][task_id]

        return None

    def save_tasks(self, tasks: List[Dict]):
        """Save tasks with batching and cache invalidation"""
        data = {'tasks': tasks, 'updated_at': time.time()}
        self._write_data(self.tasks_file, data)

    def save_task_status(self, status_data: Dict):
        """Save task status with batching"""
        status_data['updated_at'] = time.time()
        self._write_data(self.status_file, status_data)

    def update_task(self, task_id: str, updates: Dict):
        """Update a single task efficiently"""
        tasks = self.get_tasks(use_cache=False)  # Get fresh data
        task_found = False

        for task in tasks:
            if task.get('id') == task_id:
                task.update(updates)
                task_found = True
                break

        if task_found:
            self.save_tasks(tasks)
            return True

        return False

    def batch_update_tasks(self, updates: List[Tuple[str, Dict]]):
        """Batch update multiple tasks efficiently"""
        if not updates:
            return

        tasks = self.get_tasks(use_cache=False)
        task_map = {t['id']: t for t in tasks if 'id' in t}

        for task_id, update_data in updates:
            if task_id in task_map:
                task_map[task_id].update(update_data)

        self.save_tasks(list(task_map.values()))

    def get_statistics_summary(self) -> Dict:
        """Get database performance statistics"""
        return {
            'cache_performance': {
                'hits': self.stats['cache_hits'],
                'misses': self.stats['cache_misses'],
                'hit_ratio': self.stats['cache_hits'] / max(1, self.stats['cache_hits'] + self.stats['cache_misses'])
            },
            'index_performance': {
                'hits': self.stats['index_hits'],
                'misses': self.stats['index_misses'],
                'hit_ratio': self.stats['index_hits'] / max(1, self.stats['index_hits'] + self.stats['index_misses'])
            },
            'query_cache_performance': {
                'hits': self.stats['query_cache_hits'],
                'misses': self.stats['query_cache_misses'],
                'hit_ratio': self.stats['query_cache_hits'] / max(1, self.stats['query_cache_hits'] + self.stats['query_cache_misses'])
            },
            'file_operations': {
                'reads': self.stats['file_reads'],
                'writes': self.stats['file_writes']
            },
            'cache_size': len(self._data_cache),
            'query_cache_size': len(self._query_cache),
            'index_count': len(self._indexes)
        }

    def clear_caches(self):
        """Clear all caches"""
        with self._cache_lock:
            self._data_cache.clear()
            self._cache_timestamps.clear()

        with self._query_cache_lock:
            self._query_cache.clear()

        with self._index_lock:
            self._indexes.clear()

        logger.info("All caches cleared")