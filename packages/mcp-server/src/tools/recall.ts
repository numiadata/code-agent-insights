/**
 * Recall Tool
 *
 * Search learnings and sessions for relevant context
 */

import type { InsightsDatabase, Learning } from '@code-agent-insights/core';

export async function recallTool(
  db: InsightsDatabase,
  args: {
    query: string;
    scope?: 'project' | 'global' | 'all';
    limit?: number;
  }
): Promise<string> {
  // Validate input
  if (!args.query || typeof args.query !== 'string') {
    return '⚠️ Search error: Query parameter is required and must be a string';
  }

  const query = args.query.trim();
  if (query.length === 0) {
    return '⚠️ Search error: Query cannot be empty';
  }

  if (query.length > 500) {
    return '⚠️ Search error: Query too long (max 500 characters)';
  }

  const limit = args.limit || 5;
  const scope = args.scope || 'all';

  // Validate limit
  if (limit < 1 || limit > 100) {
    return '⚠️ Search error: Limit must be between 1 and 100';
  }

  // Search learnings using FTS
  const allLearnings = db.searchLearnings(query, { limit: limit * 2 });

  // Filter by scope if specified
  let learnings = allLearnings;
  if (scope === 'global') {
    learnings = allLearnings.filter((l) => l.scope === 'global');
  } else if (scope === 'project') {
    learnings = allLearnings.filter((l) => l.scope === 'project');
  }

  // Take only the limit we need
  learnings = learnings.slice(0, limit);

  if (learnings.length === 0) {
    return `No learnings found for query: "${args.query}"${
      scope !== 'all' ? ` (scope: ${scope})` : ''
    }`;
  }

  // Group learnings by type
  const grouped = new Map<string, Learning[]>();
  for (const learning of learnings) {
    const type = learning.type;
    if (!grouped.has(type)) {
      grouped.set(type, []);
    }
    grouped.get(type)!.push(learning);
  }

  // Format as markdown
  let output = `# Recalled Learnings (${learnings.length})\n\n`;
  output += `Query: "${args.query}"`;
  if (scope !== 'all') {
    output += ` • Scope: ${scope}`;
  }
  output += '\n\n';

  // Sort groups by type for consistent output
  const sortedTypes = Array.from(grouped.keys()).sort();

  for (const type of sortedTypes) {
    const items = grouped.get(type)!;
    output += `## ${type.charAt(0).toUpperCase() + type.slice(1)}s (${items.length})\n\n`;

    for (const learning of items) {
      output += `### ${learning.content}\n\n`;

      // Metadata
      const metadata: string[] = [];
      metadata.push(`**Confidence:** ${(learning.confidence * 100).toFixed(0)}%`);
      metadata.push(`**Scope:** ${learning.scope}`);

      if (learning.projectPath) {
        metadata.push(`**Project:** ${learning.projectPath}`);
      }

      if (learning.tags.length > 0) {
        metadata.push(`**Tags:** ${learning.tags.join(', ')}`);
      }

      if (learning.relatedFiles.length > 0) {
        const files = learning.relatedFiles.slice(0, 3);
        metadata.push(`**Files:** ${files.join(', ')}${learning.relatedFiles.length > 3 ? '...' : ''}`);
      }

      output += metadata.join(' • ') + '\n\n';

      // Applied count if relevant
      if (learning.appliedCount > 0) {
        output += `_Applied ${learning.appliedCount} time${learning.appliedCount > 1 ? 's' : ''}_\n\n`;
      }
    }
  }

  output += '---\n\n';
  output += `_Tip: Use the \`remember\` tool to save new learnings during this session._`;

  return output;
}
