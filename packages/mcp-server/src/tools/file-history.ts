/**
 * File History Tool
 *
 * Get sessions that touched a specific file
 */

import type { InsightsDatabase } from '@code-agent-insights/core';

export async function fileHistoryTool(
  db: InsightsDatabase,
  args: {
    file_path: string;
    limit?: number;
  }
): Promise<string> {
  // Validate input
  if (!args.file_path || typeof args.file_path !== 'string') {
    return '⚠️ Error: file_path parameter is required and must be a string';
  }

  const filePath = args.file_path.trim();
  if (filePath.length === 0) {
    return '⚠️ Error: file_path cannot be empty';
  }

  if (filePath.length > 500) {
    return '⚠️ Error: file_path too long (max 500 characters)';
  }

  const limit = args.limit || 5;

  // Validate limit
  if (limit < 1 || limit > 50) {
    return '⚠️ Error: Limit must be between 1 and 50';
  }

  // Try the primary method first
  let results = db.getSessionsForFile(filePath, limit);

  // If no results, try the simple fallback
  if (results.length === 0) {
    results = db.getSessionsForFileSimple(filePath, limit);
  }

  // Get learnings related to this file
  const relatedLearnings = db.searchLearnings(filePath, { limit: 5 });

  if (results.length === 0 && relatedLearnings.length === 0) {
    return `No past sessions or learnings found for "${filePath}".\n\nThis file may not have been worked on in indexed sessions, or the sessions haven't been indexed yet. Try running \`cai index\` to update.`;
  }

  // Format as markdown
  let output = `# File History: \`${filePath}\`\n\n`;
  output += `Found ${results.length} session${results.length > 1 ? 's' : ''}\n\n`;

  for (let i = 0; i < results.length; i++) {
    const { session, operations } = results[i];

    output += `## Session ${i + 1}\n\n`;
    output += `**Project:** ${session.projectName || 'Unknown'}\n`;
    output += `**Date:** ${session.startedAt.toLocaleDateString()} ${session.startedAt.toLocaleTimeString()}\n`;
    output += `**Outcome:** ${session.outcome}\n`;

    // Operations performed
    const opsList = operations.filter((o) => o).map((o) => {
      const opMap: { [key: string]: string } = {
        file_read: 'Read',
        file_write: 'Write',
        file_create: 'Create',
      };
      return opMap[o] || o;
    });

    if (opsList.length > 0) {
      output += `**Operations:** ${opsList.join(', ')}\n`;
    }

    // Session stats
    output += `**Activity:** ${session.turnCount} turns, ${session.toolCallCount} tool calls`;
    if (session.errorCount > 0) {
      output += `, ${session.errorCount} error${session.errorCount > 1 ? 's' : ''}`;
    }
    output += '\n';

    // Features used
    const features: string[] = [];
    if (session.skillInvocationCount > 0) {
      features.push(`${session.skillInvocationCount} skill${session.skillInvocationCount > 1 ? 's' : ''}`);
    }
    if (session.usedPlanMode) {
      features.push('plan mode');
    }
    if (session.subAgentCount > 0) {
      features.push(`${session.subAgentCount} sub-agent${session.subAgentCount > 1 ? 's' : ''}`);
    }

    if (features.length > 0) {
      output += `**Features:** ${features.join(', ')}\n`;
    }

    // Summary if available
    if (session.summary) {
      output += `\n**Summary:** ${session.summary}\n`;
    }

    // Get learnings from this session
    const learnings = db.getLearningsForSession(session.id);

    if (learnings.length > 0) {
      output += '\n**Learnings from this session:**\n';
      for (const learning of learnings.slice(0, 3)) {
        output += `- [${learning.type}] ${learning.content}\n`;
      }
      if (learnings.length > 3) {
        output += `- _...and ${learnings.length - 3} more_\n`;
      }
    }

    output += '\n---\n\n';
  }

  // Show related learnings (both from sessions and file-specific search)
  const sessionLearnings = results.flatMap((r) => db.getLearningsForSession(r.session.id));
  const allLearnings = Array.from(
    new Map([...sessionLearnings, ...relatedLearnings].map((l) => [l.id, l])).values()
  );

  if (allLearnings.length > 0) {
    output += `\n## Related Learnings (${allLearnings.length})\n\n`;
    for (const learning of allLearnings.slice(0, 5)) {
      output += `- **[${learning.type}]** ${learning.content}`;
      if (learning.tags && learning.tags.length > 0) {
        output += ` _• Tags: ${learning.tags.join(', ')}_`;
      }
      output += '\n';
    }
    if (allLearnings.length > 5) {
      output += `\n_...and ${allLearnings.length - 5} more. Use \`recall "${filePath}"\` to search all learnings._\n`;
    }
  }

  return output;
}
