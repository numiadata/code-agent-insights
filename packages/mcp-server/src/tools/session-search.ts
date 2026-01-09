/**
 * Session Search Tool
 *
 * Dedicated tool for searching sessions by content, date, or outcome
 */

import type { InsightsDatabase } from '@code-agent-insights/core';

export interface SessionSearchParams {
  query: string;
  project_path?: string;
  since?: string; // ISO date or relative: "7d", "2w", "1m"
  outcome?: 'success' | 'partial' | 'failure' | 'unknown';
  limit?: number;
}

export interface SessionSearchResult {
  sessions: Array<{
    id: string;
    projectName: string;
    projectPath: string;
    date: string;
    duration: string;
    outcome: string;
    summary?: string;
    workDone?: string[];
    filesChanged?: string[];
    errorsEncountered?: string[];
    errorsResolved?: string[];
    learningCount: number;
  }>;
  totalFound: number;
  error?: string;
}

function parseRelativeDate(since: string): Date {
  const now = new Date();
  const match = since.match(/^(\d+)([dwm])$/);

  if (!match) {
    // Try ISO date
    const date = new Date(since);
    if (!isNaN(date.getTime())) return date;
    throw new Error(`Invalid date format: ${since}`);
  }

  const [, num, unit] = match;
  const n = parseInt(num, 10);

  switch (unit) {
    case 'd':
      return new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
    case 'w':
      return new Date(now.getTime() - n * 7 * 24 * 60 * 60 * 1000);
    case 'm':
      return new Date(now.getTime() - n * 30 * 24 * 60 * 60 * 1000);
    default:
      throw new Error(`Invalid date unit: ${unit}`);
  }
}

export async function sessionSearch(
  db: InsightsDatabase,
  params: SessionSearchParams
): Promise<SessionSearchResult> {
  // Validation
  if (!params.query || typeof params.query !== 'string') {
    return { sessions: [], totalFound: 0, error: 'Query required' };
  }

  const query = params.query.trim();
  const limit = Math.min(Math.max(params.limit || 10, 1), 50);

  // Parse since date if provided
  let sinceDate: Date | null = null;
  if (params.since) {
    try {
      sinceDate = parseRelativeDate(params.since);
    } catch (e) {
      return {
        sessions: [],
        totalFound: 0,
        error: `Invalid since date: ${params.since}`,
      };
    }
  }

  // Search session summaries
  const summaries = db.searchSessionSummaries(query, {
    limit: limit * 2, // Get extra to filter
    projectPath: params.project_path,
  });

  // Also search events to find sessions without summaries
  const events = db.searchEvents(query, { limit: limit * 2 });
  const eventSessionIds = [...new Set(events.map((e) => e.sessionId))];

  // Combine and deduplicate session IDs
  const allSessionIds = new Set<string>([
    ...summaries.map((s) => s.sessionId),
    ...eventSessionIds,
  ]);

  const results: SessionSearchResult['sessions'] = [];

  for (const sessionId of allSessionIds) {
    if (results.length >= limit) break;

    const session = db.getSession(sessionId);
    if (!session) continue;

    // Apply filters
    if (params.project_path && session.projectPath !== params.project_path) continue;
    if (params.outcome && session.outcome !== params.outcome) continue;
    if (sinceDate && session.startedAt < sinceDate) continue;

    // Get summary if available
    const summary = db.getSessionSummary(sessionId);

    // Get learning count
    const learnings = db.getLearningsForSession(sessionId);

    // Calculate duration
    let duration = 'Unknown';
    if (session.endedAt) {
      const mins = Math.round(
        (session.endedAt.getTime() - session.startedAt.getTime()) / 60000
      );
      duration = mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h ${mins % 60}m`;
    }

    results.push({
      id: session.id,
      projectName: session.projectName || 'Unknown',
      projectPath: session.projectPath,
      date: session.startedAt.toLocaleDateString(),
      duration,
      outcome: session.outcome,
      summary: summary?.summary || session.summary,
      workDone: summary?.workDone,
      filesChanged: summary?.filesChanged,
      errorsEncountered: summary?.errorsEncountered,
      errorsResolved: summary?.errorsResolved,
      learningCount: learnings.length,
    });
  }

  // Sort by date descending
  results.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  return {
    sessions: results.slice(0, limit),
    totalFound: results.length,
  };
}

export function formatSessionSearchResponse(result: SessionSearchResult): string {
  if (result.error) {
    return `⚠️ Search error: ${result.error}`;
  }

  if (result.sessions.length === 0) {
    return 'No matching sessions found.';
  }

  const parts: string[] = [`## Found ${result.totalFound} Sessions\n`];

  for (const s of result.sessions) {
    parts.push(`### ${s.projectName} — ${s.date} (${s.duration})`);
    parts.push(`**Outcome:** ${s.outcome} | **Learnings:** ${s.learningCount}`);

    if (s.summary) {
      parts.push(`\n${s.summary}`);
    }

    if (s.workDone && s.workDone.length > 0) {
      parts.push('\n**Work done:**');
      for (const w of s.workDone.slice(0, 5)) {
        parts.push(`- ${w}`);
      }
    }

    if (s.errorsResolved && s.errorsResolved.length > 0) {
      parts.push('\n**Errors resolved:**');
      for (const e of s.errorsResolved.slice(0, 3)) {
        parts.push(`- ${e}`);
      }
    }

    if (s.filesChanged && s.filesChanged.length > 0) {
      const fileList = s.filesChanged.slice(0, 5).join(', ');
      parts.push(
        `\n**Files:** ${fileList}${
          s.filesChanged.length > 5 ? ` (+${s.filesChanged.length - 5} more)` : ''
        }`
      );
    }

    parts.push('');
  }

  return parts.join('\n');
}

// Legacy function for backwards compatibility
export async function sessionSearchTool(
  db: InsightsDatabase,
  args: SessionSearchParams
): Promise<string> {
  const result = await sessionSearch(db, args);
  return formatSessionSearchResponse(result);
}
