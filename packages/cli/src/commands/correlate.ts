import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import { InsightsDatabase } from '@code-agent-insights/core';
import { getGitInfo, getRecentCommits, getFilesChangedInCommit } from '../utils/git';

interface CorrelateOptions {
  project?: string;
  since?: string;
}

interface SessionCommitCorrelation {
  session: any;
  commit: any;
  confidence: number;
  commonFiles: string[];
}

function parseSinceDate(since: string): Date {
  // Try parsing as ISO date first
  const isoMatch = since.match(/^\d{4}-\d{2}-\d{2}$/);
  if (isoMatch) {
    const date = new Date(since);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid date: ${since}. Use format YYYY-MM-DD`);
    }
    return date;
  }

  // Try parsing relative formats
  const relativeMatch = since.match(/^(\d+)([dwm])$/);
  if (relativeMatch) {
    const value = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    const now = new Date();

    switch (unit) {
      case 'd': // days
        now.setDate(now.getDate() - value);
        return now;
      case 'w': // weeks
        now.setDate(now.getDate() - (value * 7));
        return now;
      case 'm': // months (approximate as 30 days)
        now.setDate(now.getDate() - (value * 30));
        return now;
      default:
        throw new Error(`Invalid unit: ${unit}`);
    }
  }

  throw new Error(
    `Invalid --since format: "${since}". Use:\n` +
    `  - ISO date: 2025-01-01\n` +
    `  - Relative days: 7d\n` +
    `  - Relative weeks: 2w\n` +
    `  - Relative months: 1m`
  );
}

function getSessionFiles(db: InsightsDatabase, sessionId: string): Set<string> {
  const files = new Set<string>();

  // Get file events
  const events = db.db.prepare(`
    SELECT content FROM events
    WHERE session_id = ? AND type IN ('file_read', 'file_write', 'file_create')
  `).all(sessionId) as Array<{ content: string }>;

  for (const event of events) {
    if (event.content) {
      // Normalize file path (remove leading slash, etc.)
      const normalized = event.content.replace(/^\/+/, '');
      files.add(normalized);
    }
  }

  return files;
}

function calculateCorrelationConfidence(
  session: any,
  commit: any,
  commitFiles: string[],
  sessionFiles: Set<string>
): { confidence: number; commonFiles: string[] } {
  // Time proximity (max 2 hours between session end and commit)
  const sessionEndTime = new Date(session.ended_at || session.endedAt || session.started_at || session.startedAt);
  const commitTime = new Date(commit.date);

  if (isNaN(sessionEndTime.getTime()) || isNaN(commitTime.getTime())) {
    return { confidence: 0, commonFiles: [] };
  }

  const timeDiffMs = Math.abs(commitTime.getTime() - sessionEndTime.getTime());
  const timeDiffHours = timeDiffMs / (1000 * 60 * 60);
  const timeScore = Math.max(0, 1 - (timeDiffHours / 2)); // 0-1, decreases over 2 hours

  // File overlap
  const commonFiles: string[] = [];
  for (const commitFile of commitFiles) {
    // Check for exact match or substring match (handles absolute vs relative paths)
    for (const sessionFile of sessionFiles) {
      if (sessionFile.includes(commitFile) || commitFile.includes(sessionFile)) {
        commonFiles.push(commitFile);
        break;
      }
    }
  }

  const fileScore = commitFiles.length > 0 ? commonFiles.length / commitFiles.length : 0;

  // Combined confidence (weighted average: 40% time, 60% files)
  const confidence = (timeScore * 0.4) + (fileScore * 0.6);

  return { confidence, commonFiles };
}

export const correlateCommand = new Command('correlate')
  .description('Correlate coding sessions with git commits')
  .option('-p, --project <path>', 'Project to analyze (default: current directory)')
  .option('--since <date>', 'Look at sessions/commits since date (default: 30d)', '30d')
  .addHelpText('after', `
Examples:
  $ cai correlate                     Analyze current project (last 30 days)
  $ cai correlate -p /path/to/project Analyze specific project
  $ cai correlate --since 7d          Last 7 days only
  $ cai correlate --since 2025-01-01  Since specific date`)
  .action(async (options: CorrelateOptions) => {
    const db = new InsightsDatabase();

    try {
      // Determine project path
      const projectPath = path.resolve(options.project || process.cwd());

      // Parse since date
      const sinceDate = parseSinceDate(options.since || '30d');

      // Check if it's a git repo
      const gitInfo = getGitInfo(projectPath);
      if (!gitInfo.isRepo) {
        console.log(chalk.yellow('\n⚠ Not a git repository:', projectPath));
        console.log(chalk.dim('Git integration requires a git repository.'));
        return;
      }

      console.log(chalk.blue(`\n📊 Session Correlation Report\n`));
      console.log(chalk.dim(`Project: ${projectPath}`));
      console.log(chalk.dim(`Branch: ${gitInfo.branch || 'unknown'}`));
      console.log(chalk.dim(`Since: ${sinceDate.toISOString().split('T')[0]}\n`));

      // Get recent commits
      const commits = getRecentCommits(projectPath, sinceDate, 50);

      if (commits.length === 0) {
        console.log(chalk.yellow('No commits found in date range.'));
        return;
      }

      console.log(chalk.dim(`Found ${commits.length} commits\n`));

      // Get files for each commit
      const commitFilesMap = new Map<string, string[]>();
      for (const commit of commits) {
        const files = getFilesChangedInCommit(projectPath, commit.hash);
        commitFilesMap.set(commit.hash, files);
      }

      // Get sessions for this project
      const sessions = db.db.prepare(`
        SELECT * FROM sessions
        WHERE project_path LIKE ?
        AND started_at >= ?
        ORDER BY started_at DESC
      `).all(`%${path.basename(projectPath)}%`, sinceDate.toISOString()) as any[];

      if (sessions.length === 0) {
        console.log(chalk.yellow('No sessions found for this project in date range.'));
        return;
      }

      console.log(chalk.dim(`Found ${sessions.length} sessions\n`));

      // Correlate sessions with commits
      const correlations: SessionCommitCorrelation[] = [];
      const unmatchedSessions: any[] = [];

      for (const session of sessions) {
        const sessionFiles = getSessionFiles(db, session.id);
        let bestMatch: SessionCommitCorrelation | null = null;

        for (const commit of commits) {
          const commitFiles = commitFilesMap.get(commit.hash) || [];
          const { confidence, commonFiles } = calculateCorrelationConfidence(
            session,
            commit,
            commitFiles,
            sessionFiles
          );

          // Only consider matches with confidence > 0.3
          if (confidence > 0.3 && (!bestMatch || confidence > bestMatch.confidence)) {
            bestMatch = {
              session,
              commit,
              confidence,
              commonFiles
            };
          }
        }

        if (bestMatch) {
          correlations.push(bestMatch);
        } else {
          unmatchedSessions.push(session);
        }
      }

      // Display correlations
      if (correlations.length > 0) {
        console.log(chalk.green(`✓ Sessions with likely commits (${correlations.length}):\n`));

        // Sort by confidence
        correlations.sort((a, b) => b.confidence - a.confidence);

        for (const corr of correlations) {
          const startedAt = new Date(corr.session.started_at || corr.session.startedAt);
          const sessionDate = !isNaN(startedAt.getTime())
            ? startedAt.toISOString().split('T').join(' ').split('.')[0]
            : 'unknown date';
          const commitHash = corr.commit.hash.substring(0, 7);
          const commitMsg = corr.commit.message.substring(0, 50);
          const confidencePercent = Math.round(corr.confidence * 100);

          console.log(chalk.green(`  ✓ Session ${sessionDate}`));
          console.log(chalk.dim(`    → Commit ${commitHash} "${commitMsg}" (${confidencePercent}% confidence)`));

          if (corr.commonFiles.length > 0) {
            const filesPreview = corr.commonFiles.slice(0, 3).join(', ');
            const moreCount = corr.commonFiles.length - 3;
            console.log(chalk.dim(`    Files: ${filesPreview}${moreCount > 0 ? ` +${moreCount} more` : ''}`));
          }
          console.log('');
        }
      }

      // Display unmatched sessions
      if (unmatchedSessions.length > 0) {
        console.log(chalk.yellow(`⚠ Sessions without matching commits (${unmatchedSessions.length}):\n`));

        for (const session of unmatchedSessions.slice(0, 5)) {
          const startedAt = new Date(session.started_at || session.startedAt);
          const sessionDate = !isNaN(startedAt.getTime())
            ? startedAt.toISOString().split('T').join(' ').split('.')[0]
            : 'unknown date';
          const filesModified = session.files_modified || 0;
          console.log(chalk.yellow(`  ⚠ Session ${sessionDate} (${filesModified} files modified, no commit found)`));
        }

        if (unmatchedSessions.length > 5) {
          console.log(chalk.dim(`\n  ...and ${unmatchedSessions.length - 5} more`));
        }
        console.log('');
      }

      // Summary
      console.log(chalk.blue('Summary:'));
      const matchRate = sessions.length > 0 ? Math.round((correlations.length / sessions.length) * 100) : 0;
      console.log(chalk.dim(`  ${correlations.length}/${sessions.length} sessions correlated with commits (${matchRate}% match rate)`));

      if (matchRate < 50) {
        console.log(chalk.yellow('\n💡 Low match rate suggests:'));
        console.log(chalk.dim('   - Sessions may not result in commits'));
        console.log(chalk.dim('   - Commits may be batched after multiple sessions'));
        console.log(chalk.dim('   - File tracking may need improvement'));
      }

    } finally {
      db.close();
    }
  });
