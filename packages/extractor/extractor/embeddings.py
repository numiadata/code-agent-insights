from sentence_transformers import SentenceTransformer
import numpy as np
import sqlite3
import struct
from pathlib import Path


class EmbeddingService:
    def __init__(self, model_name: str = "all-MiniLM-L6-v2", cache_dir: str | None = None):
        self.model = SentenceTransformer(model_name, cache_folder=cache_dir)
        self.dimension = self.model.get_sentence_embedding_dimension()
    
    def embed(self, text: str) -> np.ndarray:
        """Generate embedding for a single text."""
        return self.model.encode(text, normalize_embeddings=True)
    
    def embed_batch(self, texts: list[str], show_progress: bool = True) -> np.ndarray:
        """Generate embeddings for multiple texts."""
        return self.model.encode(texts, normalize_embeddings=True, show_progress_bar=show_progress)


class VectorStore:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.conn = sqlite3.connect(db_path)
        self._init_tables()
    
    def _init_tables(self):
        """Create tables for storing embeddings as BLOBs."""
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS learning_embeddings (
                learning_id TEXT PRIMARY KEY,
                embedding BLOB NOT NULL
            )
        """)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS session_embeddings (
                session_id TEXT PRIMARY KEY,
                embedding BLOB NOT NULL
            )
        """)
        self.conn.commit()
    
    def _serialize(self, embedding: np.ndarray) -> bytes:
        return struct.pack(f'{len(embedding)}f', *embedding.tolist())
    
    def _deserialize(self, data: bytes) -> np.ndarray:
        count = len(data) // 4
        return np.array(struct.unpack(f'{count}f', data))
    
    def insert_learning_embedding(self, learning_id: str, embedding: np.ndarray):
        self.conn.execute(
            "INSERT OR REPLACE INTO learning_embeddings (learning_id, embedding) VALUES (?, ?)",
            (learning_id, self._serialize(embedding))
        )
        self.conn.commit()
    
    def insert_session_embedding(self, session_id: str, embedding: np.ndarray):
        self.conn.execute(
            "INSERT OR REPLACE INTO session_embeddings (session_id, embedding) VALUES (?, ?)",
            (session_id, self._serialize(embedding))
        )
        self.conn.commit()
    
    def search_similar_learnings(self, query_embedding: np.ndarray, limit: int = 10) -> list[tuple[str, float]]:
        """Search for similar learnings using cosine similarity."""
        rows = self.conn.execute("SELECT learning_id, embedding FROM learning_embeddings").fetchall()
        
        if not rows:
            return []
        
        results = []
        for learning_id, blob in rows:
            embedding = self._deserialize(blob)
            similarity = float(np.dot(query_embedding, embedding))
            results.append((learning_id, similarity))
        
        results.sort(key=lambda x: x[1], reverse=True)
        return results[:limit]
    
    def close(self):
        self.conn.close()
