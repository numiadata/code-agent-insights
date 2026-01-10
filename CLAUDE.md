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

---

<!-- code-agent-insights:start -->
## Learnings from Past Sessions

> Auto-generated by code-agent-insights. Last synced: 2026-01-10
> 56 learnings from past coding sessions.

### 🔧 Fixes

- When checking if a session needs reindexing, always add a tolerance (5 seconds) to account for filesystem write delays. The file modification time can be slightly after the session's ended_at timestamp (e.g., 157ms) due to OS filesystem buffering. Without tolerance, sessions appear "modified" and get skipped by the indexer. _(timestamp, filesystem, indexing, reindexing, tolerance)_
- To fix path mismatches in learnings database, use: UPDATE learnings SET project_path = '/actual/project/path' WHERE project_path = '/Users/username/.claude/projects/-actual-project-path'. This normalizes extracted learnings to match paths used by cai sync. _(database, sql, path-normalization, maintenance)_
- Learnings stored with project_path from session directories (/Users/rafa/.claude/projects/-Users-rafa-Documents-...) don't match actual project paths (/Users/rafa/Documents/...) used by cai sync. Normalize paths to actual project directories when storing learnings to ensure sync finds them correctly. _(database, sync, project-paths, learnings, path-normalization)_
- When deleting database records with foreign key constraints, respect dependency order: delete child records before parents. For example, tool_calls references events, so DELETE FROM tool_calls must happen before DELETE FROM events to avoid FK constraint failures. _(database, foreign-keys, sqlite, deletion-order, constraints)_
- MCP servers must be configured in ~/.claude.json (not ~/.claude/mcp_servers.json). Use 'claude mcp add --transport stdio <name> -- node /path/to/server.js' to register them correctly. The invalid mcp_servers.json location will be silently ignored and tools won't load. _(mcp, configuration, claude-code, debugging, troubleshooting)_
- Claude Code uses `.mcp.json` in project root for MCP server configuration, NOT `~/.claude/mcp_servers.json` (which is for Claude Desktop). The file must be in project root and session must be restarted to load new MCP servers. _(claude-code, mcp, configuration, server-discovery)_
- When implementing MCP server tools with TypeScript, add 'uuid' package dependency to package.json and ensure it's available in the build environment. The MCP server will fail at runtime if uuid is imported but not properly installed as a dependency. _(mcp, typescript, dependencies, uuid)_
- MCP server executable files (dist/index.js) need executable permissions (chmod +x) to work with Claude Code, even when using absolute paths in configuration. _(mcp, permissions, executable, chmod)_
- When event IDs are generated using array indices for chart tooltips and UI cards, they can mismatch if the arrays are different (e.g., filteredEvents vs eventsByCategory[category]). Remove the index from ID generation to use consistent identifiers like `event.date + event.title` instead of `event.date + event.title + index`. _(event-handling, chart-interaction, array-indices, id-generation)_
- When creating pandas tables for markdown reports, use `tabulate(df.values, headers=df.columns, tablefmt='pipe', maxcolwidths=[None])` to prevent address truncation instead of relying on pandas display options which still truncate long strings _(pandas, tabulate, markdown, string-truncation)_
- When making paginated API requests with requests.get(), use the params parameter for automatic URL encoding instead of manually building query strings. Manual f-string URL construction fails with complex pagination keys containing special characters like '+' and '/'. _(requests, pagination, url-encoding, api)_
- ClickHouse table names with dots (like blockchain.dydx_mainnet_1.table_name) can cause syntax errors - use backticks around the full table name or check if the actual table name is different (e.g., just 'dydx_mainnet_1_raw_address_balances' instead of 'blockchain.dydx_mainnet_1.dydx_mainnet_1_raw_address_balances') _(clickhouse, sql, table-names, syntax-error)_
- When ClickHouse error says 'Maybe you meant: [column_name]', the actual column name is different from what you're querying - always check table schema first with DESCRIBE or SHOW CREATE TABLE _(clickhouse, debugging, column-names)_
- Playwright NameError 'Page is not defined' indicates a broken installation or version mismatch. This can occur even when pages load successfully, causing browser crashes during operation. _(playwright, browser-automation, installation)_
- For config file errors like 'Config file not found: {args.config_file}', use proper string formatting. The literal '{args.config_file}' suggests f-string or .format() wasn't used. _(python, string-formatting, error-handling)_
- Claude CLI 'claude auth status' command may be intercepted by hooks or configuration that prevents direct execution, requiring alternative methods to check account status _(claude-cli, authentication, debugging)_
- Claude Code sessions are stored as .jsonl files directly in project directories (~/.claude/projects/*/*.jsonl), not in sessions subdirectories as originally assumed. The session discovery pattern needs to be updated from 'projects/*/sessions/*.json' to 'projects/*/*.jsonl'. _(claude-code, file-discovery, session-parsing, jsonl)_
- PNPM blocks build scripts by default. When encountering native binding compilation issues with packages like better-sqlite3, add 'enable-pre-post-scripts=true' to .npmrc to allow installation scripts to run. _(pnpm, native-bindings, better-sqlite3, build-scripts)_
- When using PNPM link for CLI tools, the binary location may not be in PATH. Check pnpm root directory with 'pnpm root -g' and use full path '/Users/username/Library/pnpm/binary-name' if the linked command isn't found. _(pnpm, cli-linking, path, binary-location)_
- pnpm blocks build scripts by default - create .npmrc with 'enable-pre-post-scripts=true' to allow native module compilation for packages like better-sqlite3 _(pnpm, native-modules, build-scripts, npmrc)_
- better-sqlite3 v9.6.0 has native binding compilation issues with Node v22.14.0 on macOS ARM64 - upgrade to v12.5.0 which compiles successfully _(better-sqlite3, node-version, macos-arm64, native-bindings)_

### ✨ Patterns

- Next.js Image component with missing files: Add conditional rendering {story.image && ...} and unoptimized prop to prevent errors. Keep image paths empty ("") until assets are ready, using gradient backgrounds as fallback. _(nextjs, images, error-handling)_
- To find foreign key constraint issues in SQLite, use: 1) PRAGMA foreign_key_list(table_name) to see FK relationships, 2) .schema to examine table definitions, 3) Test deletion order manually in sqlite3 CLI before implementing in code _(sqlite, debugging, foreign-keys, database-troubleshooting)_
- When operations fail silently, add detailed error logging with a --verbose flag. Catching errors without logging their messages (catch { errorCount++ }) makes debugging impossible. Always capture error messages: catch (error) { errorCount++; errorMap.set(key, error.message); } _(error-handling, logging, debugging, verbose-mode, cli)_
- Wrap database operations in transactions for atomicity. Use db.transaction() to ensure all inserts/deletes succeed or fail together, preventing partial data corruption. This is especially important during reindexing where you delete and recreate records. _(database, transactions, atomicity, better-sqlite3, data-integrity)_
- When reindexing sessions, preserve learnings by setting their session_id to NULL instead of deleting them. This maintains extracted knowledge while allowing the parent session to be deleted and recreated. Use UPDATE learnings SET session_id = NULL WHERE session_id = ? before DELETE FROM sessions. _(database, learnings, reindexing, data-preservation, foreign-keys)_
- MCP servers configured in ~/.claude/mcp_servers.json only load when starting a NEW Claude Code session, not in existing sessions. The server must be restarted after config changes. _(mcp, claude-code, server-loading, session-restart)_
- To verify MCP tools are loaded in Claude Code, ask 'What MCP tools do you have available?' - custom tools should appear alongside built-in tools like mcp__ide__getDiagnostics and mcp__ide__executeCode _(mcp, debugging, verification, tool-loading)_
- When describing MCP tools, distinguish between tools defined in codebase vs tools actually available in current session - checking actual tool availability prevents user confusion _(mcp, communication, debugging)_
- MCP server tools appear with prefix pattern `mcp__<server-name>__<tool-name>` in Claude sessions. If expected tools don't appear, check server registration and config file location rather than tool implementation first. _(mcp, debugging, tool-discovery, naming-convention)_
- When implementing MCP tools that return large datasets, structure results with clear groupings (by type/category) and include metadata like confidence scores, application counts, and context information to make results more actionable for the AI agent. _(mcp, data-structure, user-experience, large-datasets)_
- MCP server tools require Claude Code restart after configuration changes. The config at ~/.claude/mcp_servers.json is only loaded at application startup, not dynamically. _(mcp, claude-code, configuration, restart-required)_
- Tailwind CSS selector `[&_*]:!text-danger` targets all child elements within a component and overrides text colors with !important flag _(tailwind, css, selector, text-color, override)_
- Clerk warning 'Clerk has been loaded with development keys. Development instances have strict usage limits...' is informational, not an error. Development keys (pk_test_*, sk_test_*) are expected in local development and the warning doesn't prevent functionality like user invitations from working. _(clerk, authentication, development, warnings)_
- For large dataset analysis without context pollution, use `df.head(n)` and `df.sample(n)` to explore structure, then build analysis functions that work on filtered subsets rather than loading full data into LLM context _(data-analysis, context-management, pandas)_
- When generating behavior descriptions from raw data, create a lookup function that processes addresses in batches and uses vectorized pandas operations instead of iterating through the full dataset for each address _(pandas, performance, batch-processing)_
- When building multi-section analytical reports, structure generation as: 1) collect all unique addresses across tables, 2) generate comprehensive profiles once, 3) reuse profiles across sections to avoid redundant data processing _(report-generation, data-processing, optimization)_
- ClickHouse ROW_NUMBER() window functions may not work in older versions - use argMax() or QUALIFY clause as alternatives for getting latest records per group _(clickhouse, sql, window-functions, argmax)_
- ClickHouse arrayJoin(argMaxMerge(labels)) pattern can be used to extract and flatten array labels from aggregated data, useful for left joining label data with main datasets _(clickhouse, arrayjoin, argmaxmerge, labels)_
- When working with CSV datasets for analysis, read only header row and first 3-5 data rows to understand structure before planning full analysis. This prevents loading large datasets unnecessarily into context while still getting complete column understanding. _(csv, data-analysis, performance, context-management)_
- E-commerce sites like BRAUN Hamburg can return HTTP 404 status but still serve content. Don't rely solely on status codes for scraping success determination. _(web-scraping, http-status, ecommerce)_
- When Playwright finds product elements (119 found) but parser extracts 0 products, the issue is parser logic not page loading. Separate element detection from data extraction debugging. _(playwright, debugging, parsing)_
- tsup build command 'tsup src/index.ts --format cjs,esm --dts' generates both CommonJS and ESM outputs with TypeScript declarations in a single command _(tsup, build, dual-package, typescript)_
- Claude Code uses JSONL format (newline-delimited JSON) natively. Each line is a separate JSON object representing different event types: 'summary', 'file-history-snapshot', 'user', 'assistant', etc. Parser must handle line-by-line parsing rather than expecting single JSON object. _(jsonl, claude-code, session-format, parsing)_
- When building multi-package TypeScript projects with tsup, use workspace dependencies 'workspace:*' to ensure proper build order and avoid version conflicts _(pnpm-workspaces, tsup, typescript, monorepo)_

### 📏 Conventions

- Test learning: Always use pnpm test for running tests _(testing, pnpm)_
- Prefer TypeScript over JavaScript for this project. All new code should be written in TypeScript (.ts files) rather than JavaScript (.js files). _(typescript, javascript, language-preference, code-style)_
- MCP servers only load at Claude Code startup - any MCP configuration changes require restarting Claude Code entirely, not just reloading files _(mcp, claude-code, startup, configuration)_
- Claude Code MCP server registration requires absolute path in command args when using node directly: {'command': 'node', 'args': ['/full/path/to/dist/index.js']} rather than relying on global npm linking which may not work reliably. _(claude-code, mcp, configuration, absolute-paths)_
- MCP server configuration file for Claude Code should be placed at ~/.claude/mcp_servers.json with structure {'mcpServers': {'server-name': {'command': '...', 'args': [...], 'env': {}}}}. Claude Code must be restarted after configuration changes. _(claude-code, mcp, configuration, restart-required)_
- When MCP server is properly registered, tools appear with naming pattern: mcp__<server-name>__<tool-name> (e.g., mcp__code-agent-insights__recall) _(mcp, naming-convention, tool-names)_
- Clerk development instances have usage limits (typically 100 MAUs) which is why they show usage warnings when loaded, even in development environments. _(clerk, limits, development, mau)_
- pnpm monorepo initialization requires pnpm-workspace.yaml with packages: ['packages/*'] format, not the flat array format that npm workspaces use _(pnpm, monorepo, workspace, configuration)_
- TypeScript 5.x with NodeNext module resolution requires both 'module: NodeNext' and 'moduleResolution: NodeNext' in tsconfig.json for proper ESM/CJS interop _(typescript, esm, nodejs, module-resolution)_
- API specs are expected at ${CLAUDE_PROJECT_DIR}/.prism/api-specs/*_openapi.{json,yaml,yml} pattern for data source discovery _(api-specs, openapi, prism, file-patterns)_

### ⚠️ Anti-patterns

- When using the remember tool, it saves learnings to the current working directory's project_path. Be careful not to save learnings about other projects while working in code-agent-insights directory - verify the learning is actually relevant to the current project before saving with scope=project. _(remember-tool, mcp, project-attribution, learnings)_

<!-- code-agent-insights:end -->