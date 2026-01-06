import argparse
import json
import sqlite3
import uuid
import os
from pathlib import Path

from .embeddings import EmbeddingService, VectorStore
from .learning_extractor import LearningExtractor


def get_data_dir() -> Path:
    return Path.home() / ".code-agent-insights"


def main():
    parser = argparse.ArgumentParser(description="Code Agent Insights Extractor")
    subparsers = parser.add_subparsers(dest="command", required=True)
    
    # embed command
    embed_parser = subparsers.add_parser("embed", help="Generate embeddings")
    embed_parser.add_argument("--type", choices=["sessions", "learnings", "all"], default="all")
    embed_parser.add_argument("--batch-size", type=int, default=32)
    
    # extract command
    extract_parser = subparsers.add_parser("extract", help="Extract learnings from sessions")
    extract_parser.add_argument("--session-id", help="Specific session ID")
    extract_parser.add_argument("--all", action="store_true", help="Process all unprocessed sessions")
    extract_parser.add_argument("--min-confidence", type=float, default=0.7)
    
    # search command
    search_parser = subparsers.add_parser("search", help="Semantic search")
    search_parser.add_argument("query", help="Search query")
    search_parser.add_argument("--limit", type=int, default=10)
    
    args = parser.parse_args()
    
    if args.command == "embed":
        run_embed(args)
    elif args.command == "extract":
        run_extract(args)
    elif args.command == "search":
        run_search(args)


def run_embed(args):
    data_dir = get_data_dir()
    db_path = data_dir / "insights.db"
    vector_path = data_dir / "embeddings.db"
    
    if not db_path.exists():
        print(f"Database not found: {db_path}")
        print("Run 'cai index' first to index sessions.")
        return
    
    print("Loading embedding model...")
    embedder = EmbeddingService()
    vector_store = VectorStore(str(vector_path))
    conn = sqlite3.connect(str(db_path))
    
    if args.type in ("learnings", "all"):
        print("Embedding learnings...")
        rows = conn.execute("SELECT id, content FROM learnings").fetchall()
        
        if rows:
            for i in range(0, len(rows), args.batch_size):
                batch = rows[i:i + args.batch_size]
                texts = [r[1] for r in batch]
                embeddings = embedder.embed_batch(texts, show_progress=False)
                
                for j, (learning_id, _) in enumerate(batch):
                    vector_store.insert_learning_embedding(learning_id, embeddings[j])
                
                print(f"  Learnings: {min(i + args.batch_size, len(rows))}/{len(rows)}")
        else:
            print("  No learnings to embed")
    
    if args.type in ("sessions", "all"):
        print("Embedding sessions...")
        rows = conn.execute("""
            SELECT s.id, GROUP_CONCAT(e.content, ' ')
            FROM sessions s
            LEFT JOIN events e ON e.session_id = s.id
            WHERE e.type IN ('user_message', 'assistant_message')
            GROUP BY s.id
        """).fetchall()
        
        if rows:
            for i in range(0, len(rows), args.batch_size):
                batch = rows[i:i + args.batch_size]
                texts = [(r[1] or "")[:10000] for r in batch]
                embeddings = embedder.embed_batch(texts, show_progress=False)
                
                for j, (session_id, _) in enumerate(batch):
                    vector_store.insert_session_embedding(session_id, embeddings[j])
                
                print(f"  Sessions: {min(i + args.batch_size, len(rows))}/{len(rows)}")
        else:
            print("  No sessions to embed")
    
    print("Done!")
    conn.close()
    vector_store.close()


def run_extract(args):
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("Error: ANTHROPIC_API_KEY environment variable required")
        return
    
    data_dir = get_data_dir()
    db_path = data_dir / "insights.db"
    
    if not db_path.exists():
        print(f"Database not found: {db_path}")
        return
    
    extractor = LearningExtractor(api_key=api_key)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    
    # Get sessions to process
    if args.session_id:
        sessions = [dict(conn.execute("SELECT * FROM sessions WHERE id = ?", (args.session_id,)).fetchone())]
    elif args.all:
        sessions = [dict(r) for r in conn.execute("""
            SELECT s.* FROM sessions s
            LEFT JOIN learnings l ON l.session_id = s.id
            WHERE l.id IS NULL
            LIMIT 100
        """).fetchall()]
    else:
        print("Specify --session-id or --all")
        return
    
    if not sessions:
        print("No sessions to process")
        return
    
    print(f"Processing {len(sessions)} sessions...")
    
    for session in sessions:
        session_id = session["id"]
        print(f"  Processing {session_id[:8]}...")
        
        # Get related data
        events = [dict(r) for r in conn.execute(
            "SELECT * FROM events WHERE session_id = ? ORDER BY sequence_number",
            (session_id,)
        ).fetchall()]
        
        tool_calls = [dict(r) for r in conn.execute(
            "SELECT * FROM tool_calls WHERE session_id = ?", (session_id,)
        ).fetchall()]
        
        errors = [dict(r) for r in conn.execute(
            "SELECT * FROM errors WHERE session_id = ?", (session_id,)
        ).fetchall()]
        
        skill_invocations = [dict(r) for r in conn.execute(
            "SELECT * FROM skill_invocations WHERE session_id = ?", (session_id,)
        ).fetchall()]
        
        sub_agents = [dict(r) for r in conn.execute(
            "SELECT * FROM sub_agent_invocations WHERE session_id = ?", (session_id,)
        ).fetchall()]
        
        modes_row = conn.execute(
            "SELECT * FROM session_modes WHERE session_id = ?", (session_id,)
        ).fetchone()
        modes = dict(modes_row) if modes_row else None
        
        # Build context and extract
        context = extractor.build_session_context(
            events, tool_calls, errors, skill_invocations, sub_agents, modes
        )
        
        try:
            result = extractor.extract(context, min_confidence=args.min_confidence)
        except Exception as e:
            print(f"    Error: {e}")
            continue
        
        # Save learnings
        for learning in result.get("learnings", []):
            conn.execute("""
                INSERT INTO learnings (id, session_id, project_path, content, type, scope, confidence, tags, related_files, source, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'extracted', datetime('now'))
            """, (
                str(uuid.uuid4()),
                session_id,
                session.get("project_path"),
                learning["content"],
                learning.get("type", "pattern"),
                learning.get("scope", "project"),
                learning.get("confidence", 0.8),
                json.dumps(learning.get("tags", [])),
                json.dumps(learning.get("related_files", [])),
            ))
        
        # Update session
        if result.get("session_summary"):
            conn.execute(
                "UPDATE sessions SET summary = ?, outcome = ? WHERE id = ?",
                (result.get("session_summary"), result.get("session_outcome", "unknown"), session_id)
            )
        
        conn.commit()
        print(f"    Extracted {len(result.get('learnings', []))} learnings")
    
    conn.close()
    print("Done!")


def run_search(args):
    data_dir = get_data_dir()
    db_path = data_dir / "insights.db"
    vector_path = data_dir / "embeddings.db"
    
    if not vector_path.exists():
        print("Embeddings not found. Run 'cai index --embed' first.")
        return
    
    embedder = EmbeddingService()
    vector_store = VectorStore(str(vector_path))
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    
    print(f"Searching for: {args.query}\n")
    
    query_embedding = embedder.embed(args.query)
    results = vector_store.search_similar_learnings(query_embedding, limit=args.limit)
    
    if not results:
        print("No results found.")
        return
    
    for learning_id, score in results:
        row = conn.execute("SELECT * FROM learnings WHERE id = ?", (learning_id,)).fetchone()
        if row:
            print(f"[{row['type']}] (score: {score:.2f})")
            print(f"  {row['content']}")
            tags = json.loads(row['tags'] or '[]')
            if tags:
                print(f"  Tags: {', '.join(tags)}")
            print()
    
    conn.close()
    vector_store.close()


if __name__ == "__main__":
    main()
