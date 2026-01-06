# MCP Server Testing Guide

## Pre-Test Checklist

✅ MCP server built: `/Users/rafa/Documents/claude/code-agent-insights/packages/mcp-server/dist/index.js`
✅ MCP config created: `~/.claude/mcp_servers.json`
✅ Database exists: `~/.code-agent-insights/insights.db` (13 MB)
✅ Test data available:
- 45 sessions indexed
- 44 learnings extracted
- 104 errors recorded
- 683K tokens of context

## How to Start Testing

**IMPORTANT:** You must restart Claude Code for the MCP server to load!

1. **Exit this Claude Code session:**
   ```bash
   exit
   # or press Ctrl+D
   ```

2. **Start a new Claude Code session:**
   ```bash
   cd /Users/rafa/Documents/claude/code-agent-insights
   claude
   ```

3. **Verify MCP tools loaded:**
   Ask Claude: `What MCP tools do you have available?`

   Expected response should mention:
   - `recall` (from code-agent-insights)
   - `remember` (from code-agent-insights)
   - `similar_errors` (from code-agent-insights)
   - `file_history` (from code-agent-insights)

---

## Test 1: Recall Tool (Search Past Learnings)

### Basic Search
**Prompt:** "Use the recall tool to search for 'Tailwind CSS'"

**Expected:**
- Claude calls `recall` tool with query "Tailwind CSS"
- Returns learnings about Tailwind selectors
- Shows confidence scores, tags, and metadata

### Scope Filtering
**Prompt:** "Use recall with scope 'global' to search for 'authentication'"

**Expected:**
- Filters to only global-scope learnings
- Returns formatted markdown results

### Sample Queries to Try:
- "Search my past learnings about D3.js charts"
- "What have I learned about event IDs?"
- "Search for anything about Clerk authentication"
- "Find learnings about balance conversion"

---

## Test 2: Remember Tool (Save New Learning)

### Basic Remember
**Prompt:** "Use the remember tool to save this learning: 'In this project, always use pnpm instead of npm for package management', type: 'convention', tags: ['pnpm', 'package-manager']"

**Expected:**
- Claude calls `remember` tool
- Returns confirmation: "✓ Remembered: ..."
- Shows type, scope, and tags

### Verify It Was Saved
After using remember, verify from command line:
```bash
cd /Users/rafa/Documents/claude/code-agent-insights
node -e "const {InsightsDatabase} = require('./packages/core/dist/index.js'); const db = new InsightsDatabase(); const learnings = db.searchLearnings('pnpm', {limit: 1}); console.log(JSON.stringify(learnings, null, 2)); db.close();"
```

Should show the newly saved learning.

### More Remember Tests:
**Prompt:** "Remember: 'Database schema version is 4', type: 'context', scope: 'project'"

**Prompt:** "Remember: 'Use uuidv4() for generating IDs', type: 'pattern', tags: ['uuid', 'ids']"

---

## Test 3: Similar Errors Tool

### Search by Error Message
**Prompt:** "Use similar_errors to search for 'ANTHROPIC_API_KEY'"

**Expected:**
- Returns errors about missing API key
- Shows session context
- Indicates if errors were resolved
- Shows related learnings from those sessions

### Search by Error Type
**Prompt:** "Search for similar errors with message 'Failed to parse' and type 'Error'"

**Expected:**
- Returns parsing errors from past sessions
- Shows file paths and line numbers if available
- Includes stack traces (truncated)

### Natural Error Context
Create a file with an error and ask Claude to help:
```bash
echo "const x = y.toString();" > test-error.js
```

**Prompt:** "I'm getting 'ReferenceError: y is not defined'. Have I seen this before?"

Expected: Claude uses similar_errors automatically to check past occurrences.

---

## Test 4: File History Tool

### Basic File History
**Prompt:** "Use file_history to show me the history of 'packages/core/src/storage/database.ts'"

**Expected:**
- Shows sessions that touched this file
- Lists operations (Read, Write, Create)
- Shows session outcomes and stats
- Includes learnings from those sessions

### Check Common Files
**Prompt:** "What's the history of package.json in my sessions?"

**Prompt:** "Show me file history for packages/mcp-server/src/server.ts"

**Expected:**
- Even if file wasn't touched much, should return results or "No sessions found"
- Graceful handling of files not in database

---

## Test 5: Natural Integration

### Scenario 1: Debugging Help
**Setup:** Create a file with an error
```bash
cat > test-debug.ts << 'EOF'
interface User {
  name: string;
}

function greet(user: User) {
  console.log(user.name.toLowercase());
}
EOF
```

**Prompt:** "Help me fix the TypeScript errors in test-debug.ts"

**Expected:**
- Claude might use similar_errors to check for past `toLowercase` typos
- Uses recall to find relevant TypeScript patterns

### Scenario 2: Project Context
**Prompt:** "I'm about to refactor the database module. What should I know from past sessions?"

**Expected:**
- Claude uses recall to search for database-related learnings
- Uses file_history to check database.ts change history
- Provides context-aware recommendations

### Scenario 3: Learning from This Session
After making some changes, ask:

**Prompt:** "Remember that we implemented 4 MCP tools for code-agent-insights: recall, remember, similar_errors, and file_history", type: "pattern", tags: ["mcp", "tools"]

**Expected:**
- Claude saves the learning for future sessions
- You can recall it later

---

## Debugging

### If Tools Don't Appear

1. **Check MCP Config Syntax:**
   ```bash
   cat ~/.claude/mcp_servers.json
   python3 -m json.tool ~/.claude/mcp_servers.json
   ```

2. **Verify Server Path:**
   ```bash
   ls -la /Users/rafa/Documents/claude/code-agent-insights/packages/mcp-server/dist/index.js
   ```

3. **Test Server Manually:**
   ```bash
   node /Users/rafa/Documents/claude/code-agent-insights/packages/mcp-server/dist/index.js
   ```
   Should print: "Code Agent Insights MCP server running"

4. **Check Claude Code Logs:**
   Look for MCP-related errors in Claude Code startup output

### If Tools Error

1. **Check Database Access:**
   ```bash
   ls -la ~/.code-agent-insights/insights.db
   # Should be readable
   ```

2. **Check Database Has Data:**
   ```bash
   cd /Users/rafa/Documents/claude/code-agent-insights
   node -e "const {InsightsDatabase} = require('./packages/core/dist/index.js'); const db = new InsightsDatabase(); console.log(db.getStats()); db.close();"
   ```

3. **Add Debug Logging:**
   Edit `packages/mcp-server/src/server.ts` and add:
   ```typescript
   console.error('Tool called:', request.params.name);
   console.error('Args:', JSON.stringify(request.params.arguments));
   ```

4. **Check stderr Output:**
   MCP servers log to stderr, so errors will appear in Claude Code console

---

## Success Criteria

- ✅ All 4 tools are callable from Claude Code
- ✅ Tools return formatted markdown results
- ✅ Error handling works gracefully (empty results, invalid args)
- ✅ Tools access the correct database
- ✅ Claude uses tools naturally when relevant
- ✅ Remember tool successfully saves learnings
- ✅ Recall finds both old and newly saved learnings

---

## Sample Test Session Script

Here's a complete test sequence to run:

```
1. "What MCP tools do you have?"
2. "Use recall to search for 'Tailwind'"
3. "Remember: 'MCP testing completed successfully', type: 'context'"
4. "Use similar_errors to find 'ANTHROPIC_API_KEY' errors"
5. "Show file history for packages/core/src/storage/database.ts"
6. "Search for learnings about D3.js"
7. "Have I seen any parsing errors before?"
```

After this sequence, verify:
- All tools executed successfully
- Results were formatted and useful
- No errors in Claude Code logs
- New learning from step 3 is in database

---

## Next Steps After Testing

Once testing is complete:

1. **Document Results:**
   - Create MCP_TEST_RESULTS.md with findings
   - Note any issues or improvements needed

2. **Update Documentation:**
   - Add examples to README.md
   - Update CLAUDE.md with MCP server status

3. **Consider Enhancements:**
   - Add more sophisticated search (semantic search with embeddings)
   - Add tool for querying session stats
   - Add tool for recommending best practices
   - Add caching for frequently accessed data

4. **Share Results:**
   - Test with real coding tasks
   - Gather feedback on tool usefulness
   - Iterate on tool implementations

---

**Ready to test!** Exit this session and start a fresh one to load the MCP server.
