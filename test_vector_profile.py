#!/usr/bin/env python3
"""
Test script to profile vector database operations
"""

import asyncio
import time
from pathlib import Path
from scripts.vector_database import VectorDatabase
from scripts.logger import get_logger

async def profile_vector_db():
    """Profile vector database operations"""
    logger = get_logger('vector-profiler')

    config = {
        'projectDir': '/tmp/vector_test',
        'collectionName': 'test_collection'
    }

    # Create test directory
    Path('/tmp/vector_test').mkdir(exist_ok=True)

    # Initialize database
    db = VectorDatabase(config)
    success = await db.initialize()
    if not success:
        logger.error("Failed to initialize database")
        return

    logger.info("Starting vector database profiling operations")

    # Test data
    task_history = {
        'taskId': 'test_task_1',
        'type': 'performance',
        'description': 'Profile application performance and identify bottlenecks',
        'status': 'completed',
        'outcome': 'success',
        'decisions': [{'decision': 'optimize', 'outcome': 'improved'}],
        'learnings': ['Caching improves performance', 'JSON operations are expensive'],
        'startTime': time.time(),
        'endTime': time.time() + 10,
        'duration': 10
    }

    learning = {
        'content': 'Vector databases provide fast similarity search for task history',
        'context': 'performance optimization',
        'category': 'database',
        'importance': 'high',
        'tags': ['vector', 'database', 'performance']
    }

    # Profile store operations
    start_time = time.time()
    for i in range(100):
        task_history['taskId'] = f'test_task_{i}'
        await db.store_task_history(task_history)
    store_time = time.time() - start_time
    logger.info("Task history storage profiling completed", {
        'operation': 'store_task_history',
        'count': 100,
        'duration_seconds': round(store_time, 3),
        'avg_time_per_operation': round(store_time / 100, 4)
    })

    # Profile query operations
    start_time = time.time()
    for i in range(50):
        results = await db.query_similar_solutions("performance optimization", limit=5)
    query_time = time.time() - start_time
    logger.info("Similarity query profiling completed", {
        'operation': 'query_similar_solutions',
        'count': 50,
        'duration_seconds': round(query_time, 3),
        'avg_time_per_query': round(query_time / 50, 4)
    })

    # Profile learning storage
    start_time = time.time()
    for i in range(50):
        learning['content'] = f'Learning {i}: Performance optimization techniques'
        await db.store_learning(learning)
    learning_time = time.time() - start_time
    logger.info("Learning storage profiling completed", {
        'operation': 'store_learning',
        'count': 50,
        'duration_seconds': round(learning_time, 3),
        'avg_time_per_operation': round(learning_time / 50, 4)
    })

    await db.close()
    logger.info("Vector database profiling completed successfully")

if __name__ == '__main__':
    asyncio.run(profile_vector_db())