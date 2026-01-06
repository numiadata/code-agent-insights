# Code Agent Insights

> Local-first observability and memory for coding agents (Claude Code, Cursor, VS Code)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.11+-green)](https://www.python.org/)

## Overview

Code Agent Insights helps developers build persistent memory and understanding across AI coding sessions. Index your Claude Code, Cursor, and VS Code sessions to:

- 🔍 **Search** past sessions ("how did I fix that auth bug?")
- 🧠 **Extract learnings** automatically from sessions
- 📊 **Track patterns**, errors, and outcomes
- 💡 **Build persistent memory** across sessions
- 📈 **Understand** which Claude Code features (skills, sub-agents, modes) work best

## Features

### 🎯 Session Indexing
- Automatically discover and index sessions from `~/.claude/`
- Support for JSONL and JSON formats
- Robust parsing with graceful error handling
- Filter by date with `--since` flag (7d, 2w, 1m, YYYY-MM-DD)

### 🔍 Full-Text Search
- Search across all sessions with FTS5
- Filter by project, limit results
- Optional AI-powered summarization

### 📊 Analytics & Statistics
- Overall metrics (sessions, tokens, errors, success rates)
- Skill usage breakdown
- Tool pattern analysis
- Sub-agent effectiveness
- Mode comparison (plan mode, thinking, sub-agents)

### 🧠 Learning Management
- Auto-extract learnings via Claude API
- Manual learning creation
- Interactive review interface
- Duplicate detection and cleanup
- Low-confidence filtering

### 🛠️ Robust Parser
- Handles malformed JSONL/JSON gracefully
- Skips invalid lines while preserving valid data
- Detailed warnings with `--verbose` flag
- Support for all Claude Code event types

## Installation

```bash
# Clone the repository
git clone https://github.com/numiadata/code-agent-insights.git
cd code-agent-insights

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Link CLI globally
cd packages/cli
pnpm link --global
```

### Python Extractor (Optional)

For learning extraction and embeddings:

```bash
cd packages/extractor
pip install -e .
```

Set your Anthropic API key:
```bash
export ANTHROPIC_API_KEY=sk-...
```

## Quick Start

```bash
# Index your Claude Code sessions
cai index

# Search for specific topics
cai search "authentication bug"

# View statistics
cai stats

# See mode effectiveness
cai stats --modes

# Review learnings interactively
cai review --limit 10

# Clean up duplicates (dry run)
cai clean --duplicates --dry-run
```

## CLI Commands

### `cai index`
Index coding agent sessions from `~/.claude/`

```bash
cai index                      # Index all new sessions
cai index --since 7d           # Only last 7 days
cai index --since 2025-01-01   # Since specific date
cai index --embed              # Generate embeddings
cai index --extract            # Extract learnings (requires API key)
cai index --verbose            # Show parse warnings
```

### `cai search <query>`
Full-text search across sessions

```bash
cai search "react hooks"
cai search "error handling" -n 20
cai search "database" -p ./my-project
cai search "async await" --summarize
```

### `cai stats`
View analytics and statistics

```bash
cai stats              # Overall statistics
cai stats --skills     # Skill usage breakdown
cai stats --tools      # Tool pattern analysis
cai stats --agents     # Sub-agent effectiveness
cai stats --modes      # Mode comparison
cai stats --json       # JSON output
```

### `cai learn <content>`
Manually add a learning

```bash
cai learn "Always use pnpm in this repo"
cai learn "Auth bugs usually in middleware" -t pattern -s global
cai learn "Use --break-system-packages for pip" --tags python,pip
```

### `cai clean`
Clean up learnings database

```bash
cai clean --duplicates --dry-run           # Preview duplicate removal
cai clean --type context                    # Remove all context learnings
cai clean --low-confidence --threshold 0.6  # Remove low-confidence
```

### `cai review`
Interactive learning review

```bash
cai review                    # Review all learnings
cai review --unreviewed       # Only unreviewed
cai review --type pattern     # Filter by type
cai review --limit 50         # Limit count
cai review -p ./my-project    # Filter by project
```

Actions: `(k)eep | (d)elete | (e)dit | (s)kip | (q)uit`

### `cai recommend`
Get personalized feature recommendations

```bash
cai recommend
cai recommend -p ./my-project
```

## Architecture

```
code-agent-insights/
├── packages/
│   ├── core/          # TypeScript - types, storage, parsers
│   ├── cli/           # TypeScript - CLI interface
│   └── extractor/     # Python - embeddings, LLM extraction
├── CLAUDE.md          # Project overview and architecture
└── PROMPTS.md         # Development prompts and tasks
```

### Tech Stack

- **TypeScript** - CLI, core library
- **Python** - Embeddings (sentence-transformers) and LLM extraction
- **SQLite** - Local storage with FTS5 full-text search
- **pnpm** - Monorepo management
- **better-sqlite3** - High-performance Node.js SQLite binding
- **Commander.js** - CLI framework
- **Claude API** - Learning extraction

## Database Schema

### Core Tables
- `sessions` - Session metadata and statistics
- `events` - All events in sessions (with FTS)
- `tool_calls` - Tool invocations
- `errors` - Errors encountered
- `learnings` - Extracted and manual learnings (with FTS)

### Feature Tracking
- `skill_invocations` - Skill file reads
- `sub_agent_invocations` - Sub-agent spawns
- `tool_sequences` - Tool call patterns
- `session_modes` - Mode usage per session

## Data Flow

```
Session Sources (Claude Code, Cursor, VS Code)
           ↓
    TypeScript Parser
           ↓
    SQLite Storage
           ↓
   Python Extractor (optional)
           ↓
    ┌──────┴──────┐
    ↓             ↓
  CLI          MCP Server (future)
```

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Development mode
pnpm dev

# Install Python extractor
cd packages/extractor
pip install -e .
```

## Configuration

Data is stored in `~/.code-agent-insights/`:
- `insights.db` - Main database
- `embeddings.db` - Vector storage (if using embeddings)
- `config.json` - User preferences

## Environment Variables

```bash
ANTHROPIC_API_KEY=sk-...  # Required for learning extraction and AI summaries
```

## Roadmap

- [x] **Phase 1**: Core + CLI with search, stats, and feature tracking
- [ ] **Phase 2**: MCP server for in-session recall/remember
- [ ] **Phase 3**: Git commit correlation
- [ ] **Phase 4**: CI/CD outcome tracking
- [ ] **Phase 5**: Team sync and manager dashboards

## Contributing

Contributions are welcome! Please read our contributing guidelines and submit pull requests.

## License

MIT License - see LICENSE file for details

## Credits

Built with ❤️ using:
- [Claude Code](https://claude.com/claude-code) - AI pair programmer
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - Fast SQLite for Node.js
- [Commander.js](https://github.com/tj/commander.js) - CLI framework
- [sentence-transformers](https://www.sbert.net/) - Embeddings

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
