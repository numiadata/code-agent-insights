import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { InsightsDatabase } from '@code-agent-insights/core';

interface EffectivenessOptions {
  since?: string;
  category?: string;
  minSessions?: string;
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

interface ToolWithCategory {
  toolName: string;
  category: string;
  usageCount: number;
  sessionCount: number;
  successRate: number;
  avgCallsPerSession: number;
  vsBaseline: number;
}

export const effectivenessCommand = new Command('effectiveness')
  .description('Show tool and feature effectiveness analysis')
  .option('--since <date>', 'Start date (default: 30d). Formats: 7d, 2w, 30d, 90d, YYYY-MM-DD', '30d')
  .option('--category <cat>', 'Filter by category: modes, agents, skills, file_ops, execution, search, mcp, navigation, notebook, other')
  .option('--min-sessions <n>', 'Minimum sessions to include tool (default: 3)', '3')
  .option('--json', 'Output as JSON')
  .addHelpText('after', `
Examples:
  $ cai effectiveness                    Show all tools
  $ cai effectiveness --since 7d         Last 7 days
  $ cai effectiveness --category modes   Only modes
  $ cai effectiveness --min-sessions 5   Min 5 sessions
  $ cai effectiveness --json             JSON output`)
  .action(async (options: EffectivenessOptions) => {
    const db = new InsightsDatabase();

    try {
      // Parse dates and options
      const since = parseDateOption(options.since || '30d');
      const minSessions = parseInt(options.minSessions || '3', 10);
      const categoryFilter = options.category;

      // Validate category
      const validCategories = ['modes', 'agents', 'skills', 'file_ops', 'execution', 'search', 'mcp', 'navigation', 'notebook', 'other'];
      if (categoryFilter && !validCategories.includes(categoryFilter)) {
        console.error(chalk.red(`Invalid category: ${categoryFilter}`));
        console.error(chalk.dim(`Valid categories: ${validCategories.join(', ')}`));
        process.exit(1);
      }

      // Get baseline stats
      const baseline = db.getBaselineStats(since);

      // Get tool usage stats
      const toolStats = db.getToolUsageStats({ since, limit: 200 });

      // Also need to get mode stats from session_modes table
      const modeStats = db.getModeEffectiveness();

      // Filter by min sessions and category
      let tools: ToolWithCategory[] = toolStats
        .filter(t => t.sessionCount >= minSessions)
        .map(t => ({
          ...t,
          vsBaseline: t.successRate - baseline.successRate
        }));

      // Add mode data
      for (const mode of modeStats) {
        if (mode.withMode.total >= minSessions) {
          const successRate = mode.withMode.total > 0
            ? (mode.withMode.success / mode.withMode.total) * 100
            : 0;

          tools.push({
            toolName: mode.mode,
            category: 'modes',
            usageCount: mode.withMode.total,
            sessionCount: mode.withMode.total,
            successRate: Math.round(successRate * 100) / 100,
            avgCallsPerSession: 1,
            vsBaseline: Math.round((successRate - baseline.successRate * 100) * 100) / 100
          });
        }
      }

      if (categoryFilter) {
        tools = tools.filter(t => t.category === categoryFilter);
      }

      if (tools.length === 0) {
        console.log(chalk.yellow('\nNo tools found matching criteria.'));
        console.log(chalk.dim(`Period: Since ${since.toISOString().split('T')[0]}`));
        console.log(chalk.dim(`Min sessions: ${minSessions}`));
        if (categoryFilter) {
          console.log(chalk.dim(`Category: ${categoryFilter}`));
        }
        return;
      }

      // Group by category
      const categories: { [key: string]: ToolWithCategory[] } = {};
      for (const tool of tools) {
        if (!categories[tool.category]) {
          categories[tool.category] = [];
        }
        categories[tool.category].push(tool);
      }

      // Sort within each category by success rate
      for (const cat in categories) {
        categories[cat].sort((a, b) => b.successRate - a.successRate);
      }

      // JSON output
      if (options.json) {
        console.log(JSON.stringify({
          period: {
            since: since.toISOString(),
            minSessions
          },
          baseline: {
            successRate: Math.round(baseline.successRate * 100 * 100) / 100,
            avgDuration: baseline.avgDuration,
            avgTokens: baseline.avgTokens
          },
          categories,
          topPerformers: tools
            .filter(t => t.vsBaseline > 0)
            .sort((a, b) => b.vsBaseline - a.vsBaseline)
            .slice(0, 5),
          underperformers: tools
            .filter(t => t.vsBaseline < 0)
            .sort((a, b) => a.vsBaseline - b.vsBaseline)
            .slice(0, 5)
        }, null, 2));
        return;
      }

      // Human-readable output
      console.log(chalk.bold('\n🎯 Tool Effectiveness Report\n'));
      console.log(chalk.dim(`Period: Since ${since.toISOString().split('T')[0]}`));
      console.log(chalk.dim(`Minimum sessions: ${minSessions}\n`));

      // Baseline
      console.log(chalk.bold('Baseline (No Special Features)'));
      console.log(`Success Rate: ${(baseline.successRate * 100).toFixed(1)}%`);
      console.log(`Avg Duration: ${baseline.avgDuration} min`);
      console.log(`Avg Tokens: ${baseline.avgTokens.toLocaleString()}\n`);

      // Category icons
      const categoryIcons: { [key: string]: string } = {
        modes: '🎛️ ',
        agents: '🤖',
        skills: '🎓',
        file_ops: '📁',
        execution: '⚡',
        search: '🔍',
        mcp: '🔌',
        navigation: '🧭',
        notebook: '📓',
        other: '🔧'
      };

      const categoryNames: { [key: string]: string } = {
        modes: 'Modes',
        agents: 'Sub-Agents',
        skills: 'Skills',
        file_ops: 'File Operations',
        execution: 'Execution',
        search: 'Search',
        mcp: 'MCP Tools',
        navigation: 'Navigation',
        notebook: 'Notebook',
        other: 'Other Tools'
      };

      // Sort categories by average success rate
      const sortedCategories = Object.keys(categories).sort((a, b) => {
        const avgA = categories[a].reduce((sum, t) => sum + t.successRate, 0) / categories[a].length;
        const avgB = categories[b].reduce((sum, t) => sum + t.successRate, 0) / categories[b].length;
        return avgB - avgA;
      });

      // Display each category
      for (const cat of sortedCategories) {
        const toolList = categories[cat];
        if (toolList.length === 0) continue;

        const icon = categoryIcons[cat] || '🔧';
        const name = categoryNames[cat] || cat;

        console.log(chalk.bold(`${icon}  ${name}`));

        const table = new Table({
          head: ['Tool', 'Sessions', 'Success', 'vs Base'],
          style: {
            head: ['cyan']
          }
        });

        for (const tool of toolList) {
          const successColor = tool.successRate >= baseline.successRate * 100 ? chalk.green : chalk.yellow;
          const vsBaseColor = tool.vsBaseline >= 0 ? chalk.green : chalk.yellow;

          table.push([
            tool.toolName,
            tool.sessionCount.toString(),
            successColor(`${tool.successRate.toFixed(1)}%`),
            vsBaseColor(`${tool.vsBaseline >= 0 ? '+' : ''}${tool.vsBaseline.toFixed(1)}%`)
          ]);
        }

        console.log(table.toString());
        console.log('');
      }

      // Top performers
      const topPerformers = tools
        .filter(t => t.vsBaseline > 0)
        .sort((a, b) => b.vsBaseline - a.vsBaseline)
        .slice(0, 3);

      if (topPerformers.length > 0) {
        console.log(chalk.bold('🏆 Top Performers (vs Baseline)\n'));

        const medals = ['🥇', '🥈', '🥉'];
        topPerformers.forEach((tool, i) => {
          console.log(chalk.green(
            `${medals[i] || '  '} ${tool.toolName} (${tool.category}): ${tool.successRate.toFixed(1)}% success (+${tool.vsBaseline.toFixed(1)}% vs baseline)`
          ));
        });
        console.log('');
      }

      // Underperformers
      const underperformers = tools
        .filter(t => t.vsBaseline < 0)
        .sort((a, b) => a.vsBaseline - b.vsBaseline)
        .slice(0, 5);

      if (underperformers.length > 0) {
        console.log(chalk.bold('⚠️  Underperformers (Below Baseline)\n'));

        underperformers.forEach(tool => {
          console.log(chalk.yellow(
            `- ${tool.toolName}: ${tool.successRate.toFixed(1)}% success (${tool.vsBaseline.toFixed(1)}% vs baseline)`
          ));
        });
        console.log('');
      }

      // Recommendations
      console.log(chalk.bold('💡 Recommendations\n'));

      if (topPerformers.length > 0) {
        const topMode = topPerformers.find(t => t.category === 'modes');
        if (topMode) {
          console.log(chalk.green(`✓ ${topMode.toolName} is effective - use for complex tasks`));
        }

        const topAgent = topPerformers.find(t => t.category === 'agents');
        if (topAgent) {
          console.log(chalk.green(`✓ Sub-agents helping - continue delegation pattern`));
        }

        const topSkill = topPerformers.find(t => t.category === 'skills');
        if (topSkill) {
          console.log(chalk.green(`✓ ${topSkill.toolName} skill is valuable - keep using it`));
        }
      }

      if (underperformers.length > 0) {
        console.log(chalk.yellow(`⚠ ${underperformers.length} tool(s) below baseline - may need different usage patterns`));
      }

      if (topPerformers.length === 0 && underperformers.length === 0) {
        console.log(chalk.dim('All tools performing close to baseline'));
      }

    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    } finally {
      db.close();
    }
  });
