# Code Agent Insights

Local-first observability and memory for coding agents (Claude Code, Cursor, VS Code).

## Project Overview

This tool indexes coding agent sessions, extracts learnings, and provides search + analytics. It helps developers:

- Search past sessions ("how did I fix that auth bug?")
- Auto-extract learnings from sessions
- Track patterns, errors, and outcomes
- Build persistent memory across sessions
- Understand which Claude Code features (skills, sub-agents, modes) work best

## Target Users

1. **Individual developers** — search past sessions, build memory, improve prompting
2. **Engineering managers** (future) — understand team AI usage patterns, share learnings

## Architecture
```
code-agent-insights/
├── packages/
│   ├── core/          # TypeScript - types, storage, parsers
│   ├── cli/           # TypeScript - CLI interface
│   ├── extractor/     # Python - embeddings, LLM extraction
│   └── mcp-server/    # TypeScript - MCP integration (Phase 2)
├── scripts/
├── CLAUDE.md
└── PROMPTS.md
```

## Tech Stack

- **TypeScript** for CLI, core, MCP server
- **Python** for embeddings (sentence-transformers) and LLM extraction
- **SQLite** for local storage (better-sqlite3)
- **pnpm workspaces** for monorepo
- **Commander.js** for CLI
- **all-MiniLM-L6-v2** for local embeddings
- **Claude API** for learning extraction

## Data Flow
```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Session Sources                                  │
├──────────────────┬──────────────────┬───────────────────────────────────┤
│  Claude Code     │  VS Code Ext     │  Cursor                           │
│  ~/.claude/      │  ~/.claude/      │  ~/.cursor/                       │
└────────┬─────────┴────────┬─────────┴─────────────┬─────────────────────┘
         │                  │                       │
         └──────────────────┼───────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      Ingestion Pipeline (TypeScript)                     │
│  - Watch/scan session directories                                        │
│  - Parse transcripts → structured events                                │
│  - Extract: files, errors, tool calls, skills, sub-agents, modes        │
└───────────────────────────┬─────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      Python Extractor                                    │
│  - Generate embeddings (all-MiniLM-L6-v2)                               │
│  - Extract learnings (Claude API)                                        │
│  - Detect error patterns                                                 │
│  - Compute metrics                                                       │
└───────────────────────────┬─────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      SQLite Storage                                      │
│  ~/.code-agent-insights/                                                │
│  ├── insights.db              # Sessions, events, learnings, features   │
│  ├── embeddings.db            # Vector storage                          │
│  └── config.json              # User preferences                        │
└───────────────────────────┬─────────────────────────────────────────────┘
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
┌───────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│       CLI         │ │   MCP Server    │ │  Claude Plugin  │
│  cai search ...   │ │  recall/remember│ │  (future)       │
│  cai stats        │ │  similar_errors │ │                 │
│  cai recommend    │ │                 │ │                 │
└───────────────────┘ └─────────────────┘ └─────────────────┘
```

## Data Model

### Core Types
```typescript
// Session - a single coding agent conversation
interface Session {
  id: string;
  source: 'claude_code' | 'cursor' | 'vscode';
  projectPath: string;
  projectName: string;
  gitBranch?: string;
  gitUser?: string;
  startedAt: Date;
  endedAt?: Date;
  status: 'completed' | 'abandoned' | 'error' | 'in_progress';
  tokenCount: number;
  turnCount: number;
  toolCallCount: number;
  errorCount: number;
  filesModified: number;
  rawPath: string;
  summary?: string;
  outcome: 'success' | 'partial' | 'failure' | 'unknown';
  
  // Claude Code feature tracking
  skillInvocationCount: number;
  subAgentCount: number;
  usedPlanMode: boolean;
  usedThinking: boolean;
  primaryTools: string[];  // Top 3 most used tools
}

// Event - a single message or action in a session
interface Event {
  id: string;
  sessionId: string;
  type: 'user_message' | 'assistant_message' | 'tool_call' | 'tool_result' 
      | 'error' | 'file_read' | 'file_write' | 'file_create' 
      | 'command_execute' | 'thinking';
  timestamp: Date;
  sequenceNumber: number;
  content?: string;
  metadata?: Record<string, unknown>;
}

// ToolCall - a tool invocation by the agent
interface ToolCall {
  id: string;
  sessionId: string;
  eventId: string;
  toolName: string;
  parameters: Record<string, unknown>;
  result?: string;
  success: boolean;
  durationMs?: number;
  timestamp: Date;
}

// ErrorRecord - an error encountered during a session
interface ErrorRecord {
  id: string;
  sessionId: string;
  eventId: string;
  errorType: string;
  errorMessage: string;
  stackTrace?: string;
  filePath?: string;
  lineNumber?: number;
  resolved: boolean;
  resolutionEventId?: string;
  timestamp: Date;
}

// Learning - extracted insight from sessions
interface Learning {
  id: string;
  sessionId?: string;
  projectPath?: string;
  content: string;
  type: 'pattern' | 'antipattern' | 'convention' | 'fix' | 'preference' | 'context';
  scope: 'global' | 'project' | 'file' | 'language';
  confidence: number;
  tags: string[];
  relatedFiles: string[];
  relatedErrors: string[];
  source: 'extracted' | 'explicit';
  appliedCount: number;
  lastAppliedAt?: Date;
  createdAt: Date;
}
```

### Claude Code Feature Types
```typescript
// SkillInvocation - when Claude reads a skill file
interface SkillInvocation {
  id: string;
  sessionId: string;
  skillPath: string;           // /mnt/skills/public/docx/SKILL.md
  skillName: string;           // docx
  skillCategory: 'public' | 'user' | 'example';
  invokedAt: Date;
  sequenceNumber: number;
  contextBefore?: string;      // What task triggered the skill read
}

// SubAgentInvocation - when Claude spawns a sub-agent via Task tool
interface SubAgentInvocation {
  id: string;
  sessionId: string;
  parentEventId: string;
  taskDescription: string;     // The prompt given to sub-agent
  toolsAllowed: string[];      // Which tools the sub-agent could use
  startedAt: Date;
  endedAt?: Date;
  tokenCount: number;
  turnCount: number;
  outcome: 'success' | 'partial' | 'failure' | 'unknown';
  resultSummary?: string;
}

// ToolSequence - a pattern of consecutive tool calls
interface ToolSequence {
  id: string;
  sessionId: string;
  tools: string[];             // ['view', 'str_replace', 'bash_tool']
  startedAt: Date;
  endedAt: Date;
  success: boolean;
  taskType?: string;           // 'file_edit' | 'debugging' | 'creation'
}

// SessionModes - which modes were used in a session
interface SessionModes {
  sessionId: string;
  usedPlanMode: boolean;
  planModeCount: number;
  usedThinking: boolean;
  thinkingBlockCount: number;
  usedCompact: boolean;
  usedSubAgents: boolean;
  subAgentCount: number;
  skillsUsed: string[];
}
```

## Claude Code Feature Detection

### Skills Detection
- Detect when `view` tool is called with path starting with `/mnt/skills/`
- Extract skill name from path (e.g., 'docx' from '/mnt/skills/public/docx/SKILL.md')
- Categorize: `public` (built-in), `user` (custom uploaded), `example`

### Sub-agent Detection
- Detect when `task` or `dispatch_agent` tool is called
- Extract task description and allowed tools from parameters
- Track token usage and outcome

### Mode Detection
- **Plan mode**: User message contains `/plan` or mentions "plan mode"
- **Thinking**: Count `thinking` type content blocks
- **Compact**: User message contains `/compact`

### Tool Sequence Patterns
- Group consecutive tool calls (max 5 per sequence)
- Common patterns: `view→str_replace`, `bash_tool→view→str_replace`
- Track success/failure of each pattern

## Key Metrics

### Core Metrics
- **Task Success Rate** — % sessions reaching accepted outcome
- **Time-to-Acceptance** — how long to complete tasks
- **Error Recovery Rate** — % errors resolved within session
- **Mistake Non-Repetition Rate** — % of corrected issues that don't reappear

### Feature Effectiveness Metrics
- **Skill Usage Rate** — % sessions using skills
- **Skill ROI** — outcome improvement when skills used
- **Sub-agent Efficiency** — tokens per successful delegation
- **Tool Pattern Success Rate** — which sequences work best
- **Plan Mode Effectiveness** — outcome comparison with/without plan mode
- **Thinking Effectiveness** — outcome comparison with/without thinking

## CLI Commands
```bash
# Indexing
cai index                     # Index all sessions from ~/.claude
cai index --embed             # Also generate embeddings
cai index --extract           # Also extract learnings (needs ANTHROPIC_API_KEY)

# Search
cai search <query>            # Keyword search
cai search <query> --summarize  # With AI summary of findings
cai search <query> -n 20      # Limit results
cai search <query> -p ./myproject  # Filter by project

# Statistics
cai stats                     # Overall statistics
cai stats --skills            # Skill usage breakdown
cai stats --tools             # Tool pattern analysis
cai stats --agents            # Sub-agent effectiveness
cai stats --modes             # Mode comparison
cai stats --json              # Output as JSON

# Manual learning
cai learn "Always use pnpm in this repo"
cai learn "Use --break-system-packages for pip" -t convention -s global
cai learn "Auth bugs usually in middleware" --tags auth,debugging

# Recommendations
cai recommend                 # Get personalized feature recommendations
cai recommend -p ./myproject  # For specific project
```

## Database Schema

### Tables
```sql
-- Core tables
sessions              -- Session metadata and stats
events                -- All events in sessions (with FTS)
tool_calls            -- Tool invocations
errors                -- Errors encountered
learnings             -- Extracted and manual learnings (with FTS)

-- Feature tracking tables
skill_invocations     -- Skill file reads
sub_agent_invocations -- Sub-agent spawns
tool_sequences        -- Tool call patterns
session_modes         -- Mode usage per session

-- Search tables
events_fts            -- Full-text search on events
learnings_fts         -- Full-text search on learnings

-- Vector storage (separate file: embeddings.db)
session_embeddings    -- Session vectors
learning_embeddings   -- Learning vectors
```

## Build Commands
```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Development mode
pnpm dev

# Install Python extractor
cd packages/extractor && pip install -e .

# Test CLI
cai --help
cai index
cai stats
cai search "test"
```

## Environment Variables
```bash
ANTHROPIC_API_KEY=sk-...  # Required for learning extraction and AI summaries
```

## Code Style

- Use Zod for runtime validation of all data types
- Prefer async/await over callbacks
- Use descriptive variable names
- Keep functions focused and small (<50 lines)
- Add JSDoc comments for public APIs
- Use snake_case for database columns, camelCase for TypeScript

## File Locations

- Session data: `~/.claude/projects/*/sessions/*.json`
- Insights database: `~/.code-agent-insights/insights.db`
- Embeddings database: `~/.code-agent-insights/embeddings.db`
- Config: `~/.code-agent-insights/config.json`

## Current Phase

**Phase 3**: Git integration and enhanced sync (COMPLETED ✓)

### Phase 1 - Completed ✓
- ✅ Core TypeScript library with SQLite storage
- ✅ CLI with 7 commands (index, search, stats, learn, recommend, clean, review)
- ✅ Robust JSONL/JSON parser with edge case handling
- ✅ Full-text search with FTS5
- ✅ Interactive learning review
- ✅ Database cleanup tools
- ✅ Mode effectiveness tracking
- ✅ Date-based session filtering (--since flag)

### Phase 2 - Completed ✓
- ✅ MCP server package setup with @modelcontextprotocol/sdk
- ✅ Server core with tool registration and routing
- ✅ 4 tool schemas defined: recall, remember, similar_errors, file_history
- ✅ Database methods: searchErrors(), getSessionsForFile(), getLearningsForSession()
- ✅ All 4 MCP tools implemented and tested
- ✅ MCP server documentation and configuration examples
- ✅ Integration testing with Claude Code

### Phase 3 - Completed ✓
- ✅ Git integration utilities (getGitInfo, getRecentCommits, getFilesChangedInCommit)
- ✅ Session-commit correlation with confidence scoring algorithm
- ✅ Projects overview command (`cai projects`)
- ✅ CLAUDE.md sync command (`cai sync`) with smart merging
- ✅ Enhanced sync options: --reviewed-only, --no-global, --min-confidence, --dry-run
- ✅ Idempotency and dry-run mode
- ✅ Comprehensive end-to-end testing (10/10 tests passed)
- ✅ Test documentation (E2E_TEST_RESULTS.md)

## Future Phases

- **Phase 4**: CI/CD outcome tracking
- **Phase 5**: Team sync and manager dashboards

---

<!-- code-agent-insights:start -->
## Learnings from Past Sessions

> Auto-generated by code-agent-insights. Last synced: 2026-01-09
> 12 learnings from past coding sessions.

### 🔧 Fixes

- To fix path mismatches in learnings database, use: UPDATE learnings SET project_path = '/actual/project/path' WHERE project_path = '/Users/username/.claude/projects/-actual-project-path'. This normalizes extracted learnings to match paths used by cai sync. _(database, sql, path-normalization, maintenance)_
- Learnings stored with project_path from session directories (/Users/rafa/.claude/projects/-Users-rafa-Documents-...) don't match actual project paths (/Users/rafa/Documents/...) used by cai sync. Normalize paths to actual project directories when storing learnings to ensure sync finds them correctly. _(database, sync, project-paths, learnings, path-normalization)_
- When deleting database records with foreign key constraints, respect dependency order: delete child records before parents. For example, tool_calls references events, so DELETE FROM tool_calls must happen before DELETE FROM events to avoid FK constraint failures. _(database, foreign-keys, sqlite, deletion-order, constraints)_
- When implementing MCP server tools with TypeScript, add 'uuid' package dependency to package.json and ensure it's available in the build environment. The MCP server will fail at runtime if uuid is imported but not properly installed as a dependency. _(mcp, typescript, dependencies, uuid)_
- Claude Code sessions are stored as .jsonl files directly in project directories (~/.claude/projects/*/*.jsonl), not in sessions subdirectories as originally assumed. The session discovery pattern needs to be updated from 'projects/*/sessions/*.json' to 'projects/*/*.jsonl'. _(claude-code, file-discovery, session-parsing, jsonl)_

### ✨ Patterns

- When reindexing sessions, preserve learnings by setting their session_id to NULL instead of deleting them. This maintains extracted knowledge while allowing the parent session to be deleted and recreated. Use UPDATE learnings SET session_id = NULL WHERE session_id = ? before DELETE FROM sessions. _(database, learnings, reindexing, data-preservation, foreign-keys)_
- Claude Code uses JSONL format (newline-delimited JSON) natively. Each line is a separate JSON object representing different event types: 'summary', 'file-history-snapshot', 'user', 'assistant', etc. Parser must handle line-by-line parsing rather than expecting single JSON object. _(jsonl, claude-code, session-format, parsing)_
- When building multi-package TypeScript projects with tsup, use workspace dependencies 'workspace:*' to ensure proper build order and avoid version conflicts _(pnpm-workspaces, tsup, typescript, monorepo)_

### 📏 Conventions

- Prefer TypeScript over JavaScript for this project. All new code should be written in TypeScript (.ts files) rather than JavaScript (.js files). _(typescript, javascript, language-preference, code-style)_
- Claude Code MCP server registration requires absolute path in command args when using node directly: {'command': 'node', 'args': ['/full/path/to/dist/index.js']} rather than relying on global npm linking which may not work reliably. _(claude-code, mcp, configuration, absolute-paths)_
- API specs are expected at ${CLAUDE_PROJECT_DIR}/.prism/api-specs/*_openapi.{json,yaml,yml} pattern for data source discovery _(api-specs, openapi, prism, file-patterns)_

### ⚠️ Anti-patterns

- When using the remember tool, it saves learnings to the current working directory's project_path. Be careful not to save learnings about other projects while working in code-agent-insights directory - verify the learning is actually relevant to the current project before saving with scope=project. _(remember-tool, mcp, project-attribution, learnings)_

<!-- code-agent-insights:end -->
