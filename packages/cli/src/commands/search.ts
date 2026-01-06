import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { InsightsDatabase, type Learning, type Session } from '@code-agent-insights/core';
import Anthropic from '@anthropic-ai/sdk';

interface SearchOptions {
  limit?: string;
  summarize?: boolean;
  project?: string;
}

export const searchCommand = new Command('search')
  .description('Search coding agent sessions')
  .argument('<query>', 'Search query')
  .option('-n, --limit <number>', 'Limit number of results', '10')
  .option('--summarize', 'Generate AI summary of findings')
  .option('-p, --project <path>', 'Filter by project path')
  .action(async (query: string, options: SearchOptions) => {
    const db = new InsightsDatabase();

    try {
      // 2. Parse limit as integer
      const limit = parseInt(options.limit || '10', 10);

      // 3. Log blue: "Searching for: "{query}""
      console.log(chalk.blue(`Searching for: "${query}"\n`));

      // 4. Search learnings
      const learnings = db.searchLearnings(query, {
        projectPath: options.project,
        limit,
      });

      // 5. Search events
      const events = db.searchEvents(query, { limit });

      // 6. Get unique sessions from events
      const sessionIds = [...new Set(events.map((e) => e.sessionId))];
      const sessions = sessionIds
        .map((id) => db.getSession(id))
        .filter((s): s is Session => s !== null);

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
      if (sessions.length > 0) {
        console.log(chalk.green.bold(`📁 Related Sessions (${sessions.length}):\n`));
        for (const session of sessions) {
          console.log(chalk.cyan(session.projectName || 'Unknown'));

          // Format date
          const date = session.startedAt.toLocaleDateString();
          console.log(
            chalk.dim(
              `  ${date} • ${session.turnCount} turns • Outcome: ${session.outcome}`
            )
          );

          // Summary if exists
          if (session.summary) {
            console.log(chalk.dim(`  ${session.summary}`));
          }

          // Show skill/mode info if present
          const features: string[] = [];
          if (session.skillInvocationCount > 0) {
            features.push(`Skills: ${session.skillInvocationCount}`);
          }
          if (session.usedPlanMode) {
            features.push('Used plan mode');
          }
          if (session.subAgentCount > 0) {
            features.push(`Sub-agents: ${session.subAgentCount}`);
          }

          if (features.length > 0) {
            console.log(chalk.dim(`  ${features.join(' • ')}`));
          }

          console.log('');
        }
      }

      // 9. If no results
      if (learnings.length === 0 && sessions.length === 0) {
        console.log(chalk.yellow('No results found.'));
      }

      // 10. If options.summarize AND process.env.ANTHROPIC_API_KEY
      if (options.summarize && process.env.ANTHROPIC_API_KEY) {
        console.log(chalk.blue.bold('\n🤖 AI Summary:\n'));
        const spinner = ora('Generating summary...').start();

        try {
          const summary = await generateSummary(query, learnings, sessions);
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
  sessions: Session[]
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

  if (sessions.length > 0) {
    context += `Sessions found:\n`;
    for (const session of sessions) {
      const features: string[] = [];
      if (session.skillInvocationCount > 0) {
        features.push(`${session.skillInvocationCount} skills`);
      }
      if (session.usedPlanMode) {
        features.push('plan mode');
      }
      if (session.subAgentCount > 0) {
        features.push(`${session.subAgentCount} sub-agents`);
      }

      context += `- ${session.projectName || 'Unknown'}: ${session.outcome}`;
      if (features.length > 0) {
        context += ` (${features.join(', ')})`;
      }
      if (session.summary) {
        context += `\n  ${session.summary}`;
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
