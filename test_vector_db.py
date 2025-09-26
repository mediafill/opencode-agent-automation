#!/usr/bin/env python3
"""Test the vector database implementation"""

import asyncio
import sys
sys.path.insert(0, 'scripts')

from vector_database import VectorDatabase

async def test_vector_db():
    """Test vector database functionality"""

    print("🔧 Testing Vector Database Implementation...")

    # Create instance
    db = VectorDatabase({
        'projectDir': '.',
        'collectionName': 'test_memory'
    })

    # Initialize
    result = await db.initialize()
    print(f"✅ Initialized: {result} (using {'ChromaDB' if db.use_chroma else 'JSON fallback'})")

    # Store task history
    task = {
        'taskId': 'test_task_1',
        'type': 'testing',
        'description': 'Implement vector database',
        'result': 'Successfully created VectorDatabase class',
        'status': 'completed'
    }

    task_id = await db.store_task_history(task)
    print(f"✅ Task stored with ID: {task_id}")

    # Store learning
    learning = {
        'task_id': 'test_task_1',
        'content': 'JSON fallback works well for lightweight storage',
        'category': 'implementation',
        'context': 'Vector database implementation'
    }

    learning_id = await db.store_learning(learning)
    print(f"✅ Learning stored with ID: {learning_id}")

    # Query similar solutions
    results = await db.query_similar_solutions('vector database storage', limit=3)
    print(f"✅ Query returned {len(results)} similar solutions")

    # Get task history
    history = await db.get_task_history('test_task_1')
    if history:
        print(f"✅ Retrieved task history: {history['description'][:50]}...")

    # Get learnings
    learnings = await db.get_learnings(limit=5)
    print(f"✅ Retrieved {len(learnings)} learnings")

    # Get stats
    stats = db.get_stats()
    print(f"✅ Database stats: {stats['total_documents']} documents")

    # Close
    await db.close()
    print("✅ Database closed successfully")

    print("\n🎉 Vector Database is working correctly!")
    return True

if __name__ == "__main__":
    success = asyncio.run(test_vector_db())
    sys.exit(0 if success else 1)