import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import Anthropic from '@anthropic-ai/sdk';
import {
  InsightsDatabase,
  type Session,
  type Learning,
} from '@code-agent-insights/core';
import { v4 as uuidv4 } from 'uuid';

interface ExtractOptions {
  all?: boolean;
  sessionId?: string;
  limit?: string;
  since?: string;
  force?: boolean;
  dryRun?: boolean;
}

const EXTRACT_PROMPT = `You are analyzing a coding session to extract learnings - reusable insights that can help in future sessions.

Given the session data below, identify and extract learnings in these categories:

**fix**: Specific solutions to bugs or errors
**pattern**: Reusable approaches or techniques
**convention**: Project-specific standards or preferences
**antipattern**: Things to avoid
**preference**: Tool or workflow choices

For each learning, provide:
- type: One of the categories above
- content: Clear, actionable description (1-2 sentences)
- tags: 3-5 relevant keywords
- confidence: 0.0-1.0 (how confident you are this is useful)

Focus on:
- Solutions to errors that were encountered and fixed
- Patterns or approaches that were successful
- Project-specific conventions discovered
- Tool usage patterns that worked well
- Things that didn't work (antipatterns)

IMPORTANT:
- Only extract learnings that would be useful in future sessions
- Be specific and actionable
- Don't extract obvious or trivial things
- Aim for 2-5 learnings per session (not more)
- If there are no significant learnings, return an empty array

Respond with ONLY valid JSON array, no markdown or explanation:
[
  {
    "type": "fix",
    "content": "...",
    "tags": ["tag1", "tag2", "tag3"],
    "confidence": 0.8
  }
]`;

function parseDateOption(dateStr: string): Date {
  const relativeMatch = dateStr.match(/^(\d+)([dwm])$/);
  if (relativeMatch) {
    const value = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    const now = new Date();

    switch (unit) {
      case 'd':
        now.setDate(now.getDate() - value);
        return now;
      case 'w':
        now.setDate(now.getDate() - (value * 7));
        return now;
      case 'm':
        now.setDate(now.getDate() - (value * 30));
        return now;
      default:
        throw new Error(`Invalid unit: ${unit}`);
    }
  }

  const isoMatch = dateStr.match(/^\d{4}-\d{2}-\d{2}$/);
  if (isoMatch) {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid date: ${dateStr}`);
    }
    return date;
  }

  throw new Error(
    `Invalid date format: "${dateStr}". Use: 7d, 2w, 30d, or YYYY-MM-DD`
  );
}

function buildSessionContext(
  db: InsightsDatabase,
  session: Session
): string {
  // Get events
  const events = db.getEventsForSession(session.id);

  // Get errors
  const errors = db.db.prepare(`
    SELECT * FROM errors WHERE session_id = ? ORDER BY timestamp
  `).all(session.id) as any[];

  // Get tool calls
  const toolCalls = db.db.prepare(`
    SELECT * FROM tool_calls WHERE session_id = ? ORDER BY timestamp
  `).all(session.id) as any[];

  // Build context
  let context = `Session: ${session.id}\n`;
  context += `Project: ${session.projectName || 'Unknown'}\n`;
  context += `Duration: ${session.turnCount} turns\n`;
  context += `Status: ${session.status}\n`;
  context += `Outcome: ${session.outcome}\n\n`;

  // Add errors (most important for learnings)
  if (errors.length > 0) {
    context += `Errors encountered (${errors.length}):\n`;
    errors.forEach(err => {
      context += `- ${err.error_type}: ${err.error_message}\n`;
      if (err.resolved) {
        context += `  ✓ Resolved\n`;
      }
    });
    context += '\n';
  }

  // Add file modifications
  if (session.filesModified > 0) {
    context += `Files modified: ${session.filesModified}\n\n`;
  }

  // Add sample of key events (user messages, errors)
  const keyEvents = events.filter(e =>
    e.type === 'user_message' || e.type === 'error'
  ).slice(0, 5);

  if (keyEvents.length > 0) {
    context += `Key events:\n`;
    keyEvents.forEach(event => {
      const preview = event.content
        ? event.content.substring(0, 150).replace(/\n/g, ' ')
        : '';
      context += `- [${event.type}] ${preview}...\n`;
    });
    context += '\n';
  }

  // Add tool usage summary
  if (toolCalls.length > 0) {
    const toolNames = [...new Set(toolCalls.map(tc => tc.tool_name))];
    context += `Tools used: ${toolNames.slice(0, 10).join(', ')}\n`;
  }

  return context;
}

export const extractCommand = new Command('extract')
  .description('Extract learnings from coding sessions')
  .option('--all', 'Extract from all sessions without learnings (no limit)')
  .option('--session-id <id>', 'Extract from specific session')
  .option('-n, --limit <number>', 'Max sessions to process (default: 10)', '10')
  .option('--since <date>', 'Extract from sessions since date (e.g., 7d, 30d)')
  .option('--force', 'Re-extract even if learnings exist')
  .option('--dry-run', 'Show what would be extracted without calling API')
  .addHelpText('after', `
Examples:
  $ cai extract                  Extract from 10 sessions without learnings
  $ cai extract --all            Extract from ALL sessions without learnings
  $ cai extract --limit 20       Extract from up to 20 sessions
  $ cai extract --since 30d      Extract from last 30 days
  $ cai extract --session-id abc Extract from specific session
  $ cai extract --force --limit 5  Re-extract from 5 most recent sessions
  $ cai extract --dry-run        Preview without API calls`)
  .action(async (options: ExtractOptions) => {
    // Check for API key
    if (!options.dryRun && !process.env.ANTHROPIC_API_KEY) {
      console.log(chalk.yellow('\n⚠  ANTHROPIC_API_KEY required for extraction'));
      console.log(chalk.dim('Set it with: export ANTHROPIC_API_KEY=your-key'));
      console.log(chalk.dim('Get your key from: https://console.anthropic.com/settings/keys\n'));
      return;
    }

    const db = new InsightsDatabase();

    try {
      const limit = options.all ? Number.MAX_SAFE_INTEGER : parseInt(options.limit || '10', 10);
      let sessionsToExtract: Session[] = [];

      // Determine which sessions to extract from
      if (options.sessionId) {
        const session = db.getSession(options.sessionId);
        if (!session) {
          console.log(chalk.red(`\n✗ Session not found: ${options.sessionId}\n`));
          return;
        }
        sessionsToExtract = [session];
      } else {
        // Get sessions without learnings
        const since = options.since ? parseDateOption(options.since) : undefined;

        if (options.force) {
          // Get all completed sessions
          const allSessions = db.db.prepare(`
            SELECT * FROM sessions
            WHERE status = 'completed'
            ${since ? 'AND started_at >= ?' : ''}
            ORDER BY started_at DESC
            LIMIT ?
          `).all(...(since ? [since.toISOString(), limit] : [limit])) as any[];

          sessionsToExtract = allSessions.map((row: any) => ({
            id: row.id,
            source: row.source,
            projectPath: row.project_path,
            projectName: row.project_name,
            startedAt: new Date(row.started_at),
            endedAt: row.ended_at ? new Date(row.ended_at) : undefined,
            status: row.status,
            tokenCount: row.token_count,
            turnCount: row.turn_count,
            toolCallCount: row.tool_call_count,
            errorCount: row.error_count,
            filesModified: row.files_modified,
            rawPath: row.raw_path,
            summary: row.summary,
            outcome: row.outcome,
            skillInvocationCount: row.skill_invocation_count,
            subAgentCount: row.sub_agent_count,
            usedPlanMode: row.used_plan_mode === 1,
            usedThinking: row.used_thinking === 1,
            usedSubAgents: row.used_sub_agents === 1,
            primaryTools: JSON.parse(row.primary_tools || '[]'),
          }));
        } else {
          sessionsToExtract = db.getSessionsWithoutLearnings(since, limit);
        }
      }

      if (sessionsToExtract.length === 0) {
        console.log(chalk.green('\n✓ No sessions need learning extraction\n'));
        console.log(chalk.dim('All sessions already have learnings extracted.'));
        console.log(chalk.dim('Use --force to re-extract.\n'));
        return;
      }

      console.log(chalk.blue(`\n📚 Learning Extraction\n`));
      console.log(chalk.dim(`Found ${sessionsToExtract.length} session${sessionsToExtract.length === 1 ? '' : 's'} to process`));

      if (options.dryRun) {
        console.log(chalk.yellow('\n🔍 Dry run - no API calls will be made\n'));
      }

      // Dry run - just show what would be processed
      if (options.dryRun) {
        console.log(chalk.bold('Sessions to extract learnings from:\n'));
        sessionsToExtract.forEach((session, i) => {
          const date = session.startedAt.toISOString().split('T')[0];
          console.log(chalk.dim(`${i + 1}. ${session.id.substring(0, 8)}... - ${session.projectName || 'Unknown'} (${date})`));
        });
        console.log(chalk.dim(`\nRun without --dry-run to extract learnings.\n`));
        return;
      }

      // Extract learnings
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      let successCount = 0;
      let errorCount = 0;
      let totalLearnings = 0;

      for (const session of sessionsToExtract) {
        const spinner = ora(`Extracting from session ${session.id.substring(0, 8)}...`).start();

        try {
          // Build context
          const context = buildSessionContext(db, session);

          // Call Claude API
          const response = await anthropic.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 2000,
            messages: [{
              role: 'user',
              content: `${EXTRACT_PROMPT}\n\n${context}`
            }]
          });

          // Parse response
          const textContent = response.content.find(c => c.type === 'text');
          if (!textContent || textContent.type !== 'text') {
            throw new Error('No text response from API');
          }

          const learningsData = JSON.parse(textContent.text);

          if (!Array.isArray(learningsData)) {
            throw new Error('Response is not an array');
          }

          // Delete existing learnings if force mode
          if (options.force) {
            db.db.prepare(`
              DELETE FROM learnings WHERE session_id = ?
            `).run(session.id);
          }

          // Save learnings
          let sessionLearningCount = 0;
          for (const learning of learningsData) {
            const learningId = uuidv4();
            db.db.prepare(`
              INSERT INTO learnings (
                id, session_id, project_path, content, type, scope,
                confidence, tags, related_files, related_errors,
                source, applied_count, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              learningId,
              session.id,
              session.projectPath,
              learning.content,
              learning.type || 'pattern',
              'project',
              learning.confidence || 0.7,
              JSON.stringify(learning.tags || []),
              JSON.stringify([]),
              JSON.stringify([]),
              'extracted',
              0,
              new Date().toISOString()
            );
            sessionLearningCount++;
          }

          totalLearnings += sessionLearningCount;
          successCount++;

          if (sessionLearningCount > 0) {
            spinner.succeed(`Extracted ${sessionLearningCount} learning${sessionLearningCount === 1 ? '' : 's'} from ${session.id.substring(0, 8)}...`);
          } else {
            spinner.info(`No learnings extracted from ${session.id.substring(0, 8)}... (session had no significant insights)`);
          }

        } catch (error) {
          errorCount++;
          spinner.fail(`Failed to extract from ${session.id.substring(0, 8)}...: ${(error as Error).message}`);
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Summary
      console.log(chalk.bold(`\n📊 Extraction Summary\n`));
      console.log(chalk.green(`✓ Successful: ${successCount}/${sessionsToExtract.length}`));
      if (errorCount > 0) {
        console.log(chalk.red(`✗ Failed: ${errorCount}`));
      }
      console.log(chalk.cyan(`📚 Total learnings extracted: ${totalLearnings}`));

      if (totalLearnings > 0) {
        console.log(chalk.dim(`\nRun ${chalk.cyan('cai review')} to review extracted learnings.`));
      }
      console.log('');

    } catch (error) {
      console.error(chalk.red(`\n✗ Error: ${(error as Error).message}\n`));
      process.exit(1);
    } finally {
      db.close();
    }
  });
