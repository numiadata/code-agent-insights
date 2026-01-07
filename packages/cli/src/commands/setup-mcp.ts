import { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const setupMcpCommand = new Command('setup-mcp')
  .description('Configure code-agent-insights as a global MCP server for Claude Code')
  .option('--force', 'Reconfigure even if already set up')
  .action(async (options: { force?: boolean }) => {
    console.log(chalk.bold('\n🔧 Setting up Code Agent Insights MCP Server\n'));

    try {
      // 1. Check if Claude Code CLI is available
      try {
        execSync('claude --version', { stdio: 'pipe' });
      } catch (error) {
        console.error(chalk.red('✗ Claude Code CLI not found'));
        console.log(chalk.dim('\nPlease install Claude Code first:'));
        console.log(chalk.cyan('  https://code.claude.com\n'));
        process.exit(1);
      }

      // 2. Find the MCP server path
      let mcpServerPath: string;

      // First, try to find cai-mcp in PATH (for global installs)
      try {
        const which = process.platform === 'win32' ? 'where' : 'which';
        mcpServerPath = execSync(`${which} cai-mcp`, { encoding: 'utf-8' }).trim().split('\n')[0];
      } catch {
        // Check if we're in development (monorepo)
        // __dirname will be /path/to/packages/cli/dist, need to go to /path/to/packages/mcp-server/dist
        const devPath = path.join(__dirname, '..', '..', 'mcp-server', 'dist', 'index.js');
        if (fs.existsSync(devPath)) {
          mcpServerPath = `node ${devPath}`;
          console.log(chalk.yellow('⚠ Using development build from monorepo\n'));
        } else {
          // Fallback: check common global install locations
          const pnpmGlobal = path.join(os.homedir(), 'Library', 'pnpm');
          let npmGlobal: string;
          try {
            npmGlobal = execSync('npm root -g', { encoding: 'utf-8' }).trim();
          } catch {
            npmGlobal = '';
          }

          const possiblePaths = [
            path.join(pnpmGlobal, 'cai-mcp'),
            path.join(npmGlobal, '.bin', 'cai-mcp'),
            path.join(npmGlobal, '..', 'bin', 'cai-mcp'),
            // Also check for the package installation
            path.join(npmGlobal, 'code-agent-insights', 'node_modules', '@code-agent-insights', 'mcp-server', 'dist', 'index.js'),
          ];

          const foundPath = possiblePaths.find(p => fs.existsSync(p));

          if (!foundPath) {
            console.error(chalk.red('✗ Could not find MCP server binary'));
            console.log(chalk.dim('\nMake sure code-agent-insights is installed globally:'));
            console.log(chalk.cyan('  pnpm install -g code-agent-insights'));
            console.log(chalk.cyan('  # or'));
            console.log(chalk.cyan('  npm install -g code-agent-insights\n'));
            process.exit(1);
          }

          mcpServerPath = foundPath;
        }
      }

      // 3. Check if already configured
      const claudeJsonPath = path.join(os.homedir(), '.claude.json');
      if (fs.existsSync(claudeJsonPath) && !options.force) {
        const claudeJson = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8'));
        if (claudeJson.mcpServers?.['code-agent-insights']) {
          console.log(chalk.green('✓ MCP server already configured'));
          console.log(chalk.dim('\nTo reconfigure, run:'));
          console.log(chalk.cyan('  cai setup-mcp --force\n'));
          console.log(chalk.yellow('⚠ Remember to restart Claude Code for changes to take effect\n'));
          return;
        }
      }

      // 4. Run claude mcp add command
      console.log(chalk.dim('Adding MCP server to global configuration...\n'));

      // Build the command - if mcpServerPath starts with "node", split it
      let command: string;
      if (mcpServerPath.startsWith('node ')) {
        const serverPath = mcpServerPath.substring(5);
        command = `claude mcp add --transport stdio --scope user code-agent-insights -- node ${serverPath}`;
      } else {
        command = `claude mcp add --transport stdio --scope user code-agent-insights -- ${mcpServerPath}`;
      }

      try {
        execSync(command, { stdio: 'inherit' });
      } catch (error) {
        console.error(chalk.red('\n✗ Failed to add MCP server'));
        console.log(chalk.dim('\nYou can try manually running:'));
        console.log(chalk.cyan(`  ${command}\n`));
        process.exit(1);
      }

      // 5. Success message
      console.log(chalk.green('\n✓ MCP server configured successfully!\n'));
      console.log(chalk.bold('Next steps:'));
      console.log(chalk.dim('  1. Restart Claude Code'));
      console.log(chalk.dim('  2. In any session, ask: "What MCP tools do you have available?"'));
      console.log(chalk.dim('  3. You should see: recall, remember, similar_errors, file_history\n'));
      console.log(chalk.dim('Run ') + chalk.cyan('cai index') + chalk.dim(' to start indexing your sessions.\n'));

    } catch (error) {
      console.error(chalk.red('✗ Unexpected error:'), error);
      process.exit(1);
    }
  });
