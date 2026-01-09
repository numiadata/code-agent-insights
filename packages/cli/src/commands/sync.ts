import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import { InsightsDatabase } from '@code-agent-insights/core';
import { formatLearningsSection, mergeIntoClaudeMd } from '../utils/claude-md';
import { getGitInfo } from '../utils/git';

interface SyncOptions {
  project?: string;
  dryRun?: boolean;
  section?: string;
  global?: boolean;
  minConfidence?: string;
  reviewedOnly?: boolean;
  silent?: boolean; // For auto-sync from other commands
}

export async function runSync(options: SyncOptions = {}): Promise<void> {
  const db = new InsightsDatabase();
  const spinner = options.silent
    ? { succeed: () => {}, fail: () => {}, start: () => ({ succeed: () => {}, fail: () => {} }) }
    : ora('Loading projects...').start();

    try {
      // Get projects to sync
      let projects: Array<{ path: string; name: string }>;

      if (options.project) {
        // Resolve to absolute path
        const projectPath = path.resolve(options.project);
        projects = [{ path: projectPath, name: path.basename(projectPath) }];
        spinner.succeed(`Found 1 project`);
      } else {
        const allProjects = db.getAllProjects();
        projects = allProjects.map(p => ({ path: p.path, name: p.name }));
        spinner.succeed(`Found ${projects.length} projects`);
      }

      if (projects.length === 0) {
        console.log(chalk.yellow('\nNo projects found. Run `cai index` first.'));
        return;
      }

      if (options.dryRun) {
        console.log(chalk.blue('\n🔍 Dry run mode - no files will be modified\n'));
      }

      const results: Array<{
        project: string;
        status: 'synced' | 'skipped' | 'error';
        learnings: number;
        action?: string;
        message?: string;
      }> = [];

      for (const project of projects) {
        // Get learnings for this project
        const learnings = db.getLearningsForProject(project.path, {
          includeGlobal: options.global !== false,
          minConfidence: parseFloat(options.minConfidence || '0.7'),
          onlyReviewed: options.reviewedOnly || false
        });

        if (learnings.length === 0) {
          results.push({
            project: project.name,
            status: 'skipped',
            learnings: 0,
            message: 'No learnings'
          });
          continue;
        }

        // Format the section
        const section = formatLearningsSection(learnings, {
          sectionName: options.section || 'Learnings from Past Sessions'
        });

        // Merge into CLAUDE.md
        const mergeResult = mergeIntoClaudeMd(project.path, section, {
          dryRun: options.dryRun
        });

        if (mergeResult.success) {
          results.push({
            project: project.name,
            status: 'synced',
            learnings: learnings.length,
            action: mergeResult.action,
            message: options.dryRun ? mergeResult.diff : undefined
          });
        } else {
          results.push({
            project: project.name,
            status: 'error',
            learnings: learnings.length,
            message: mergeResult.diff
          });
        }
      }

      // Summary
      console.log(chalk.bold('\n📋 Sync Summary\n'));

      const synced = results.filter(r => r.status === 'synced');
      const skipped = results.filter(r => r.status === 'skipped');
      const errors = results.filter(r => r.status === 'error');

      if (synced.length > 0) {
        console.log(chalk.green(`✓ ${synced.length} project${synced.length > 1 ? 's' : ''} ${options.dryRun ? 'would be ' : ''}synced:`));
        for (const r of synced) {
          const action = r.action === 'created' ? '(created)' :
                        r.action === 'updated' ? '(updated)' :
                        r.action === 'unchanged' ? '(unchanged)' : '';
          console.log(`    ${r.project}: ${r.learnings} learnings ${action}`);
          if (options.dryRun && r.message) {
            console.log(chalk.dim(`    ${r.message.split('\n').slice(0, 5).join('\n    ')}`));
            if (r.message.split('\n').length > 5) {
              console.log(chalk.dim('    ...'));
            }
          }
        }
      }

      if (skipped.length > 0) {
        console.log(chalk.yellow(`\n⚠ ${skipped.length} project${skipped.length > 1 ? 's' : ''} skipped:`));
        for (const r of skipped) {
          console.log(`    ${r.project}: ${r.message}`);
        }
      }

      if (errors.length > 0) {
        console.log(chalk.red(`\n✗ ${errors.length} project${errors.length > 1 ? 's' : ''} failed:`));
        for (const r of errors) {
          console.log(`    ${r.project}: ${r.message}`);
        }
      }

      // Total
      const totalLearnings = results.reduce((sum, r) => sum + r.learnings, 0);
      console.log(chalk.dim(`\nTotal: ${totalLearnings} learnings across ${results.length} projects`));

      // Dry-run reminder
      if (options.dryRun && synced.length > 0 && !options.silent) {
        console.log(chalk.yellow('\n💡 Run without --dry-run to apply changes.'));
      }
    } catch (error) {
      if (!options.silent) {
        spinner.fail('Sync failed');
        console.error(chalk.red(`Error: ${(error as Error).message}`));
      }
    } finally {
      db.close();
    }
}

export const syncCommand = new Command('sync')
  .description('Sync learnings to project CLAUDE.md files')
  .option('-p, --project <path>', 'Sync specific project only')
  .option('--dry-run', 'Show what would be synced without modifying files')
  .option('--section <name>', 'Section name in CLAUDE.md', 'Learnings from Past Sessions')
  .option('--no-global', 'Exclude global-scoped learnings')
  .option('--min-confidence <number>', 'Minimum confidence threshold', '0.7')
  .option('--reviewed-only', 'Only include reviewed learnings')
  .addHelpText('after', `
Examples:
  $ cai sync                          Sync all projects
  $ cai sync --dry-run                Preview changes without writing
  $ cai sync -p /path/to/project      Sync specific project only
  $ cai sync --min-confidence 0.9     Only high-confidence learnings
  $ cai sync --no-global              Exclude global learnings
  $ cai sync --reviewed-only          Only reviewed/manual learnings`)
  .action(async (options: SyncOptions) => {
    await runSync(options);
  });
