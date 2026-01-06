# MCP Tools Quick Reference

## Available Tools

### 1. `recall` - Search Past Learnings

**Purpose:** Search through past sessions and learnings for relevant context

**Parameters:**
- `query` (required): Search term or phrase
- `scope` (optional): Filter by scope - `'global'`, `'project'`, or `'all'` (default: `'all'`)
- `limit` (optional): Max results to return (default: `5`)

**Example Usage:**
```
Use recall to search for "authentication"
Use recall with scope 'global' to search for "best practices"
Search my learnings for "error handling" with limit 10
```

**Returns:**
- Grouped learnings by type (pattern, fix, convention, etc.)
- Confidence scores
- Tags and related files
- Project context
- Application count

---

### 2. `remember` - Save New Learning

**Purpose:** Save a learning from the current session for future reference

**Parameters:**
- `content` (required): The learning content (clear, actionable statement)
- `type` (required): One of: `'pattern'`, `'antipattern'`, `'convention'`, `'fix'`, `'preference'`
- `scope` (optional): `'global'`, `'project'`, `'file'`, or `'language'` (default: `'project'`)
- `tags` (optional): Array of tag strings

**Example Usage:**
```
Remember: "Always use pnpm instead of npm in this project", type: convention
Save learning: "D3.js requires explicit color mapping for chart nodes", type: pattern, tags: ["d3", "charts"]
Remember: "Bug fix: Use consistent event IDs without array indices", type: fix
```

**Returns:**
- Confirmation message
- Type, scope, and tags used
- Note that it can be recalled later

---

### 3. `similar_errors` - Find Past Error Resolutions

**Purpose:** Search for similar errors from past sessions to find solutions

**Parameters:**
- `error_message` (required): The error message or part of it
- `error_type` (optional): Filter by error type (e.g., `'TypeError'`, `'Error'`, `'SyntaxError'`)
- `limit` (optional): Max results (default: `5`)

**Example Usage:**
```
Search for similar errors with "Cannot read property"
Find errors matching "ANTHROPIC_API_KEY"
Have I seen "TypeError" errors before?
Show me past "Failed to parse" errors
```

**Returns:**
- Error details (type, message, stack trace)
- Session context (project, date, outcome)
- Resolution status
- Related learnings from that session
- File path and line number if available
- Statistics (resolved vs unresolved count)

---

### 4. `file_history` - Get File Modification History

**Purpose:** See which sessions modified a specific file and what was learned

**Parameters:**
- `file_path` (required): Path to the file (absolute or relative)
- `limit` (optional): Max sessions to return (default: `5`)

**Example Usage:**
```
Show file history for "packages/core/src/storage/database.ts"
What's the history of package.json?
Get sessions that modified "src/server.ts"
```

**Returns:**
- Sessions that touched the file (chronologically)
- Operations performed (Read, Write, Create)
- Session outcomes and stats
- Features used (skills, plan mode, sub-agents)
- Session summaries
- All learnings related to the file

---

## Tool Selection Guide

### When Claude Should Use Each Tool:

**recall:**
- User asks about past solutions or patterns
- Need context about project conventions
- Looking for best practices discovered previously
- Debugging: "How did I solve this before?"

**remember:**
- User explicitly asks to save something
- Discovered an important pattern or solution
- Learned a project convention
- Fixed a tricky bug worth documenting

**similar_errors:**
- Encountering an error during coding
- User reports an error and asks for help
- Debugging session
- "Have I seen this error before?"

**file_history:**
- Need to understand file evolution
- User asks "what changed in this file?"
- Planning refactoring
- Understanding why file exists or its purpose

---

## Natural Integration Examples

### Debugging Flow:
1. Error occurs
2. Use `similar_errors` to check if it happened before
3. If found, recall solution; if not, solve it
4. Use `remember` to save the solution

### Refactoring Flow:
1. Use `file_history` to understand past changes
2. Use `recall` to find related patterns
3. Make changes
4. Use `remember` to document refactoring decisions

### Learning Flow:
1. User discovers something useful
2. Use `remember` to save it
3. Future sessions use `recall` to retrieve it

---

## Output Format

All tools return **formatted markdown** suitable for Claude to read and present to users:

- Headers (# ## ###)
- Bold (**text**)
- Lists (- item)
- Code blocks (\`\`\`)
- Metadata with bullets (•)
- Collapsible sections (<details>)

This makes responses easy to read and professional.

---

## Error Handling

All tools handle errors gracefully:

- Empty results: Clear "No results found" messages
- Invalid args: Descriptive error messages
- Database issues: Error logged, user-friendly message returned
- Missing files: "File not found" with suggestions

---

## Performance

- Database queries are indexed (FTS5 for text search)
- Results are limited by default (configurable)
- Queries typically complete in < 100ms
- Database is local (no network latency)

---

## Database Location

The MCP server queries: `~/.code-agent-insights/insights.db`

To populate or refresh:
```bash
cai index           # Index all sessions
cai index --since 7d  # Index last 7 days
```

Current database stats:
- 45 sessions indexed
- 44 learnings
- 104 errors recorded
- 683K tokens of context

---

## Troubleshooting

**Tools not appearing:**
- Check `~/.claude/mcp_servers.json` exists and has correct path
- Restart Claude Code
- Verify server starts: `node /path/to/dist/index.js`

**Tools returning empty:**
- Check database exists and has data
- Run `cai stats` to verify content
- Try different search terms

**Tools erroring:**
- Check database permissions
- Check server logs (stderr)
- Add debug logging to server.ts

---

**For detailed testing instructions, see: MCP_TESTING_GUIDE.md**
