import { Command } from 'commander';
import chalk from 'chalk';
import { InsightsDatabase } from '@code-agent-insights/core';
import * as path from 'path';

interface ReportOptions {
  since?: string;
  title?: string;
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

function calculatePeriodDuration(since: Date, until: Date): number {
  return Math.floor((until.getTime() - since.getTime()) / (1000 * 60 * 60 * 24));
}

function formatPercentChange(current: number, previous: number): string {
  if (previous === 0) {
    return current > 0 ? chalk.green('(new)') : '';
  }

  const change = ((current - previous) / previous) * 100;
  const formatted = change >= 0 ? `+${change.toFixed(1)}%` : `${change.toFixed(1)}%`;

  if (change > 0) {
    return chalk.green(`(${formatted})`);
  } else if (change < 0) {
    return chalk.yellow(`(${formatted})`);
  } else {
    return chalk.dim('(0.0%)');
  }
}

export const reportCommand = new Command('report')
  .description('Generate comprehensive analytics report')
  .option('--since <date>', 'Report period start (default: 7d)', '7d')
  .option('--title <text>', 'Custom report title')
  .option('--json', 'Output as JSON')
  .addHelpText('after', `
Examples:
  $ cai report                      Weekly report (last 7 days)
  $ cai report --since 30d          Monthly report
  $ cai report --title "Q1 Summary" Custom title
  $ cai report --json               JSON output for API integration`)
  .action(async (options: ReportOptions) => {
    const db = new InsightsDatabase();

    try {
      // Parse dates
      const since = parseDateOption(options.since || '7d');
      const until = new Date();
      const periodDays = calculatePeriodDuration(since, until);

      // Calculate previous period (same duration before 'since')
      const previousPeriodSince = new Date(since.getTime() - (periodDays * 24 * 60 * 60 * 1000));
      const previousPeriodUntil = since;

      // Gather data for current period
      const currentTrends = db.getTrends({
        since,
        until,
        groupBy: periodDays <= 7 ? 'day' : periodDays <= 60 ? 'week' : 'month'
      });

      const currentToolStats = db.getToolUsageStats({ since, limit: 10 });
      const currentErrorStats = db.getErrorStats({ since, limit: 10 });
      const currentBaseline = db.getBaselineStats(since);
      const currentModeEffectiveness = db.getModeEffectiveness();
      const recentLearnings = db.getRecentLearnings(since, 5);

      // Get correlation stats for current period
      const currentSessions = db.db.prepare(`
        SELECT COUNT(*) as total,
               SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) as success
        FROM sessions
        WHERE started_at >= ? AND started_at <= ?
      `).get(since.toISOString(), until.toISOString()) as any;

      // Gather data for previous period
      const previousTrends = db.getTrends({
        since: previousPeriodSince,
        until: previousPeriodUntil,
        groupBy: periodDays <= 7 ? 'day' : periodDays <= 60 ? 'week' : 'month'
      });

      const previousSessions = db.db.prepare(`
        SELECT COUNT(*) as total,
               SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) as success
        FROM sessions
        WHERE started_at >= ? AND started_at < ?
      `).get(previousPeriodSince.toISOString(), previousPeriodUntil.toISOString()) as any;

      const previousErrors = db.db.prepare(`
        SELECT COUNT(*) as total
        FROM errors e
        JOIN sessions s ON e.session_id = s.id
        WHERE s.started_at >= ? AND s.started_at < ?
      `).get(previousPeriodSince.toISOString(), previousPeriodUntil.toISOString()) as any;

      // Calculate aggregates
      const currentSessionCount = currentSessions.total || 0;
      const currentSuccessRate = currentSessionCount > 0
        ? (currentSessions.success / currentSessionCount) * 100
        : 0;
      const currentTokens = currentTrends.reduce((sum, t) => sum + t.tokenCount, 0);
      const currentLearningCount = currentTrends.reduce((sum, t) => sum + t.learningCount, 0);
      const currentErrorCount = currentTrends.reduce((sum, t) => sum + t.errorCount, 0);

      const previousSessionCount = previousSessions.total || 0;
      const previousSuccessRate = previousSessionCount > 0
        ? (previousSessions.success / previousSessionCount) * 100
        : 0;
      const previousErrorCount = previousErrors.total || 0;

      // Top performing tools (vs baseline)
      const topTools = currentToolStats
        .map(t => ({
          ...t,
          vsBaseline: t.successRate - (currentBaseline.successRate * 100)
        }))
        .filter(t => t.vsBaseline > 0)
        .sort((a, b) => b.vsBaseline - a.vsBaseline)
        .slice(0, 3);

      // Mode effectiveness
      const modeStats = currentModeEffectiveness
        .filter(m => m.withMode.total >= 3)
        .map(m => ({
          mode: m.mode,
          successRate: m.withMode.total > 0
            ? (m.withMode.success / m.withMode.total) * 100
            : 0,
          vsBaseline: m.withMode.total > 0
            ? ((m.withMode.success / m.withMode.total) * 100) - (currentBaseline.successRate * 100)
            : 0
        }))
        .filter(m => m.vsBaseline > 0)
        .sort((a, b) => b.vsBaseline - a.vsBaseline);

      // Top error types
      const topErrors = currentErrorStats.slice(0, 3);

      // Recommendations
      const recommendations: string[] = [];

      // Success rate improvement
      const successRateDiff = currentSuccessRate - previousSuccessRate;
      if (successRateDiff > 5) {
        recommendations.push(`Continue current approach - success rate improved by ${successRateDiff.toFixed(1)}%`);
      } else if (successRateDiff < -5) {
        recommendations.push(`Review recent changes - success rate declined by ${Math.abs(successRateDiff).toFixed(1)}%`);
      }

      // Undocumented errors
      const undocumentedErrors = currentErrorStats
        .filter(e => !e.hasLearning && e.recurrenceCount >= 3)
        .slice(0, 2);
      for (const error of undocumentedErrors) {
        recommendations.push(`Document fix for "${error.errorType}" (seen ${error.recurrenceCount}x, no learning)`);
      }

      // Top tool recommendation
      if (topTools.length > 0) {
        const topTool = topTools[0];
        recommendations.push(`Increase use of ${topTool.toolName} (+${topTool.vsBaseline.toFixed(1)}% better than baseline)`);
      }

      // JSON output
      if (options.json) {
        const jsonReport = {
          period: {
            since: since.toISOString(),
            until: until.toISOString(),
            days: periodDays
          },
          overview: {
            sessions: currentSessionCount,
            sessionChange: previousSessionCount > 0
              ? ((currentSessionCount - previousSessionCount) / previousSessionCount) * 100
              : null,
            successRate: Math.round(currentSuccessRate * 10) / 10,
            successRateChange: successRateDiff,
            learnings: currentLearningCount,
            tokens: currentTokens,
          },
          effectiveness: {
            baseline: {
              successRate: Math.round(currentBaseline.successRate * 100 * 10) / 10,
              avgDuration: currentBaseline.avgDuration,
              avgTokens: currentBaseline.avgTokens
            },
            topTools: topTools.map(t => ({
              name: t.toolName,
              category: t.category,
              successRate: Math.round(t.successRate * 10) / 10,
              vsBaseline: Math.round(t.vsBaseline * 10) / 10
            })),
            modes: modeStats.map(m => ({
              mode: m.mode,
              successRate: Math.round(m.successRate * 10) / 10,
              vsBaseline: Math.round(m.vsBaseline * 10) / 10
            }))
          },
          errors: {
            total: currentErrorCount,
            errorChange: previousErrorCount > 0
              ? ((currentErrorCount - previousErrorCount) / previousErrorCount) * 100
              : null,
            recurring: currentErrorStats.filter(e => e.recurrenceCount >= 3).length,
            topTypes: topErrors.map(e => ({
              type: e.errorType,
              count: e.count,
              hasLearning: e.hasLearning,
              recurrenceCount: e.recurrenceCount
            }))
          },
          codeImpact: {
            sessionsAnalyzed: currentSessionCount,
            // Note: Full correlation analysis would require git integration
          },
          recentLearnings: recentLearnings.map(l => ({
            type: l.type,
            content: l.content.substring(0, 100) + (l.content.length > 100 ? '...' : ''),
            tags: l.tags
          })),
          recommendations
        };

        console.log(JSON.stringify(jsonReport, null, 2));
        return;
      }

      // Human-readable output
      const border = '═'.repeat(67);
      const divider = '─'.repeat(67);

      console.log(chalk.bold(`\n${border}`));
      console.log(chalk.bold.cyan(`          CODE AGENT INSIGHTS REPORT`));

      const title = options.title || `${since.toISOString().split('T')[0]} to ${until.toISOString().split('T')[0]}`;
      console.log(chalk.bold.cyan(`                   ${title}`));
      console.log(chalk.bold(`${border}\n`));

      // Overview
      console.log(chalk.bold('📊 OVERVIEW'));
      console.log(divider);
      console.log(`   Sessions:      ${currentSessionCount} ${formatPercentChange(currentSessionCount, previousSessionCount)} vs previous period`);
      console.log(`   Success Rate:  ${currentSuccessRate.toFixed(1)}% ${formatPercentChange(currentSuccessRate, previousSuccessRate)}`);
      console.log(`   Learnings:     ${currentLearningCount} new`);
      console.log(`   Tokens:        ${(currentTokens / 1000).toFixed(0)}K\n`);

      // Effectiveness
      if (topTools.length > 0 || modeStats.length > 0) {
        console.log(chalk.bold('🎯 EFFECTIVENESS'));
        console.log(divider);

        if (topTools.length > 0) {
          console.log('   Top performing tools/features:');
          for (const tool of topTools) {
            console.log(chalk.green(`   • ${tool.toolName}: ${tool.successRate.toFixed(1)}% success (+${tool.vsBaseline.toFixed(1)}% vs baseline)`));
          }
        }

        if (modeStats.length > 0) {
          console.log('\n   Mode effectiveness:');
          for (const mode of modeStats) {
            console.log(chalk.green(`   • ${mode.mode}: ${mode.successRate.toFixed(1)}% (+${mode.vsBaseline.toFixed(1)}%)`));
          }
        }
        console.log('');
      }

      // Errors
      console.log(chalk.bold('🐛 ERROR TRENDS'));
      console.log(divider);
      console.log(`   Total:         ${currentErrorCount} ${formatPercentChange(currentErrorCount, previousErrorCount)} vs previous period`);
      console.log(`   Recurring:     ${currentErrorStats.filter(e => e.recurrenceCount >= 3).length} error types seen 3+ times`);

      if (topErrors.length > 0) {
        console.log('\n   Top issues:');
        for (const error of topErrors) {
          const status = error.hasLearning ? chalk.green('✓ fix documented') : chalk.yellow('no fix documented');
          console.log(`   • ${error.errorType} (${error.count}x) - ${status}`);
        }
      }
      console.log('');

      // Code Impact
      console.log(chalk.bold('🔗 CODE IMPACT'));
      console.log(divider);
      console.log(`   Sessions analyzed: ${currentSessionCount}`);
      console.log(chalk.dim('   Note: Run \'cai correlate --insights\' for detailed commit correlation\n'));

      // Recent Learnings
      if (recentLearnings.length > 0) {
        console.log(chalk.bold('💡 TOP LEARNINGS THIS PERIOD'));
        console.log(divider);
        for (const learning of recentLearnings) {
          const icon = learning.type === 'fix' ? '🔧' : learning.type === 'pattern' ? '✨' : '📏';
          const preview = learning.content.substring(0, 60) + (learning.content.length > 60 ? '...' : '');
          console.log(`   ${icon} [${learning.type}] ${preview}`);
        }
        console.log('');
      }

      // Recommendations
      if (recommendations.length > 0) {
        console.log(chalk.bold('📈 RECOMMENDATIONS'));
        console.log(divider);
        recommendations.forEach((rec, i) => {
          console.log(`   ${i + 1}. ${rec}`);
        });
        console.log('');
      }

      console.log(chalk.bold(border));

    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    } finally {
      db.close();
    }
  });
