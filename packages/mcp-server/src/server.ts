/**
 * MCP Server Setup
 *
 * Configures and starts the Model Context Protocol server
 * for Claude Code integration
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { InsightsDatabase } from '@code-agent-insights/core';

export class InsightsMCPServer {
  private server: Server;
  private db: InsightsDatabase;

  constructor() {
    // Initialize database
    this.db = new InsightsDatabase();

    // Create MCP Server
    this.server = new Server(
      {
        name: 'code-agent-insights',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Setup tool handlers
    this.setupToolHandlers();
  }

  private setupToolHandlers(): void {
    // Register ListTools handler - returns all available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'recall',
            description:
              "Search past coding sessions and learnings for relevant context. Use this when the user asks about past work, mentions a problem they've seen before, or when you need context about how something was done previously.",
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'What to search for - describe the problem, pattern, or topic',
                },
                scope: {
                  type: 'string',
                  enum: ['project', 'global', 'all'],
                  description:
                    'Search scope: project (current project), global (universal learnings), or all',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum results to return (default: 5)',
                },
              },
              required: ['query'],
            },
          },
          {
            name: 'remember',
            description:
              'Save a learning, pattern, or convention for future sessions. Use when discovering something important that should be remembered.',
            inputSchema: {
              type: 'object',
              properties: {
                content: {
                  type: 'string',
                  description: 'The learning to remember - be specific and actionable',
                },
                type: {
                  type: 'string',
                  enum: ['pattern', 'antipattern', 'convention', 'fix', 'preference'],
                  description: 'Type of learning',
                },
                scope: {
                  type: 'string',
                  enum: ['global', 'project', 'file', 'language'],
                  description: "Where this applies (default: project)",
                },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Keywords for easier retrieval',
                },
              },
              required: ['content', 'type'],
            },
          },
          {
            name: 'similar_errors',
            description:
              "Find past sessions where similar errors were encountered and resolved. Use when hitting an error to see if it's been solved before.",
            inputSchema: {
              type: 'object',
              properties: {
                error_message: {
                  type: 'string',
                  description: 'The error message or key part of it',
                },
                error_type: {
                  type: 'string',
                  description: 'Error type like TypeError, SyntaxError, etc.',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum results (default: 5)',
                },
              },
              required: ['error_message'],
            },
          },
          {
            name: 'file_history',
            description:
              'Get history of past sessions that worked on a specific file. Use to understand past changes or find related context.',
            inputSchema: {
              type: 'object',
              properties: {
                file_path: {
                  type: 'string',
                  description: 'Path to the file (relative or absolute)',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum sessions to return (default: 5)',
                },
              },
              required: ['file_path'],
            },
          },
        ],
      };
    });

    // Register CallTool handler - routes to tool implementations
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        let result: string;

        switch (name) {
          case 'recall':
            result = await this.handleRecall(args as any);
            break;

          case 'remember':
            result = await this.handleRemember(args as any);
            break;

          case 'similar_errors':
            result = await this.handleSimilarErrors(args as any);
            break;

          case 'file_history':
            result = await this.handleFileHistory(args as any);
            break;

          default:
            throw new Error(`Unknown tool: ${name}`);
        }

        return {
          content: [
            {
              type: 'text',
              text: result,
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private async handleRecall(args: {
    query: string;
    scope?: 'project' | 'global' | 'all';
    limit?: number;
  }): Promise<string> {
    // Import tool implementation
    const { recallTool } = await import('./tools/recall.js');
    return recallTool(this.db, args);
  }

  private async handleRemember(args: {
    content: string;
    type: 'pattern' | 'antipattern' | 'convention' | 'fix' | 'preference';
    scope?: 'global' | 'project' | 'file' | 'language';
    tags?: string[];
  }): Promise<string> {
    // Import tool implementation
    const { rememberTool } = await import('./tools/remember.js');
    return rememberTool(this.db, args);
  }

  private async handleSimilarErrors(args: {
    error_message: string;
    error_type?: string;
    limit?: number;
  }): Promise<string> {
    // Import tool implementation
    const { similarErrorsTool } = await import('./tools/similar-errors.js');
    return similarErrorsTool(this.db, args);
  }

  private async handleFileHistory(args: {
    file_path: string;
    limit?: number;
  }): Promise<string> {
    // Import tool implementation
    const { fileHistoryTool } = await import('./tools/file-history.js');
    return fileHistoryTool(this.db, args);
  }

  async start(): Promise<void> {
    // Create stdio transport
    const transport = new StdioServerTransport();

    // Connect server to transport
    await this.server.connect(transport);

    // Log to stderr (stdout is used for protocol communication)
    console.error('Code Agent Insights MCP server running');
    console.error('Providing context from past coding sessions');
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Convenience function to start the server
 */
export async function startServer(): Promise<void> {
  const server = new InsightsMCPServer();
  await server.start();
}
