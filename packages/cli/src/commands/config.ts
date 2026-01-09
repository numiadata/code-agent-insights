import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as yaml from 'yaml';
import { getConfig, getConfigManager } from '@code-agent-insights/core';
import { spawn } from 'child_process';

export const configCommand = new Command('config')
  .description('Manage code-agent-insights configuration');

// Show subcommand
configCommand
  .command('show')
  .description('Display current configuration')
  .action(async () => {
    try {
      const config = getConfig();
      const configPath = getConfigManager().getPath();

      console.log(chalk.bold('Current Configuration\n'));
      console.log(chalk.dim(`File: ${configPath}\n`));
      console.log(yaml.stringify(config));
    } catch (error) {
      console.error(
        chalk.red('Error displaying config:'),
        error instanceof Error ? error.message : 'Unknown error'
      );
      process.exit(1);
    }
  });

// Edit subcommand
configCommand
  .command('edit')
  .description('Open configuration file in editor')
  .action(async () => {
    try {
      const configPath = getConfigManager().getPath();
      const editor = process.env.EDITOR || process.env.VISUAL || 'nano';

      // Ensure config file exists
      if (!fs.existsSync(configPath)) {
        console.log(chalk.blue('Creating config file with defaults...'));
        getConfigManager().save();
      }

      console.log(chalk.dim(`Opening ${configPath} in ${editor}...`));

      const child = spawn(editor, [configPath], { stdio: 'inherit' });

      child.on('exit', (code) => {
        if (code === 0) {
          console.log(chalk.green('\n✓ Config file saved'));
        } else {
          console.log(chalk.yellow('\n⚠ Editor exited with code'), code);
        }
      });

      child.on('error', (error) => {
        console.error(chalk.red('Error opening editor:'), error.message);
        console.log(chalk.dim(`\nTry setting EDITOR environment variable:`));
        console.log(chalk.dim(`  export EDITOR=nano`));
        console.log(chalk.dim(`  export EDITOR=vim`));
        console.log(chalk.dim(`  export EDITOR=code`));
      });
    } catch (error) {
      console.error(
        chalk.red('Error editing config:'),
        error instanceof Error ? error.message : 'Unknown error'
      );
      process.exit(1);
    }
  });

// Reset subcommand
configCommand
  .command('reset')
  .description('Reset configuration to defaults')
  .option('--confirm', 'Skip confirmation prompt')
  .action(async (options: { confirm?: boolean }) => {
    try {
      if (!options.confirm) {
        console.log(chalk.yellow('⚠ This will reset all configuration to defaults'));
        console.log(chalk.dim('Use --confirm to proceed without this prompt\n'));

        // Simple confirmation without readline
        const configPath = getConfigManager().getPath();
        console.log(chalk.dim(`Config file: ${configPath}\n`));
        console.log(chalk.yellow('Run with --confirm to reset'));
        return;
      }

      getConfigManager().reset();
      console.log(chalk.green('✓ Config reset to defaults'));

      const configPath = getConfigManager().getPath();
      console.log(chalk.dim(`File: ${configPath}`));
    } catch (error) {
      console.error(
        chalk.red('Error resetting config:'),
        error instanceof Error ? error.message : 'Unknown error'
      );
      process.exit(1);
    }
  });

// Get subcommand
configCommand
  .command('get')
  .description('Get a configuration value')
  .argument('<key>', 'Configuration key (e.g., "summarization.autoSummarize")')
  .action(async (key: string) => {
    try {
      const config = getConfig();
      const value = getNestedValue(config, key);

      if (value === undefined) {
        console.log(chalk.yellow(`⚠ Key not found: ${key}`));
        process.exit(1);
      }

      console.log(yaml.stringify({ [key]: value }));
    } catch (error) {
      console.error(
        chalk.red('Error getting config value:'),
        error instanceof Error ? error.message : 'Unknown error'
      );
      process.exit(1);
    }
  });

// Set subcommand
configCommand
  .command('set')
  .description('Set a configuration value')
  .argument('<key>', 'Configuration key (e.g., "summarization.autoSummarize")')
  .argument('<value>', 'Value to set (JSON format for complex values)')
  .action(async (key: string, value: string) => {
    try {
      const manager = getConfigManager();
      const config = manager.get();

      // Parse value
      let parsedValue: any;
      try {
        parsedValue = JSON.parse(value);
      } catch {
        // Not JSON, treat as string
        // Convert string booleans
        if (value === 'true') parsedValue = true;
        else if (value === 'false') parsedValue = false;
        // Convert numbers
        else if (!isNaN(Number(value))) parsedValue = Number(value);
        else parsedValue = value;
      }

      // Set nested value
      const updated = setNestedValue(config, key, parsedValue);
      manager.set(updated);

      console.log(chalk.green(`✓ Set ${key} = ${JSON.stringify(parsedValue)}`));
    } catch (error) {
      console.error(
        chalk.red('Error setting config value:'),
        error instanceof Error ? error.message : 'Unknown error'
      );
      process.exit(1);
    }
  });

// Path subcommand
configCommand
  .command('path')
  .description('Show configuration file path')
  .action(async () => {
    try {
      const configPath = getConfigManager().getPath();
      console.log(configPath);
    } catch (error) {
      console.error(
        chalk.red('Error getting config path:'),
        error instanceof Error ? error.message : 'Unknown error'
      );
      process.exit(1);
    }
  });

// Helper functions
function getNestedValue(obj: any, path: string): any {
  const keys = path.split('.');
  let current = obj;

  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[key];
  }

  return current;
}

function setNestedValue(obj: any, path: string, value: any): any {
  const keys = path.split('.');
  const result = JSON.parse(JSON.stringify(obj)); // Deep clone
  let current = result;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }

  current[keys[keys.length - 1]] = value;
  return result;
}
