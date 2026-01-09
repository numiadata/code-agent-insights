/**
 * Recall Tool
 *
 * Search learnings, sessions, and summaries for relevant context
 */

import type { InsightsDatabase } from '@code-agent-insights/core';
import * as path from 'path';

export interface RecallParams {
  query: string;
  scope?: 'project' | 'global' | 'all';
  limit?: number;
  include?: ('learnings' | 'sessions' | 'summaries')[];
}

export interface RecallResult {
  learnings: Array<{
    type: string;
    content: string;
    tags: string[];
    confidence: number;
    projectPath?: string;
  }>;
  sessions: Array<{
    id: string;
    projectName: string;
    date: string;
    summary?: string;
    outcome: string;
    workDone?: string[];
    filesChanged?: string[];
  }>;
  totalFound: number;
  error?: string;
}

function getCurrentProjectPath(): string | undefined {
  // Get current working directory as project path
  const cwd = process.cwd();
  return cwd;
}

export async function recall(
  db: InsightsDatabase,
  params: RecallParams
): Promise<RecallResult> {
  // Validation
  if (!params.query || typeof params.query !== 'string') {
    return { learnings: [], sessions: [], totalFound: 0, error: 'Query required' };
  }

  const query = params.query.trim();
  if (query.length === 0) {
    return { learnings: [], sessions: [], totalFound: 0, error: 'Query cannot be empty' };
  }

  const limit = Math.min(Math.max(params.limit || 5, 1), 100);
  const include = params.include || ['learnings', 'sessions', 'summaries'];

  const result: RecallResult = {
    learnings: [],
    sessions: [],
    totalFound: 0,
  };

  // Search learnings
  if (include.includes('learnings')) {
    const learnings = db.searchLearnings(query, {
      limit,
      projectPath: params.scope === 'project' ? getCurrentProjectPath() : undefined,
    });

    result.learnings = learnings.map((l) => ({
      type: l.type,
      content: l.content,
      tags: l.tags || [],
      confidence: l.confidence,
      projectPath: l.projectPath,
    }));
  }

  // Search session summaries
  if (include.includes('sessions') || include.includes('summaries')) {
    const summaries = db.searchSessionSummaries(query, {
      limit,
      projectPath: params.scope === 'project' ? getCurrentProjectPath() : undefined,
    });

    for (const summary of summaries) {
      const session = db.getSession(summary.sessionId);
      if (session) {
        result.sessions.push({
          id: session.id,
          projectName: session.projectName || 'Unknown',
          date: session.startedAt.toLocaleDateString(),
          summary: summary.summary,
          outcome: session.outcome,
          workDone: summary.workDone,
          filesChanged: summary.filesChanged,
        });
      }
    }
  }

  // Also search events for sessions without summaries
  if (include.includes('sessions')) {
    const events = db.searchEvents(query, { limit });
    const sessionIds = new Set(result.sessions.map((s) => s.id));

    // Get unique sessions from event results
    const eventSessionIds = [...new Set(events.map((e) => e.sessionId))];

    for (const sessionId of eventSessionIds) {
      if (sessionIds.has(sessionId)) continue; // Already have this session

      const session = db.getSession(sessionId);
      if (!session) continue;

      // Check scope
      if (params.scope === 'project') {
        const projectPath = getCurrentProjectPath();
        if (session.projectPath !== projectPath) continue;
      }

      result.sessions.push({
        id: session.id,
        projectName: session.projectName || 'Unknown',
        date: session.startedAt.toLocaleDateString(),
        summary: session.summary,
        outcome: session.outcome,
      });

      if (result.sessions.length >= limit) break;
    }
  }

  result.totalFound = result.learnings.length + result.sessions.length;

  return result;
}

export function formatRecallResponse(result: RecallResult): string {
  if (result.error) {
    return `⚠️ Search error: ${result.error}`;
  }

  const parts: string[] = [];

  // Sessions with summaries first (most useful)
  if (result.sessions.length > 0) {
    parts.push('## Relevant Past Sessions\n');

    for (const s of result.sessions) {
      parts.push(`### ${s.projectName} (${s.date}) — ${s.outcome}`);

      if (s.summary) {
        parts.push(s.summary);
      }

      if (s.workDone && s.workDone.length > 0) {
        parts.push('\n**Work done:**');
        for (const work of s.workDone.slice(0, 5)) {
          parts.push(`- ${work}`);
        }
      }

      if (s.filesChanged && s.filesChanged.length > 0) {
        parts.push(
          `\n**Files:** ${s.filesChanged.slice(0, 5).join(', ')}${
            s.filesChanged.length > 5 ? '...' : ''
          }`
        );
      }

      parts.push('');
    }
  }

  // Learnings
  if (result.learnings.length > 0) {
    parts.push('## Relevant Learnings\n');

    for (const l of result.learnings) {
      parts.push(`**[${l.type}]** ${l.content}`);
      if (l.tags.length > 0) {
        parts.push(`_Tags: ${l.tags.join(', ')}_`);
      }
      parts.push('');
    }
  }

  if (result.totalFound === 0) {
    parts.push('No relevant past context found for this query.');
  }

  return parts.join('\n');
}

// Legacy function for backwards compatibility
export async function recallTool(
  db: InsightsDatabase,
  args: {
    query: string;
    scope?: 'project' | 'global' | 'all';
    limit?: number;
  }
): Promise<string> {
  const result = await recall(db, args);
  return formatRecallResponse(result);
}
