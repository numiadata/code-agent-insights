import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { InsightsDatabase, type Learning, type Session } from '@code-agent-insights/core';
import Anthropic from '@anthropic-ai/sdk';

interface SearchOptions {
  limit?: string;
  summarize?: boolean;
  project?: string;
  since?: string;
}

function parseRelativeDate(since: string): Date {
  const now = new Date();
  const match = since.match(/^(\d+)([dwm])$/);

  if (!match) {
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

export const searchCommand = new Command('search')
  .description('Search coding agent sessions')
  .argument('<query>', 'Search query')
  .option('-n, --limit <number>', 'Limit number of results', '10')
  .option('--summarize', 'Generate AI summary of findings')
  .option('-p, --project <path>', 'Filter by project path')
  .option('--since <date>', 'Only results after date (YYYY-MM-DD, 7d, 2w, 1m)')
  .action(async (query: string, options: SearchOptions) => {
    const db = new InsightsDatabase();

    try {
      // 2. Parse limit as integer
      const limit = parseInt(options.limit || '10', 10);

      // Parse since date if provided
      let sinceDate: Date | null = null;
      if (options.since) {
        try {
          sinceDate = parseRelativeDate(options.since);
          console.log(
            chalk.dim(
              `Filtering to results after ${sinceDate.toLocaleDateString()}\n`
            )
          );
        } catch (e) {
          console.log(chalk.red(`Invalid --since date: ${options.since}`));
          return;
        }
      }

      // 3. Log blue: "Searching for: "{query}""
      console.log(chalk.blue(`Searching for: "${query}"\n`));

      // 4. Search learnings
      let learnings = db.searchLearnings(query, {
        projectPath: options.project,
        limit,
      });

      // Filter learnings by date
      if (sinceDate) {
        learnings = learnings.filter((l) => l.createdAt >= sinceDate);
      }

      // 5. Search events
      const events = db.searchEvents(query, { limit });

      // 6. Get unique sessions from events
      const sessionIds = [...new Set(events.map((e) => e.sessionId))];
      let sessions = sessionIds
        .map((id) => db.getSession(id))
        .filter((s): s is Session => s !== null);

      // Filter sessions by date
      if (sinceDate) {
        sessions = sessions.filter((s) => s.startedAt >= sinceDate);
      }

      // Fetch session summaries from session_summaries table
      const sessionsWithSummaries = sessions.map((session) => ({
        ...session,
        summaryData: db.getSessionSummary(session.id),
      }));

      // 7. Display learnings if any
      if (learnings.length > 0) {
        console.log(chalk.green.bold(`📚 Learnings (${learnings.length}):\n`));
        for (const learning of learnings) {
          console.log(chalk.cyan(`[${learning.type}]`) + ` ${learning.content}`);
          if (learning.tags.length > 0) {
            console.log(chalk.dim(`  Tags: ${learning.tags.join(', ')}`));
          }
          console.log('');
        }
      }

      // 8. Display sessions if any
      if (sessionsWithSummaries.length > 0) {
        console.log(chalk.green.bold(`📁 Related Sessions (${sessionsWithSummaries.length}):\n`));
        for (const sessionWithSummary of sessionsWithSummaries) {
          console.log(chalk.cyan(sessionWithSummary.projectName || 'Unknown'));

          // Format date
          const date = sessionWithSummary.startedAt.toLocaleDateString();
          console.log(
            chalk.dim(
              `  ${date} • ${sessionWithSummary.turnCount} turns • Outcome: ${sessionWithSummary.outcome}`
            )
          );

          // Summary from session_summaries table
          if (sessionWithSummary.summaryData?.summary) {
            console.log(chalk.dim(`  ${sessionWithSummary.summaryData.summary}`));
          }

          // Show skill/mode info if present
          const features: string[] = [];
          if (sessionWithSummary.skillInvocationCount > 0) {
            features.push(`Skills: ${sessionWithSummary.skillInvocationCount}`);
          }
          if (sessionWithSummary.usedPlanMode) {
            features.push('Used plan mode');
          }
          if (sessionWithSummary.subAgentCount > 0) {
            features.push(`Sub-agents: ${sessionWithSummary.subAgentCount}`);
          }

          if (features.length > 0) {
            console.log(chalk.dim(`  ${features.join(' • ')}`));
          }

          console.log('');
        }
      }

      // 9. If no results
      if (learnings.length === 0 && sessionsWithSummaries.length === 0) {
        console.log(chalk.yellow('No results found.'));
      }

      // 10. If options.summarize AND process.env.ANTHROPIC_API_KEY
      if (options.summarize && process.env.ANTHROPIC_API_KEY) {
        console.log(chalk.blue.bold('\n🤖 AI Summary:\n'));
        const spinner = ora('Generating summary...').start();

        try {
          const summary = await generateSummary(query, learnings, sessionsWithSummaries);
          spinner.stop();
          console.log(summary);
        } catch (error) {
          spinner.fail('Failed to generate summary');
          console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
        }
      } else if (options.summarize && !process.env.ANTHROPIC_API_KEY) {
        console.log(
          chalk.yellow('\n⚠ Skipping AI summary: ANTHROPIC_API_KEY not set')
        );
      }
    } finally {
      // 11. Close database in finally block
      db.close();
    }
  });

// Async function generateSummary
async function generateSummary(
  query: string,
  learnings: Learning[],
  sessionsWithSummaries: Array<Session & { summaryData: ReturnType<InsightsDatabase['getSessionSummary']> }>
): Promise<string> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Build context string
  let context = `Query: "${query}"\n\n`;

  if (learnings.length > 0) {
    context += `Learnings found:\n`;
    for (const learning of learnings) {
      context += `- [${learning.type}] ${learning.content}\n`;
    }
    context += '\n';
  }

  if (sessionsWithSummaries.length > 0) {
    context += `Sessions found:\n`;
    for (const sessionWithSummary of sessionsWithSummaries) {
      const features: string[] = [];
      if (sessionWithSummary.skillInvocationCount > 0) {
        features.push(`${sessionWithSummary.skillInvocationCount} skills`);
      }
      if (sessionWithSummary.usedPlanMode) {
        features.push('plan mode');
      }
      if (sessionWithSummary.subAgentCount > 0) {
        features.push(`${sessionWithSummary.subAgentCount} sub-agents`);
      }

      context += `- ${sessionWithSummary.projectName || 'Unknown'}: ${sessionWithSummary.outcome}`;
      if (features.length > 0) {
        context += ` (${features.join(', ')})`;
      }
      if (sessionWithSummary.summaryData?.summary) {
        context += `\n  ${sessionWithSummary.summaryData.summary}`;
      }
      context += '\n';
    }
  }

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system:
      'You summarize search results from a coding agent session database. Provide brief, actionable insights.',
    messages: [
      {
        role: 'user',
        content: `${context}\n\nProvide a brief, actionable summary focusing on patterns, solutions, and insights. Keep it concise (2-3 paragraphs).`,
      },
    ],
  });

  const textContent = message.content.find((c) => c.type === 'text');
  return textContent && 'text' in textContent ? textContent.text : 'No summary generated';
}
