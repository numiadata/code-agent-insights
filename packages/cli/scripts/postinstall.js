#!/usr/bin/env node

// Only show message on global install, not local/dev
const isGlobalInstall = process.env.npm_config_global === 'true';

if (isGlobalInstall) {
  console.log('\n\x1b[1m\x1b[36m📦 Code Agent Insights installed successfully!\x1b[0m\n');
  console.log('To enable MCP tools in Claude Code, run:\n');
  console.log('  \x1b[36mcai setup-mcp\x1b[0m\n');
  console.log('Then restart Claude Code to access these tools:');
  console.log('  • recall - Search past sessions and learnings');
  console.log('  • remember - Save new learnings');
  console.log('  • similar_errors - Find past error resolutions');
  console.log('  • file_history - Get session history for files\n');
}
