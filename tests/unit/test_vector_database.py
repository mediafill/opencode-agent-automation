#!/usr/bin/env python3
"""
Comprehensive unit tests for vector_database.py
Tests all core classes and functions with edge cases
"""

import unittest
import unittest.mock as mock
import tempfile
import json
import asyncio
import os
from pathlib import Path
from datetime import datetime, timedelta

# Import from parent directory
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'scripts'))

try:
    from vector_database import VectorDatabase
except ImportError:
    # Fallback for direct execution
    sys.path.insert(0, str(Path(__file__).parent.parent.parent.absolute()))
    from scripts.vector_database import VectorDatabase


class TestVectorDatabase(unittest.TestCase):
    """Test VectorDatabase class functionality"""
    
    def setUp(self):
        """Set up test fixtures"""
        self.temp_dir = tempfile.mkdtemp()
        self.project_dir = Path(self.temp_dir)
        self.addCleanup(self.cleanup)
        
        self.valid_config = {
            'projectDir': str(self.project_dir),
            'chromaUrl': 'http://localhost:8000',
            'collectionName': 'test_memory'
        }
    
    def cleanup(self):
        """Clean up test fixtures"""
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)
    
    def test_initialization_valid_config(self):
        """Test database initialization with valid configuration"""
        db = VectorDatabase(self.valid_config)
        
        self.assertEqual(db.config['projectDir'], str(self.project_dir))
        self.assertEqual(db.config['chromaUrl'], 'http://localhost:8000')
        self.assertEqual(db.config['collectionName'], 'test_memory')
        self.assertFalse(db.is_initialized())
        self.assertFalse(db.use_chroma)
    
    def test_initialization_missing_project_dir(self):
        """Test initialization fails with missing projectDir"""
        config = {'chromaUrl': 'http://localhost:8000', 'collectionName': 'test'}
        with self.assertRaises(ValueError) as cm:
            VectorDatabase(config)
        self.assertIn('projectDir is required', str(cm.exception))
    
    def test_initialization_missing_collection_name(self):
        """Test initialization fails with missing collectionName"""
        config = {'projectDir': str(self.project_dir), 'chromaUrl': 'http://localhost:8000', 'collectionName': ''}
        with self.assertRaises(ValueError) as cm:
            VectorDatabase(config)
        self.assertIn('collectionName is required', str(cm.exception))
    
    def test_initialization_invalid_url(self):
        """Test initialization fails with invalid ChromaDB URL"""
        config = {
            'projectDir': str(self.project_dir),
            'chromaUrl': 'invalid-url',
            'collectionName': 'test'
        }
        with self.assertRaises(ValueError) as cm:
            VectorDatabase(config)
        self.assertIn('Invalid ChromaDB URL format', str(cm.exception))
    
    def test_initialization_invalid_collection_name(self):
        """Test initialization fails with invalid collection name"""
        config = {
            'projectDir': str(self.project_dir),
            'chromaUrl': 'http://localhost:8000',
            'collectionName': 'invalid name with spaces'
        }
        with self.assertRaises(ValueError) as cm:
            VectorDatabase(config)
        self.assertIn('Collection name must be alphanumeric', str(cm.exception))
    
    def test_initialization_invalid_embedding_model(self):
        """Test initialization fails with invalid embedding model"""
        config = {
            'projectDir': str(self.project_dir),
            'chromaUrl': 'http://localhost:8000',
            'collectionName': 'test',
            'embeddingModel': 'invalid-model'
        }
        with self.assertRaises(ValueError) as cm:
            VectorDatabase(config)
        self.assertIn('Unsupported embedding model', str(cm.exception))
    
    @mock.patch('vector_database.VectorDatabase._try_import_chromadb')
    def test_initialize_json_fallback(self, mock_try_chroma):
        """Test initialization falls back to JSON when ChromaDB unavailable"""
        mock_try_chroma.return_value = False
        
        db = VectorDatabase(self.valid_config)
        
        # Run async initialization
        async def test_init():
            result = await db.initialize()
            self.assertTrue(result)
            self.assertTrue(db.is_initialized())
            self.assertFalse(db.use_chroma)
            
            # Check JSON store was created
            json_path = db.data_dir / 'test_memory.json'
            self.assertTrue(json_path.exists())
        
        asyncio.run(test_init())
    
    @mock.patch('vector_database.VectorDatabase._try_import_chromadb')
    @mock.patch('vector_database.VectorDatabase._initialize_chroma')
    def test_initialize_chroma_success(self, mock_init_chroma, mock_try_chroma):
        """Test successful ChromaDB initialization"""
        mock_try_chroma.return_value = True
        mock_init_chroma.return_value = True
        
        db = VectorDatabase(self.valid_config)
        
        async def test_init():
            result = await db.initialize()
            self.assertTrue(result)
            self.assertTrue(db.is_initialized())
            self.assertTrue(db.use_chroma)
        
        asyncio.run(test_init())
    
    def test_generate_embedding_consistent(self):
        """Test embedding generation produces consistent results"""
        db = VectorDatabase(self.valid_config)
        
        text = "test text for embedding"
        embedding1 = db._generate_embedding(text)
        embedding2 = db._generate_embedding(text)
        
        self.assertEqual(embedding1, embedding2)
        self.assertEqual(len(embedding1), 384)  # Expected dimension
        self.assertTrue(all(-1 <= x <= 1 for x in embedding1))
    
    def test_create_document_text_task_history(self):
        """Test document text creation for task history"""
        db = VectorDatabase(self.valid_config)
        
        task_data = {
            'description': 'Test task',
            'type': 'testing',
            'status': 'completed',
            'outcome': 'Success',
            'decisions': [
                {'decision': 'Run tests', 'outcome': 'Passed'},
                {'decision': 'Deploy', 'outcome': 'Success'}
            ],
            'learnings': ['Use mocks', 'Test edge cases'],
            'error': ''
        }
        
        doc_text = db._create_document_text(task_data, 'task_history')
        
        self.assertIn('Test task', doc_text)
        self.assertIn('testing', doc_text)
        self.assertIn('completed', doc_text)
        self.assertIn('Success', doc_text)
        self.assertIn('Run tests: Passed', doc_text)
        self.assertIn('Use mocks', doc_text)
    
    def test_create_document_text_learning(self):
        """Test document text creation for learning"""
        db = VectorDatabase(self.valid_config)
        
        learning_data = {
            'content': 'Mock external dependencies',
            'context': 'Unit testing',
            'category': 'testing',
            'importance': 'high',
            'tags': ['unittest', 'mocks']
        }
        
        doc_text = db._create_document_text(learning_data, 'learning')
        
        self.assertIn('Mock external dependencies', doc_text)
        self.assertIn('Unit testing', doc_text)
        self.assertIn('testing', doc_text)
        self.assertIn('high', doc_text)
        self.assertIn('unittest', doc_text)
    
    @mock.patch('vector_database.VectorDatabase._try_import_chromadb')
    def test_store_task_history_json_fallback(self, mock_try_chroma):
        """Test storing task history in JSON fallback"""
        mock_try_chroma.return_value = False
        
        db = VectorDatabase(self.valid_config)
        
        async def test_store():
            await db.initialize()
            
            task_history = {
                'taskId': 'test_task_123',
                'type': 'testing',
                'description': 'Run unit tests',
                'status': 'completed',
                'startTime': '2024-01-15T10:00:00Z',
                'endTime': '2024-01-15T10:05:00Z',
                'duration': 300,
                'decisions': [{'decision': 'Run tests', 'outcome': 'Passed'}],
                'outcome': 'All tests passed',
                'learnings': ['Use descriptive test names'],
                'metadata': {'testCount': 10}
            }
            
            doc_id = await db.store_task_history(task_history)
            
            self.assertTrue(doc_id.startswith('task_test_task_123_'))
            
            # Verify data was stored
            stored_data = await db.get_task_history('test_task_123')
            self.assertEqual(stored_data['taskId'], 'test_task_123')
            self.assertEqual(stored_data['type'], 'testing')
            self.assertEqual(stored_data['status'], 'completed')
        
        asyncio.run(test_store())
    
    @mock.patch('vector_database.VectorDatabase._try_import_chromadb')
    def test_store_task_history_missing_required_fields(self, mock_try_chroma):
        """Test storing task history fails with missing required fields"""
        mock_try_chroma.return_value = False
        
        db = VectorDatabase(self.valid_config)
        
        async def test_store_invalid():
            await db.initialize()
            
            invalid_history = {
                'description': 'Missing taskId and type'
            }
            
            with self.assertRaises(ValueError) as cm:
                await db.store_task_history(invalid_history)
            self.assertIn('Missing required field: taskId', str(cm.exception))
        
        asyncio.run(test_store_invalid())
    
    @mock.patch('vector_database.VectorDatabase._try_import_chromadb')
    def test_store_learning_json_fallback(self, mock_try_chroma):
        """Test storing learning in JSON fallback"""
        mock_try_chroma.return_value = False
        
        db = VectorDatabase(self.valid_config)
        
        async def test_store():
            await db.initialize()
            
            learning = {
                'content': 'Use dependency injection for better testability',
                'context': 'Refactoring legacy code',
                'category': 'architecture',
                'importance': 'high',
                'tags': ['refactoring', 'testing', 'architecture']
            }
            
            doc_id = await db.store_learning(learning)
            
            self.assertTrue(doc_id.startswith('learning_'))
            
            # Verify data was stored
            learnings = await db.get_learnings()
            self.assertEqual(len(learnings), 1)
            self.assertEqual(learnings[0]['content'], learning['content'])
            self.assertEqual(learnings[0]['category'], 'architecture')
        
        asyncio.run(test_store())
    
    @mock.patch('vector_database.VectorDatabase._try_import_chromadb')
    def test_store_learning_missing_content(self, mock_try_chroma):
        """Test storing learning fails without content"""
        mock_try_chroma.return_value = False
        
        db = VectorDatabase(self.valid_config)
        
        async def test_store_invalid():
            await db.initialize()
            
            invalid_learning = {
                'context': 'Missing content field'
            }
            
            with self.assertRaises(ValueError) as cm:
                await db.store_learning(invalid_learning)
            self.assertIn('Missing required field: content', str(cm.exception))
        
        asyncio.run(test_store_invalid())
    
    @mock.patch('vector_database.VectorDatabase._try_import_chromadb')
    def test_query_similar_solutions_json_fallback(self, mock_try_chroma):
        """Test querying similar solutions in JSON fallback"""
        mock_try_chroma.return_value = False
        
        db = VectorDatabase(self.valid_config)
        
        async def test_query():
            await db.initialize()
            
            # Store some test data
            task1 = {
                'taskId': 'task1',
                'type': 'testing',
                'description': 'Run unit tests for authentication',
                'status': 'completed'
            }
            task2 = {
                'taskId': 'task2',
                'type': 'testing',
                'description': 'Run integration tests for payment',
                'status': 'completed'
            }
            
            await db.store_task_history(task1)
            await db.store_task_history(task2)
            
            # Query for similar solutions
            results = await db.query_similar_solutions('authentication testing', limit=2)
            
            self.assertGreaterEqual(len(results), 1)
            self.assertIn('authentication', results[0]['document'].lower())
        
        asyncio.run(test_query())
    
    @mock.patch('vector_database.VectorDatabase._try_import_chromadb')
    def test_query_similar_solutions_with_filters(self, mock_try_chroma):
        """Test querying with metadata filters"""
        mock_try_chroma.return_value = False
        
        db = VectorDatabase(self.valid_config)
        
        async def test_query_filtered():
            await db.initialize()
            
            # Store test data
            await db.store_task_history({
                'taskId': 'task1',
                'type': 'testing',
                'description': 'Unit tests',
                'status': 'completed'
            })
            await db.store_task_history({
                'taskId': 'task2',
                'type': 'deployment',
                'description': 'Deploy to production',
                'status': 'completed'
            })
            
            # Query with filters
            results = await db.query_similar_solutions(
                'tests',
                limit=5,
                filters={'taskType': 'testing'}
            )
            
            # Should only return testing tasks
            for result in results:
                self.assertEqual(result['metadata']['taskType'], 'testing')
        
        asyncio.run(test_query_filtered())
    
    @mock.patch('vector_database.VectorDatabase._try_import_chromadb')
    def test_get_task_history_not_found(self, mock_try_chroma):
        """Test retrieving non-existent task history"""
        mock_try_chroma.return_value = False
        
        db = VectorDatabase(self.valid_config)
        
        async def test_get_missing():
            await db.initialize()
            
            result = await db.get_task_history('non_existent_task')
            self.assertIsNone(result)
        
        asyncio.run(test_get_missing())
    
    @mock.patch('vector_database.VectorDatabase._try_import_chromadb')
    def test_get_learnings_with_filters(self, mock_try_chroma):
        """Test retrieving learnings with filters"""
        mock_try_chroma.return_value = False
        
        db = VectorDatabase(self.valid_config)
        
        async def test_get_filtered():
            await db.initialize()
            
            # Store test learnings
            await db.store_learning({
                'content': 'Use TDD',
                'category': 'testing',
                'importance': 'high'
            })
            await db.store_learning({
                'content': 'Use design patterns',
                'category': 'architecture',
                'importance': 'medium'
            })
            
            # Get learnings filtered by category
            learnings = await db.get_learnings(
                filters={'category': 'testing'},
                limit=5
            )
            
            self.assertEqual(len(learnings), 1)
            self.assertEqual(learnings[0]['category'], 'testing')
        
        asyncio.run(test_get_filtered())
    
    def test_cosine_similarity_calculation(self):
        """Test cosine similarity calculation"""
        db = VectorDatabase(self.valid_config)
        
        # Test identical vectors
        vec1 = [1.0, 0.0, 0.0]
        vec2 = [1.0, 0.0, 0.0]
        similarity = db._cosine_similarity(vec1, vec2)
        self.assertAlmostEqual(similarity, 1.0)
        
        # Test orthogonal vectors
        vec1 = [1.0, 0.0]
        vec2 = [0.0, 1.0]
        similarity = db._cosine_similarity(vec1, vec2)
        self.assertAlmostEqual(similarity, 0.0)
        
        # Test opposite vectors
        vec1 = [1.0, 0.0]
        vec2 = [-1.0, 0.0]
        similarity = db._cosine_similarity(vec1, vec2)
        self.assertAlmostEqual(similarity, -1.0)
    
    def test_matches_filters(self):
        """Test filter matching logic"""
        db = VectorDatabase(self.valid_config)
        
        metadata = {
            'type': 'task_history',
            'status': 'completed',
            'taskType': 'testing'
        }
        
        # Test matching filters
        self.assertTrue(db._matches_filters(metadata, {'type': 'task_history'}))
        self.assertTrue(db._matches_filters(metadata, {'status': 'completed', 'taskType': 'testing'}))
        
        # Test non-matching filters
        self.assertFalse(db._matches_filters(metadata, {'type': 'learning'}))
        self.assertFalse(db._matches_filters(metadata, {'status': 'failed'}))
    
    @mock.patch('vector_database.VectorDatabase._try_import_chromadb')
    def test_get_stats_json_fallback(self, mock_try_chroma):
        """Test getting statistics for JSON fallback"""
        mock_try_chroma.return_value = False
        
        db = VectorDatabase(self.valid_config)
        
        async def test_stats():
            await db.initialize()
            
            # Store some data
            await db.store_task_history({
                'taskId': 'task1',
                'type': 'testing',
                'description': 'Test',
                'status': 'completed'
            })
            
            stats = db.get_stats()
            
            self.assertIn('total_documents', stats)
            self.assertIn('last_updated', stats)
            self.assertIn('configuration', stats)
            self.assertEqual(stats['configuration']['collectionName'], 'test_memory')
            self.assertIsNotNone(stats['last_updated'])
        
        asyncio.run(test_stats())
    
    @mock.patch('vector_database.VectorDatabase._try_import_chromadb')
    def test_close_database(self, mock_try_chroma):
        """Test closing database connection"""
        mock_try_chroma.return_value = False
        
        db = VectorDatabase(self.valid_config)
        
        async def test_close():
            await db.initialize()
            self.assertTrue(db.is_initialized())
            
            await db.close()
            self.assertFalse(db.is_initialized())
        
        asyncio.run(test_close())
    
    def test_operations_without_initialization(self):
        """Test that operations fail when database not initialized"""
        db = VectorDatabase(self.valid_config)
        
        async def test_uninitialized():
            with self.assertRaises(RuntimeError) as cm:
                await db.store_task_history({'taskId': 'test', 'type': 'test', 'description': 'test', 'status': 'pending'})
            self.assertIn('Database not initialized', str(cm.exception))
            
            with self.assertRaises(RuntimeError) as cm:
                await db.query_similar_solutions('test')
            self.assertIn('Database not initialized', str(cm.exception))
        
        asyncio.run(test_uninitialized())
    
    @mock.patch('vector_database.VectorDatabase._try_import_chromadb')
    def test_persistence_across_sessions(self, mock_try_chroma):
        """Test data persistence across database sessions"""
        mock_try_chroma.return_value = False
        
        # First session
        db1 = VectorDatabase(self.valid_config)
        
        async def test_persistence():
            await db1.initialize()
            
            await db1.store_task_history({
                'taskId': 'persistent_task',
                'type': 'testing',
                'description': 'Persistent test',
                'status': 'completed'
            })
            
            await db1.close()
            
            # Second session - should load existing data
            db2 = VectorDatabase(self.valid_config)
            await db2.initialize()
            
            stored_data = await db2.get_task_history('persistent_task')
            self.assertIsNotNone(stored_data)
            self.assertEqual(stored_data['taskId'], 'persistent_task')
        
        asyncio.run(test_persistence())


class TestVectorDatabaseEdgeCases(unittest.TestCase):
    """Test edge cases and error conditions"""
    
    def setUp(self):
        """Set up test fixtures"""
        self.temp_dir = tempfile.mkdtemp()
        self.project_dir = Path(self.temp_dir)
        self.addCleanup(self.cleanup)
        
        self.valid_config = {
            'projectDir': str(self.project_dir),
            'chromaUrl': 'http://localhost:8000',
            'collectionName': 'test_memory'
        }
    
    def cleanup(self):
        """Clean up test fixtures"""
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)
    
    @mock.patch('vector_database.VectorDatabase._try_import_chromadb')
    def test_empty_query_similar_solutions(self, mock_try_chroma):
        """Test querying similar solutions with empty database"""
        mock_try_chroma.return_value = False
        
        db = VectorDatabase(self.valid_config)
        
        async def test_empty_query():
            await db.initialize()
            
            results = await db.query_similar_solutions('test query')
            self.assertEqual(len(results), 0)
        
        asyncio.run(test_empty_query())
    
    @mock.patch('vector_database.VectorDatabase._try_import_chromadb')
    def test_large_metadata_handling(self, mock_try_chroma):
        """Test handling of large metadata objects"""
        mock_try_chroma.return_value = False
        
        db = VectorDatabase(self.valid_config)
        
        async def test_large_metadata():
            await db.initialize()
            
            large_metadata = {'data': 'x' * 10000}  # Large string
            task_history = {
                'taskId': 'large_task',
                'type': 'testing',
                'description': 'Test with large metadata',
                'status': 'completed',
                'metadata': large_metadata
            }
            
            doc_id = await db.store_task_history(task_history)
            
            # Should be able to retrieve it
            stored = await db.get_task_history('large_task')
            self.assertEqual(stored['metadata']['data'], 'x' * 10000)
        
        asyncio.run(test_large_metadata())
    
    @mock.patch('vector_database.VectorDatabase._try_import_chromadb')
    def test_special_characters_in_text(self, mock_try_chroma):
        """Test handling of special characters in stored text"""
        mock_try_chroma.return_value = False
        
        db = VectorDatabase(self.valid_config)
        
        async def test_special_chars():
            await db.initialize()
            
            special_text = "Special chars: àáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ"
            task_history = {
                'taskId': 'special_task',
                'type': 'testing',
                'description': special_text,
                'status': 'completed'
            }
            
            await db.store_task_history(task_history)
            
            stored = await db.get_task_history('special_task')
            self.assertEqual(stored['description'], special_text)
        
        asyncio.run(test_special_chars())
    
    @mock.patch('vector_database.VectorDatabase._try_import_chromadb')
    def test_concurrent_operations(self, mock_try_chroma):
        """Test concurrent database operations"""
        mock_try_chroma.return_value = False
        
        db = VectorDatabase(self.valid_config)
        
        async def test_concurrent():
            await db.initialize()
            
            async def store_task(task_id):
                await db.store_task_history({
                    'taskId': task_id,
                    'type': 'testing',
                    'description': f'Task {task_id}',
                    'status': 'completed'
                })
            
            # Store multiple tasks concurrently
            tasks = [store_task(f'task_{i}') for i in range(10)]
            await asyncio.gather(*tasks)
            
            # Verify all were stored
            learnings = await db.get_learnings(limit=20)  # Should be empty
            self.assertEqual(len(learnings), 0)
            
            # Check stats
            stats = db.get_stats()
            self.assertEqual(stats['total_documents'], 10)
        
        asyncio.run(test_concurrent())


if __name__ == '__main__':
    unittest.main()
