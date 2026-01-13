import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { InsightsDatabase } from '@code-agent-insights/core';

interface TrendsOptions {
  since?: string;
  until?: string;
  groupBy?: 'day' | 'week' | 'month';
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

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

function calculateTrend(data: number[]): { direction: 'up' | 'down' | 'stable'; percentage: number } {
  if (data.length < 2) {
    return { direction: 'stable', percentage: 0 };
  }

  const midpoint = Math.floor(data.length / 2);
  const firstHalf = data.slice(0, midpoint);
  const secondHalf = data.slice(midpoint);

  const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

  if (avgFirst === 0) {
    return { direction: 'stable', percentage: 0 };
  }

  const percentChange = ((avgSecond - avgFirst) / avgFirst) * 100;

  if (Math.abs(percentChange) < 2) {
    return { direction: 'stable', percentage: 0 };
  }

  return {
    direction: percentChange > 0 ? 'up' : 'down',
    percentage: Math.abs(percentChange)
  };
}

function formatTrendArrow(direction: 'up' | 'down' | 'stable', percentage: number): string {
  if (direction === 'up') {
    return chalk.green(`↑ ${percentage.toFixed(1)}%`);
  } else if (direction === 'down') {
    return chalk.red(`↓ ${percentage.toFixed(1)}%`);
  }
  return chalk.dim('—');
}

export const trendsCommand = new Command('trends')
  .description('Show trends and analytics over time')
  .option('--since <date>', 'Start date (default: 30d). Formats: 7d, 2w, 30d, 90d, YYYY-MM-DD', '30d')
  .option('--until <date>', 'End date (default: now)')
  .option('--group-by <period>', 'Group by: day | week | month (default: week)', 'week')
  .option('--json', 'Output as JSON')
  .addHelpText('after', `
Examples:
  $ cai trends                      Last 30 days, grouped by week
  $ cai trends --since 7d           Last 7 days, grouped by week
  $ cai trends --since 90d --group-by month
  $ cai trends --since 2026-01-01   From specific date
  $ cai trends --json               Output as JSON`)
  .action(async (options: TrendsOptions) => {
    const db = new InsightsDatabase();

    try {
      // Parse dates
      const since = parseDateOption(options.since || '30d');
      const until = options.until ? parseDateOption(options.until) : new Date();
      const groupBy = options.groupBy || 'week';

      // Validate groupBy
      if (!['day', 'week', 'month'].includes(groupBy)) {
        console.error(chalk.red(`Invalid --group-by value: ${groupBy}. Use: day, week, or month`));
        process.exit(1);
      }

      // Get trends data
      const trends = db.getTrends({
        since,
        until,
        groupBy: groupBy as 'day' | 'week' | 'month'
      });

      if (trends.length === 0) {
        console.log(chalk.yellow('\nNo sessions found in the specified time range.'));
        console.log(chalk.dim(`Period: ${since.toISOString().split('T')[0]} to ${until.toISOString().split('T')[0]}`));
        return;
      }

      // Calculate totals and averages
      const totalSessions = trends.reduce((sum, t) => sum + t.sessionCount, 0);
      const totalSuccesses = trends.reduce((sum, t) => sum + t.successCount, 0);
      const totalFailures = trends.reduce((sum, t) => sum + t.failureCount, 0);
      const totalLearnings = trends.reduce((sum, t) => sum + t.learningCount, 0);
      const totalErrors = trends.reduce((sum, t) => sum + t.errorCount, 0);
      const totalTokens = trends.reduce((sum, t) => sum + t.tokenCount, 0);

      const successRate = totalSessions > 0 ? (totalSuccesses / totalSessions) * 100 : 0;
      const avgSessionsPerPeriod = totalSessions / trends.length;
      const avgLearningsPerSession = totalSessions > 0 ? totalLearnings / totalSessions : 0;

      // Calculate trends
      const successRates = trends.map(t => t.sessionCount > 0 ? (t.successCount / t.sessionCount) * 100 : 0);
      const errorCounts = trends.map(t => t.errorCount);

      const successTrend = calculateTrend(successRates);
      const errorTrend = calculateTrend(errorCounts);

      // JSON output
      if (options.json) {
        console.log(JSON.stringify({
          period: {
            since: since.toISOString(),
            until: until.toISOString(),
            groupBy
          },
          overview: {
            totalSessions,
            successRate: Math.round(successRate * 10) / 10,
            totalLearnings,
            totalErrors,
            totalTokens,
            avgSessionsPerPeriod: Math.round(avgSessionsPerPeriod * 10) / 10,
            avgLearningsPerSession: Math.round(avgLearningsPerSession * 10) / 10
          },
          trends: {
            successRate: {
              direction: successTrend.direction,
              percentage: Math.round(successTrend.percentage * 10) / 10
            },
            errors: {
              direction: errorTrend.direction,
              percentage: Math.round(errorTrend.percentage * 10) / 10
            }
          },
          periods: trends
        }, null, 2));
        return;
      }

      // Human-readable output
      console.log(chalk.bold('\n📈 Trends Report\n'));
      console.log(chalk.dim(`Period: ${since.toISOString().split('T')[0]} to ${until.toISOString().split('T')[0]}`));
      console.log(chalk.dim(`Grouped by: ${groupBy}\n`));

      console.log(chalk.bold('Overview'));
      console.log(`Sessions:      ${totalSessions} total, ${avgSessionsPerPeriod.toFixed(1)}/${groupBy} average`);
      console.log(`Success Rate:  ${successRate.toFixed(0)}% ${formatTrendArrow(successTrend.direction, successTrend.percentage)} ${successTrend.direction === 'up' ? '(improving)' : successTrend.direction === 'down' ? '(declining)' : ''}`);
      console.log(`Learnings:     ${totalLearnings} total, ${avgLearningsPerSession.toFixed(1)}/session`);
      console.log(`Errors:        ${totalErrors} total ${formatTrendArrow(errorTrend.direction === 'up' ? 'down' : errorTrend.direction === 'down' ? 'up' : 'stable', errorTrend.percentage)} ${errorTrend.direction === 'down' ? '(decreasing)' : errorTrend.direction === 'up' ? '(increasing)' : ''}`);
      console.log(`Tokens:        ${formatNumber(totalTokens)} total\n`);

      // Period breakdown table
      console.log(chalk.bold('Period Breakdown'));
      const table = new Table({
        head: ['Period', 'Sessions', 'Success', 'Learnings', 'Errors'],
        style: {
          head: ['cyan']
        }
      });

      for (const period of trends) {
        const periodSuccessRate = period.sessionCount > 0
          ? ((period.successCount / period.sessionCount) * 100).toFixed(0) + '%'
          : '—';

        table.push([
          period.period,
          period.sessionCount.toString(),
          periodSuccessRate,
          period.learningCount.toString(),
          period.errorCount.toString()
        ]);
      }

      console.log(table.toString());

      // Insights
      console.log(chalk.bold('\n💡 Insights'));
      if (successTrend.direction === 'up') {
        console.log(chalk.green(`✓ Success rate improving: +${successTrend.percentage.toFixed(1)}% over the period`));
      } else if (successTrend.direction === 'down') {
        console.log(chalk.yellow(`⚠ Success rate declining: -${successTrend.percentage.toFixed(1)}% over the period`));
      }

      if (errorTrend.direction === 'down') {
        console.log(chalk.green(`✓ Errors decreasing: ${errorTrend.percentage.toFixed(1)}% reduction`));
      } else if (errorTrend.direction === 'up') {
        console.log(chalk.yellow(`⚠ Errors increasing: ${errorTrend.percentage.toFixed(1)}% increase`));
      }

      if (successTrend.direction === 'stable' && errorTrend.direction === 'stable') {
        console.log(chalk.dim('— Metrics stable over the period'));
      }

    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    } finally {
      db.close();
    }
  });
