# Next Session Summary - Phase 2: MCP Server Implementation

## Context: What We're Building

We're adding an **MCP (Model Context Protocol) server** that enables Claude Code to query past coding sessions and learnings **during active sessions**. This allows Claude to recall solutions, remember new learnings, find similar errors, and understand file history in real-time.

## What's Been Completed

### ✅ Phase 1 - Fully Complete
- Core TypeScript library with SQLite storage (better-sqlite3)
- CLI with 7 commands: `index`, `search`, `stats`, `learn`, `recommend`, `clean`, `review`
- Robust JSONL/JSON parser handling malformed data gracefully
- Full-text search with SQLite FTS5
- Interactive learning review with keep/delete/edit/skip
- Database cleanup (duplicates, low-confidence, type-based filtering)
- Mode effectiveness tracking (plan mode, thinking, sub-agents)
- Date-based session filtering with `--since` flag (7d, 2w, 1m, YYYY-MM-DD)

### ✅ Phase 2 - MCP Server Core (Completed This Session)

**Package Structure Created:**
```
packages/mcp-server/
├── src/
│   ├── index.ts              # Entry point with startServer()
│   ├── server.ts             # InsightsMCPServer class (261 lines)
│   └── tools/
│       ├── recall.ts         # Placeholder with signature
│       ├── remember.ts       # Placeholder with signature
│       ├── similar-errors.ts # Placeholder with signature
│       └── file-history.ts   # Placeholder with signature
├── dist/                     # Built output (8.78 KB)
├── README.md                 # Complete usage documentation
├── mcp-config-example.json   # Configuration template
├── package.json
└── tsconfig.json
```

**MCP Server Implementation (server.ts):**
1. ✅ `InsightsMCPServer` class with constructor
   - Initializes `InsightsDatabase`
   - Creates MCP Server with name 'code-agent-insights' v0.1.0
   - Declares capabilities: `{ tools: {} }`

2. ✅ Tool Registration (`setupToolHandlers()`)
   - `ListToolsRequestSchema` handler returning 4 tool definitions
   - `CallToolRequestSchema` handler with switch-based routing
   - Dynamic tool imports for lazy loading
   - Error handling with graceful MCP response format

3. ✅ Four Tools Defined:
   - **recall**: Search learnings/sessions (query, scope, limit)
   - **remember**: Save learnings (content, type, scope, tags)
   - **similar_errors**: Find error resolutions (error_message, error_type, limit)
   - **file_history**: Get file sessions (file_path, limit)

4. ✅ Server Transport
   - `StdioServerTransport` for JSON-RPC over stdio
   - Error logging to stderr (stdout reserved for protocol)
   - `startServer()` convenience function

**Database Methods Added (database.ts):**
1. ✅ `searchErrors(query, options)` - Lines 518-537
   - Searches error_message with LIKE pattern
   - Joins with sessions for context
   - Optional errorType filter
   - Tested: ✓ Found 3 errors

2. ✅ `getSessionsForFile(filePath, limit)` - Lines 539-564
   - Searches by full path OR basename
   - Filters file_read, file_write, file_create operations
   - Groups operations by session
   - Tested: ✓ Works correctly

3. ✅ `getLearningsForSession(sessionId)` - Lines 887-890
   - Simple query by session_id
   - Returns all learnings for session
   - Tested: ✓ Found 4 learnings

**Build Status:**
- ✅ All packages build successfully
- ✅ Core: 57.31 KB (CJS), 53.35 KB (ESM)
- ✅ MCP Server: 8.78 KB
- ✅ TypeScript definitions generated
- ✅ Dependencies properly linked

## What Needs to Be Done Next

### 🎯 Immediate Tasks (Tool Implementations)

All tool signatures are defined, placeholders exist. You need to implement the actual logic:

#### Task 3: Implement `recall` Tool
**File:** `packages/mcp-server/src/tools/recall.ts`

**Purpose:** Search past sessions and learnings for relevant context

**Implementation Guide:**
```typescript
export async function recallTool(
  db: InsightsDatabase,
  args: { query: string; scope?: string; limit?: number }
): Promise<string> {
  const limit = args.limit || 5;

  // 1. Search learnings using FTS
  const learnings = db.searchLearnings(args.query, { limit });

  // 2. Filter by scope if provided
  //    - 'project': filter to current project (need to detect)
  //    - 'global': filter to scope='global'
  //    - 'all': no filter

  // 3. Format results as markdown:
  //    - Group by type (pattern, fix, convention, etc.)
  //    - Show confidence scores
  //    - Include project context
  //    - Add tags for easy scanning

  // 4. Return formatted string
  return `Found ${learnings.length} relevant learnings:\n\n...`;
}
```

**Reference:** See `packages/cli/src/commands/search.ts` for formatting examples

#### Task 4: Implement `remember` Tool
**File:** `packages/mcp-server/src/tools/remember.ts`

**Purpose:** Save a learning during active session

**Implementation Guide:**
```typescript
export async function rememberTool(
  db: InsightsDatabase,
  args: {
    content: string;
    type: string;
    scope?: string;
    tags?: string[];
  }
): Promise<string> {
  // 1. Create Learning object
  const learning: Learning = {
    id: uuidv4(),
    sessionId: undefined, // MCP session doesn't have session ID
    projectPath: undefined, // Could detect from cwd
    content: args.content,
    type: args.type,
    scope: args.scope || 'project',
    confidence: 0.9, // High confidence for explicit learnings
    tags: args.tags || [],
    relatedFiles: [],
    relatedErrors: [],
    source: 'explicit',
    appliedCount: 0,
    createdAt: new Date(),
  };

  // 2. Insert learning
  db.insertLearning(learning);

  // 3. Return confirmation
  return `✓ Remembered: "${args.content}" (${args.type})`;
}
```

**Reference:** See `packages/cli/src/commands/learn.ts` for the CLI implementation

#### Task 5: Implement `similar_errors` Tool
**File:** `packages/mcp-server/src/tools/similar-errors.ts`

**Purpose:** Find past sessions with similar errors

**Implementation Guide:**
```typescript
export async function similarErrorsTool(
  db: InsightsDatabase,
  args: {
    error_message: string;
    error_type?: string;
    limit?: number;
  }
): Promise<string> {
  // 1. Use searchErrors() method
  const errors = db.searchErrors(args.error_message, {
    errorType: args.error_type,
    limit: args.limit || 5,
  });

  // 2. For each error, get:
  //    - Session details
  //    - Error context
  //    - Resolution (check if resolved=true)
  //    - Related learnings from that session

  // 3. Format as:
  //    - Error type and message
  //    - When it occurred
  //    - Project context
  //    - How it was resolved (if available)
  //    - Link to learnings from that session

  return `Found ${errors.length} similar errors:\n\n...`;
}
```

#### Task 6: Implement `file_history` Tool
**File:** `packages/mcp-server/src/tools/file-history.ts`

**Purpose:** Get sessions that modified a specific file

**Implementation Guide:**
```typescript
export async function fileHistoryTool(
  db: InsightsDatabase,
  args: { file_path: string; limit?: number }
): Promise<string> {
  // 1. Use getSessionsForFile() method
  const sessions = db.getSessionsForFile(args.file_path, args.limit || 5);

  // 2. For each session, show:
  //    - Session date
  //    - Project name
  //    - Operations performed (read/write/create)
  //    - Session outcome
  //    - Summary if available

  // 3. Get learnings from those sessions
  const learnings = sessions.flatMap(s =>
    db.getLearningsForSession(s.session.id)
  );

  return `File "${args.file_path}" history:\n\n...`;
}
```

### Task 7: Testing & Integration

**After implementing tools:**

1. **Build and test:**
   ```bash
   cd packages/mcp-server
   pnpm build
   ```

2. **Manual test with MCP Inspector** (optional):
   - Install: `npm install -g @modelcontextprotocol/inspector`
   - Run: `mcp-inspector node dist/index.js`
   - Test each tool with sample inputs

3. **Configure Claude Code:**
   - Add to MCP config (location varies by OS)
   - Test in actual Claude Code session
   - Verify tools appear and work

4. **Update documentation:**
   - Add usage examples to README
   - Document tool behaviors
   - Add troubleshooting tips

## Key Technical Notes

### Database Schema
- Schema version: 4
- Tables: sessions, events, tool_calls, errors, learnings, skill_invocations, sub_agent_invocations, tool_sequences, session_modes
- FTS tables: events_fts, learnings_fts

### Important Methods Available
```typescript
// From InsightsDatabase
db.searchLearnings(query, options)      // FTS search on learnings
db.searchErrors(query, options)          // NEW: Search errors with LIKE
db.getSessionsForFile(path, limit)       // NEW: Get sessions for file
db.getLearningsForSession(sessionId)     // NEW: Get learnings by session
db.insertLearning(learning)              // Save new learning
db.getSession(id)                        // Get session by ID
db.getSessions(options)                  // Query sessions
```

### MCP Response Format
All tool responses must return:
```typescript
{
  content: [
    {
      type: 'text',
      text: 'Your formatted response here'
    }
  ]
}
```

Error responses:
```typescript
{
  content: [{ type: 'text', text: 'Error: ...' }],
  isError: true
}
```

## Files to Reference

**For Implementation:**
- `packages/core/src/storage/database.ts` - All database methods
- `packages/cli/src/commands/search.ts` - Search and formatting examples
- `packages/cli/src/commands/learn.ts` - Learning creation example
- `packages/mcp-server/src/server.ts` - How tools are called
- `PROMPTS.md` - Lines 2133-2579 have detailed tool implementation specs

**For Testing:**
- `packages/mcp-server/README.md` - Usage guide
- `packages/mcp-server/mcp-config-example.json` - Configuration template

## How to Start Next Session

1. **Read this file** to understand current state
2. **Check CLAUDE.md** for architecture and data model reference
3. **Review PROMPTS.md** lines 2133-2579 for detailed implementation specs
4. **Start with Task 3** (recall tool) - it's the most complex, good to tackle fresh
5. **Then Task 4** (remember tool) - simplest, quick win
6. **Then Tasks 5 & 6** (similar_errors and file_history) - moderate complexity

## Quick Verification Commands

```bash
# Check everything builds
pnpm build

# Test database methods
node -e "const {InsightsDatabase} = require('./packages/core/dist/index.js'); const db = new InsightsDatabase(); console.log('searchErrors:', db.searchErrors('error', {limit: 1})); db.close();"

# Check MCP server structure
ls -la packages/mcp-server/src/tools/

# View current git status
git status
```

## Success Criteria

When Phase 2 is complete, you should be able to:
1. Start MCP server: `node packages/mcp-server/dist/index.js`
2. Claude Code recognizes 4 tools: recall, remember, similar_errors, file_history
3. Each tool returns formatted, useful information
4. Tools access real data from `~/.code-agent-insights/insights.db`
5. Error handling works gracefully

Good luck! 🚀
