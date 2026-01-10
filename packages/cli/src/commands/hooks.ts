import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const POST_SESSION_HOOK = `#!/bin/bash
# code-agent-insights: Auto-index on session end
# Installed by: cai hooks install

LOG_FILE=~/.code-agent-insights/hooks.log

{
  echo "========================================="
  echo "[$(date)] Session ended - starting hook"

  # Wait a moment for session file to be written
  echo "Waiting 2s for session file..."
  sleep 2

  # Index the recent session (using 6h to avoid timezone edge cases)
  echo "Running: cai index --since 6h"
  if cai index --since 6h; then
    echo "✓ Index completed successfully"
  else
    echo "✗ Index failed with exit code $?"
  fi

  # Generate summary if API key available
  if [ -n "$ANTHROPIC_API_KEY" ]; then
    echo "Running: cai summarize --last-session"
    if cai summarize --last-session 2>&1; then
      echo "✓ Summarize completed"
    else
      echo "⚠ Summarize failed or skipped (check API key and credits)"
    fi
  else
    echo "ℹ Skipping summarization (ANTHROPIC_API_KEY not set)"
    echo "  To enable: export ANTHROPIC_API_KEY=sk-ant-..."
  fi

  # Check if auto-sync is enabled
  if grep -q "autoSync: true" ~/.code-agent-insights/config.yaml 2>/dev/null; then
    echo "Running: cai sync"
    if cai sync 2>&1; then
      echo "✓ Sync completed"
    else
      echo "⚠ Sync failed or skipped"
    fi
  fi

  echo "[$(date)] Hook completed"
  echo "========================================="
} >> "$LOG_FILE" 2>&1
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

// Logs subcommand
hooksCommand
  .command('logs')
  .description('Show hook execution logs')
  .option('-f, --follow', 'Follow log output in real-time')
  .option('-n, --lines <number>', 'Number of lines to show', '20')
  .action(async (options: { follow?: boolean; lines?: string }) => {
    try {
      await showHookLogs(options);
    } catch (error) {
      console.error(
        chalk.red('Error showing hook logs:'),
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

  // Configure Claude Code to run the hook
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  try {
    let settings: any = {};

    // Read existing settings if file exists
    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, 'utf-8');
      settings = JSON.parse(content);
    }

    // Add or update hooks configuration
    if (!settings.hooks) {
      settings.hooks = {};
    }
    settings.hooks.SessionEnd = [
      {
        hooks: [
          {
            type: 'command',
            command: hookPath
          }
        ]
      }
    ];

    // Write back to settings
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    console.log(chalk.green('✓ Configured Claude Code to run hook'));
  } catch (error) {
    console.log(chalk.yellow('⚠ Could not automatically configure Claude Code settings'));
    console.log(chalk.dim('  You may need to manually add this to ~/.claude/settings.json:'));
    console.log(chalk.dim('  "hooks": {'));
    console.log(chalk.dim('    "SessionEnd": ['));
    console.log(chalk.dim('      {'));
    console.log(chalk.dim('        "hooks": ['));
    console.log(chalk.dim('          {'));
    console.log(chalk.dim('            "type": "command",'));
    console.log(chalk.dim(`            "command": "${hookPath}"`));
    console.log(chalk.dim('          }'));
    console.log(chalk.dim('        ]'));
    console.log(chalk.dim('      }'));
    console.log(chalk.dim('    ]'));
    console.log(chalk.dim('  }'));
  }

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
  let hookRemoved = false;

  if (fs.existsSync(hookPath)) {
    fs.unlinkSync(hookPath);
    console.log(chalk.green('✓ Removed post-session hook'));
    hookRemoved = true;
  } else {
    console.log(chalk.yellow('No hook script found'));
  }

  // Remove from Claude Code settings
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  try {
    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(content);

      if (settings.hooks?.SessionEnd || settings.hooks?.postSession) {
        // Remove both old (postSession) and new (SessionEnd) formats
        delete settings.hooks.SessionEnd;
        delete settings.hooks.postSession;

        // Remove hooks object if empty
        if (Object.keys(settings.hooks).length === 0) {
          delete settings.hooks;
        }

        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
        console.log(chalk.green('✓ Removed hook configuration from Claude Code'));
        hookRemoved = true;
      }
    }
  } catch (error) {
    console.log(chalk.yellow('⚠ Could not update Claude Code settings'));
    console.log(chalk.dim('  You may want to manually remove hooks config from ~/.claude/settings.json'));
  }

  if (!hookRemoved) {
    console.log(chalk.yellow('No hooks were installed'));
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

  console.log('');
  console.log(chalk.dim('Tip: Run `cai hooks logs -f` to watch hook execution in real-time'));
}

async function showHookLogs(options: { follow?: boolean; lines?: string }): Promise<void> {
  const logPath = path.join(os.homedir(), '.code-agent-insights', 'hooks.log');

  if (!fs.existsSync(logPath)) {
    console.log(chalk.yellow('No hook logs found'));
    console.log(chalk.dim('Logs will be created after the first hook execution'));
    console.log(chalk.dim(`Expected location: ${logPath}`));
    return;
  }

  if (options.follow) {
    // Use tail -f for real-time following
    console.log(chalk.blue('Following hook logs (Ctrl+C to stop)...\n'));
    const { spawn } = require('child_process');
    const tail = spawn('tail', ['-f', logPath], {
      stdio: 'inherit'
    });

    tail.on('error', (error: Error) => {
      console.error(chalk.red('Error following logs:'), error.message);
    });

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      tail.kill();
      process.exit(0);
    });
  } else {
    // Show last N lines
    const lines = parseInt(options.lines || '20', 10);
    const content = fs.readFileSync(logPath, 'utf-8');
    const logLines = content.split('\n').filter(Boolean);
    const recentLines = logLines.slice(-lines);

    console.log(chalk.blue(`Last ${recentLines.length} lines from hook logs:\n`));
    for (const line of recentLines) {
      // Color-code different log levels
      if (line.includes('✓')) {
        console.log(chalk.green(line));
      } else if (line.includes('✗') || line.includes('failed')) {
        console.log(chalk.red(line));
      } else if (line.includes('⚠')) {
        console.log(chalk.yellow(line));
      } else if (line.includes('=====')) {
        console.log(chalk.dim(line));
      } else {
        console.log(line);
      }
    }

    console.log('');
    console.log(chalk.dim(`Tip: Run \`cai hooks logs -f\` to watch logs in real-time`));
  }
}
