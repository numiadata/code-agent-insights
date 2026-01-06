#!/usr/bin/env node

/**
 * MCP Server Entry Point
 *
 * This server enables Claude Code to query past sessions and learnings
 * during active coding sessions.
 *
 * Tools provided:
 * - recall: Search learnings and sessions for relevant context
 * - remember: Save a learning during the session
 * - similar_errors: Find past sessions with similar errors
 * - file_history: Get sessions that touched a specific file
 */

import { startServer } from './server.js';

// Start the MCP server
startServer().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
