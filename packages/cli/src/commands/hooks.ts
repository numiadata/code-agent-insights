import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const POST_SESSION_HOOK = `#!/bin/bash
# code-agent-insights: Auto-index on session end
# Installed by: cai hooks install

# Wait a moment for session file to be written
sleep 2

# Index the recent session
cai index --since 1h 2>/dev/null

# Generate summary if API key available
if [ -n "$ANTHROPIC_API_KEY" ]; then
  cai summarize --last-session 2>/dev/null
fi

# Check if auto-sync is enabled
if grep -q "autoSync: true" ~/.code-agent-insights/config.yaml 2>/dev/null; then
  cai sync 2>/dev/null
fi

# Log completion
echo "[$(date)] Session indexed" >> ~/.code-agent-insights/hooks.log
`;

export const hooksCommand = new Command('hooks')
  .description('Manage session hooks for auto-indexing and summarization');

// Install subcommand
hooksCommand
  .command('install')
  .description('Install hooks for auto-indexing after sessions')
  .action(async () => {
    try {
      await installHooks();
    } catch (error) {
      console.error(
        chalk.red('Error installing hooks:'),
        error instanceof Error ? error.message : 'Unknown error'
      );
      process.exit(1);
    }
  });

// Uninstall subcommand
hooksCommand
  .command('uninstall')
  .description('Remove installed hooks')
  .action(async () => {
    try {
      await uninstallHooks();
    } catch (error) {
      console.error(
        chalk.red('Error uninstalling hooks:'),
        error instanceof Error ? error.message : 'Unknown error'
      );
      process.exit(1);
    }
  });

// Status subcommand
hooksCommand
  .command('status')
  .description('Show current hook status')
  .action(async () => {
    try {
      await hookStatus();
    } catch (error) {
      console.error(
        chalk.red('Error checking hook status:'),
        error instanceof Error ? error.message : 'Unknown error'
      );
      process.exit(1);
    }
  });

async function installHooks(): Promise<void> {
  const hooksDir = path.join(os.homedir(), '.claude', 'hooks');

  // Create hooks directory
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
    console.log(chalk.dim(`Created ${hooksDir}`));
  }

  // Write post-session hook
  const hookPath = path.join(hooksDir, 'post-session.sh');
  fs.writeFileSync(hookPath, POST_SESSION_HOOK);
  fs.chmodSync(hookPath, '755');

  console.log(chalk.green('✓ Installed post-session hook'));
  console.log(chalk.dim(`  Location: ${hookPath}`));
  console.log('');
  console.log(
    chalk.bold('What this hook does:')
  );
  console.log(chalk.dim('  1. Auto-indexes new sessions within the last hour'));
  console.log(chalk.dim('  2. Generates AI summaries (if ANTHROPIC_API_KEY is set)'));
  console.log(chalk.dim('  3. Auto-syncs learnings to projects (if enabled in config)'));
  console.log('');
  console.log(chalk.yellow('Note: Hook will run after each Claude Code session ends.'));
  console.log(
    chalk.dim('Check logs at: ~/.code-agent-insights/hooks.log')
  );
}

async function uninstallHooks(): Promise<void> {
  const hooksDir = path.join(os.homedir(), '.claude', 'hooks');
  const hookPath = path.join(hooksDir, 'post-session.sh');

  if (fs.existsSync(hookPath)) {
    fs.unlinkSync(hookPath);
    console.log(chalk.green('✓ Removed post-session hook'));
  } else {
    console.log(chalk.yellow('No hooks installed'));
  }
}

async function hookStatus(): Promise<void> {
  const hooksDir = path.join(os.homedir(), '.claude', 'hooks');
  const hookPath = path.join(hooksDir, 'post-session.sh');

  console.log(chalk.bold('Hook Status\n'));

  if (fs.existsSync(hookPath)) {
    console.log(chalk.green('✓ post-session.sh installed'));
    console.log(chalk.dim(`  Location: ${hookPath}`));

    // Check if executable
    try {
      fs.accessSync(hookPath, fs.constants.X_OK);
      console.log(chalk.green('✓ Hook is executable'));
    } catch {
      console.log(chalk.red('✗ Hook is not executable'));
      console.log(chalk.dim('  Fix with: chmod +x ' + hookPath));
    }

    // Show hook contents summary
    const content = fs.readFileSync(hookPath, 'utf-8');
    const hasIndex = content.includes('cai index');
    const hasSummarize = content.includes('cai summarize');
    const hasSync = content.includes('cai sync');

    console.log('');
    console.log(chalk.bold('Hook Actions:'));
    if (hasIndex) console.log(chalk.green('  ✓ Auto-index'));
    if (hasSummarize) console.log(chalk.green('  ✓ Auto-summarize'));
    if (hasSync) console.log(chalk.green('  ✓ Auto-sync (if enabled)'));
  } else {
    console.log(chalk.yellow('✗ No hooks installed'));
    console.log(chalk.dim('  Run: cai hooks install'));
  }

  // Check for log file
  const logPath = path.join(
    os.homedir(),
    '.code-agent-insights',
    'hooks.log'
  );
  if (fs.existsSync(logPath)) {
    const stats = fs.statSync(logPath);
    const lines = fs.readFileSync(logPath, 'utf-8').split('\n').filter(Boolean);

    console.log('');
    console.log(chalk.bold('Hook Activity:'));
    console.log(chalk.dim(`  Last run: ${stats.mtime.toLocaleString()}`));
    console.log(chalk.dim(`  Total runs: ${lines.length}`));

    if (lines.length > 0) {
      console.log(chalk.dim('\n  Recent activity:'));
      const recentLines = lines.slice(-5);
      for (const line of recentLines) {
        console.log(chalk.dim(`    ${line}`));
      }
    }
  }
}
