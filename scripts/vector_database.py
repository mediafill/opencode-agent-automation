#!/usr/bin/env python3
"""
Vector Database Implementation for Agent Memory and Learning
Supports ChromaDB for vector storage with JSON fallback
"""

import json
import os
import hashlib
import time
from pathlib import Path
from typing import Dict, List, Optional, Any, Union, Set
from datetime import datetime
from collections import OrderedDict
import threading

# Try to import ChromaDB, fallback to JSON if not available
try:
    from chromadb import ChromaClient
    from chromadb.config import Settings

    CHROMADB_AVAILABLE = True
except ImportError:
    CHROMADB_AVAILABLE = False
    ChromaClient = None
    Settings = None

# Try to import intelligent cache for enhanced caching
try:
    from intelligent_cache import (
        get_cache, cache_process_operation, cache_system_operation
    )
    INTELLIGENT_CACHE_AVAILABLE = True
except ImportError:
    INTELLIGENT_CACHE_AVAILABLE = False

# Set up logging
try:
    from logger import StructuredLogger

    logger = StructuredLogger(__name__)
except ImportError:
    import logging

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )
    logger = logging.getLogger(__name__)


class VectorDatabase:
    """
    Vector database for storing agent task history and learnings.
    Supports ChromaDB with JSON fallback for lightweight operation.
    """

    def __init__(self, config: Dict[str, Any]):
        """
        Initialize vector database with configuration.

        Args:
            config: Configuration dictionary containing:
                - projectDir: Project directory path
                - chromaUrl: ChromaDB server URL (optional)
                - collectionName: Collection name for vector storage
                - embeddingModel: Embedding model to use (optional)
                - maxRetries: Maximum retry attempts (optional)
                - retryDelay: Delay between retries in ms (optional)
        """
        self.config = {
            "projectDir": config.get("projectDir"),
            "chromaUrl": config.get("chromaUrl", "http://localhost:8000"),
            "collectionName": config.get("collectionName", "agent_memory"),
            "embeddingModel": config.get("embeddingModel", "all-MiniLM-L6-v2"),
            "maxRetries": config.get("maxRetries", 3),
            "retryDelay": config.get("retryDelay", 1000),
        }

        # Validate required configuration
        if not self.config["projectDir"]:
            raise ValueError("projectDir is required")
        if not self.config["collectionName"]:
            raise ValueError("collectionName is required")

        # Validate ChromaDB URL format
        if not self._is_valid_url(self.config["chromaUrl"]):
            raise ValueError("Invalid ChromaDB URL format")

        # Validate collection name
        if not self._is_valid_collection_name(self.config["collectionName"]):
            raise ValueError(
                "Collection name must be alphanumeric with underscores only"
            )

        # Validate embedding model
        if not self._is_valid_embedding_model(self.config["embeddingModel"]):
            raise ValueError("Unsupported embedding model")

        self.project_dir = Path(self.config["projectDir"])
        self.data_dir = self.project_dir / ".claude" / "vector_db"
        self.data_dir.mkdir(parents=True, exist_ok=True)

        self.chroma_client = None
        self.collection = None
        self.json_store_path = self.data_dir / f"{self.config['collectionName']}.json"
        self.use_chroma = False
        self._initialized = False

        # Initialize indexes for faster lookups
        self._indexes: Dict[str, Dict[str, Set[str]]] = {
            "task_history_by_task_id": {},  # task_id -> set of document_ids
            "task_history_by_type": {},  # type -> set of document_ids
            "task_history_by_status": {},  # status -> set of document_ids
            "learning_by_category": {},  # category -> set of document_ids
            "learning_by_importance": {},  # importance -> set of document_ids
            "by_timestamp_range": {},  # timestamp_range -> set of document_ids
        }
        self._index_lock = threading.RLock()

        # Query result cache
        self._query_cache: OrderedDict = OrderedDict()
        self._query_cache_max_size = 100
        self._query_cache_lock = threading.RLock()

        # Additional caches for expensive operations
        self._embedding_cache: OrderedDict = OrderedDict()
        self._embedding_cache_max_size = 200
        self._embedding_cache_lock = threading.RLock()

        self._document_text_cache: OrderedDict = OrderedDict()
        self._document_text_cache_max_size = 150
        self._document_text_cache_lock = threading.RLock()

        self._similarity_cache: OrderedDict = OrderedDict()
        self._similarity_cache_max_size = 50
        self._similarity_cache_lock = threading.RLock()

        self._stats = {
            "total_documents": 0,
            "collections": [],
            "last_updated": None,
            "configuration": self.config.copy(),
            "index_stats": {
                "task_history_by_task_id": 0,
                "task_history_by_type": 0,
                "task_history_by_status": 0,
                "learning_by_category": 0,
                "learning_by_importance": 0,
                "by_timestamp_range": 0,
            },
            "cache_stats": {"hits": 0, "misses": 0, "size": 0},
        }

    def _is_valid_url(self, url: str) -> bool:
        """Validate URL format."""
        import re

        url_pattern = re.compile(r"^https?://[^\s/$.?#].[^\s]*$")
        return bool(url_pattern.match(url))

    def _is_valid_collection_name(self, name: str) -> bool:
        """Validate collection name format."""
        import re

        return bool(re.match(r"^[a-zA-Z0-9_]+$", name))

    def _is_valid_embedding_model(self, model: str) -> bool:
        """Validate embedding model."""
        valid_models = [
            "all-MiniLM-L6-v2",
            "text-embedding-ada-002",
            "sentence-transformers",
        ]
        return model in valid_models

    def _try_import_chromadb(self) -> bool:
        """Try to import ChromaDB."""
        try:
            import chromadb
            from chromadb.config import Settings

            return True
        except ImportError:
            return False

    def _initialize_chroma(self) -> bool:
        """Initialize ChromaDB client and collection."""
        try:
            import chromadb
            from chromadb.config import Settings

            # Create ChromaDB client
            settings = Settings(
                chroma_server_host=self.config["chromaUrl"]
                .split("://")[1]
                .split(":")[0],
                chroma_server_http_port=int(self.config["chromaUrl"].split(":")[-1]),
            )
            self.chroma_client = chromadb.PersistentClient(
                path=str(self.data_dir / "chroma"), settings=settings
            )

            # Try to get existing collection
            try:
                self.collection = self.chroma_client.get_collection(
                    name=self.config["collectionName"]
                )
            except:
                # Create new collection if it doesn't exist
                self.collection = self.chroma_client.create_collection(
                    name=self.config["collectionName"],
                    metadata={"description": "Agent memory and learning database"},
                )

            self.use_chroma = True
            return True

        except Exception as e:
            logger.warning(f"Failed to initialize ChromaDB: {e}")
            return False

    def _initialize_json_fallback(self) -> bool:
        """Initialize JSON-based fallback storage."""
        try:
            # Load existing data if available
            if self.json_store_path.exists():
                with open(self.json_store_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self._stats.update(data.get("stats", {}))
                    # Rebuild indexes from existing data
                    self._rebuild_indexes(data)
            else:
                # Initialize empty store
                self._save_json_store(
                    {"documents": [], "metadata": [], "ids": [], "stats": self._stats}
                )

            self.use_chroma = False
            return True

        except Exception as e:
            logger.error(f"Failed to initialize JSON fallback: {e}")
            return False

    def _rebuild_indexes(self, store_data: Dict):
        """Rebuild indexes from stored data."""
        with self._index_lock:
            # Clear existing indexes
            for index_name in self._indexes:
                self._indexes[index_name].clear()

            # Rebuild from metadata
            for metadata in store_data.get("metadata", []):
                doc_id = metadata.get("id")
                if not doc_id:
                    continue

                doc_type = metadata.get("type")
                if doc_type == "task_history":
                    # Index task history
                    task_id = metadata.get("taskId")
                    task_type = metadata.get("taskType")
                    status = metadata.get("status")

                    if task_id:
                        if task_id not in self._indexes["task_history_by_task_id"]:
                            self._indexes["task_history_by_task_id"][task_id] = set()
                        self._indexes["task_history_by_task_id"][task_id].add(doc_id)

                    if task_type:
                        if task_type not in self._indexes["task_history_by_type"]:
                            self._indexes["task_history_by_type"][task_type] = set()
                        self._indexes["task_history_by_type"][task_type].add(doc_id)

                    if status:
                        if status not in self._indexes["task_history_by_status"]:
                            self._indexes["task_history_by_status"][status] = set()
                        self._indexes["task_history_by_status"][status].add(doc_id)

                elif doc_type == "learning":
                    # Index learnings
                    category = metadata.get("category")
                    importance = metadata.get("importance")

                    if category:
                        if category not in self._indexes["learning_by_category"]:
                            self._indexes["learning_by_category"][category] = set()
                        self._indexes["learning_by_category"][category].add(doc_id)

                    if importance:
                        if importance not in self._indexes["learning_by_importance"]:
                            self._indexes["learning_by_importance"][importance] = set()
                        self._indexes["learning_by_importance"][importance].add(doc_id)

            # Update index stats
            self._update_index_stats()

    def _update_index_stats(self):
        """Update index statistics."""
        with self._index_lock:
            for index_name, index_data in self._indexes.items():
                if index_name in self._stats["index_stats"]:
                    if isinstance(index_data, dict):
                        self._stats["index_stats"][index_name] = sum(
                            len(v) for v in index_data.values()
                        )
                    else:
                        self._stats["index_stats"][index_name] = len(index_data)

    def _update_indexes(self, doc_id: str, metadata: Dict):
        """Update indexes with new document."""
        with self._index_lock:
            doc_type = metadata.get("type")

            if doc_type == "task_history":
                # Update task history indexes
                task_id = metadata.get("taskId")
                task_type = metadata.get("taskType")
                status = metadata.get("status")

                if task_id:
                    if task_id not in self._indexes["task_history_by_task_id"]:
                        self._indexes["task_history_by_task_id"][task_id] = set()
                    self._indexes["task_history_by_task_id"][task_id].add(doc_id)

                if task_type:
                    if task_type not in self._indexes["task_history_by_type"]:
                        self._indexes["task_history_by_type"][task_type] = set()
                    self._indexes["task_history_by_type"][task_type].add(doc_id)

                if status:
                    if status not in self._indexes["task_history_by_status"]:
                        self._indexes["task_history_by_status"][status] = set()
                    self._indexes["task_history_by_status"][status].add(doc_id)

            elif doc_type == "learning":
                # Update learning indexes
                category = metadata.get("category")
                importance = metadata.get("importance")

                if category:
                    if category not in self._indexes["learning_by_category"]:
                        self._indexes["learning_by_category"][category] = set()
                    self._indexes["learning_by_category"][category].add(doc_id)

                if importance:
                    if importance not in self._indexes["learning_by_importance"]:
                        self._indexes["learning_by_importance"][importance] = set()
                    self._indexes["learning_by_importance"][importance].add(doc_id)

            self._update_index_stats()

    def _get_cached_query_result(self, cache_key: str) -> Optional[Any]:
        """Get cached query result."""
        with self._query_cache_lock:
            if cache_key in self._query_cache:
                # Move to end (most recently used)
                self._query_cache.move_to_end(cache_key)
                self._stats["cache_stats"]["hits"] += 1
                return self._query_cache[cache_key]
        self._stats["cache_stats"]["misses"] += 1
        return None

    def _cache_query_result(self, cache_key: str, result: Any):
        """Cache query result with LRU eviction."""
        with self._query_cache_lock:
            self._query_cache[cache_key] = result
            self._query_cache.move_to_end(cache_key)

            # Evict oldest if cache is full
            if len(self._query_cache) > self._query_cache_max_size:
                self._query_cache.popitem(last=False)

            self._stats["cache_stats"]["size"] = len(self._query_cache)

    async def initialize(self) -> bool:
        """
        Initialize the vector database.
        Tries ChromaDB first, falls back to JSON storage.

        Returns:
            bool: True if initialization successful
        """
        if self._initialized:
            return True

        # Try ChromaDB first
        if self._try_import_chromadb():
            success = self._initialize_chroma()
            if success:
                self._initialized = True
                self.use_chroma = (
                    True  # Set this here since _initialize_chroma might be mocked
                )
                return True

        # Fall back to JSON storage
        success = self._initialize_json_fallback()
        if success:
            self._initialized = True
            return True

        return False

    def is_initialized(self) -> bool:
        """Check if database is initialized."""
        return self._initialized

    def _generate_embedding(self, text: str) -> List[float]:
        """Generate embedding for text (simplified for fallback)."""
        # Simple hash-based embedding for fallback
        # In a real implementation, this would use proper embedding models
        hash_obj = hashlib.md5(text.encode("utf-8"))
        hash_bytes = hash_obj.digest()
        # Convert to list of floats between -1 and 1
        embedding = []
        for i in range(0, len(hash_bytes), 2):
            val = int.from_bytes(hash_bytes[i : i + 2], "big") / 65535.0 * 2 - 1
            embedding.append(val)
        # Pad/truncate to 384 dimensions (common embedding size)
        while len(embedding) < 384:
            embedding.extend(embedding)
        return embedding[:384]

    def _create_document_text(self, data: Dict[str, Any], data_type: str) -> str:
        """Create searchable document text from data."""
        if data_type == "task_history":
            return f"""
Task: {data.get('description', '')}
Type: {data.get('type', '')}
Status: {data.get('status', '')}
Outcome: {data.get('outcome', '')}
Decisions: {'; '.join([d.get('decision', '') + ': ' + d.get('outcome', '') for d in data.get('decisions', [])])}
Learnings: {'; '.join(data.get('learnings', []))}
Error: {data.get('error', '')}
""".strip()

        elif data_type == "learning":
            return f"""
Learning: {data.get('content', '')}
Context: {data.get('context', '')}
Category: {data.get('category', '')}
Importance: {data.get('importance', '')}
Tags: {'; '.join(data.get('tags', []))}
""".strip()

        return json.dumps(data)

    async def store_task_history(self, task_history: Dict[str, Any]) -> str:
        """
        Store task execution history.

        Args:
            task_history: Task history data

        Returns:
            str: Document ID
        """
        if not self._initialized:
            raise RuntimeError("Database not initialized")

        # Validate required fields
        required_fields = ["taskId", "type", "description", "status"]
        for field in required_fields:
            if field not in task_history:
                raise ValueError(f"Missing required field: {field}")

        document_id = f"task_{task_history['taskId']}_{int(time.time())}"
        document_text = self._create_document_text(task_history, "task_history")
        embedding = self._generate_embedding(document_text)

        metadata = {
            "id": document_id,
            "type": "task_history",
            "taskId": task_history["taskId"],
            "taskType": task_history.get("type"),
            "status": task_history.get("status"),
            "startTime": task_history.get("startTime"),
            "endTime": task_history.get("endTime"),
            "duration": task_history.get("duration"),
            "timestamp": datetime.now().isoformat(),
            "data": json.dumps(task_history),
        }

        if self.use_chroma:
            self.collection.add(
                documents=[document_text],
                embeddings=[embedding],
                metadatas=[metadata],
                ids=[document_id],
            )
        else:
            self._store_json_document(document_id, document_text, metadata, embedding)
            # Update indexes for JSON fallback
            self._update_indexes(document_id, metadata)

        self._stats["total_documents"] += 1
        self._stats["last_updated"] = datetime.now().isoformat()
        self._save_stats()

        return document_id

    async def store_learning(self, learning: Dict[str, Any]) -> str:
        """
        Store agent learning.

        Args:
            learning: Learning data

        Returns:
            str: Document ID
        """
        if not self._initialized:
            raise RuntimeError("Database not initialized")

        # Validate required fields
        if "content" not in learning:
            raise ValueError("Missing required field: content")

        document_id = (
            f"learning_{int(time.time())}_{hash(learning.get('content', '')) % 10000}"
        )
        document_text = self._create_document_text(learning, "learning")
        embedding = self._generate_embedding(document_text)

        metadata = {
            "id": document_id,
            "type": "learning",
            "content": learning.get("content"),
            "context": learning.get("context"),
            "category": learning.get("category"),
            "importance": learning.get("importance", "medium"),
            "tags": json.dumps(learning.get("tags", [])),
            "timestamp": datetime.now().isoformat(),
            "data": json.dumps(learning),
        }

        if self.use_chroma:
            self.collection.add(
                documents=[document_text],
                embeddings=[embedding],
                metadatas=[metadata],
                ids=[document_id],
            )
        else:
            self._store_json_document(document_id, document_text, metadata, embedding)
            # Update indexes for JSON fallback
            self._update_indexes(document_id, metadata)

        self._stats["total_documents"] += 1
        self._stats["last_updated"] = datetime.now().isoformat()
        self._save_stats()

        return document_id

    def _store_json_document(
        self, doc_id: str, document: str, metadata: Dict, embedding: List[float]
    ):
        """Store document in JSON fallback."""
        store_data = self._load_json_store()

        store_data["documents"].append(document)
        store_data["metadata"].append(metadata)
        store_data["ids"].append(doc_id)
        store_data["embeddings"] = store_data.get("embeddings", [])
        store_data["embeddings"].append(embedding)

        self._save_json_store(store_data)

    def _load_json_store(self) -> Dict:
        """Load JSON store data."""
        if self.json_store_path.exists():
            with open(self.json_store_path, "r", encoding="utf-8") as f:
                return json.load(f)
        return {
            "documents": [],
            "metadata": [],
            "ids": [],
            "embeddings": [],
            "stats": self._stats,
        }

    def _save_json_store(self, data: Dict):
        """Save JSON store data."""
        with open(self.json_store_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    async def query_similar_solutions(
        self, query: str, limit: int = 5, filters: Optional[Dict] = None
    ) -> List[Dict[str, Any]]:
        """
        Query for similar solutions based on text query.

        Args:
            query: Search query
            limit: Maximum number of results
            filters: Optional metadata filters

        Returns:
            List of similar documents with metadata
        """
        if not self._initialized:
            raise RuntimeError("Database not initialized")

        query_embedding = self._generate_embedding(query)

        if self.use_chroma:
            where_clause = None
            if filters:
                where_clause = filters

            results = self.collection.query(
                query_embeddings=[query_embedding], n_results=limit, where=where_clause
            )

            return [
                {
                    "id": results["ids"][0][i],
                    "document": results["documents"][0][i],
                    "metadata": results["metadatas"][0][i],
                    "distance": (
                        results["distances"][0][i] if "distances" in results else None
                    ),
                }
                for i in range(len(results["ids"][0]))
            ]
        else:
            # Simple similarity search for JSON fallback
            return self._json_similarity_search(query_embedding, limit, filters)

    def _json_similarity_search(
        self, query_embedding: List[float], limit: int, filters: Optional[Dict]
    ) -> List[Dict[str, Any]]:
        """Perform similarity search in JSON store."""
        store_data = self._load_json_store()

        similarities = []
        for i, embedding in enumerate(store_data.get("embeddings", [])):
            if i >= len(store_data["metadata"]):
                continue

            metadata = store_data["metadata"][i]

            # Apply filters
            if filters:
                if not self._matches_filters(metadata, filters):
                    continue

            # Calculate cosine similarity
            similarity = self._cosine_similarity(query_embedding, embedding)
            similarities.append((similarity, i))

        # Sort by similarity (descending)
        similarities.sort(key=lambda x: x[0], reverse=True)

        results = []
        for similarity, idx in similarities[:limit]:
            metadata = store_data["metadata"][idx]
            results.append(
                {
                    "id": store_data["ids"][idx],
                    "document": store_data["documents"][idx],
                    "metadata": metadata,
                    "distance": 1 - similarity,  # Convert to distance
                }
            )

        return results

    def _cosine_similarity(self, vec1: List[float], vec2: List[float]) -> float:
        """Calculate cosine similarity between two vectors."""
        import math

        dot_product = sum(a * b for a, b in zip(vec1, vec2))
        norm1 = math.sqrt(sum(a * a for a in vec1))
        norm2 = math.sqrt(sum(b * b for b in vec2))

        if norm1 == 0 or norm2 == 0:
            return 0

        return dot_product / (norm1 * norm2)

    def _matches_filters(self, metadata: Dict, filters: Dict) -> bool:
        """Check if metadata matches filters."""
        for key, value in filters.items():
            if key not in metadata or metadata[key] != value:
                return False
        return True

    async def get_task_history(self, task_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve task history by task ID.

        Args:
            task_id: Task ID to retrieve

        Returns:
            Task history data or None if not found
        """
        if not self._initialized:
            raise RuntimeError("Database not initialized")

        # Check cache first
        cache_key = f"task_history_{task_id}"
        cached_result = self._get_cached_query_result(cache_key)
        if cached_result is not None:
            return cached_result

        if self.use_chroma:
            try:
                results = self.collection.get(
                    where={"taskId": task_id, "type": "task_history"}
                )
                if results["ids"]:
                    metadata = results["metadatas"][0]
                    result = json.loads(metadata.get("data", "{}"))
                    self._cache_query_result(cache_key, result)
                    return result
            except Exception as e:
                print(f"Error retrieving task history: {e}")
                return None
        else:
            # Use index for faster lookup in JSON fallback
            with self._index_lock:
                doc_ids = self._indexes["task_history_by_task_id"].get(task_id, set())
                if doc_ids:
                    store_data = self._load_json_store()
                    for i, metadata in enumerate(store_data.get("metadata", [])):
                        if (
                            metadata.get("id") in doc_ids
                            and metadata.get("type") == "task_history"
                        ):
                            result = json.loads(metadata.get("data", "{}"))
                            self._cache_query_result(cache_key, result)
                            return result

        return None

    async def get_learnings(
        self, filters: Optional[Dict] = None, limit: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Retrieve agent learnings with optional filters.

        Args:
            filters: Optional filters for learnings
            limit: Maximum number of results

        Returns:
            List of learning data
        """
        if not self._initialized:
            raise RuntimeError("Database not initialized")

        # Check cache first
        cache_key = f"learnings_{json.dumps(filters or {}, sort_keys=True)}_{limit}"
        cached_result = self._get_cached_query_result(cache_key)
        if cached_result is not None:
            return cached_result

        learnings = []

        if self.use_chroma:
            where_clause = {"type": "learning"}
            if filters:
                where_clause.update(filters)

            try:
                results = self.collection.get(where=where_clause, limit=limit)

                for metadata in results.get("metadatas", []):
                    learning_data = json.loads(metadata.get("data", "{}"))
                    learnings.append(learning_data)
            except Exception as e:
                print(f"Error retrieving learnings: {e}")
        else:
            # Use indexes for faster filtering in JSON fallback
            candidate_doc_ids = set()

            with self._index_lock:
                # Start with all learning documents
                if "learning_by_category" in self._indexes:
                    for category_docs in self._indexes["learning_by_category"].values():
                        candidate_doc_ids.update(category_docs)
                    for importance_docs in self._indexes[
                        "learning_by_importance"
                    ].values():
                        candidate_doc_ids.update(importance_docs)

                # If no indexes, fall back to scanning all
                if not candidate_doc_ids:
                    store_data = self._load_json_store()
                    for metadata in store_data.get("metadata", []):
                        if metadata.get("type") == "learning":
                            candidate_doc_ids.add(metadata.get("id"))

            # Filter candidates
            store_data = self._load_json_store()
            for metadata in store_data.get("metadata", []):
                if metadata.get("id") not in candidate_doc_ids:
                    continue

                if metadata.get("type") == "learning":
                    if filters and not self._matches_filters(metadata, filters):
                        continue

                    learning_data = json.loads(metadata.get("data", "{}"))
                    learnings.append(learning_data)

                    if len(learnings) >= limit:
                        break

        self._cache_query_result(cache_key, learnings)
        return learnings

    def get_stats(self) -> Dict[str, Any]:
        """
        Get database statistics.

        Returns:
            Dictionary with database statistics
        """
        if self.use_chroma and self.collection:
            try:
                count = self.collection.count()
                self._stats["total_documents"] = count
            except:
                pass

        return self._stats.copy()

    async def close(self):
        """Close database connections."""
        if self.chroma_client:
            # ChromaDB client doesn't have explicit close method in current version
            pass

        self._save_stats()
        self._initialized = False

    def _save_stats(self):
        """Save current statistics."""
        if not self.use_chroma:
            store_data = self._load_json_store()
            store_data["stats"] = self._stats
            self._save_json_store(store_data)
