import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import { InsightsDatabase } from '@code-agent-insights/core';
import { formatLearningsSection, mergeIntoClaudeMd } from '../utils/claude-md';

interface SyncOptions {
  project?: string;
  dryRun?: boolean;
  section?: string;
  includeGlobal?: boolean;
  minConfidence?: number;
}

function getUniqueProjects(db: InsightsDatabase): string[] {
  const rows = db.db.prepare(`
    SELECT DISTINCT project_path
    FROM sessions
    WHERE project_path IS NOT NULL AND project_path != ''
    ORDER BY project_path
  `).all() as Array<{ project_path: string }>;

  return rows.map((r) => r.project_path);
}

export const syncCommand = new Command('sync')
  .description('Sync learnings to project CLAUDE.md files')
  .option('-p, --project <path>', 'Sync specific project only')
  .option('--dry-run', 'Show what would be synced without modifying files')
  .option('--section <name>', 'Section name in CLAUDE.md', 'Learnings from Past Sessions')
  .option('--no-include-global', 'Exclude global-scoped learnings')
  .option('--min-confidence <number>', 'Minimum confidence threshold', '0.7')
  .addHelpText('after', `
Examples:
  $ cai sync                          Sync all projects
  $ cai sync --dry-run                Preview changes without writing
  $ cai sync -p /path/to/project      Sync specific project only
  $ cai sync --min-confidence 0.9     Only high-confidence learnings
  $ cai sync --no-include-global      Exclude global learnings`)
  .action(async (options: SyncOptions) => {
    const db = new InsightsDatabase();

    try {
      // Parse options
      const minConfidence = parseFloat(options.minConfidence?.toString() || '0.7');
      const includeGlobal = options.includeGlobal !== false;
      const sectionName = options.section || 'Learnings from Past Sessions';

      // Determine which projects to sync
      let projectPaths: string[];
      if (options.project) {
        // Resolve to absolute path
        const absolutePath = path.resolve(options.project);
        projectPaths = [absolutePath];
      } else {
        // Get all projects
        const spinner = ora('Discovering projects...').start();
        projectPaths = getUniqueProjects(db);
        spinner.succeed(`Found ${projectPaths.length} projects`);
      }

      if (projectPaths.length === 0) {
        console.log(chalk.yellow('No projects found to sync.'));
        return;
      }

      // Sync each project
      const results: Array<{
        path: string;
        success: boolean;
        action: 'created' | 'updated' | 'unchanged' | 'skipped';
        learningCount: number;
        error?: string;
      }> = [];

      console.log(chalk.blue(`\n${options.dryRun ? 'Preview' : 'Syncing'} ${projectPaths.length} project${projectPaths.length > 1 ? 's' : ''}...\n`));

      for (const projectPath of projectPaths) {
        try {
          // Get learnings for this project
          const learnings = db.getLearningsForProject(projectPath, {
            includeGlobal,
            minConfidence,
            onlyReviewed: true,
            limit: 100
          });

          // Skip if no learnings
          if (learnings.length === 0) {
            results.push({
              path: projectPath,
              success: true,
              action: 'skipped',
              learningCount: 0
            });
            console.log(chalk.dim(`  ⊘ ${path.basename(projectPath)}: No learnings`));
            continue;
          }

          // Format learnings section
          const learningsSection = formatLearningsSection(learnings, {
            sectionName
          });

          // Merge into CLAUDE.md
          const result = mergeIntoClaudeMd(projectPath, learningsSection, {
            dryRun: options.dryRun
          });

          results.push({
            path: projectPath,
            success: result.success,
            action: result.action,
            learningCount: learnings.length
          });

          // Display result
          const projectName = path.basename(projectPath);
          if (result.action === 'created') {
            console.log(chalk.green(`  ✓ ${projectName}: Created (${learnings.length} learnings)`));
          } else if (result.action === 'updated') {
            console.log(chalk.green(`  ✓ ${projectName}: Updated (${learnings.length} learnings)`));
          } else if (result.action === 'unchanged') {
            console.log(chalk.dim(`  ⊘ ${projectName}: Unchanged (${learnings.length} learnings)`));
          }

          // Show diff in dry-run mode
          if (options.dryRun && result.diff) {
            console.log(chalk.dim('    Preview:'));
            const diffLines = result.diff.split('\n').slice(0, 5);
            diffLines.forEach(line => {
              console.log(chalk.dim(`    ${line}`));
            });
            if (result.diff.split('\n').length > 5) {
              console.log(chalk.dim('    ...'));
            }
          }
        } catch (error) {
          results.push({
            path: projectPath,
            success: false,
            action: 'skipped',
            learningCount: 0,
            error: (error as Error).message
          });
          console.log(chalk.red(`  ✗ ${path.basename(projectPath)}: Error - ${(error as Error).message}`));
        }
      }

      // Summary
      const successful = results.filter(r => r.success && r.action !== 'skipped' && r.action !== 'unchanged');
      const unchanged = results.filter(r => r.action === 'unchanged');
      const skipped = results.filter(r => r.action === 'skipped');
      const failed = results.filter(r => !r.success);

      console.log(chalk.blue('\n' + (options.dryRun ? 'Preview' : 'Sync') + ' complete:'));

      if (successful.length > 0) {
        console.log(chalk.green(`  ✓ ${successful.length} project${successful.length > 1 ? 's' : ''} ${options.dryRun ? 'would be ' : ''}${successful.filter(r => r.action === 'created').length > 0 ? 'created/updated' : 'updated'}`));
      }

      if (unchanged.length > 0) {
        console.log(chalk.dim(`  ⊘ ${unchanged.length} project${unchanged.length > 1 ? 's' : ''} unchanged`));
      }

      if (skipped.length > 0) {
        console.log(chalk.yellow(`  ⚠ ${skipped.length} project${skipped.length > 1 ? 's' : ''} skipped (no learnings)`));
      }

      if (failed.length > 0) {
        console.log(chalk.red(`  ✗ ${failed.length} project${failed.length > 1 ? 's' : ''} failed`));
      }

      // Show projects synced
      if (successful.length > 0) {
        console.log(chalk.blue('\nProjects synced:'));
        for (const result of successful) {
          const projectName = path.basename(result.path);
          console.log(chalk.green(`  ${projectName}: ${result.learningCount} learnings`));
        }
      }

      // Dry-run reminder
      if (options.dryRun && successful.length > 0) {
        console.log(chalk.yellow('\n💡 This was a dry-run. Run without --dry-run to apply changes.'));
      }
    } finally {
      db.close();
    }
  });
