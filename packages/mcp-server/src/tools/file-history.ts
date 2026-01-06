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
  const limit = args.limit || 5;

  // Get sessions that touched this file
  const results = db.getSessionsForFile(args.file_path, limit);

  if (results.length === 0) {
    return `No sessions found that touched file: "${args.file_path}"`;
  }

  // Format as markdown
  let output = `# File History: \`${args.file_path}\`\n\n`;
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

  // Aggregate all learnings
  const allLearnings = results.flatMap((r) => db.getLearningsForSession(r.session.id));
  const uniqueLearnings = Array.from(
    new Map(allLearnings.map((l) => [l.id, l])).values()
  );

  if (uniqueLearnings.length > 0) {
    output += `\n## All Learnings Related to This File (${uniqueLearnings.length})\n\n`;
    for (const learning of uniqueLearnings.slice(0, 5)) {
      output += `- [${learning.type}] ${learning.content}\n`;
    }
    if (uniqueLearnings.length > 5) {
      output += `- _...and ${uniqueLearnings.length - 5} more (use \`recall\` to search)_\n`;
    }
  }

  return output;
}
