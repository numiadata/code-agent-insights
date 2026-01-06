import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { InsightsDatabase } from '@code-agent-insights/core';

interface StatsOptions {
  project?: string;
  json?: boolean;
  skills?: boolean;
  tools?: boolean;
  agents?: boolean;
  modes?: boolean;
}

export const statsCommand = new Command('stats')
  .description('Show insights and statistics')
  .option('-p, --project <path>', 'Filter by project')
  .option('--json', 'Output as JSON')
  .option('--skills', 'Show skill usage breakdown')
  .option('--tools', 'Show tool pattern analysis')
  .option('--agents', 'Show sub-agent statistics')
  .option('--modes', 'Show mode effectiveness')
  .action(async (options: StatsOptions) => {
    const db = new InsightsDatabase();

    try {
      // 2. If options.json and no specific breakdown
      if (options.json && !options.skills && !options.tools && !options.agents && !options.modes) {
        const stats = db.getStats();
        const skillStats = db.getSkillStats();
        const toolStats = db.getToolPatternStats();
        const agentStats = db.getSubAgentStats();
        const modeStats = db.getModeEffectiveness();

        console.log(
          JSON.stringify(
            {
              overview: stats,
              skills: skillStats,
              tools: toolStats,
              agents: agentStats,
              modes: modeStats,
            },
            null,
            2
          )
        );
        return;
      }

      // 3. Log blue header
      console.log(chalk.blue.bold('\n📊 Code Agent Insights\n'));

      // 4. Default view (no specific flag)
      if (!options.skills && !options.tools && !options.agents && !options.modes) {
        const stats = db.getStats();

        // Calculate success rate
        const successSession = stats.sessionsByOutcome.find((o) => o.outcome === 'success');
        const totalSessions = stats.totalSessions;
        const successRate =
          totalSessions > 0 ? ((successSession?.count || 0) / totalSessions) * 100 : 0;

        // Create overview table
        const overviewTable = new Table({
          head: ['Metric', 'Value'],
          style: { head: ['cyan'] },
        });

        overviewTable.push(
          ['Total Sessions', totalSessions.toLocaleString()],
          ['Total Tokens', stats.totalTokens.toLocaleString()],
          ['Total Errors', stats.totalErrors.toLocaleString()],
          ['Total Learnings', stats.totalLearnings.toLocaleString()],
          ['Success Rate', `${successRate.toFixed(1)}%`]
        );

        console.log(overviewTable.toString());
        console.log('');

        // Show breakdown by source
        if (stats.sessionsBySource.length > 0) {
          console.log(chalk.cyan.bold('Sessions by Source:\n'));
          const sourceTable = new Table({
            head: ['Source', 'Count'],
            style: { head: ['cyan'] },
          });

          for (const item of stats.sessionsBySource) {
            sourceTable.push([item.source, item.count.toLocaleString()]);
          }

          console.log(sourceTable.toString());
          console.log('');
        }

        // Show breakdown by outcome
        if (stats.sessionsByOutcome.length > 0) {
          console.log(chalk.cyan.bold('Sessions by Outcome:\n'));
          const outcomeTable = new Table({
            head: ['Outcome', 'Count', 'Percentage'],
            style: { head: ['cyan'] },
          });

          for (const item of stats.sessionsByOutcome) {
            const percentage = totalSessions > 0 ? (item.count / totalSessions) * 100 : 0;
            outcomeTable.push([
              item.outcome,
              item.count.toLocaleString(),
              `${percentage.toFixed(1)}%`,
            ]);
          }

          console.log(outcomeTable.toString());
          console.log('');
        }
      }

      // 5. If options.skills
      if (options.skills) {
        console.log(chalk.cyan.bold('Skill Usage:\n'));
        const skillStats = db.getSkillStats();

        if (skillStats.length > 0) {
          const skillTable = new Table({
            head: ['Skill Name', 'Usage Count', 'Success Rate'],
            style: { head: ['cyan'] },
          });

          for (const skill of skillStats) {
            skillTable.push([
              skill.skillName,
              skill.usageCount.toLocaleString(),
              `${(skill.successRate * 100).toFixed(1)}%`,
            ]);
          }

          console.log(skillTable.toString());
          console.log('');

          // Calculate overall insight
          const stats = db.getStats();
          const modeStats = db.getModeEffectiveness();
          const skillMode = modeStats.find((m) => m.mode === 'sub_agents'); // Using sub_agents as proxy

          if (skillMode) {
            const withRate =
              skillMode.withMode.total > 0
                ? (skillMode.withMode.success / skillMode.withMode.total) * 100
                : 0;
            const withoutRate =
              skillMode.withoutMode.total > 0
                ? (skillMode.withoutMode.success / skillMode.withoutMode.total) * 100
                : 0;

            console.log(
              chalk.dim(
                `💡 Insight: Sessions using skills have ${withRate.toFixed(1)}% success rate vs ${withoutRate.toFixed(1)}% without\n`
              )
            );
          }
        } else {
          console.log(chalk.yellow('No skill usage data found.\n'));
        }
      }

      // 6. If options.tools
      if (options.tools) {
        console.log(chalk.cyan.bold('Tool Patterns:\n'));
        const toolStats = db.getToolPatternStats();

        if (toolStats.length > 0) {
          const toolTable = new Table({
            head: ['Pattern', 'Count', 'Success Rate'],
            style: { head: ['cyan'] },
          });

          // Show top 5 most effective patterns
          const topPatterns = toolStats
            .sort((a, b) => b.successRate - a.successRate)
            .slice(0, 5);

          for (const pattern of topPatterns) {
            // Parse tools array and format
            const tools = JSON.parse(pattern.tools);
            const toolString = tools.join(' → ');

            toolTable.push([
              toolString,
              pattern.count.toLocaleString(),
              `${(pattern.successRate * 100).toFixed(1)}%`,
            ]);
          }

          console.log(toolTable.toString());
          console.log('');
          console.log(chalk.dim('💡 Showing top 5 most effective patterns\n'));
        } else {
          console.log(chalk.yellow('No tool pattern data found.\n'));
        }
      }

      // 7. If options.agents
      if (options.agents) {
        console.log(chalk.cyan.bold('Sub-agent Usage:\n'));
        const agentStats = db.getSubAgentStats();

        if (agentStats.length > 0) {
          const agentTable = new Table({
            head: ['Outcome', 'Count', 'Avg Tokens'],
            style: { head: ['cyan'] },
          });

          let totalCount = 0;
          let totalTokens = 0;

          for (const agent of agentStats) {
            agentTable.push([
              agent.outcome,
              agent.count.toLocaleString(),
              Math.round(agent.avgTokens).toLocaleString(),
            ]);

            totalCount += agent.count;
            totalTokens += agent.avgTokens * agent.count;
          }

          console.log(agentTable.toString());
          console.log('');

          // Calculate efficiency
          const avgTokensPerAgent = totalCount > 0 ? totalTokens / totalCount : 0;
          const successAgent = agentStats.find((a) => a.outcome === 'success');
          const successRate = totalCount > 0 ? ((successAgent?.count || 0) / totalCount) * 100 : 0;

          console.log(
            chalk.dim(
              `💡 Sub-agent efficiency: ${successRate.toFixed(1)}% success rate, avg ${Math.round(avgTokensPerAgent).toLocaleString()} tokens per task\n`
            )
          );
        } else {
          console.log(chalk.yellow('No sub-agent data found.\n'));
        }
      }

      // 8. If options.modes
      if (options.modes) {
        console.log(chalk.cyan.bold('Mode Effectiveness:\n'));
        const modeStats = db.getModeEffectiveness();

        if (modeStats.length > 0) {
          const modeTable = new Table({
            head: ['Mode', 'With Mode', 'Without Mode', 'Difference'],
            style: { head: ['cyan'] },
          });

          const recommendations: string[] = [];

          for (const mode of modeStats) {
            const withRate =
              mode.withMode.total > 0
                ? (mode.withMode.success / mode.withMode.total) * 100
                : 0;
            const withoutRate =
              mode.withoutMode.total > 0
                ? (mode.withoutMode.success / mode.withoutMode.total) * 100
                : 0;
            const diff = withRate - withoutRate;

            const modeName = mode.mode.replace('_', ' ');
            modeTable.push([
              modeName,
              `${withRate.toFixed(1)}% (${mode.withMode.total})`,
              `${withoutRate.toFixed(1)}% (${mode.withoutMode.total})`,
              `${diff > 0 ? '+' : ''}${diff.toFixed(1)}%`,
            ]);

            // Generate recommendations
            if (diff > 5 && mode.withMode.total >= 3) {
              recommendations.push(
                `Consider using ${modeName} more often (+${diff.toFixed(1)}% success rate)`
              );
            } else if (diff < -5 && mode.withMode.total >= 3) {
              recommendations.push(
                `${modeName} shows lower success rate (-${Math.abs(diff).toFixed(1)}%)`
              );
            }
          }

          console.log(modeTable.toString());
          console.log('');

          if (recommendations.length > 0) {
            console.log(chalk.dim('💡 Recommendations:'));
            for (const rec of recommendations) {
              console.log(chalk.dim(`  • ${rec}`));
            }
            console.log('');
          }
        } else {
          console.log(chalk.yellow('No mode data found.\n'));
        }
      }
    } finally {
      // 9. Close database in finally block
      db.close();
    }
  });
