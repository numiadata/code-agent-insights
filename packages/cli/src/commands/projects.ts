import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { InsightsDatabase } from '@code-agent-insights/core';

interface ProjectsOptions {
  json?: boolean;
  withLearnings?: boolean;
}

function formatRelativeTime(date: Date | null): string {
  if (!date) return 'never';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

function shortenPath(path: string, maxLength: number = 35): string {
  if (path.length <= maxLength) return path;

  // Try to keep the last part of the path
  const parts = path.split('/');
  const lastPart = parts[parts.length - 1];

  if (lastPart.length > maxLength - 3) {
    return '...' + lastPart.substring(lastPart.length - (maxLength - 3));
  }

  // Build path from the end
  let result = lastPart;
  for (let i = parts.length - 2; i >= 0; i--) {
    const candidate = parts[i] + '/' + result;
    if (candidate.length > maxLength - 3) {
      return '...' + result;
    }
    result = candidate;
  }

  return result;
}

export const projectsCommand = new Command('projects')
  .description('List all tracked projects')
  .option('--json', 'Output as JSON')
  .option('--with-learnings', 'Show learning count per project')
  .addHelpText('after', `
Examples:
  $ cai projects              List all projects
  $ cai projects --json       Output as JSON
  $ cai projects --with-learnings  Show detailed learning counts`)
  .action((options: ProjectsOptions) => {
    const db = new InsightsDatabase();

    try {
      // Get all projects
      const projects = db.getAllProjects();

      // Handle empty case
      if (projects.length === 0) {
        if (options.json) {
          console.log(JSON.stringify({ projects: [] }, null, 2));
        } else {
          console.log(chalk.yellow('\nNo projects tracked yet.\n'));
          console.log(chalk.dim("Run 'cai index' to index your Claude Code sessions."));
        }
        return;
      }

      // JSON output
      if (options.json) {
        const output = {
          projects: projects.map(p => ({
            path: p.path,
            name: p.name,
            sessionCount: p.sessionCount,
            learningCount: p.learningCount,
            lastSessionDate: p.lastSessionDate ? p.lastSessionDate.toISOString() : null
          })),
          summary: {
            totalProjects: projects.length,
            totalSessions: projects.reduce((sum, p) => sum + p.sessionCount, 0),
            totalLearnings: projects.reduce((sum, p) => sum + p.learningCount, 0)
          }
        };
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      // Table output
      console.log(chalk.blue('\n📁 Tracked Projects\n'));

      const table = new Table({
        head: [
          chalk.bold('Project'),
          chalk.bold('Sessions'),
          chalk.bold('Learnings'),
          chalk.bold('Last Active')
        ],
        colWidths: [37, 10, 11, 15],
        style: {
          head: [],
          border: []
        }
      });

      // Add rows
      for (const project of projects) {
        const displayPath = shortenPath(project.path);
        const relativeTime = formatRelativeTime(project.lastSessionDate);

        table.push([
          displayPath,
          project.sessionCount.toString(),
          project.learningCount.toString(),
          relativeTime
        ]);
      }

      console.log(table.toString());

      // Summary
      const totalSessions = projects.reduce((sum, p) => sum + p.sessionCount, 0);
      const totalLearnings = projects.reduce((sum, p) => sum + p.learningCount, 0);

      console.log(chalk.dim(`\nTotal: ${projects.length} project${projects.length > 1 ? 's' : ''}, ${totalSessions} session${totalSessions > 1 ? 's' : ''}, ${totalLearnings} learning${totalLearnings > 1 ? 's' : ''}\n`));
    } finally {
      db.close();
    }
  });
