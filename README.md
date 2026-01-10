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

### 🔌 MCP Server
- **recall** - Search past learnings and session summaries during coding
- **remember** - Save learnings in real-time during sessions
- **similar_errors** - Find past error resolutions
- **file_history** - Get session history for files
- **session_search** - Search sessions by content, date, or outcome (NEW!)
- Seamless integration with Claude Code

### 🔀 Git Integration
- **Session-commit correlation** - Match sessions to commits with confidence scoring
- **Project overview** - List all tracked projects with stats
- **CLAUDE.md sync** - Push learnings to project documentation
- Smart merging with idempotency and dry-run mode
- Filter by global/project scope and confidence levels

### 🤖 AI-Powered Summarization
- **Automatic session summaries** - Claude API generates structured summaries
- **Tracks work done, files changed, errors, and key decisions**
- **Searchable summaries** - `cai search` and MCP recall tool display session summaries
- **Auto-summarize via hooks** - Automatic summarization after session completion
- Dry-run mode and force re-summarization options

### ⚙️ Configuration & Automation (New!)
- **User preferences** - YAML-based config at `~/.code-agent-insights/config.yaml`
- **Session hooks** - Automatic indexing, summarization, and sync after sessions
- **Auto-sync triggers** - Event-driven sync after review/clean operations
- **Configurable thresholds** - Control auto-summarize, sync options, and confidence levels

### 🛠️ Robust Parser
- Handles malformed JSONL/JSON gracefully
- Skips invalid lines while preserving valid data
- Detailed warnings with `--verbose` flag
- Support for all Claude Code event types

## Installation

### For Users (Recommended)

```bash
# Install globally via npm
npm install -g code-agent-insights

# Or via pnpm
pnpm install -g code-agent-insights

# Setup MCP server for Claude Code
cai setup-mcp

# Restart Claude Code
```

### For Development

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

# Setup MCP server
cai setup-mcp
```

### Python Extractor (Optional)

For learning extraction and embeddings:

```bash
cd packages/extractor
pip install -e .
```

### ⚠️ Required for Summarization & Learning Extraction

To use AI-powered features (`cai summarize`, `cai index --extract`), set your Anthropic API key:

```bash
# Add to your ~/.bashrc, ~/.zshrc, or equivalent
export ANTHROPIC_API_KEY=sk-ant-...
```

**Important:**
- Get your API key from [Anthropic Console](https://console.anthropic.com/settings/keys)
- Ensure your account has credits at [Billing](https://console.anthropic.com/settings/billing)
- Without the API key, only basic indexing and search will work

## Quick Start

```bash
# Index your Claude Code sessions
cai index

# Install session hooks for automatic indexing
cai hooks install

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

**Note:** After running `cai hooks install`, your sessions will be automatically indexed, summarized, and synced after each Claude Code session ends.

## MCP Server Setup

The MCP server provides in-session memory tools for Claude Code:
- **recall** - Search past learnings and session summaries during coding
- **remember** - Save learnings in real-time during sessions
- **similar_errors** - Find past error resolutions
- **file_history** - Get session history for files
- **session_search** - Search sessions by content, date, or outcome

### Automatic Setup (Recommended)

```bash
# After installing code-agent-insights, run:
cai setup-mcp

# Then restart Claude Code
```

This automatically configures the MCP server globally for all your Claude Code sessions.

### Manual Setup

If you prefer manual configuration, add to `~/.claude.json`:

```bash
claude mcp add --transport stdio --scope user code-agent-insights -- cai-mcp
```

**Important:** Always restart Claude Code after configuration changes for the tools to become available.

### MCP Tools

Once configured, these tools become available in Claude Code:

- `mcp__code-agent-insights__recall` - Search learnings and session summaries
- `mcp__code-agent-insights__remember` - Save new learnings
- `mcp__code-agent-insights__similar_errors` - Find past errors
- `mcp__code-agent-insights__file_history` - Get file session history
- `mcp__code-agent-insights__session_search` - Search sessions by content, date, or outcome

See [MCP_TESTING_GUIDE.md](./MCP_TESTING_GUIDE.md) for detailed testing instructions.

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
Full-text search across sessions and learnings. Displays session summaries when available.

```bash
cai search "react hooks"
cai search "error handling" -n 20
cai search "database" -p ./my-project
cai search "async await" --summarize         # Add AI-powered summary of findings
cai search "authentication" --since 7d        # Last 7 days
cai search "bug fix" --since 2025-01-01       # Since specific date
```

**Output includes:**
- Matching learnings with tags
- Related sessions with summaries (from `cai summarize`)
- Session metadata (date, turns, outcome, features used)

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

### `cai summarize`
Generate AI-powered session summaries

**⚠️ Requires:** `ANTHROPIC_API_KEY` environment variable and account credits

```bash
# First time setup
export ANTHROPIC_API_KEY=sk-ant-...  # Get from https://console.anthropic.com/settings/keys

# Summarize sessions
cai summarize --last-session           # Summarize most recent session
cai summarize --all                    # Summarize ALL sessions without summaries (no limit)
cai summarize --limit 10               # Summarize up to 10 sessions without summaries
cai summarize --session-id <id>        # Summarize specific session
cai summarize --force --limit 20       # Re-summarize existing (use with --limit)
cai summarize --dry-run                # Preview without calling API

# Regenerate ALL summaries for all sessions (useful after API issues are fixed)
cai summarize --all

# Check if summaries exist
sqlite3 ~/.code-agent-insights/insights.db "SELECT COUNT(*) FROM session_summaries"
sqlite3 ~/.code-agent-insights/insights.db "SELECT COUNT(*) FROM sessions"
```

### `cai config`
Manage configuration settings

```bash
cai config show                                # Show all config
cai config get summarization.autoSummarize     # Get specific value
cai config set sync.autoSync true              # Set config value
cai config edit                                # Open in editor
cai config reset                               # Reset to defaults
cai config path                                # Show config file path
```

### `cai hooks`
Manage session hooks for automation

```bash
cai hooks install         # Install and configure post-session hook
cai hooks uninstall       # Remove post-session hook
cai hooks status          # Check hook installation and activity
cai hooks logs            # Show recent hook execution logs
cai hooks logs -f         # Follow hook logs in real-time (great for debugging!)
cai hooks logs -n 50      # Show last 50 lines
```

**What `cai hooks install` does:**
1. Creates `~/.claude/hooks/post-session.sh` script
2. Automatically configures `~/.claude/settings.json` to enable the hook
3. No manual configuration needed!

**The post-session hook automatically runs after each session and:**
- Indexes new sessions (`cai index --since 6h` - wider window to avoid timezone issues)
- Generates AI summaries (if `ANTHROPIC_API_KEY` is set)
- Syncs learnings to CLAUDE.md (if `autoSync: true` in config)
- Logs detailed execution info to `~/.code-agent-insights/hooks.log`

**For other users:** When sharing this project, users just need to run `cai hooks install` - it will automatically configure their Claude Code installation.

**Debugging hooks:**
If hooks aren't running automatically or stats aren't updating:

1. **Watch hook execution in real-time:**
   ```bash
   # In a separate terminal, run:
   cai hooks logs -f
   # Then end your Claude Code session and watch the logs
   ```

2. **Check hook status:**
   ```bash
   cai hooks status  # Shows installation status and recent activity
   ```

3. **View recent logs:**
   ```bash
   cai hooks logs -n 30  # Show last 30 log lines
   ```

4. **Manually test the hook:**
   ```bash
   ~/.claude/hooks/post-session.sh  # Should index recent sessions
   ```

5. **Verify Claude Code configuration:**
   Check `~/.claude/settings.json` contains the correct format (see below)

The correct hook configuration in `~/.claude/settings.json` should be:
```json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/Users/your-username/.claude/hooks/post-session.sh"
          }
        ]
      }
    ]
  }
}
```

**Note:** Versions prior to v0.3.5 used an incorrect `postSession` format. If you installed hooks before this version, run `cai hooks install` again to update to the correct `SessionEnd` format.

### `cai recommend`
Get personalized feature recommendations

```bash
cai recommend
cai recommend -p ./my-project
```

### `cai projects`
List all tracked projects

```bash
cai projects                    # Show all projects with stats
cai projects --json             # JSON output for scripting
cai projects --with-learnings   # Include learning counts
```

### `cai sync`
Sync learnings to project CLAUDE.md files

```bash
cai sync                          # Sync all projects
cai sync --dry-run                # Preview changes
cai sync -p /path/to/project      # Sync specific project
cai sync --min-confidence 0.9     # Only high-confidence learnings
cai sync --no-global              # Exclude global learnings
cai sync --reviewed-only          # Only reviewed/manual learnings
```

### `cai correlate`
Correlate coding sessions with git commits

```bash
cai correlate                     # Analyze current project (last 30 days)
cai correlate -p /path/to/project # Analyze specific project
cai correlate --since 7d          # Last 7 days only
cai correlate --since 2025-01-01  # Since specific date
```

## Architecture

```
code-agent-insights/
├── packages/
│   ├── core/          # TypeScript - types, storage, parsers
│   ├── cli/           # TypeScript - CLI interface
│   ├── mcp-server/    # TypeScript - MCP server for in-session tools
│   └── extractor/     # Python - embeddings, LLM extraction
├── CLAUDE.md          # Project overview and architecture
├── PROMPTS.md         # Development prompts and tasks
└── MCP_TESTING_GUIDE.md  # MCP server testing guide
```

### Tech Stack

- **TypeScript** - CLI, core library, MCP server
- **Python** - Embeddings (sentence-transformers) and LLM extraction
- **SQLite** - Local storage with FTS5 full-text search
- **pnpm** - Monorepo management
- **better-sqlite3** - High-performance Node.js SQLite binding
- **Commander.js** - CLI framework
- **@modelcontextprotocol/sdk** - MCP server implementation
- **Claude API** - Learning extraction

## Database Schema

### Core Tables
- `sessions` - Session metadata and statistics
- `session_summaries` - AI-generated session summaries (NEW!)
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
    SQLite Storage (~/.code-agent-insights/insights.db)
           ↓
   Python Extractor (optional)
           ↓
    ┌──────┴──────┐
    ↓             ↓
  CLI          MCP Server
                  ↓
           Claude Code Session
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
- `config.yaml` - User preferences (YAML format)
- `hooks.log` - Session hook execution log

Configuration options include:
- **Summarization**: Auto-summarize settings, model selection
- **Sync**: Auto-sync triggers, confidence thresholds, global/project scope
- **Hooks**: Enable/disable automatic session processing

## Environment Variables

```bash
ANTHROPIC_API_KEY=sk-...  # Required for learning extraction and AI summaries
```

## Roadmap

- [x] **Phase 1**: Core + CLI with search, stats, and feature tracking
- [x] **Phase 2**: MCP server for in-session recall/remember (4 tools: recall, remember, similar_errors, file_history)
- [x] **Phase 3**: Git integration, project management, and CLAUDE.md sync (3 new commands: projects, sync, correlate)
- [x] **Phase 3.5**: AI-powered summarization, configuration system, and automation (3 new commands: summarize, config, hooks; enhanced MCP tools)
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
