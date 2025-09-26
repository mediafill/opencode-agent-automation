#!/usr/bin/env python3
"""
Performance and Edge Case Tests for Vector Database
Tests performance characteristics and edge cases
"""

import unittest
import unittest.mock as mock
import tempfile
import asyncio
import time
import threading
import json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

# Import from parent directory
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'scripts'))

try:
    from vector_database import VectorDatabase
except ImportError:
    sys.path.insert(0, str(Path(__file__).parent.parent.parent.absolute()))
    from scripts.vector_database import VectorDatabase


class TestVectorDatabasePerformance(unittest.TestCase):
    """Performance tests for VectorDatabase"""

    def setUp(self):
        """Set up test fixtures"""
        self.temp_dir = tempfile.mkdtemp()
        self.project_dir = Path(self.temp_dir)
        self.addCleanup(self.cleanup)

        self.valid_config = {
            'projectDir': str(self.project_dir),
            'chromaUrl': 'http://localhost:8000',
            'collectionName': 'perf_memory'
        }

    def cleanup(self):
        """Clean up test fixtures"""
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    @mock.patch('vector_database.VectorDatabase._try_import_chromadb')
    def test_storage_performance_json_fallback(self, mock_try_chroma):
        """Test storage performance with JSON fallback"""
        mock_try_chroma.return_value = False

        async def test_storage_perf():
            db = VectorDatabase(self.valid_config)
            await db.initialize()

            # Test storing various sizes of task histories
            task_sizes = [
                self._generate_task_history(size='small'),
                self._generate_task_history(size='medium'),
                self._generate_task_history(size='large')
            ]

            for task in task_sizes:
                start_time = time.time()
                doc_id = await db.store_task_history(task)
                end_time = time.time()

                storage_time = end_time - start_time
                # Should store within reasonable time (allowing for test environment)
                self.assertLess(storage_time, 1.0, f"Storage too slow for {task['size']} task")

                # Verify storage
                retrieved = await db.get_task_history(task['taskId'])
                self.assertIsNotNone(retrieved)

        asyncio.run(test_storage_perf())

    def _generate_task_history(self, size='medium'):
        """Generate task history of specified size"""
        base_task = {
            'taskId': f'perf_task_{size}_{int(time.time())}',
            'type': 'testing',
            'description': f'Performance test task ({size})',
            'status': 'completed',
            'size': size
        }

        if size == 'small':
            return base_task
        elif size == 'medium':
            return {
                **base_task,
                'decisions': [
                    {'decision': 'Run tests', 'outcome': 'Passed'},
                    {'decision': 'Check coverage', 'outcome': '95%'}
                ],
                'learnings': ['Test regularly', 'Monitor coverage'],
                'metadata': {'tests': 10, 'coverage': 95}
            }
        elif size == 'large':
            return {
                **base_task,
                'decisions': [{'decision': f'Decision {i}', 'outcome': f'Outcome {i}'} for i in range(10)],
                'learnings': [f'Learning {i}: Detailed explanation of performance consideration' for i in range(20)],
                'metadata': {
                    'testSuites': [{'name': f'Suite {i}', 'tests': 50 + i} for i in range(5)],
                    'performance': {'executionTime': 120.5, 'memoryUsage': '256MB'},
                    'coverage': {'statements': 95.2, 'branches': 89.1, 'functions': 98.0},
                    'dependencies': [f'dep{i}' for i in range(15)]
                }
            }

    @mock.patch('vector_database.VectorDatabase._try_import_chromadb')
    def test_query_performance_json_fallback(self, mock_try_chroma):
        """Test query performance with JSON fallback"""
        mock_try_chroma.return_value = False

        async def test_query_perf():
            db = VectorDatabase(self.valid_config)
            await db.initialize()

            # Store test data
            tasks = []
            for i in range(100):
                task = {
                    'taskId': f'query_perf_task_{i}',
                    'type': 'testing' if i % 2 == 0 else 'refactoring',
                    'description': f'Query performance test task {i} with some unique content {i * 17}',
                    'status': 'completed',
                    'metadata': {'index': i, 'category': 'performance'}
                }
                tasks.append(task)
                await db.store_task_history(task)

            # Test query performance
            queries = [
                'testing tasks',
                'refactoring code',
                'unique content 153',  # Specific content
                'performance test task',  # Common content
                'nonexistent content that should not match'
            ]

            for query in queries:
                start_time = time.time()
                results = await db.query_similar_solutions(query, limit=10)
                end_time = time.time()

                query_time = end_time - start_time
                # Should query within reasonable time
                self.assertLess(query_time, 2.0, f"Query too slow for: {query}")

                # Results should be an array
                self.assertIsInstance(results, list)

        asyncio.run(test_query_perf())

    @mock.patch('vector_database.VectorDatabase._try_import_chromadb')
    def test_concurrent_operations_performance(self, mock_try_chroma):
        """Test performance under concurrent operations"""
        mock_try_chroma.return_value = False

        async def test_concurrent_perf():
            db = VectorDatabase(self.valid_config)
            await db.initialize()

            async def concurrent_worker(worker_id):
                """Worker function for concurrent operations"""
                results = []

                # Store some tasks
                for i in range(5):
                    task = {
                        'taskId': f'concurrent_{worker_id}_{i}',
                        'type': 'testing',
                        'description': f'Concurrent task {worker_id}-{i}',
                        'status': 'completed'
                    }
                    doc_id = await db.store_task_history(task)
                    results.append(('store', doc_id))

                # Query for some results
                query_results = await db.query_similar_solutions(f'concurrent task {worker_id}', limit=3)
                results.append(('query', len(query_results)))

                # Retrieve specific tasks
                for i in range(2):
                    task = await db.get_task_history(f'concurrent_{worker_id}_{i}')
                    results.append(('retrieve', task is not None))

                return results

            # Run multiple workers concurrently
            start_time = time.time()
            workers = [concurrent_worker(i) for i in range(10)]
            results = await asyncio.gather(*workers)
            end_time = time.time()

            total_time = end_time - start_time

            # Should complete within reasonable time for concurrent operations
            self.assertLess(total_time, 10.0, "Concurrent operations too slow")

            # Verify results
            self.assertEqual(len(results), 10)  # 10 workers
            for worker_results in results:
                self.assertEqual(len(worker_results), 7)  # 5 stores + 1 query + 2 retrieves

        asyncio.run(test_concurrent_perf())

    @mock.patch('vector_database.VectorDatabase._try_import_chromadb')
    def test_memory_usage_growth(self, mock_try_chroma):
        """Test memory usage growth with increasing data"""
        mock_try_chroma.return_value = False

        async def test_memory_growth():
            db = VectorDatabase(self.valid_config)
            await db.initialize()

            # Store increasing amounts of data and monitor stats
            sizes = [10, 50, 100, 200]

            for size in sizes:
                # Clear existing data for clean test
                db._stats['total_documents'] = 0

                # Store tasks
                for i in range(size):
                    task = {
                        'taskId': f'memory_task_{size}_{i}',
                        'type': 'testing',
                        'description': f'Memory test task {i} with some content to increase size',
                        'status': 'completed',
                        'metadata': {'size': size, 'index': i, 'data': 'x' * 100}  # Add some data
                    }
                    await db.store_task_history(task)

                # Check stats
                stats = db.get_stats()
                self.assertEqual(stats['total_documents'], size)

                # Verify we can still query
                results = await db.query_similar_solutions('memory test task', limit=5)
                self.assertGreater(len(results), 0)

        asyncio.run(test_memory_growth())


class TestVectorDatabaseEdgeCases(unittest.TestCase):
    """Edge case tests for VectorDatabase"""

    def setUp(self):
        """Set up test fixtures"""
        self.temp_dir = tempfile.mkdtemp()
        self.project_dir = Path(self.temp_dir)
        self.addCleanup(self.cleanup)

        self.valid_config = {
            'projectDir': str(self.project_dir),
            'chromaUrl': 'http://localhost:8000',
            'collectionName': 'edge_memory'
        }

    def cleanup(self):
        """Clean up test fixtures"""
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    @mock.patch('vector_database.VectorDatabase._try_import_chromadb')
    def test_empty_and_null_values(self, mock_try_chroma):
        """Test handling of empty and null values"""
        mock_try_chroma.return_value = False

        async def test_empty_null():
            db = VectorDatabase(self.valid_config)
            await db.initialize()

            # Test with empty strings, None values, empty arrays
            task_with_empty = {
                'taskId': 'empty_task',
                'type': 'testing',
                'description': '',  # Empty string
                'status': 'completed',
                'decisions': [],  # Empty array
                'learnings': None,  # None value
                'metadata': {}  # Empty object
            }

            # Should handle gracefully
            doc_id = await db.store_task_history(task_with_empty)
            self.assertIsNotNone(doc_id)

            # Should retrieve successfully
            retrieved = await db.get_task_history('empty_task')
            self.assertIsNotNone(retrieved)
            self.assertEqual(retrieved['taskId'], 'empty_task')

        asyncio.run(test_empty_null())

    @mock.patch('vector_database.VectorDatabase._try_import_chromadb')
    def test_unicode_and_special_characters(self, mock_try_chroma):
        """Test handling of Unicode and special characters"""
        mock_try_chroma.return_value = False

        async def test_unicode():
            db = VectorDatabase(self.valid_config)
            await db.initialize()

            # Test with various Unicode characters
            unicode_task = {
                'taskId': 'unicode_task',
                'type': 'testing',
                'description': 'Test with Unicode: ñáéíóú 🚀 🔥 ❤️ 中文 русский עברית',
                'status': 'completed',
                'learnings': [
                    'Unicode handling: α + β = γ',
                    'Emojis: 😀 🎉 🎊',
                    'Math: ∫∂∇⊗⊕'
                ],
                'metadata': {
                    'special_chars': '!@#$%^&*()_+-=[]{}|;:,.<>?',
                    'quotes': '"\'',
                    'newlines': 'line1\nline2\tline3'
                }
            }

            doc_id = await db.store_task_history(unicode_task)
            self.assertIsNotNone(doc_id)

            # Should retrieve and preserve Unicode
            retrieved = await db.get_task_history('unicode_task')
            self.assertEqual(retrieved['description'], unicode_task['description'])
            self.assertEqual(retrieved['learnings'], unicode_task['learnings'])

            # Should be able to search with Unicode
            results = await db.query_similar_solutions('Unicode handling', limit=5)
            self.assertGreater(len(results), 0)

        asyncio.run(test_unicode())

    @mock.patch('vector_database.VectorDatabase._try_import_chromadb')
    def test_extremely_large_data(self, mock_try_chroma):
        """Test handling of extremely large data objects"""
        mock_try_chroma.return_value = False

        async def test_large_data():
            db = VectorDatabase(self.valid_config)
            await db.initialize()

            # Create very large task history
            large_task = {
                'taskId': 'large_task',
                'type': 'testing',
                'description': 'Test with extremely large data',
                'status': 'completed',
                'decisions': [
                    {
                        'decision': f'Decision {i}',
                        'outcome': 'x' * 1000,  # Large outcome
                        'reasoning': 'y' * 1000  # Large reasoning
                    } for i in range(50)  # Many decisions
                ],
                'learnings': [f'Learning {i}: ' + 'z' * 2000 for i in range(100)],  # Many large learnings
                'metadata': {
                    'large_array': ['item' * 100 for _ in range(200)],  # Large array
                    'large_object': {f'key{i}': 'value' * 500 for i in range(100)},  # Large object
                    'nested': {
                        'level1': {
                            'level2': {
                                'data': 'deep' * 1000
                            }
                        }
                    }
                }
            }

            # Should handle large data (may be slow but shouldn't crash)
            start_time = time.time()
            doc_id = await db.store_task_history(large_task)
            end_time = time.time()

            # Allow more time for large data
            self.assertLess(end_time - start_time, 30.0, "Large data storage too slow")

            # Should be able to retrieve
            retrieved = await db.get_task_history('large_task')
            self.assertIsNotNone(retrieved)
            self.assertEqual(retrieved['taskId'], 'large_task')
            self.assertEqual(len(retrieved['learnings']), 100)

        asyncio.run(test_large_data())

    @mock.patch('vector_database.VectorDatabase._try_import_chromadb')
    def test_rapid_successive_operations(self, mock_try_chroma):
        """Test rapid successive operations"""
        mock_try_chroma.return_value = False

        async def test_rapid_ops():
            db = VectorDatabase(self.valid_config)
            await db.initialize()

            # Perform many rapid operations
            operations = []

            for i in range(100):
                task = {
                    'taskId': f'rapid_task_{i}',
                    'type': 'testing',
                    'description': f'Rapid operation {i}',
                    'status': 'completed'
                }

                # Store
                doc_id = await db.store_task_history(task)
                operations.append(('store', doc_id))

                # Immediately query
                results = await db.query_similar_solutions(f'Rapid operation {i}', limit=1)
                operations.append(('query', len(results)))

                # Immediately retrieve
                retrieved = await db.get_task_history(f'rapid_task_{i}')
                operations.append(('retrieve', retrieved is not None))

            # Verify all operations succeeded
            self.assertEqual(len(operations), 300)  # 100 tasks * 3 operations each

            stores = [op for op in operations if op[0] == 'store']
            queries = [op for op in operations if op[0] == 'query']
            retrieves = [op for op in operations if op[0] == 'retrieve']

            self.assertEqual(len(stores), 100)
            self.assertEqual(len(queries), 100)
            self.assertEqual(len(retrieves), 100)

            # All retrieves should have succeeded
            successful_retrieves = [op for op in retrieves if op[1]]
            self.assertEqual(len(successful_retrieves), 100)

        asyncio.run(test_rapid_ops())

    @mock.patch('vector_database.VectorDatabase._try_import_chromadb')
    def test_database_reinitialization(self, mock_try_chroma):
        """Test database reinitialization and state management"""
        mock_try_chroma.return_value = False

        async def test_reinit():
            db = VectorDatabase(self.valid_config)

            # Initialize
            result1 = await db.initialize()
            self.assertTrue(result1)
            self.assertTrue(db.is_initialized())

            # Store some data
            await db.store_task_history({
                'taskId': 'reinit_task',
                'type': 'testing',
                'description': 'Test reinitialization',
                'status': 'completed'
            })

            # Close
            await db.close()
            self.assertFalse(db.is_initialized())

            # Reinitialize
            result2 = await db.initialize()
            self.assertTrue(result2)
            self.assertTrue(db.is_initialized())

            # Data should still be there
            retrieved = await db.get_task_history('reinit_task')
            self.assertIsNotNone(retrieved)

        asyncio.run(test_reinit())

    @mock.patch('vector_database.VectorDatabase._try_import_chromadb')
    def test_thread_safety(self, mock_try_chroma):
        """Test thread safety of database operations"""
        mock_try_chroma.return_value = False

        def thread_worker(thread_id):
            """Worker function for thread safety test"""
            async def async_worker():
                db = VectorDatabase({
                    'projectDir': str(self.project_dir),
                    'chromaUrl': 'http://localhost:8000',
                    'collectionName': 'thread_memory'
                })

                await db.initialize()

                # Perform operations
                for i in range(10):
                    task = {
                        'taskId': f'thread_{thread_id}_task_{i}',
                        'type': 'testing',
                        'description': f'Thread {thread_id} task {i}',
                        'status': 'completed'
                    }

                    await db.store_task_history(task)

                    # Query
                    results = await db.query_similar_solutions(f'Thread {thread_id}', limit=2)

                    # Verify we get some results
                    self.assertIsInstance(results, list)

                await db.close()

            # Run async code in thread
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(async_worker())
            loop.close()

        # Run multiple threads
        threads = []
        for i in range(5):
            thread = threading.Thread(target=thread_worker, args=(i,))
            threads.append(thread)
            thread.start()

        # Wait for all threads
        for thread in threads:
            thread.join()

        # Verify final state
        final_db = VectorDatabase({
            'projectDir': str(self.project_dir),
            'chromaUrl': 'http://localhost:8000',
            'collectionName': 'thread_memory'
        })

        async def verify_final_state():
            await final_db.initialize()

            # Should have all tasks stored
            stats = final_db.get_stats()
            self.assertEqual(stats['total_documents'], 50)  # 5 threads * 10 tasks each

            # Should be able to query
            results = await final_db.query_similar_solutions('Thread', limit=10)
            self.assertGreater(len(results), 0)

        asyncio.run(verify_final_state())

    @mock.patch('vector_database.VectorDatabase._try_import_chromadb')
    def test_operation_timeout_simulation(self, mock_try_chroma):
        """Test behavior when operations take too long (simulated)"""
        mock_try_chroma.return_value = False

        async def test_timeout():
            db = VectorDatabase(self.valid_config)
            await db.initialize()

            # Simulate slow operations by adding delays
            original_store = db.store_task_history

            async def slow_store_task_history(task_history):
                await asyncio.sleep(0.1)  # Small delay
                return await original_store(task_history)

            db.store_task_history = slow_store_task_history

            # Perform multiple operations
            start_time = time.time()
            tasks = []
            for i in range(10):
                task = {
                    'taskId': f'timeout_task_{i}',
                    'type': 'testing',
                    'description': f'Timeout test {i}',
                    'status': 'completed'
                }
                tasks.append(db.store_task_history(task))

            await asyncio.gather(*tasks)
            end_time = time.time()

            # Should complete within reasonable time
            total_time = end_time - start_time
            self.assertLess(total_time, 5.0, "Operations took too long")

            # All tasks should be stored
            stats = db.get_stats()
            self.assertEqual(stats['total_documents'], 10)

        asyncio.run(test_timeout())


if __name__ == '__main__':
    unittest.main()
