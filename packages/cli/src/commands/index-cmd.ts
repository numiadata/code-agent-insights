import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { spawn } from 'child_process';
import * as fs from 'fs';
import { ClaudeCodeParser, InsightsDatabase } from '@code-agent-insights/core';

interface IndexOptions {
  source?: string;
  embed?: boolean;
  extract?: boolean;
  since?: string;
  verbose?: boolean;
  force?: boolean;
}

/**
 * Parse a date string that can be either:
 * - ISO date: "2025-01-01"
 * - Relative days: "7d"
 * - Relative weeks: "2w"
 * - Relative months: "1m"
 */
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

export const indexCommand = new Command('index')
  .description('Index coding agent sessions')
  .option('-s, --source <source>', 'Source to index (claude_code, cursor, all)', 'all')
  .option('--embed', 'Generate embeddings after indexing')
  .option('--extract', 'Extract learnings after indexing (requires ANTHROPIC_API_KEY)')
  .option('--since <date>', 'Only index sessions after this date (e.g., 7d, 2w, 1m, 2025-01-01)')
  .option('-f, --force', 'Reindex all sessions (ignore already indexed)')
  .option('-v, --verbose', 'Show detailed parse warnings')
  .addHelpText('after', `
Examples:
  $ cai index --since 7d           Only sessions from last 7 days
  $ cai index --since 2w           Only sessions from last 2 weeks
  $ cai index --since 2025-01-01   Only sessions after specific date
  $ cai index --force              Reindex all sessions with improved parser
  $ cai index --verbose            Show detailed parse warnings`)
  .action(async (options: IndexOptions) => {
    const db = new InsightsDatabase();

    try {
      // 1. Create spinner with 'Discovering sessions...'
      const spinner = ora('Discovering sessions...').start();

      // 2. Instantiate parser
      const parser = new ClaudeCodeParser();

      // 3. Call parser.discoverSessions()
      let sessionPaths = await parser.discoverSessions();

      // 4. Filter by --since if provided
      if (options.since) {
        try {
          const sinceDate = parseSinceDate(options.since);
          const beforeFilter = sessionPaths.length;

          sessionPaths = sessionPaths.filter(path => {
            const stats = fs.statSync(path);
            return stats.mtime > sinceDate;
          });

          const filtered = beforeFilter - sessionPaths.length;
          if (filtered > 0) {
            spinner.text = `Filtered to ${sessionPaths.length} sessions modified after ${sinceDate.toISOString().split('T')[0]}`;
          }
        } catch (error) {
          spinner.fail();
          console.error(chalk.red(`Error: ${(error as Error).message}`));
          return;
        }
      }

      // 5. spinner.succeed with count
      spinner.succeed(`Found ${sessionPaths.length} total sessions`);

      // 6. Handle force mode or filter out already indexed
      let newSessionPaths: string[];
      if (options.force) {
        console.log(chalk.yellow('\nForce mode enabled - will reindex existing sessions'));
        newSessionPaths = sessionPaths;
      } else {
        newSessionPaths = sessionPaths.filter(p => !db.sessionExists(p));
      }

      // 7. If no new sessions, log yellow message and return
      if (newSessionPaths.length === 0) {
        console.log(chalk.yellow('No new sessions to index.'));
        return;
      }

      // 8. Log blue message
      const actionWord = options.force ? 'Reindexing' : 'Indexing';
      console.log(chalk.blue(`\n${actionWord} ${newSessionPaths.length} ${options.force ? '' : 'new '}sessions...`));

      // 9. Loop through new session paths
      let successCount = 0;
      let errorCount = 0;
      let totalWarnings = 0;
      const total = newSessionPaths.length;
      const sessionWarnings: Map<string, string[]> = new Map();
      const sessionErrors: Map<string, string> = new Map();

      for (const sessionPath of newSessionPaths) {
        try {
          // Parse the session first (outside transaction since it's async)
          const parsed = await parser.parseSession(sessionPath);

          // Execute all DB operations in a single transaction for atomicity
          const insertTransaction = db.transaction(() => {
            // If force mode, delete existing data first
            if (options.force) {
              db.deleteSessionByPath(sessionPath);
            }

            // Insert: session, events, toolCalls, errors
            db.insertSession(parsed.session);
            db.insertEvents(parsed.events);
            db.insertToolCalls(parsed.toolCalls);
            db.insertErrors(parsed.errors);

            // Insert: skillInvocations, subAgentInvocations, toolSequences, sessionModes
            db.insertSkillInvocations(parsed.skillInvocations);
            db.insertSubAgentInvocations(parsed.subAgentInvocations);
            db.insertToolSequences(parsed.toolSequences);
            db.insertSessionModes(parsed.sessionModes);
          });

          // Execute the transaction
          insertTransaction();

          // Track warnings
          if (parsed.stats.warnings.length > 0) {
            sessionWarnings.set(sessionPath, parsed.stats.warnings);
            totalWarnings += parsed.stats.warnings.length;
          }

          // Increment success counter
          successCount++;

          // Log progress
          process.stdout.write(`\r  Indexed: ${successCount}/${total}`);
        } catch (error) {
          // On error: track the error message and increment counter
          errorCount++;
          sessionErrors.set(sessionPath, (error as Error).message || String(error));
        }
      }

      // 10. Log newline, then green success message
      console.log('');

      if (totalWarnings > 0) {
        console.log(chalk.green(`\n✓ Successfully indexed ${successCount} sessions (${totalWarnings} warnings)`));

        if (!options.verbose) {
          console.log(chalk.dim('Run with --verbose to see detailed warnings'));
        } else {
          console.log(chalk.yellow('\nParse Warnings:'));
          for (const [sessionPath, warnings] of sessionWarnings) {
            console.log(chalk.dim(`\n${sessionPath}:`));
            for (const warning of warnings) {
              console.log(chalk.yellow(`  - ${warning}`));
            }
          }
        }
      } else {
        console.log(chalk.green(`\n✓ Successfully indexed ${successCount} sessions`));
      }

      // 11. If errors > 0, log yellow warning
      if (errorCount > 0) {
        console.log(chalk.yellow(`⚠ Failed to index ${errorCount} sessions`));

        if (options.verbose && sessionErrors.size > 0) {
          console.log(chalk.red('\nParse Errors:'));
          for (const [sessionPath, errorMsg] of sessionErrors) {
            console.log(chalk.dim(`\n${sessionPath}:`));
            console.log(chalk.red(`  ✗ ${errorMsg}`));
          }
        } else if (!options.verbose) {
          console.log(chalk.dim('Run with --verbose to see detailed errors'));
        }
      }

      // 12. If options.embed
      if (options.embed) {
        console.log(chalk.blue('\nGenerating embeddings...'));
        try {
          await runPythonCommand(['embed', '--type', 'all']);
          console.log(chalk.green('✓ Embeddings generated'));
        } catch (error) {
          console.log(chalk.yellow('⚠ Failed to generate embeddings'));
        }
      }

      // 13. If options.extract
      if (options.extract) {
        if (!process.env.ANTHROPIC_API_KEY) {
          console.log(chalk.yellow('⚠ Skipping learning extraction: ANTHROPIC_API_KEY not set'));
        } else {
          console.log(chalk.blue('\nExtracting learnings...'));
          try {
            await runPythonCommand(['extract', '--all']);
            console.log(chalk.green('✓ Learnings extracted'));
          } catch (error) {
            console.log(chalk.yellow('⚠ Failed to extract learnings'));
          }
        }
      }
    } finally {
      // 14. Close database in finally block
      db.close();
    }
  });

// Helper function runPythonCommand
function runPythonCommand(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('cai-extract', args, {
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command exited with code ${code}`));
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}
