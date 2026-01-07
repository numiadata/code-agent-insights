# Code Agent Insights MCP Server

Model Context Protocol server that enables Claude Code to query past sessions and learnings during active coding sessions.

## Features

### Tools Provided

1. **recall** - Search past coding sessions and learnings for relevant context
   - Query past work, problems you've seen before, or how something was done
   - Scope: project, global, or all
   - Returns top N results (default: 5)

2. **remember** - Save a learning, pattern, or convention for future sessions
   - Store discoveries that should be remembered
   - Types: pattern, antipattern, convention, fix, preference
   - Scope: global, project, file, or language

3. **similar_errors** - Find past sessions with similar errors
   - Search for errors that have been resolved before
   - Filter by error type (TypeError, SyntaxError, etc.)
   - Returns sessions where similar errors were encountered

4. **file_history** - Get history of sessions that worked on a specific file
   - Understand past changes to a file
   - Find related context for file modifications
   - See what was done before on the same file

## Installation

### Automatic Setup (Recommended)

If you have `code-agent-insights` installed globally:

```bash
# Install the package
npm install -g code-agent-insights

# Setup MCP server automatically
cai setup-mcp

# Restart Claude Code
```

The `setup-mcp` command will:
- Detect if Claude Code is installed
- Find the `cai-mcp` binary path
- Add the MCP server to your global `~/.claude.json` configuration
- Provide next steps

### Manual Setup

If you prefer manual configuration:

```bash
# Add via Claude CLI
claude mcp add --transport stdio --scope user code-agent-insights -- cai-mcp

# Then restart Claude Code
```

Or manually edit `~/.claude.json`:

```json
{
  "mcpServers": {
    "code-agent-insights": {
      "type": "stdio",
      "command": "cai-mcp",
      "args": [],
      "env": {}
    }
  }
}
```

### Development Setup

When developing locally:

```bash
cd packages/mcp-server
pnpm build

# Add with absolute path
claude mcp add --transport stdio --scope user code-agent-insights -- node /absolute/path/to/packages/mcp-server/dist/index.js
```

## Usage Examples

Once configured, Claude Code can use these tools during your coding sessions:

### Recall Past Work
```
User: "How did I fix the authentication middleware bug last time?"
Claude: [calls recall tool with query "authentication middleware bug"]
        "I found a similar issue in a past session. The fix was adding
        a null check on req.user before accessing properties."
```

### Remember New Learnings
```
User: "Remember that we always use pnpm in this repo"
Claude: [calls remember tool]
        "Noted! I'll remember to use pnpm for package management in this project."
```

### Find Similar Errors
```
User: "I'm getting TypeError: Cannot read property 'id' of undefined"
Claude: [calls similar_errors tool]
        "I found 2 past sessions with similar errors. The solution was..."
```

### Check File History
```
User: "What changes were made to src/auth.ts before?"
Claude: [calls file_history tool for "src/auth.ts"]
        "This file was modified in 3 past sessions..."
```

## Development

### Testing the Server

The server uses stdio protocol, so it's designed to be run by an MCP client (like Claude Code).

For manual testing:
```bash
# Build the server
pnpm build

# Run the server (will wait for JSON-RPC messages on stdin)
node dist/index.js
```

### Tool Implementation Status

- [x] Server core with MCP SDK integration
- [x] Tool registration and routing
- [ ] recall tool implementation (pending)
- [ ] remember tool implementation (pending)
- [ ] similar_errors tool implementation (pending)
- [ ] file_history tool implementation (pending)

## Architecture

```
┌─────────────────┐
│   Claude Code   │
└────────┬────────┘
         │ JSON-RPC over stdio
         ▼
┌─────────────────┐
│   MCP Server    │
│  - recall       │
│  - remember     │
│  - similar_errors│
│  - file_history │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ InsightsDatabase│
│   (SQLite)      │
└─────────────────┘
```

## Requirements

- Node.js 18+
- Indexed sessions in `~/.code-agent-insights/insights.db`
- Run `cai index` first to populate the database

## Troubleshooting

### Server not connecting
- Check the path in MCP configuration is correct
- Ensure the package is built (`pnpm build`)
- Check Claude Code logs for connection errors

### No results from recall
- Run `cai index` to index your sessions first
- Check that learnings exist: `cai stats`
- Try with `scope: 'all'` to search everywhere

### Remember not saving
- Ensure you have write permissions to `~/.code-agent-insights/`
- Check the database is not locked
- Verify the learning was saved with `cai search`

## License

MIT
