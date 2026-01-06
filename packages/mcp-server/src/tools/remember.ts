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
  // Validate input
  if (!args.content || typeof args.content !== 'string') {
    return '⚠️ Error: content parameter is required and must be a string';
  }

  const content = args.content.trim();
  if (content.length === 0) {
    return '⚠️ Error: content cannot be empty';
  }

  if (content.length > 2000) {
    return '⚠️ Error: content too long (max 2000 characters)';
  }

  if (!args.type) {
    return '⚠️ Error: type parameter is required (pattern, antipattern, convention, fix, preference)';
  }

  const validTypes = ['pattern', 'antipattern', 'convention', 'fix', 'preference'];
  if (!validTypes.includes(args.type)) {
    return `⚠️ Error: Invalid type "${args.type}". Must be one of: ${validTypes.join(', ')}`;
  }

  if (args.scope) {
    const validScopes = ['global', 'project', 'file', 'language'];
    if (!validScopes.includes(args.scope)) {
      return `⚠️ Error: Invalid scope "${args.scope}". Must be one of: ${validScopes.join(', ')}`;
    }
  }

  // Validate tags if provided
  if (args.tags && !Array.isArray(args.tags)) {
    return '⚠️ Error: tags must be an array of strings';
  }

  if (args.tags && args.tags.length > 20) {
    return '⚠️ Error: Too many tags (max 20)';
  }

  // Create learning object
  const learning: Learning = {
    id: uuidv4(),
    sessionId: undefined, // MCP sessions don't have session IDs
    projectPath: undefined, // Could be detected from cwd in the future
    content,
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
  let output = `✓ **Remembered:** ${content}\n\n`;
  output += `- **Type:** ${args.type}\n`;
  output += `- **Scope:** ${args.scope || 'project'}\n`;

  if (args.tags && args.tags.length > 0) {
    output += `- **Tags:** ${args.tags.join(', ')}\n`;
  }

  output += `\n_This learning has been saved and can be recalled using the \`recall\` tool._`;

  return output;
}
