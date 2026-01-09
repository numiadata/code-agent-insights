import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import Anthropic from '@anthropic-ai/sdk';
import {
  InsightsDatabase,
  type Session,
  type Event,
  type ToolCall,
  type ErrorRecord,
  type SessionSummary,
} from '@code-agent-insights/core';
import * as path from 'path';

interface SummarizeOptions {
  lastSession?: boolean;
  all?: boolean;
  sessionId?: string;
  limit?: string;
  force?: boolean;
  dryRun?: boolean;
}

const SUMMARIZE_PROMPT = `You are analyzing a coding session to create a structured summary.

Given the session data below, create a JSON summary with these fields:
- summary: One paragraph describing what was accomplished (2-3 sentences)
- work_done: Array of bullet points listing specific accomplishments
- files_changed: Array of file paths that were modified
- errors_encountered: Array of errors that occurred during the session
- errors_resolved: Array of errors that were fixed (subset of encountered)
- key_decisions: Array of important technical decisions made

Focus on:
- What was the main goal/task?
- What concrete changes were made?
- What problems were solved?
- What trade-offs or decisions were made?

Respond with ONLY valid JSON, no markdown or explanation:
{
  "summary": "...",
  "work_done": ["...", "..."],
  "files_changed": ["...", "..."],
  "errors_encountered": ["...", "..."],
  "errors_resolved": ["...", "..."],
  "key_decisions": ["...", "..."]
}`;

export const summarizeCommand = new Command('summarize')
  .description('Generate AI summaries for coding sessions')
  .option('--last-session', 'Summarize only the most recent session')
  .option('--all', 'Summarize all sessions without summaries')
  .option('--session-id <id>', 'Summarize specific session by ID')
  .option('-n, --limit <number>', 'Max sessions to summarize (default: 10)', '10')
  .option('--force', 'Re-summarize even if summary exists')
  .option('--dry-run', 'Show what would be summarized without calling API')
  .action(async (options: SummarizeOptions) => {
    // Check for API key
    if (!options.dryRun && !process.env.ANTHROPIC_API_KEY) {
      console.log(chalk.yellow('⚠  ANTHROPIC_API_KEY required for summarization'));
      console.log(chalk.dim('Set it with: export ANTHROPIC_API_KEY=your-key'));
      return;
    }

    const db = new InsightsDatabase();

    try {
      const limit = parseInt(options.limit || '10', 10);
      let sessionsToSummarize: Session[] = [];

      // Determine which sessions to summarize
      if (options.sessionId) {
        const session = db.getSession(options.sessionId);
        if (!session) {
          console.log(chalk.red(`✗ Session not found: ${options.sessionId}`));
          return;
        }
        sessionsToSummarize = [session];
      } else if (options.lastSession) {
        const allSessions = db.getSessions({ limit: 1 });
        sessionsToSummarize = allSessions;
      } else {
        // Get sessions without summaries or all if --force
        if (options.force) {
          sessionsToSummarize = db.getSessions({ limit });
        } else {
          sessionsToSummarize = db.getSessionsWithoutSummary(limit);
        }
      }

      if (sessionsToSummarize.length === 0) {
        console.log(chalk.green('✓ All sessions already have summaries!'));
        console.log(chalk.dim('Use --force to re-summarize existing sessions'));
        return;
      }

      console.log(
        chalk.blue(`📝 ${options.dryRun ? 'Would summarize' : 'Summarizing'} ${sessionsToSummarize.length} session(s)...\n`)
      );

      // Process each session
      for (const session of sessionsToSummarize) {
        const dateStr = session.startedAt.toISOString().split('T')[0];
        const timeStr = session.startedAt.toTimeString().split(' ')[0].slice(0, 5);

        if (options.dryRun) {
          console.log(
            chalk.dim(`Would summarize: ${session.projectName || session.projectPath} (${dateStr} ${timeStr})`)
          );
          continue;
        }

        const spinner = ora(
          `Summarizing ${session.projectName || session.projectPath} (${dateStr} ${timeStr})`
        ).start();

        try {
          // Build context for the session
          const events = db.getEvents(session.id);
          const toolCalls = db.getToolCalls(session.id);
          const errors = db.getErrors(session.id);

          const context = buildSummaryContext(session, events, toolCalls, errors);

          // Call Claude API
          const summaryData = await generateSummary(context);

          // Create SessionSummary object
          const sessionSummary: SessionSummary = {
            sessionId: session.id,
            summary: summaryData.summary,
            workDone: summaryData.work_done,
            filesChanged: summaryData.files_changed,
            errorsEncountered: summaryData.errors_encountered,
            errorsResolved: summaryData.errors_resolved,
            keyDecisions: summaryData.key_decisions,
            generatedAt: new Date(),
            modelUsed: 'claude-sonnet-4-20250514',
          };

          // Save to database
          db.insertSessionSummary(sessionSummary);

          spinner.succeed(
            `Summarized ${session.projectName || session.projectPath} (${dateStr} ${timeStr})`
          );

          // Display summary
          console.log();
          console.log(chalk.bold('## Session Summary'));
          console.log(summaryData.summary);
          console.log();

          if (summaryData.work_done.length > 0) {
            console.log(chalk.bold('**Work Done:**'));
            for (const item of summaryData.work_done) {
              console.log(`- ${item}`);
            }
            console.log();
          }

          if (summaryData.files_changed.length > 0) {
            console.log(chalk.bold(`**Files Changed:** ${summaryData.files_changed.length} files`));
            for (const file of summaryData.files_changed.slice(0, 5)) {
              console.log(chalk.dim(`- ${file}`));
            }
            if (summaryData.files_changed.length > 5) {
              console.log(chalk.dim(`  ... and ${summaryData.files_changed.length - 5} more`));
            }
            console.log();
          }

          if (summaryData.errors_encountered.length > 0) {
            console.log(chalk.bold('**Errors Encountered → Resolved:**'));
            const resolved = new Set(summaryData.errors_resolved);
            for (const error of summaryData.errors_encountered) {
              const status = resolved.has(error) ? chalk.green('✓') : chalk.red('✗');
              console.log(`${status} ${error}`);
            }
            console.log();
          }

          if (summaryData.key_decisions.length > 0) {
            console.log(chalk.bold('**Key Decisions:**'));
            for (const decision of summaryData.key_decisions) {
              console.log(`- ${decision}`);
            }
            console.log();
          }

          console.log(chalk.dim('─'.repeat(80)));
          console.log();
        } catch (error) {
          spinner.fail(`Failed to summarize session`);
          console.error(
            chalk.red(error instanceof Error ? error.message : 'Unknown error')
          );
          console.log();
        }
      }

      if (!options.dryRun) {
        console.log(
          chalk.green(
            `\n✓ Successfully summarized ${sessionsToSummarize.length} session(s)`
          )
        );
      }
    } finally {
      db.close();
    }
  });

function buildSummaryContext(
  session: Session,
  events: Event[],
  toolCalls: ToolCall[],
  errors: ErrorRecord[]
): string {
  const parts: string[] = [];

  parts.push(`Project: ${session.projectName || session.projectPath}`);
  parts.push(`Date: ${session.startedAt.toISOString()}`);
  const duration = session.endedAt
    ? Math.round((session.endedAt.getTime() - session.startedAt.getTime()) / 60000)
    : '?';
  parts.push(`Duration: ${duration} minutes`);
  parts.push(`Turns: ${session.turnCount}`);
  parts.push('');

  // Files touched
  const files = new Set<string>();
  for (const tc of toolCalls) {
    const params =
      typeof tc.parameters === 'string' ? JSON.parse(tc.parameters) : tc.parameters;
    if (params?.path) files.add(params.path);
    if (params?.file_path) files.add(params.file_path);
    if (params?.filePath) files.add(params.filePath);
  }
  if (files.size > 0) {
    parts.push('Files touched:');
    for (const f of Array.from(files).slice(0, 20)) {
      parts.push(`  - ${f}`);
    }
    if (files.size > 20) {
      parts.push(`  ... and ${files.size - 20} more files`);
    }
    parts.push('');
  }

  // Errors
  if (errors.length > 0) {
    parts.push('Errors:');
    for (const e of errors.slice(0, 10)) {
      const status = e.resolved ? '[RESOLVED]' : '[UNRESOLVED]';
      parts.push(`  - ${status} [${e.errorType}] ${e.errorMessage.slice(0, 200)}`);
    }
    if (errors.length > 10) {
      parts.push(`  ... and ${errors.length - 10} more errors`);
    }
    parts.push('');
  }

  // Conversation summary (first and last few messages)
  const userMessages = events.filter((e) => e.type === 'user_message');
  const assistantMessages = events.filter((e) => e.type === 'assistant_message');

  parts.push('Conversation highlights:');

  // First user message (the task)
  if (userMessages[0]) {
    parts.push(`Initial request: ${userMessages[0].content?.slice(0, 500) || 'N/A'}`);
  }

  // Sample of middle conversation
  const middleIndex = Math.floor(userMessages.length / 2);
  if (userMessages[middleIndex] && middleIndex > 0) {
    parts.push(
      `Mid-session: ${userMessages[middleIndex].content?.slice(0, 300) || 'N/A'}`
    );
  }

  // Last exchange
  if (userMessages.length > 1) {
    const lastUser = userMessages[userMessages.length - 1];
    parts.push(`Final request: ${lastUser.content?.slice(0, 300) || 'N/A'}`);
  }

  // Truncate to ~8K tokens worth (~32K chars)
  const fullContext = parts.join('\n');
  return fullContext.slice(0, 32000);
}

async function generateSummary(context: string): Promise<{
  summary: string;
  work_done: string[];
  files_changed: string[];
  errors_encountered: string[];
  errors_resolved: string[];
  key_decisions: string[];
}> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: SUMMARIZE_PROMPT,
    messages: [
      {
        role: 'user',
        content: context,
      },
    ],
  });

  const textContent = message.content.find((c) => c.type === 'text');
  if (!textContent || !('text' in textContent)) {
    throw new Error('No text content in response');
  }

  // Parse JSON response
  const responseText = textContent.text.trim();

  // Remove markdown code blocks if present
  const jsonText = responseText.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();

  try {
    const parsed = JSON.parse(jsonText);
    return {
      summary: parsed.summary || 'No summary available',
      work_done: parsed.work_done || [],
      files_changed: parsed.files_changed || [],
      errors_encountered: parsed.errors_encountered || [],
      errors_resolved: parsed.errors_resolved || [],
      key_decisions: parsed.key_decisions || [],
    };
  } catch (error) {
    console.error(chalk.red('Failed to parse AI response as JSON:'));
    console.error(chalk.dim(jsonText));
    throw new Error('Invalid JSON response from API');
  }
}
