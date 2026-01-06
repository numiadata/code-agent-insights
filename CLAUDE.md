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

**Phase 1**: Core + CLI with search, stats, and feature tracking

## Future Phases

- **Phase 2**: MCP server for in-session recall/remember
- **Phase 3**: Git commit correlation
- **Phase 4**: CI/CD outcome tracking
- **Phase 5**: Team sync and manager dashboards