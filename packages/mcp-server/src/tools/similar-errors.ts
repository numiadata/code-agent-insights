/**
 * Similar Errors Tool
 *
 * Find past sessions with similar errors
 */

import type { InsightsDatabase } from '@code-agent-insights/core';

export async function similarErrorsTool(
  db: InsightsDatabase,
  args: {
    error_message: string;
    error_type?: string;
    limit?: number;
  }
): Promise<string> {
  const limit = args.limit || 5;

  // Search for similar errors
  const errors = db.searchErrors(args.error_message, {
    errorType: args.error_type,
    limit,
  });

  if (errors.length === 0) {
    return `No similar errors found for: "${args.error_message}"${
      args.error_type ? ` (type: ${args.error_type})` : ''
    }`;
  }

  // Format as markdown
  let output = `# Similar Errors (${errors.length})\n\n`;
  output += `Query: "${args.error_message}"`;
  if (args.error_type) {
    output += ` • Type: ${args.error_type}`;
  }
  output += '\n\n';

  for (let i = 0; i < errors.length; i++) {
    const error = errors[i];

    output += `## Error ${i + 1}: ${error.errorType || 'Unknown'}\n\n`;
    output += `\`\`\`\n${error.errorMessage}\n\`\`\`\n\n`;

    // Get session details
    const session = db.getSession(error.sessionId);

    if (session) {
      output += `**Session:** ${session.projectName || 'Unknown'}\n`;
      output += `**Date:** ${session.startedAt.toLocaleDateString()}\n`;
      output += `**Outcome:** ${session.outcome}\n`;

      if (error.filePath) {
        output += `**File:** ${error.filePath}`;
        if (error.lineNumber) {
          output += `:${error.lineNumber}`;
        }
        output += '\n';
      }

      // Resolution status
      output += `**Resolved:** ${error.resolved ? '✓ Yes' : '✗ No'}\n`;

      // Get learnings from this session
      const learnings = db.getLearningsForSession(error.sessionId);

      if (learnings.length > 0) {
        output += '\n**Related Learnings:**\n';
        for (const learning of learnings.slice(0, 3)) {
          output += `- [${learning.type}] ${learning.content}\n`;
        }
        if (learnings.length > 3) {
          output += `- _...and ${learnings.length - 3} more_\n`;
        }
      }

      // Stack trace if available (truncated)
      if (error.stackTrace && error.stackTrace.length > 0) {
        const truncated = error.stackTrace.slice(0, 200);
        output += `\n<details>\n<summary>Stack Trace</summary>\n\n\`\`\`\n${truncated}${
          error.stackTrace.length > 200 ? '...' : ''
        }\n\`\`\`\n</details>\n`;
      }
    }

    output += '\n---\n\n';
  }

  output += `_Found ${errors.length} similar error${errors.length > 1 ? 's' : ''}. `;
  const resolvedCount = errors.filter((e) => e.resolved).length;
  output += `${resolvedCount} resolved, ${errors.length - resolvedCount} unresolved._`;

  return output;
}
