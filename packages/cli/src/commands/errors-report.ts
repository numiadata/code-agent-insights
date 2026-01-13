import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { InsightsDatabase } from '@code-agent-insights/core';

interface ErrorsReportOptions {
  since?: string;
  limit?: string;
  json?: boolean;
}

function parseDateOption(dateStr: string): Date {
  // Try relative formats first
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

  // Try ISO date format
  const isoMatch = dateStr.match(/^\d{4}-\d{2}-\d{2}$/);
  if (isoMatch) {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid date: ${dateStr}`);
    }
    return date;
  }

  throw new Error(
    `Invalid date format: "${dateStr}". Use:\n` +
    `  - Relative days: 7d, 30d, 90d\n` +
    `  - Relative weeks: 2w, 4w\n` +
    `  - Relative months: 1m, 3m\n` +
    `  - ISO date: YYYY-MM-DD`
  );
}

export const errorsReportCommand = new Command('errors')
  .description('Show error analysis and patterns')
  .option('--since <date>', 'Start date (default: 30d). Formats: 7d, 2w, 30d, 90d, YYYY-MM-DD', '30d')
  .option('--limit <n>', 'Max error types to show (default: 15)', '15')
  .option('--json', 'Output as JSON')
  .addHelpText('after', `
Examples:
  $ cai errors                   Show error report
  $ cai errors --since 7d        Last 7 days
  $ cai errors --limit 20        Show top 20 errors
  $ cai errors --json            JSON output`)
  .action(async (options: ErrorsReportOptions) => {
    const db = new InsightsDatabase();

    try {
      // Parse options
      const since = parseDateOption(options.since || '30d');
      const limit = parseInt(options.limit || '15', 10);

      // Get error stats
      const errorStats = db.getErrorStats({ since, limit });

      if (errorStats.length === 0) {
        console.log(chalk.yellow('\nNo errors found in the specified time range.'));
        console.log(chalk.dim(`Period: Since ${since.toISOString().split('T')[0]}`));
        return;
      }

      // Calculate totals
      const totalErrors = errorStats.reduce((sum, e) => sum + e.count, 0);
      const totalResolved = errorStats.reduce((sum, e) => sum + e.resolvedCount, 0);
      const resolutionRate = totalErrors > 0 ? (totalResolved / totalErrors) * 100 : 0;
      const errorTypes = errorStats.length;

      // Identify recurring errors (3+ sessions)
      const recurringErrors = errorStats.filter(e => e.recurrenceCount >= 3);

      // Identify errors without fixes
      const errorsWithoutFixes = errorStats.filter(e => !e.hasLearning);

      // JSON output
      if (options.json) {
        console.log(JSON.stringify({
          period: {
            since: since.toISOString()
          },
          summary: {
            totalErrors,
            totalResolved,
            resolutionRate: Math.round(resolutionRate * 10) / 10,
            errorTypes
          },
          topErrors: errorStats,
          recurringErrors,
          errorsWithoutFixes: errorsWithoutFixes.slice(0, 5)
        }, null, 2));
        return;
      }

      // Human-readable output
      console.log(chalk.bold('\n🐛 Error Analysis Report\n'));
      console.log(chalk.dim(`Period: Since ${since.toISOString().split('T')[0]}\n`));

      // Summary
      console.log(chalk.bold('Summary'));
      console.log(`Total Errors:     ${totalErrors}`);
      console.log(`Resolved:         ${totalResolved} (${resolutionRate.toFixed(1)}%)`);
      console.log(`Error Types:      ${errorTypes}\n`);

      // Top error categories table
      console.log(chalk.bold('Top Error Categories'));

      const table = new Table({
        head: ['Error Type', 'Count', 'Resolved', 'Sessions', 'Has Fix'],
        style: {
          head: ['cyan']
        },
        colWidths: [35, 8, 10, 10, 10]
      });

      for (const error of errorStats) {
        const resolvedPct = error.count > 0
          ? ((error.resolvedCount / error.count) * 100).toFixed(0) + '%'
          : '—';

        const hasFix = error.hasLearning
          ? chalk.green('✓ Yes')
          : chalk.dim('No');

        // Truncate error type if too long
        const errorType = error.errorType.length > 32
          ? error.errorType.substring(0, 29) + '...'
          : error.errorType;

        table.push([
          errorType,
          error.count.toString(),
          resolvedPct,
          error.recurrenceCount.toString(),
          hasFix
        ]);
      }

      console.log(table.toString());
      console.log('');

      // Recurring errors section
      if (recurringErrors.length > 0) {
        console.log(chalk.bold('⚠️  Recurring Errors (3+ sessions)\n'));

        for (const error of recurringErrors.slice(0, 5)) {
          if (error.hasLearning) {
            console.log(chalk.green(`✓ ${error.errorType}`));
            console.log(chalk.dim(`  Seen in ${error.recurrenceCount} sessions, ${error.count} total occurrences`));

            // Show first related learning
            if (error.relatedLearnings.length > 0) {
              const learning = error.relatedLearnings[0];
              const preview = learning.length > 60
                ? learning.substring(0, 57) + '...'
                : learning;
              console.log(chalk.dim(`  Fix documented: "${preview}"`));
            }
          } else {
            console.log(chalk.yellow(`! ${error.errorType}`));
            console.log(chalk.dim(`  Seen in ${error.recurrenceCount} sessions, ${error.count} total occurrences`));
            console.log(chalk.yellow(`  ⚠ No fix documented - run 'cai learn' to capture the solution`));
          }
          console.log('');
        }
      }

      // Errors without documented fixes
      if (errorsWithoutFixes.length > 0) {
        console.log(chalk.bold('📝 Errors Without Documented Fixes\n'));

        errorsWithoutFixes.slice(0, 5).forEach(error => {
          console.log(chalk.dim(`- ${error.errorType} (${error.count} occurrences)`));
        });
        console.log('');
      }

      // Recommendations
      console.log(chalk.bold('💡 Recommendations\n'));

      let recommendationCount = 0;

      // Recommend documenting high-frequency errors without fixes
      const highFreqNoFix = errorsWithoutFixes
        .filter(e => e.recurrenceCount >= 3)
        .sort((a, b) => b.count - a.count)
        .slice(0, 2);

      for (const error of highFreqNoFix) {
        recommendationCount++;
        console.log(`${recommendationCount}. Document fix for "${error.errorType}" (seen ${error.recurrenceCount}x)`);
      }

      // Recommend investigating low resolution rates
      const lowResolution = errorStats
        .filter(e => e.count >= 5 && (e.resolvedCount / e.count) < 0.7)
        .slice(0, 2);

      for (const error of lowResolution) {
        const rate = ((error.resolvedCount / error.count) * 100).toFixed(0);
        recommendationCount++;
        console.log(`${recommendationCount}. Investigate low resolution rate for "${error.errorType}" (${rate}%)`);
      }

      if (recommendationCount === 0) {
        console.log(chalk.green('✓ All major errors are documented and resolved efficiently'));
      }

    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    } finally {
      db.close();
    }
  });
