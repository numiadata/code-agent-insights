import { Command } from 'commander';
import chalk from 'chalk';
import * as readline from 'readline';
import { InsightsDatabase, getConfig } from '@code-agent-insights/core';

interface ReviewOptions {
  unreviewed?: boolean;
  type?: string;
  limit?: string;
  project?: string;
}

interface ReviewStats {
  kept: number;
  deleted: number;
  edited: number;
  skipped: number;
}

/**
 * Format date string for display
 */
function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return 'Unknown';
  try {
    const date = new Date(dateStr);
    return date.toISOString().split('T')[0];
  } catch {
    return 'Unknown';
  }
}

/**
 * Truncate project path for display
 */
function truncatePath(path: string | null, maxLength: number = 50): string {
  if (!path) return 'N/A';
  if (path.length <= maxLength) return path;
  return '...' + path.slice(-(maxLength - 3));
}

/**
 * Get user input from readline
 */
function getUserInput(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.toLowerCase().trim());
    });
  });
}

/**
 * Get multiline input for editing
 */
function getMultilineInput(rl: readline.Interface, currentContent: string): Promise<string> {
  return new Promise((resolve) => {
    console.log(chalk.blue('\nEnter new content (type END on a new line when done):'));
    console.log(chalk.dim(`Current: ${currentContent}\n`));

    let lines: string[] = [];
    const handleLine = (line: string) => {
      if (line === 'END') {
        rl.removeListener('line', handleLine);
        resolve(lines.join('\n'));
      } else {
        lines.push(line);
      }
    };

    rl.on('line', handleLine);
  });
}

export const reviewCommand = new Command('review')
  .description('Interactive review of learnings')
  .option('--unreviewed', 'Only show learnings that haven\'t been reviewed yet')
  .option('--type <type>', 'Filter by learning type')
  .option('--limit <n>', 'Maximum learnings to review', '20')
  .option('-p, --project <path>', 'Filter by project path')
  .addHelpText('after', `
Examples:
  $ cai review                          Review all learnings
  $ cai review --unreviewed             Review only unreviewed learnings
  $ cai review --type context --limit 50   Review context learnings
  $ cai review -p ./my-project          Review learnings from specific project`)
  .action(async (options: ReviewOptions) => {
    const db = new InsightsDatabase();
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const stats: ReviewStats = {
      kept: 0,
      deleted: 0,
      edited: 0,
      skipped: 0,
    };

    try {
      const limit = parseInt(options.limit || '20', 10);
      if (isNaN(limit) || limit < 1) {
        console.error(chalk.red('Error: Limit must be a positive number'));
        return;
      }

      // Query learnings
      console.log(chalk.blue('Loading learnings...\n'));
      const learnings = db.getLearningsForReview({
        unreviewed: options.unreviewed,
        type: options.type,
        projectPath: options.project,
        limit,
      });

      if (learnings.length === 0) {
        console.log(chalk.yellow('No learnings found matching the criteria.'));
        return;
      }

      console.log(chalk.green(`Found ${learnings.length} learnings to review\n`));

      // Review each learning
      for (let i = 0; i < learnings.length; i++) {
        const learning = learnings[i];

        // Display learning
        console.log(chalk.dim('─'.repeat(60)));
        console.log(
          chalk.cyan(`[${i + 1}/${learnings.length}] `) +
          chalk.bold(`[${learning.type}]`) +
          chalk.dim(` (confidence: ${learning.confidence.toFixed(2)})`)
        );
        console.log();
        console.log(learning.content);
        console.log();

        // Parse and display tags
        let tags: string[] = [];
        try {
          tags = typeof learning.tags === 'string' ? JSON.parse(learning.tags) : learning.tags;
        } catch {
          tags = [];
        }

        if (tags.length > 0) {
          console.log(chalk.dim(`Tags: ${tags.join(', ')}`));
        }

        console.log(chalk.dim(`Project: ${truncatePath(learning.projectPath)}`));
        console.log(chalk.dim(`Created: ${formatDate(learning.createdAt as any)}`));
        console.log(chalk.dim('─'.repeat(60)));
        console.log();

        // Get user action
        let action = '';
        while (!['k', 'y', 'd', 'n', 'e', 's', 'q'].includes(action)) {
          action = await getUserInput(
            rl,
            chalk.yellow('(k)eep | (d)elete | (e)dit | (s)kip | (q)uit: ')
          );

          if (!['k', 'y', 'd', 'n', 'e', 's', 'q'].includes(action)) {
            console.log(chalk.red('Invalid option. Please choose k, d, e, s, or q.'));
          }
        }

        // Handle action
        if (action === 'q') {
          console.log(chalk.blue('\nQuitting review session...'));
          break;
        } else if (action === 'k' || action === 'y') {
          // Keep and mark as reviewed
          db.markLearningReviewed(learning.id);
          stats.kept++;
          console.log(chalk.green('✓ Kept and marked as reviewed\n'));
        } else if (action === 'd' || action === 'n') {
          // Delete
          db.deleteLearnings([learning.id]);
          stats.deleted++;
          console.log(chalk.red('✗ Deleted\n'));
        } else if (action === 'e') {
          // Edit
          console.log(chalk.blue('\nEditing learning...'));
          console.log(chalk.dim('Enter new content (empty line to cancel):\n'));

          const newContent = await getUserInput(rl, '> ');

          if (newContent.trim()) {
            db.updateLearningContent(learning.id, newContent);
            db.markLearningReviewed(learning.id);
            stats.edited++;
            console.log(chalk.green('✓ Updated and marked as reviewed\n'));
          } else {
            console.log(chalk.yellow('Cancelled edit\n'));
            stats.skipped++;
          }
        } else if (action === 's') {
          // Skip
          stats.skipped++;
          console.log(chalk.dim('Skipped\n'));
        }
      }

      // Show summary
      console.log(chalk.bold('\n' + '═'.repeat(60)));
      console.log(chalk.bold('Review Complete'));
      console.log(chalk.bold('═'.repeat(60)));
      console.log(
        chalk.green(`✓ Kept: ${stats.kept}`) +
        chalk.dim(' | ') +
        chalk.red(`✗ Deleted: ${stats.deleted}`) +
        chalk.dim(' | ') +
        chalk.blue(`✎ Edited: ${stats.edited}`) +
        chalk.dim(' | ') +
        chalk.yellow(`⊝ Skipped: ${stats.skipped}`)
      );
      console.log();

      // Auto-sync if configured
      const config = getConfig();
      if (config.sync.autoSync && config.sync.triggers.includes('on_review_complete')) {
        console.log(chalk.dim('Auto-syncing to projects...'));
        const { runSync } = await import('./sync.js');
        await runSync({
          dryRun: false,
          global: config.sync.options.includeGlobal,
          minConfidence: config.sync.options.minConfidence.toString(),
          reviewedOnly: config.sync.options.reviewedOnly,
          silent: true
        });
        console.log(chalk.green('✓ Auto-sync complete'));
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
    } finally {
      rl.close();
      db.close();
    }
  });
