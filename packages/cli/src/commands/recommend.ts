import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { InsightsDatabase } from '@code-agent-insights/core';
import Anthropic from '@anthropic-ai/sdk';

interface RecommendOptions {
  project?: string;
}

export const recommendCommand = new Command('recommend')
  .description('Get personalized feature recommendations')
  .option('-p, --project <path>', 'Filter by project')
  .action(async (options: RecommendOptions) => {
    // 1. Check for ANTHROPIC_API_KEY
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log(chalk.yellow('⚠ ANTHROPIC_API_KEY not set'));
      console.log(
        chalk.dim('  Set it to get AI-powered recommendations: export ANTHROPIC_API_KEY=...')
      );
      console.log(chalk.dim('  Falling back to basic recommendations...\n'));
    }

    const db = new InsightsDatabase();

    try {
      // 3. Gather stats
      const basicStats = db.getStats();
      const skillStats = db.getSkillStats();
      const modeStats = db.getModeEffectiveness();
      const toolStats = db.getToolPatternStats();
      const subAgentStats = db.getSubAgentStats();

      // 4. If not enough data (< 5 sessions)
      if (basicStats.totalSessions < 5) {
        console.log(chalk.yellow('⚠ Not enough data to generate recommendations'));
        console.log(
          chalk.dim(
            `  You have ${basicStats.totalSessions} sessions indexed. Run 'cai index' to index more sessions (need at least 5).`
          )
        );
        return;
      }

      // If API key is available, use AI recommendations
      if (process.env.ANTHROPIC_API_KEY) {
        // 5. Build analysis context string with all stats
        let context = `User Statistics:\n\n`;
        context += `Total Sessions: ${basicStats.totalSessions}\n`;
        context += `Total Tokens: ${basicStats.totalTokens}\n`;
        context += `Total Errors: ${basicStats.totalErrors}\n`;
        context += `Success Rate: ${
          basicStats.totalSessions > 0
            ? (
                ((basicStats.sessionsByOutcome.find((o) => o.outcome === 'success')?.count || 0) /
                  basicStats.totalSessions) *
                100
              ).toFixed(1)
            : 0
        }%\n\n`;

        if (modeStats.length > 0) {
          context += `Mode Usage:\n`;
          for (const mode of modeStats) {
            const withRate =
              mode.withMode.total > 0
                ? ((mode.withMode.success / mode.withMode.total) * 100).toFixed(1)
                : 0;
            const withoutRate =
              mode.withoutMode.total > 0
                ? ((mode.withoutMode.success / mode.withoutMode.total) * 100).toFixed(1)
                : 0;
            context += `- ${mode.mode}: Used ${mode.withMode.total} times (${withRate}% success), Not used ${mode.withoutMode.total} times (${withoutRate}% success)\n`;
          }
          context += '\n';
        }

        if (skillStats.length > 0) {
          context += `Skills Used:\n`;
          for (const skill of skillStats.slice(0, 5)) {
            context += `- ${skill.skillName}: ${skill.usageCount} times, ${(skill.successRate * 100).toFixed(1)}% success\n`;
          }
          context += '\n';
        }

        if (subAgentStats.length > 0) {
          context += `Sub-agent Usage:\n`;
          for (const agent of subAgentStats) {
            context += `- ${agent.outcome}: ${agent.count} times, avg ${Math.round(agent.avgTokens)} tokens\n`;
          }
          context += '\n';
        }

        // 6. Show spinner
        const spinner = ora('Analyzing your patterns...').start();

        try {
          // 7. Call Claude API
          const anthropic = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY,
          });

          const message = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2048,
            system:
              'You are an expert at helping developers get the most out of Claude Code. Based on usage statistics, provide actionable recommendations. Be specific and practical.',
            messages: [
              {
                role: 'user',
                content: `${context}\n\nBased on these statistics, provide 3-5 specific, actionable recommendations to help me improve my Claude Code usage. Focus on:\n- Features I should try or use more\n- Patterns that could improve success rate\n- Ways to reduce errors or token usage\n- Best practices I'm missing\n\nFormat each recommendation as a numbered list with a brief explanation of why.`,
              },
            ],
          });

          // 8. Stop spinner
          spinner.stop();

          // 9. Log blue header
          console.log(chalk.blue.bold('\n🎯 Recommendations for You\n'));

          // 10. Display recommendations
          const textContent = message.content.find((c) => c.type === 'text');
          if (textContent && 'text' in textContent) {
            console.log(textContent.text);
          } else {
            console.log(chalk.yellow('No recommendations generated.'));
          }
        } catch (error) {
          spinner.fail('Failed to generate AI recommendations');
          console.log(chalk.yellow('\nFalling back to basic recommendations...\n'));
          displayFallbackRecommendations(basicStats, skillStats, modeStats, subAgentStats);
        }
      } else {
        // No API key, use fallback recommendations
        displayFallbackRecommendations(basicStats, skillStats, modeStats, subAgentStats);
      }
    } finally {
      // 11. Close database in finally block
      db.close();
    }
  });

// Fallback recommendations when API is not available
function displayFallbackRecommendations(
  basicStats: any,
  skillStats: any[],
  modeStats: any[],
  subAgentStats: any[]
): void {
  console.log(chalk.blue.bold('🎯 Recommendations for You\n'));

  const recommendations: string[] = [];

  // Calculate success rate
  const successCount =
    basicStats.sessionsByOutcome.find((o: any) => o.outcome === 'success')?.count || 0;
  const successRate = basicStats.totalSessions > 0 ? successCount / basicStats.totalSessions : 0;

  // Recommendation based on skill usage
  if (skillStats.length === 0) {
    recommendations.push(
      '📚 Try using Claude Code skills - Skills can help Claude understand specialized file formats and domain-specific tasks. Check available skills with the Task tool.'
    );
  } else {
    const avgSkillSuccess =
      skillStats.reduce((sum, s) => sum + s.successRate, 0) / skillStats.length;
    if (avgSkillSuccess > successRate + 0.1) {
      const topSkill = skillStats[0];
      recommendations.push(
        `📚 Use skills more often - Your skill usage shows ${(avgSkillSuccess * 100).toFixed(1)}% success rate vs ${(successRate * 100).toFixed(1)}% overall. Consider using "${topSkill.skillName}" and similar skills more frequently.`
      );
    }
  }

  // Recommendation based on plan mode
  const planMode = modeStats.find((m) => m.mode === 'plan_mode');
  if (planMode) {
    const planRate =
      planMode.withMode.total > 0 ? planMode.withMode.success / planMode.withMode.total : 0;
    const noPlanRate =
      planMode.withoutMode.total > 0
        ? planMode.withoutMode.success / planMode.withoutMode.total
        : 0;

    if (planRate > noPlanRate + 0.1 && planMode.withMode.total < basicStats.totalSessions * 0.3) {
      recommendations.push(
        `🎯 Use plan mode more - Sessions with plan mode show ${(planRate * 100).toFixed(1)}% success vs ${(noPlanRate * 100).toFixed(1)}% without. Try using /plan for complex tasks.`
      );
    }
  } else {
    recommendations.push(
      "🎯 Try plan mode - Use /plan before complex tasks to help Claude create a structured approach. This often leads to better outcomes."
    );
  }

  // Recommendation based on sub-agents
  const subAgentMode = modeStats.find((m) => m.mode === 'sub_agents');
  if (subAgentMode && subAgentMode.withMode.total === 0) {
    recommendations.push(
      '🤖 Leverage sub-agents - Use the Task tool to delegate specific subtasks to specialized sub-agents. This can help break down complex problems and improve success rates.'
    );
  } else if (subAgentStats.length > 0) {
    const successAgents = subAgentStats.find((a) => a.outcome === 'success');
    const totalAgents = subAgentStats.reduce((sum, a) => sum + a.count, 0);
    const agentSuccessRate = successAgents ? successAgents.count / totalAgents : 0;

    if (agentSuccessRate > 0.7) {
      recommendations.push(
        `🤖 Continue using sub-agents - Your sub-agents have ${(agentSuccessRate * 100).toFixed(1)}% success rate. Keep delegating complex subtasks to specialized agents.`
      );
    }
  }

  // Recommendation based on error rate
  const errorRate = basicStats.totalSessions > 0 ? basicStats.totalErrors / basicStats.totalSessions : 0;
  if (errorRate > 3) {
    recommendations.push(
      `🔧 Focus on error handling - You average ${errorRate.toFixed(1)} errors per session. Consider:\n   • Using the Read tool before Edit to understand code structure\n   • Breaking complex tasks into smaller steps\n   • Using plan mode to think through the approach first`
    );
  }

  // Recommendation based on thinking mode
  const thinkingMode = modeStats.find((m) => m.mode === 'thinking');
  if (thinkingMode) {
    const thinkingRate =
      thinkingMode.withMode.total > 0
        ? thinkingMode.withMode.success / thinkingMode.withMode.total
        : 0;
    const noThinkingRate =
      thinkingMode.withoutMode.total > 0
        ? thinkingMode.withoutMode.success / thinkingMode.withoutMode.total
        : 0;

    if (thinkingRate > noThinkingRate + 0.1) {
      recommendations.push(
        `💭 Extended thinking helps - Sessions with thinking blocks show ${(thinkingRate * 100).toFixed(1)}% success. This feature is automatically used for complex reasoning.`
      );
    }
  }

  // Display recommendations
  if (recommendations.length === 0) {
    recommendations.push(
      "✨ You're doing great! Keep up the good work. Continue exploring Claude Code features as you encounter new challenges."
    );
  }

  recommendations.forEach((rec, i) => {
    console.log(`${i + 1}. ${rec}\n`);
  });
}
