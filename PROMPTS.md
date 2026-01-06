# Code Agent Insights — Build Prompts for Claude Code

This file contains all the prompts to build code-agent-insights step by step in Claude Code.

## How to Use

1. Start Claude Code in your project directory: `claude`
2. Copy and paste each prompt in order
3. Wait for Claude to complete before moving to the next prompt
4. Test after each major phase

---

## Phase 1A: Project Setup

### Prompt 1 — Initialize Monorepo
```
Initialize a pnpm monorepo for code-agent-insights:

1. Create pnpm-workspace.yaml:
   packages:
     - 'packages/*'

2. Create root package.json:
   - name: "code-agent-insights"
   - private: true
   - scripts: build, dev, test (all run pnpm -r <command>)
   - devDependencies: typescript ^5.4.0, tsup ^8.0.0, vitest ^1.4.0

3. Create root tsconfig.json:
   - target: ES2022
   - module: NodeNext
   - moduleResolution: NodeNext
   - strict: true
   - esModuleInterop: true
   - skipLibCheck: true
   - declaration: true

4. Create .gitignore:
   node_modules/
   dist/
   *.db
   .env
   .DS_Store
   *.log

5. Create folder structure:
   - packages/core/
   - packages/cli/
   - packages/extractor/
   - scripts/

Run pnpm install after creating the files.
```

---

## Phase 1B: Core Package — Types

### Prompt 2 — Create All Types
```
In packages/core, create the type definitions.

First, create packages/core/package.json:
- name: "@code-agent-insights/core"
- version: "0.1.0"
- main: "./dist/index.js"
- types: "./dist/index.d.ts"
- scripts: build (tsup src/index.ts --format cjs,esm --dts)
- dependencies: better-sqlite3 ^9.4.0, glob ^10.3.0, zod ^3.22.0, uuid ^9.0.0
- devDependencies: @types/better-sqlite3 ^7.6.0, @types/node ^20.0.0, @types/uuid ^9.0.0

Then create packages/core/src/types/index.ts with these Zod schemas and inferred types:

1. SessionStatus: enum ['completed', 'abandoned', 'error', 'in_progress']

2. SessionSource: enum ['claude_code', 'cursor', 'vscode']

3. Session: {
   id: string (uuid),
   source: SessionSource,
   projectPath: string,
   projectName: string,
   gitBranch: string (optional),
   gitUser: string (optional),
   startedAt: date,
   endedAt: date (optional),
   status: SessionStatus,
   tokenCount: number (default 0),
   turnCount: number (default 0),
   toolCallCount: number (default 0),
   errorCount: number (default 0),
   filesModified: number (default 0),
   rawPath: string,
   summary: string (optional),
   outcome: enum ['success', 'partial', 'failure', 'unknown'] (default 'unknown'),
   skillInvocationCount: number (default 0),
   subAgentCount: number (default 0),
   usedPlanMode: boolean (default false),
   usedThinking: boolean (default false),
   primaryTools: array of strings (default [])
}

4. EventType: enum ['user_message', 'assistant_message', 'tool_call', 'tool_result', 'error', 'file_read', 'file_write', 'file_create', 'command_execute', 'thinking']

5. Event: {
   id: string (uuid),
   sessionId: string (uuid),
   type: EventType,
   timestamp: date,
   sequenceNumber: number,
   content: string (optional),
   metadata: record of unknown (optional)
}

6. ToolCall: {
   id: string (uuid),
   sessionId: string (uuid),
   eventId: string (uuid),
   toolName: string,
   parameters: record of unknown,
   result: string (optional),
   success: boolean,
   durationMs: number (optional),
   timestamp: date
}

7. ErrorRecord: {
   id: string (uuid),
   sessionId: string (uuid),
   eventId: string (uuid),
   errorType: string,
   errorMessage: string,
   stackTrace: string (optional),
   filePath: string (optional),
   lineNumber: number (optional),
   resolved: boolean (default false),
   resolutionEventId: string uuid (optional),
   timestamp: date
}

8. LearningType: enum ['pattern', 'antipattern', 'convention', 'fix', 'preference', 'context']

9. LearningScope: enum ['global', 'project', 'file', 'language']

10. LearningSource: enum ['extracted', 'explicit']

11. Learning: {
    id: string (uuid),
    sessionId: string uuid (optional),
    projectPath: string (optional),
    content: string,
    type: LearningType,
    scope: LearningScope (default 'project'),
    confidence: number 0-1 (default 1),
    tags: array of strings (default []),
    relatedFiles: array of strings (default []),
    relatedErrors: array of strings (default []),
    source: LearningSource,
    appliedCount: number (default 0),
    lastAppliedAt: date (optional),
    createdAt: date
}

12. SkillCategory: enum ['public', 'user', 'example']

13. SkillInvocation: {
    id: string (uuid),
    sessionId: string (uuid),
    skillPath: string,
    skillName: string,
    skillCategory: SkillCategory,
    invokedAt: date,
    sequenceNumber: number,
    contextBefore: string (optional)
}

14. SubAgentInvocation: {
    id: string (uuid),
    sessionId: string (uuid),
    parentEventId: string (uuid),
    taskDescription: string,
    toolsAllowed: array of strings (default []),
    startedAt: date,
    endedAt: date (optional),
    tokenCount: number (default 0),
    turnCount: number (default 0),
    outcome: enum ['success', 'partial', 'failure', 'unknown'] (default 'unknown'),
    resultSummary: string (optional)
}

15. ToolSequence: {
    id: string (uuid),
    sessionId: string (uuid),
    tools: array of strings,
    startedAt: date,
    endedAt: date,
    success: boolean,
    taskType: string (optional)
}

16. SessionModes: {
    sessionId: string (uuid),
    usedPlanMode: boolean (default false),
    planModeCount: number (default 0),
    usedThinking: boolean (default false),
    thinkingBlockCount: number (default 0),
    usedCompact: boolean (default false),
    usedSubAgents: boolean (default false),
    subAgentCount: number (default 0),
    skillsUsed: array of strings (default [])
}

Export both the Zod schemas (with Schema suffix) and the inferred TypeScript types.
```

---

## Phase 1C: Core Package — Session Parser

### Prompt 3 — Claude Code Session Parser
```
Create packages/core/src/ingestion/parsers/claude-code.ts with a ClaudeCodeParser class:

Import types from '../../types' and use uuid v4 for ID generation.

Define internal interfaces for raw message parsing:
- RawMessage: { role: 'user' | 'assistant', content: string | ContentBlock[], timestamp?: string }
- ContentBlock: { type: 'text' | 'tool_use' | 'tool_result' | 'thinking', text?: string, name?: string, id?: string, input?: Record<string, unknown>, content?: string, thinking?: string }

Define ParsedSession interface: { session, events, toolCalls, errors, skillInvocations, subAgentInvocations, toolSequences, sessionModes }

Class ClaudeCodeParser:

Constructor:
- Accept optional claudeDir parameter, default to path.join(process.env.HOME || '', '.claude')

Method discoverSessions(): Promise<string[]>
- Use glob to find all JSON files matching: ~/.claude/projects/*/sessions/*.json
- Return array of file paths

Method parseSession(sessionPath: string): Promise<ParsedSession>
1. Read and parse the JSON file
2. Handle both formats: direct array of messages OR { messages: [...] }
3. Initialize arrays for events, toolCalls, errors, skillInvocations, subAgentInvocations
4. Initialize sequenceNumber = 0

5. For each message, get timestamp (or use Date.now()):
   - If content is string: create user_message or assistant_message event
   - If content is array of ContentBlocks, parse each block:
     
     For 'text' blocks:
     - Create assistant_message event with the text
     
     For 'thinking' blocks:
     - Create thinking event with the thinking content
     
     For 'tool_use' blocks:
     - Create tool_call event
     - Create ToolCall record
     - Check if it's a skill invocation:
       - If toolName is 'view' AND input.path starts with '/mnt/skills/'
       - Extract skillName from path (last directory name before SKILL.md)
       - Determine category: 'public' if path contains '/public/', 'user' if '/user/', else 'example'
       - Create SkillInvocation record
     - Check if it's a sub-agent:
       - If toolName is 'task' or 'dispatch_agent'
       - Create SubAgentInvocation with taskDescription from input.description or input.prompt
       - Extract toolsAllowed from input.allowed_tools if present
     - Check if it's a file operation:
       - If toolName is 'view', 'str_replace', or 'create_file'
       - Create appropriate file event (file_read, file_write, file_create)
     - Check if it's a command:
       - If toolName is 'bash_tool' or 'bash'
       - Create command_execute event
     
     For 'tool_result' blocks:
     - Create tool_result event
     - Extract errors using regex patterns:
       - /Error: (.+)/g → 'Error'
       - /TypeError: (.+)/g → 'TypeError'
       - /SyntaxError: (.+)/g → 'SyntaxError'
       - /ReferenceError: (.+)/g → 'ReferenceError'
       - /npm ERR! (.+)/g → 'npm'
       - /error\[E\d+\]: (.+)/g → 'Rust'
       - /FAILED (.+)/g → 'Test'
       - /Exception: (.+)/g → 'Exception'
     - Create ErrorRecord for each match

6. Detect modes:
   - usedPlanMode: any user_message contains '/plan' (case insensitive)
   - planModeCount: count of '/plan' occurrences
   - usedThinking: any thinking events exist
   - thinkingBlockCount: count of thinking events
   - usedCompact: any user_message contains '/compact'

7. Extract tool sequences:
   - Group consecutive tool calls (max 5 per sequence)
   - Create ToolSequence records

8. Calculate session stats:
   - tokenCount: estimate as total character count / 4
   - turnCount: count of user messages
   - toolCallCount: toolCalls.length
   - errorCount: errors.length
   - filesModified: count unique file paths from str_replace and create_file calls
   - skillInvocationCount: skillInvocations.length
   - subAgentCount: subAgentInvocations.length
   - primaryTools: top 3 most used tool names

9. Infer outcome:
   - 'success' if: has commit-related content AND no unresolved errors
   - 'failure' if: more than 3 unresolved errors
   - 'partial' if: some unresolved errors
   - 'unknown' otherwise

10. Extract project info from path:
    - projectHash from path structure
    - Try to load project info from ~/.claude/projects/{hash}/.project_info

11. Create Session object with all fields

12. Create SessionModes object

13. Return { session, events, toolCalls, errors, skillInvocations, subAgentInvocations, toolSequences, sessionModes }

Helper methods:
- extractProjectHash(sessionPath): extract project hash from path
- loadProjectInfo(projectHash): try to read .project_info JSON
- inferProjectPath(sessionPath): fallback path inference
- estimateTokens(messages): character count / 4
- countFilesModified(toolCalls): count unique paths
- getTopTools(toolCalls, n): return top n tool names by frequency
```

---

## Phase 1D: Core Package — Database

### Prompt 4 — SQLite Database Layer
Create packages/core/src/storage/database.ts with an InsightsDatabase class using better-sqlite3:
Constructor:

Accept optional dbPath parameter
Default data directory: ~/.code-agent-insights/
Create directory if not exists
Open database with WAL mode pragma
Run migrations

Migrations array (execute in order):
Migration 1 - Core tables:
sqlCREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  project_path TEXT NOT NULL,
  project_name TEXT,
  git_branch TEXT,
  git_user TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT DEFAULT 'completed',
  token_count INTEGER DEFAULT 0,
  turn_count INTEGER DEFAULT 0,
  tool_call_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  files_modified INTEGER DEFAULT 0,
  raw_path TEXT UNIQUE,
  summary TEXT,
  outcome TEXT DEFAULT 'unknown',
  skill_invocation_count INTEGER DEFAULT 0,
  sub_agent_count INTEGER DEFAULT 0,
  used_plan_mode INTEGER DEFAULT 0,
  used_thinking INTEGER DEFAULT 0,
  primary_tools TEXT DEFAULT '[]',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_source ON sessions(source);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  sequence_number REAL NOT NULL,
  content TEXT,
  metadata TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  event_id TEXT,
  tool_name TEXT NOT NULL,
  parameters TEXT,
  result TEXT,
  success INTEGER DEFAULT 1,
  duration_ms INTEGER,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id),
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_name ON tool_calls(tool_name);

CREATE TABLE IF NOT EXISTS errors (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  event_id TEXT,
  error_type TEXT,
  error_message TEXT,
  stack_trace TEXT,
  file_path TEXT,
  line_number INTEGER,
  resolved INTEGER DEFAULT 0,
  resolution_event_id TEXT,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_errors_session ON errors(session_id);
CREATE INDEX IF NOT EXISTS idx_errors_type ON errors(error_type);

CREATE TABLE IF NOT EXISTS learnings (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  project_path TEXT,
  content TEXT NOT NULL,
  type TEXT NOT NULL,
  scope TEXT DEFAULT 'project',
  confidence REAL DEFAULT 1.0,
  tags TEXT DEFAULT '[]',
  related_files TEXT DEFAULT '[]',
  related_errors TEXT DEFAULT '[]',
  source TEXT DEFAULT 'extracted',
  applied_count INTEGER DEFAULT 0,
  last_applied_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_learnings_project ON learnings(project_path);
CREATE INDEX IF NOT EXISTS idx_learnings_type ON learnings(type);

-- FTS tables
CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
  content,
  session_id UNINDEXED,
  event_id UNINDEXED
);

CREATE VIRTUAL TABLE IF NOT EXISTS learnings_fts USING fts5(
  content,
  tags,
  learning_id UNINDEXED
);
Migration 2 - Feature tracking tables:
sqlCREATE TABLE IF NOT EXISTS skill_invocations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  skill_path TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  skill_category TEXT NOT NULL,
  invoked_at TEXT NOT NULL,
  sequence_number INTEGER,
  context_before TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_skill_invocations_session ON skill_invocations(session_id);
CREATE INDEX IF NOT EXISTS idx_skill_invocations_name ON skill_invocations(skill_name);

CREATE TABLE IF NOT EXISTS sub_agent_invocations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  parent_event_id TEXT,
  task_description TEXT,
  tools_allowed TEXT DEFAULT '[]',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  token_count INTEGER DEFAULT 0,
  turn_count INTEGER DEFAULT 0,
  outcome TEXT DEFAULT 'unknown',
  result_summary TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_sub_agent_session ON sub_agent_invocations(session_id);
CREATE INDEX IF NOT EXISTS idx_sub_agent_outcome ON sub_agent_invocations(outcome);

CREATE TABLE IF NOT EXISTS tool_sequences (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  tools TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  success INTEGER DEFAULT 1,
  task_type TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_tool_sequences_session ON tool_sequences(session_id);

CREATE TABLE IF NOT EXISTS session_modes (
  session_id TEXT PRIMARY KEY,
  used_plan_mode INTEGER DEFAULT 0,
  plan_mode_count INTEGER DEFAULT 0,
  used_thinking INTEGER DEFAULT 0,
  thinking_block_count INTEGER DEFAULT 0,
  used_compact INTEGER DEFAULT 0,
  used_sub_agents INTEGER DEFAULT 0,
  sub_agent_count INTEGER DEFAULT 0,
  skills_used TEXT DEFAULT '[]',
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

INSERT OR IGNORE INTO schema_version (version) VALUES (2);
```

Methods to implement:

Session methods:
- insertSession(session: Session): void
- getSession(id: string): Session | null
- sessionExists(rawPath: string): boolean
- getSessions(options: { projectPath?, source?, limit?, offset? }): Session[]
- updateSessionSummary(id: string, summary: string, outcome: string): void

Event methods:
- insertEvents(events: Event[]): void — use transaction, also insert into FTS
- getEvents(sessionId: string): Event[]

Tool call methods:
- insertToolCalls(toolCalls: ToolCall[]): void — use transaction
- getToolCalls(sessionId: string): ToolCall[]

Error methods:
- insertErrors(errors: ErrorRecord[]): void — use transaction
- getErrors(sessionId: string): ErrorRecord[]

Learning methods:
- insertLearning(learning: Learning): void — also insert into FTS
- getLearnings(options: { projectPath?, type?, limit? }): Learning[]
- incrementLearningApplied(id: string): void

Feature tracking methods:
- insertSkillInvocations(invocations: SkillInvocation[]): void
- insertSubAgentInvocations(invocations: SubAgentInvocation[]): void
- insertToolSequences(sequences: ToolSequence[]): void
- insertSessionModes(modes: SessionModes): void

Search methods:
- searchEvents(query: string, options: { sessionId?, limit? }): Event[]
- searchLearnings(query: string, options: { projectPath?, limit? }): Learning[]

Stats methods:
- getStats(): { totalSessions, totalTokens, totalErrors, totalLearnings, sessionsBySource, sessionsByOutcome }
- getSkillStats(): { skillName, usageCount, successRate }[]
- getSubAgentStats(): { outcome, count, avgTokens }[]
- getToolPatternStats(): { tools, count, successRate }[]
- getModeEffectiveness(): { mode, withMode: { success, total }, withoutMode: { success, total } }[]

Utility:
- close(): void

Helper methods for row-to-type conversions (snake_case to camelCase, parse JSON fields, parse dates).
```

---

## Phase 1E: Core Package — Exports

### Prompt 5 — Package Exports and Build
```
1. Create packages/core/src/index.ts that exports:
   - All types from './types'
   - ClaudeCodeParser from './ingestion/parsers/claude-code'
   - InsightsDatabase from './storage/database'

2. Create packages/core/tsconfig.json:
   {
     "extends": "../../tsconfig.json",
     "compilerOptions": {
       "outDir": "./dist",
       "rootDir": "./src"
     },
     "include": ["src/**/*"]
   }

3. Test the build:
   cd packages/core && pnpm build

Fix any TypeScript errors that appear.
```

---

## Phase 1F: CLI Package — Setup

### Prompt 6 — CLI Package Initialization
```
Create packages/cli:

1. packages/cli/package.json:
   - name: "code-agent-insights"
   - version: "0.1.0"
   - bin: { "cai": "./dist/index.js" }
   - main: "./dist/index.js"
   - scripts: 
     - build: tsup src/index.ts --format cjs --dts
     - dev: tsup src/index.ts --format cjs --watch
   - dependencies:
     - @code-agent-insights/core: workspace:*
     - @anthropic-ai/sdk: ^0.25.0
     - commander: ^12.0.0
     - chalk: ^5.3.0
     - ora: ^8.0.0
     - cli-table3: ^0.6.0
   - devDependencies:
     - @types/node: ^20.0.0

2. packages/cli/tsconfig.json extending root

3. packages/cli/src/index.ts:
   #!/usr/bin/env node
   
   Import Command from commander.
   Create program with:
   - name: 'cai'
   - description: 'Code Agent Insights - Analytics and memory for coding agents'
   - version: '0.1.0'
   
   Import and add commands:
   - indexCommand from './commands/index-cmd'
   - searchCommand from './commands/search'
   - statsCommand from './commands/stats'
   - learnCommand from './commands/learn'
   - recommendCommand from './commands/recommend'
   
   Call program.parse()

4. Create placeholder files for each command in src/commands/:
   - index-cmd.ts (export indexCommand)
   - search.ts (export searchCommand)
   - stats.ts (export statsCommand)
   - learn.ts (export learnCommand)
   - recommend.ts (export recommendCommand)
   
   Each should export a Command that logs "Not implemented yet" for now.
```

---

## Phase 1G: CLI — Index Command

### Prompt 7 — Implement Index Command
```
Implement packages/cli/src/commands/index-cmd.ts:

Import:
- Command from 'commander'
- ora for spinners
- chalk for colors
- ClaudeCodeParser, InsightsDatabase from '@code-agent-insights/core'
- spawn from 'child_process'

Export indexCommand as new Command('index'):
- description: 'Index coding agent sessions'
- option: -s, --source <source> — Source to index (claude_code, cursor, all), default 'all'
- option: --embed — Generate embeddings after indexing
- option: --extract — Extract learnings after indexing (requires ANTHROPIC_API_KEY)

Action handler (async):
1. Create spinner with 'Discovering sessions...'
2. Instantiate InsightsDatabase and ClaudeCodeParser
3. Call parser.discoverSessions()
4. spinner.succeed with count

5. Filter out already indexed: sessionPaths.filter(p => !db.sessionExists(p))
6. If no new sessions, log yellow message and return

7. Log blue message: "Indexing {count} new sessions..."

8. Loop through new session paths:
   - Wrap in try/catch
   - Call parser.parseSession(path)
   - Insert: session, events, toolCalls, errors
   - Insert: skillInvocations, subAgentInvocations, toolSequences, sessionModes
   - Increment success counter
   - Log progress: process.stdout.write(`\r  Indexed: ${count}/${total}`)
   - On error: increment error counter, continue

9. Log newline, then green success message
10. If errors > 0, log yellow warning

11. If options.embed:
    - Log blue "Generating embeddings..."
    - Spawn: 'cai-extract embed --type all'
    - Wait for completion

12. If options.extract:
    - Check process.env.ANTHROPIC_API_KEY
    - If not set, log yellow skip message
    - Else log blue "Extracting learnings..." and spawn 'cai-extract extract --all'

13. Close database in finally block

Helper function runPythonCommand(args: string[]): Promise<void>
- Spawn 'cai-extract' with args
- Return promise that resolves on close code 0, rejects otherwise
```

---

## Phase 1H: CLI — Search Command

### Prompt 8 — Implement Search Command
```
Implement packages/cli/src/commands/search.ts:

Import:
- Command from 'commander'
- chalk for colors
- ora for spinner
- InsightsDatabase from '@code-agent-insights/core'
- Anthropic from '@anthropic-ai/sdk'

Export searchCommand as new Command('search'):
- argument: <query> — Search query
- option: -n, --limit <number> — Max results, default '10'
- option: --summarize — Generate AI summary of findings
- option: -p, --project <path> — Filter by project path

Action handler (async, query, options):
1. Instantiate InsightsDatabase
2. Parse limit as integer

3. Log blue: "Searching for: "{query}""

4. Search learnings:
   const learnings = db.searchLearnings(query, { projectPath: options.project, limit })

5. Search events:
   const events = db.searchEvents(query, { limit })

6. Get unique sessions from events:
   const sessionIds = [...new Set(events.map(e => e.sessionId))]
   const sessions = sessionIds.map(id => db.getSession(id)).filter(Boolean)

7. Display learnings if any:
   - Header: chalk.green.bold(`📚 Learnings (${learnings.length}):`)
   - For each learning:
     - chalk.cyan(`[${learning.type}]`) + learning.content
     - If tags: chalk.dim(`Tags: ${tags.join(', ')}`)
     - Empty line between

8. Display sessions if any:
   - Header: chalk.green.bold(`📁 Related Sessions (${sessions.length}):`)
   - For each session:
     - chalk.cyan(session.projectName || 'Unknown')
     - chalk.dim with date, turnCount, outcome
     - Summary if exists
     - Show skill/mode info if present:
       - If skillInvocationCount > 0: "Skills: {count}"
       - If usedPlanMode: "Used plan mode"
       - If subAgentCount > 0: "Sub-agents: {count}"

9. If no results: chalk.yellow('No results found.')

10. If options.summarize AND process.env.ANTHROPIC_API_KEY:
    - Log blue header: "🤖 AI Summary:"
    - Show spinner "Generating summary..."
    - Call generateSummary(query, learnings, sessions)
    - Stop spinner and display result

11. Close database in finally block

Async function generateSummary(query, learnings, sessions):
- Instantiate Anthropic client
- Build context string with:
  - Query
  - Learnings list (type and content)
  - Sessions list (name, summary, outcome, features used)
- Call messages.create with claude-sonnet-4-20250514
- System: You summarize search results from a coding agent session database
- User prompt: Ask for brief, actionable summary focusing on patterns, solutions, insights
- Return response text
```

---

## Phase 1I: CLI — Stats Command

### Prompt 9 — Implement Stats Command
```
Implement packages/cli/src/commands/stats.ts:

Import:
- Command from 'commander'
- chalk for colors
- Table from 'cli-table3'
- InsightsDatabase from '@code-agent-insights/core'

Export statsCommand as new Command('stats'):
- description: 'Show insights and statistics'
- option: -p, --project <path> — Filter by project
- option: --json — Output as JSON
- option: --skills — Show skill usage breakdown
- option: --tools — Show tool pattern analysis
- option: --agents — Show sub-agent statistics
- option: --modes — Show mode effectiveness

Action handler (async, options):
1. Instantiate InsightsDatabase

2. If options.json and no specific breakdown:
   - Get all stats, output JSON, return

3. Log blue header: "📊 Code Agent Insights"

4. Default view (no specific flag):
   - Get basic stats from db.getStats()
   - Create table with:
     - Total Sessions
     - Total Tokens (format with commas)
     - Total Errors
     - Total Learnings
     - Success Rate (calculate from outcomes)
   - Show breakdown by source
   - Show breakdown by outcome

5. If options.skills:
   - Log cyan subheader: "Skill Usage"
   - Get db.getSkillStats()
   - Create table: Skill Name | Usage Count | Success Rate
   - Show insight: "Sessions using skills have X% success rate vs Y% without"

6. If options.tools:
   - Log cyan subheader: "Tool Patterns"
   - Get db.getToolPatternStats()
   - Create table: Pattern | Count | Success Rate
   - Show top 5 most effective patterns

7. If options.agents:
   - Log cyan subheader: "Sub-agent Usage"
   - Get db.getSubAgentStats()
   - Create table: Outcome | Count | Avg Tokens
   - Calculate and show sub-agent efficiency

8. If options.modes:
   - Log cyan subheader: "Mode Effectiveness"
   - Get db.getModeEffectiveness()
   - Create comparison table:
     - Plan Mode: with vs without success rates
     - Thinking: with vs without success rates
   - Show recommendations based on data

9. Close database in finally block
```

---

## Phase 1J: CLI — Learn Command

### Prompt 10 — Implement Learn Command
```
Implement packages/cli/src/commands/learn.ts:

Import:
- Command from 'commander'
- chalk for colors
- { v4: uuidv4 } from 'uuid'
- InsightsDatabase, Learning from '@code-agent-insights/core'

Export learnCommand as new Command('learn'):
- description: 'Manually add a learning'
- argument: <content> — The learning content
- option: -t, --type <type> — Learning type (pattern|antipattern|convention|fix|preference|context), default 'pattern'
- option: -s, --scope <scope> — Scope (global|project|file|language), default 'project'
- option: --tags <tags> — Comma-separated tags
- option: -p, --project <path> — Project path, default process.cwd()

Action handler (async, content, options):
1. Instantiate InsightsDatabase

2. Parse tags: options.tags ? options.tags.split(',').map(t => t.trim()) : []

3. Validate type is one of the allowed values

4. Create learning object:
   {
     id: uuidv4(),
     content: content,
     type: options.type,
     scope: options.scope,
     confidence: 1.0,
     tags: parsedTags,
     relatedFiles: [],
     relatedErrors: [],
     source: 'explicit',
     appliedCount: 0,
     projectPath: options.project,
     createdAt: new Date()
   }

5. Insert with db.insertLearning(learning)

6. Log success:
   chalk.green('✓') + ` Remembered: ` + chalk.cyan(`[${options.type}]`) + ` ${content}`
   If tags: chalk.dim(`  Tags: ${tags.join(', ')}`)

7. Close database in finally block
```

---

## Phase 1K: CLI — Recommend Command

### Prompt 11 — Implement Recommend Command
```
Implement packages/cli/src/commands/recommend.ts:

Import:
- Command from 'commander'
- chalk for colors
- ora for spinner
- InsightsDatabase from '@code-agent-insights/core'
- Anthropic from '@anthropic-ai/sdk'

Export recommendCommand as new Command('recommend'):
- description: 'Get personalized feature recommendations'
- option: -p, --project <path> — Filter by project

Action handler (async, options):
1. Check for ANTHROPIC_API_KEY, if not set log warning and suggest setting it

2. Instantiate InsightsDatabase

3. Gather stats:
   - basicStats = db.getStats()
   - skillStats = db.getSkillStats()
   - modeStats = db.getModeEffectiveness()
   - toolStats = db.getToolPatternStats()
   - subAgentStats = db.getSubAgentStats()

4. If not enough data (< 5 sessions), log message suggesting to index more first

5. Build analysis context string with all stats

6. Show spinner "Analyzing your patterns..."

7. Call Claude API:
   - Model: claude-sonnet-4-20250514
   - System prompt: You are an expert at helping developers get the most out of Claude Code. Based on usage statistics, provide actionable recommendations.
   - User prompt: Include all stats, ask for 3-5 specific recommendations with reasoning

8. Stop spinner

9. Log blue header: "🎯 Recommendations for You"

10. Display recommendations, formatted nicely

11. Close database in finally block

Include fallback recommendations if API call fails:
- Based on skill usage rate
- Based on plan mode usage
- Based on sub-agent usage
- Based on error rate
```

---

## Phase 1L: Python Extractor — Setup

### Prompt 12 — Python Package Setup
```
Create packages/extractor as a Python package:

1. packages/extractor/pyproject.toml:
   [project]
   name = "code-agent-insights-extractor"
   version = "0.1.0"
   requires-python = ">=3.10"
   dependencies = [
       "sentence-transformers>=2.5.0",
       "anthropic>=0.25.0",
       "numpy>=1.26.0",
       "pydantic>=2.6.0",
   ]
   
   [project.scripts]
   cai-extract = "extractor.cli:main"
   
   [build-system]
   requires = ["hatchling"]
   build-backend = "hatchling.build"

2. Create packages/extractor/extractor/__init__.py (empty file)

3. Create packages/extractor/extractor/embeddings.py:

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
```

---

## Phase 1M: Python Extractor — Learning Extraction

### Prompt 13 — Learning Extractor
```
Create packages/extractor/extractor/learning_extractor.py:

import anthropic
import json
from pydantic import BaseModel

class ExtractedLearning(BaseModel):
    content: str
    type: str
    scope: str
    confidence: float
    tags: list[str]
    related_files: list[str]

class ExtractionResult(BaseModel):
    learnings: list[ExtractedLearning]
    session_summary: str | None
    session_outcome: str

class LearningExtractor:
    SYSTEM_PROMPT = """You extract actionable learnings from coding agent sessions.

For each learning, provide:
- content: A specific, actionable insight (one clear sentence)
- type: pattern | antipattern | convention | fix | preference | context
- scope: global | project | file | language
- confidence: 0.0 to 1.0
- tags: relevant keywords
- related_files: file paths this applies to

Focus on:
- Error resolutions and bug fixes
- Project conventions discovered
- User preferences expressed
- Effective patterns
- Anti-patterns to avoid
- Tool usage insights
- When skills/sub-agents/plan mode helped

Output valid JSON only:
{
  "learnings": [...],
  "session_summary": "One sentence summary",
  "session_outcome": "success" | "partial" | "failure"
}"""

    def __init__(self, api_key: str | None = None, model: str = "claude-sonnet-4-20250514"):
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = model
    
    def extract(self, session_context: str, min_confidence: float = 0.7) -> dict:
        """Extract learnings from session context."""
        response = self.client.messages.create(
            model=self.model,
            max_tokens=2000,
            system=self.SYSTEM_PROMPT,
            messages=[{"role": "user", "content": f"Extract learnings:\n\n{session_context}"}]
        )
        
        text = response.content[0].text
        
        # Clean up potential markdown code blocks
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0]
        elif "```" in text:
            text = text.split("```")[1].split("```")[0]
        
        try:
            result = json.loads(text.strip())
        except json.JSONDecodeError:
            result = {"learnings": [], "session_summary": None, "session_outcome": "unknown"}
        
        # Filter by confidence
        if "learnings" in result:
            result["learnings"] = [
                l for l in result["learnings"]
                if l.get("confidence", 0) >= min_confidence
            ]
        
        return result
    
    def build_session_context(
        self,
        events: list[dict],
        tool_calls: list[dict],
        errors: list[dict],
        skill_invocations: list[dict] = None,
        sub_agents: list[dict] = None,
        modes: dict = None,
        max_chars: int = 32000
    ) -> str:
        """Build context string from session data."""
        parts = []
        
        # Files touched
        files = set()
        for tc in tool_calls:
            params = tc.get("parameters", {})
            if isinstance(params, str):
                try:
                    params = json.loads(params)
                except:
                    params = {}
            if "path" in params:
                files.add(params["path"])
        
        if files:
            parts.append(f"Files touched: {', '.join(sorted(files)[:20])}")
        
        # Errors
        if errors:
            error_msgs = [e.get("error_message", "")[:200] for e in errors[:10]]
            parts.append("Errors:\n" + "\n".join(f"- {m}" for m in error_msgs))
        
        # Tool usage
        tool_counts = {}
        for tc in tool_calls:
            name = tc.get("tool_name", "unknown")
            tool_counts[name] = tool_counts.get(name, 0) + 1
        if tool_counts:
            parts.append(f"Tools: {', '.join(f'{k}({v})' for k, v in sorted(tool_counts.items(), key=lambda x: -x[1])[:10])}")
        
        # Skills used
        if skill_invocations:
            skills = [s.get("skill_name") for s in skill_invocations]
            parts.append(f"Skills used: {', '.join(set(skills))}")
        
        # Sub-agents
        if sub_agents:
            parts.append(f"Sub-agents spawned: {len(sub_agents)}")
            for sa in sub_agents[:3]:
                parts.append(f"  - Task: {sa.get('task_description', '')[:100]}")
        
        # Modes
        if modes:
            mode_info = []
            if modes.get("used_plan_mode"):
                mode_info.append("plan mode")
            if modes.get("used_thinking"):
                mode_info.append(f"thinking ({modes.get('thinking_block_count', 0)} blocks)")
            if mode_info:
                parts.append(f"Modes: {', '.join(mode_info)}")
        
        # Conversation (truncated)
        messages = []
        char_count = sum(len(p) for p in parts)
        char_limit = max_chars - char_count - 500
        
        for event in events:
            if event.get("type") in ("user_message", "assistant_message"):
                content = event.get("content", "")[:1000]
                role = "User" if event["type"] == "user_message" else "Claude"
                msg = f"[{role}]: {content}"
                
                if char_count + len(msg) > char_limit:
                    break
                
                messages.append(msg)
                char_count += len(msg)
        
        if messages:
            parts.append("Conversation:\n" + "\n".join(messages))
        
        return "\n\n".join(parts)
```

---

## Phase 1N: Python Extractor — CLI

### Prompt 14 — Python CLI
```
Create packages/extractor/extractor/cli.py:

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
```

---

## Phase 1O: Build and Test

### Prompt 15 — Final Build and Test
```
Let's build and test everything:

1. From root directory, run:
   pnpm install
   pnpm build

2. Fix any TypeScript compilation errors that appear.

3. For Python package:
   cd packages/extractor
   pip install -e . --break-system-packages
   cd ../..

4. Link the CLI globally (for testing):
   cd packages/cli
   pnpm link --global
   cd ../..

5. Test the CLI:
   cai --help
   cai index --help
   cai search --help
   cai stats --help

6. If there are sessions in ~/.claude, test indexing:
   cai index

7. Check stats:
   cai stats

8. Test search:
   cai search "test"

Report any errors so we can fix them.
```

---

## Quick Reference

After building, here are your main commands:
```bash
# Index sessions
cai index                    # Basic indexing
cai index --embed            # With embeddings
cai index --extract          # With learning extraction (needs ANTHROPIC_API_KEY)

# Search
cai search "auth bug"        # Keyword search
cai search "auth" --summarize  # With AI summary

# Stats
cai stats                    # Overview
cai stats --skills           # Skill usage
cai stats --modes            # Mode effectiveness

# Manual learning
cai learn "Always run tests before commit" -t convention

# Recommendations
cai recommend
```

---

## Troubleshooting

If you encounter issues:

1. **TypeScript errors**: Ask Claude Code to fix them specifically
2. **Import errors**: Check that workspace dependencies are linked
3. **Python errors**: Ensure Python 3.10+ and pip install worked
4. **No sessions found**: Check ~/.claude/projects exists and has sessions
5. **Database errors**: Delete ~/.code-agent-insights and re-index

# Phase 1.5 Prompts — Stabilize & Quality

Use these prompts sequentially in Claude Code to complete Phase 1.5.

---

## Task 1: Add `--since` Flag to Index Command

**Why:** Faster iteration — only index recent sessions instead of re-scanning everything.

```
Add a --since flag to the cai index command.

In packages/cli/src/commands/index-cmd.ts:

1. Add option: --since <date> with description "Only index sessions after this date (YYYY-MM-DD or relative like '7d', '2w', '1m')"

2. Create a helper function parseSinceDate(since: string): Date that handles:
   - ISO date strings: "2025-01-01" → new Date("2025-01-01")
   - Relative days: "7d" → 7 days ago
   - Relative weeks: "2w" → 14 days ago
   - Relative months: "1m" → 30 days ago
   - Invalid input: throw error with helpful message

3. In the action handler, after discovering sessions:
   - If options.since is provided, parse it to a Date
   - Filter sessionPaths to only include files where the file modification time (fs.statSync(path).mtime) is after the since date
   - Log how many sessions were filtered out: "Filtered to X sessions modified after {date}"

4. Update the help text to show examples:
   --since 7d      Only sessions from last 7 days
   --since 2w      Only sessions from last 2 weeks  
   --since 2025-01-01  Only sessions after specific date

Test with: cai index --since 7d
```

---

## Task 2: Add `cai clean` Command

**Why:** Remove low-value and duplicate learnings to keep the database useful.

```
Create a new command: cai clean

Create packages/cli/src/commands/clean.ts:

Command: cai clean
Options:
- --duplicates: Remove duplicate/near-duplicate learnings
- --low-confidence: Remove learnings with confidence below threshold
- --type <type>: Remove all learnings of a specific type (e.g., "context")
- --dry-run: Show what would be removed without actually removing
- --threshold <number>: Confidence threshold for --low-confidence (default: 0.5)

Implementation:

1. For --duplicates:
   - Query all learnings ordered by created_at DESC
   - For each learning, check if a very similar one exists (same type + similar content)
   - Use simple string similarity: if content shares >80% of words, consider duplicate
   - Keep the newer one, mark older for deletion
   - Show: "Found X duplicate learnings"

2. For --low-confidence:
   - Query learnings WHERE confidence < threshold
   - Show count and sample of what will be removed

3. For --type:
   - Query learnings WHERE type = specified_type
   - Useful for bulk removing "context" type learnings

4. For --dry-run:
   - Show what would be removed but don't delete
   - Format: "[type] content... (reason: duplicate|low-confidence|type-filter)"

5. Without --dry-run:
   - Delete from learnings table
   - Delete from learnings_fts table
   - Show: "Removed X learnings"

Add to the CLI in index.ts.

Example usage:
  cai clean --duplicates --dry-run
  cai clean --type context
  cai clean --low-confidence --threshold 0.6
  cai clean --duplicates --low-confidence
```

---

## Task 3: Add `cai review` Command

**Why:** Let users interactively approve/reject/edit learnings for quality control.

```
Create a new command: cai review

Create packages/cli/src/commands/review.ts:

Command: cai review
Options:
- --unreviewed: Only show learnings that haven't been reviewed yet
- --type <type>: Filter by learning type
- --limit <n>: Maximum learnings to review (default: 20)
- -p, --project <path>: Filter by project

This requires a schema update first. Add to database.ts migrations:
- Add column 'reviewed' INTEGER DEFAULT 0 to learnings table
- Add column 'reviewed_at' TEXT to learnings table

Implementation:

1. Query learnings based on filters, ORDER BY created_at DESC

2. For each learning, display:
   ```
   ─────────────────────────────────────
   [fix] (confidence: 0.85)
   
   When event IDs are generated using array indices for chart tooltips 
   and UI cards, they can mismatch if the arrays are different...
   
   Tags: react, events, arrays
   Project: /path/to/project
   Created: 2025-01-03
   ─────────────────────────────────────
   
   (k)eep | (d)elete | (e)dit | (s)kip | (q)uit: 
   ```

3. Handle input:
   - 'k' or 'y': Mark as reviewed (UPDATE learnings SET reviewed = 1, reviewed_at = datetime('now'))
   - 'd' or 'n': Delete the learning
   - 'e': Open simple edit prompt for content, then mark reviewed
   - 's': Skip without marking reviewed
   - 'q': Quit review session

4. Use readline for interactive input (import * as readline from 'readline')

5. After completing or quitting, show summary:
   "Review complete: X kept, Y deleted, Z skipped"

Add to the CLI in index.ts.

Example usage:
  cai review
  cai review --unreviewed --limit 50
  cai review --type context
```

---

## Task 4: Fix Parser Edge Cases

**Why:** Handle JSONL format variations and edge cases in Claude Code session files.

```
Review and fix edge cases in packages/core/src/ingestion/parsers/claude-code.ts:

1. Handle empty or malformed JSONL lines:
   - Skip empty lines
   - Wrap JSON.parse in try/catch per line
   - Log warning for unparseable lines but continue processing
   - Track: parsedLines, skippedLines counts

2. Handle different message types in JSONL:
   Claude Code JSONL has different event types per line:
   - "type": "summary" → session metadata, extract if useful
   - "type": "user" → user message
   - "type": "assistant" → assistant message with content blocks  
   - "type": "file-history-snapshot" → skip, not conversation
   
   Update parsing to check the 'type' field first and route accordingly.

3. Handle missing/null fields gracefully:
   - message.content might be undefined
   - message.timestamp might be missing
   - content blocks might have unexpected types
   
   Add null checks and sensible defaults throughout.

4. Handle file read errors:
   - Wrap fs.readFileSync in try/catch
   - Return null or empty result for unreadable files
   - Log which files failed

5. Add a parseSession return type that includes parse stats:
   ```typescript
   interface ParseResult {
     session: Session;
     events: Event[];
     toolCalls: ToolCall[];
     errors: ErrorRecord[];
     skillInvocations: SkillInvocation[];
     subAgentInvocations: SubAgentInvocation[];
     toolSequences: ToolSequence[];
     sessionModes: SessionModes;
     stats: {
       totalLines: number;
       parsedLines: number;
       skippedLines: number;
       warnings: string[];
     };
   }
   ```

6. Update the index command to show parse stats:
   "Indexed 43 sessions (12 warnings, run with --verbose for details)"

Test by running: cai index --since 1d
Check that it handles any malformed sessions gracefully.
```

---

## Task 5: Update Database Migration for Review Feature

**Note:** This should be done as part of Task 3, but separating for clarity.

```
Add a database migration for the review feature.

In packages/core/src/storage/database.ts:

1. Add Migration 3 to the MIGRATIONS array:

```sql
-- Migration 3: Add review tracking to learnings
ALTER TABLE learnings ADD COLUMN reviewed INTEGER DEFAULT 0;
ALTER TABLE learnings ADD COLUMN reviewed_at TEXT;

UPDATE schema_version SET version = 3 WHERE version = 2;
INSERT OR IGNORE INTO schema_version (version) VALUES (3);
```

2. Update the migrate() method to handle ALTER TABLE migrations:
   - SQLite doesn't support IF NOT EXISTS for ALTER TABLE
   - Check if column exists first: PRAGMA table_info(learnings)
   - Only run ALTER if column doesn't exist

3. Add methods to InsightsDatabase:
   - markLearningReviewed(id: string): void
   - deleteLearning(id: string): void  
   - updateLearningContent(id: string, content: string): void
   - getUnreviewedLearnings(options): Learning[]

Rebuild core package after changes: cd packages/core && pnpm build
```

---

## Verification Steps

After completing all tasks, verify:

```bash
# Test --since flag
cai index --since 7d

# Test clean command
cai clean --duplicates --dry-run
cai clean --type context --dry-run

# Test review command
cai review --limit 5

# Verify no crashes on edge cases
cai index  # Should handle any malformed sessions gracefully

# Check stats still work
cai stats
```

---

## Order of Implementation

1. **Task 1** (`--since` flag) — Quick win, independent
2. **Task 5** (Database migration) — Required for Task 3
3. **Task 2** (`cai clean`) — Independent, useful immediately
4. **Task 3** (`cai review`) — Depends on Task 5
5. **Task 4** (Parser edge cases) — Can be done anytime

Recommended: Do Task 1 first to verify your build setup still works, then proceed in order.