/**
 * Remember Tool
 *
 * Save a learning during the session
 */

import type { InsightsDatabase } from '@code-agent-insights/core';

export async function rememberTool(
  db: InsightsDatabase,
  args: {
    content: string;
    type: 'pattern' | 'antipattern' | 'convention' | 'fix' | 'preference';
    scope?: 'global' | 'project' | 'file' | 'language';
    tags?: string[];
  }
): Promise<string> {
  // To be implemented in next task
  return `Remember tool called:\nContent: "${args.content}"\nType: ${args.type}\nScope: ${args.scope || 'project'}\nTags: ${args.tags?.join(', ') || 'none'}\n\nImplementation pending...`;
}
