/**
 * Remember Tool
 *
 * Save a learning during the session
 */

import { v4 as uuidv4 } from 'uuid';
import type { InsightsDatabase, Learning } from '@code-agent-insights/core';

export async function rememberTool(
  db: InsightsDatabase,
  args: {
    content: string;
    type: 'pattern' | 'antipattern' | 'convention' | 'fix' | 'preference';
    scope?: 'global' | 'project' | 'file' | 'language';
    tags?: string[];
  }
): Promise<string> {
  // Create learning object
  const learning: Learning = {
    id: uuidv4(),
    sessionId: undefined, // MCP sessions don't have session IDs
    projectPath: undefined, // Could be detected from cwd in the future
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

  // Insert into database
  db.insertLearning(learning);

  // Format success message
  let output = `✓ **Remembered:** ${args.content}\n\n`;
  output += `- **Type:** ${args.type}\n`;
  output += `- **Scope:** ${args.scope || 'project'}\n`;

  if (args.tags && args.tags.length > 0) {
    output += `- **Tags:** ${args.tags.join(', ')}\n`;
  }

  output += `\n_This learning has been saved and can be recalled using the \`recall\` tool._`;

  return output;
}
