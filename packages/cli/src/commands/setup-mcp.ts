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

      // 5. Create conventions file
      const caiDir = path.join(os.homedir(), '.code-agent-insights');
      if (!fs.existsSync(caiDir)) {
        fs.mkdirSync(caiDir, { recursive: true });
      }

      const conventionsPath = path.join(caiDir, 'CONVENTIONS.md');
      const conventionsContent = `# Code Agent Insights - Conventions & Workflow

## Command Defaults & Conventions

### Sync Command
- **Default behavior**: Project-only learnings (no global scope)
- **Always run with --dry-run first** before making changes
- Use \`--global\` flag explicitly if you want global learnings included
- Use \`--reviewed-only\` to only sync reviewed learnings

Example:
\`\`\`bash
cai sync --dry-run          # Check what will be synced
cai sync                    # Sync project-only learnings
cai sync --global           # Include global learnings (rarely needed)
\`\`\`

### Other Commands
- **Index**: Use \`--force\` to reindex sessions, otherwise incremental
- **Clean**: Always use \`--dry-run\` first to preview deletions
- **Correlate**: Add \`--insights\` for detailed commit correlation analysis

## AI Agent Workflow Checklist

When working with code-agent-insights, follow these steps:

1. **Use recall first** - Before debugging or making changes
   - Check if similar issues were solved before
   - Review past learnings related to the task

2. **Check conventions** - Review CONVENTIONS.md or project CLAUDE.md
   - Understand command defaults
   - Follow established patterns

3. **Use dry-run** - For any data modification commands
   - Preview changes before committing
   - Verify assumptions about what will change

4. **Save learnings** - Document solutions and patterns
   - Use \`cai learn\` or \`remember\` MCP tool
   - Tag appropriately (fix, pattern, convention)

## When to Use Recall (MANDATORY)

**ALWAYS use the recall tool before:**
- Debugging issues (check if solved before)
- Running sync commands (check conventions)
- Indexing problems (check past solutions)
- Database issues (check common fixes)
- Path normalization issues (recurring pattern)
- Foreign key constraint errors (documented fixes)

**Example recall queries:**
- "path normalization issues"
- "sync command defaults"
- "database foreign key errors"
- "indexing sessions problems"

## Common Pitfalls

### 1. Global Learnings Pollution
- ❌ Running \`cai sync\` without checking scope
- ✅ Always use \`cai sync --dry-run\` first
- ✅ Default is project-only (no --global needed)

### 2. Skipping Recall
- ❌ Debugging from scratch without checking past solutions
- ✅ Use recall tool before investigating issues
- ✅ Search for error messages and patterns

### 3. Path Mismatches
- ❌ Assuming paths are normalized
- ✅ Check if path inference has been fixed before
- ✅ Use recall for "path normalization" issues

### 4. Dry-run Habit
- ❌ Running destructive commands without preview
- ✅ Always use --dry-run flag first
- ✅ Verify output before actual execution

## Project Integration

For best results, integrate these conventions into your project:

### Option 1: CLAUDE.md
Copy this conventions section to your project's CLAUDE.md file.

### Option 2: Claude Code Skill
Create \`.claude/skills/code-agent-insights/SKILL.md\` in your project with the workflow checklist.

Run \`cai init\` in your project directory to set this up automatically.
`;

      fs.writeFileSync(conventionsPath, conventionsContent, 'utf-8');

      // 6. Create skill template
      const templatesDir = path.join(caiDir, 'templates');
      if (!fs.existsSync(templatesDir)) {
        fs.mkdirSync(templatesDir, { recursive: true });
      }

      const skillTemplatePath = path.join(templatesDir, 'SKILL.md');
      const skillTemplateContent = `# Code Agent Insights Workflow

When working with code-agent-insights tools and commands, follow this workflow:

## 1. Use Recall Before Debugging

**MANDATORY**: Always use the \`recall\` MCP tool before debugging or investigating issues.

Example queries:
- "path normalization issues"
- "sync command defaults"
- "database foreign key errors"
- "indexing sessions problems"

## 2. Check Conventions Before Commands

Review conventions for command defaults:
- \`cai sync\`: Defaults to project-only (no --global)
- Always use \`--dry-run\` first for data modifications
- Check \`~/.code-agent-insights/CONVENTIONS.md\`

## 3. Use Dry-Run for Data Modifications

Before running commands that modify data:
\`\`\`bash
cai sync --dry-run          # Preview changes
cai clean --dry-run         # Preview deletions
\`\`\`

## 4. Save Learnings After Solutions

Document solutions using:
- \`cai learn "description"\` command
- \`remember\` MCP tool with appropriate type (fix/pattern/convention)
- Include relevant tags for future recall

## Common Patterns

### Path Issues
If encountering path mismatches or normalization issues:
1. Use recall for "path normalization"
2. Check if similar issue was solved before
3. Document the fix if new

### Sync Issues
If global learnings appear in project sync:
1. Default is project-only (correct)
2. Only use \`--global\` if explicitly needed
3. Always \`--dry-run\` first

### Database Errors
If foreign key or constraint errors occur:
1. Use recall for "database errors" or "foreign key"
2. Check deletion order (children before parents)
3. Use transactions for atomicity

## What NOT to Do

- ❌ Debug without using recall first
- ❌ Run sync without --dry-run
- ❌ Assume command defaults without checking
- ❌ Skip documenting solutions (no learning saved)
`;

      fs.writeFileSync(skillTemplatePath, skillTemplateContent, 'utf-8');

      // 7. Success message with conventions info
      console.log(chalk.green('✓ MCP server registered'));
      console.log(chalk.green(`✓ Conventions file created: ${conventionsPath}`));
      console.log(chalk.green(`✓ Skill template created: ${skillTemplatePath}\n`));

      console.log(chalk.bold('💡 For best results with Claude Code:\n'));
      console.log(chalk.dim('   1. Copy CONVENTIONS.md content to your project\'s CLAUDE.md'));
      console.log(chalk.dim('   2. Or create a skill: .claude/skills/code-agent-insights/SKILL.md'));
      console.log(chalk.dim('   3. Or run ') + chalk.cyan('cai init') + chalk.dim(' in your project directory\n'));

      console.log(chalk.bold('📚 Key conventions:\n'));
      console.log(chalk.cyan('   • Always use \'recall\' tool before debugging'));
      console.log(chalk.cyan('   • Run \'cai sync --dry-run\' before syncing'));
      console.log(chalk.cyan('   • Default: project-only learnings (no --global)\n'));

      console.log(chalk.bold('Next steps:'));
      console.log(chalk.dim('  1. Restart Claude Code'));
      console.log(chalk.dim('  2. Run ') + chalk.cyan('cai index') + chalk.dim(' to start indexing sessions'));
      console.log(chalk.dim('  3. Ask Claude: "What MCP tools do you have available?"\n'));

    } catch (error) {
      console.error(chalk.red('✗ Unexpected error:'), error);
      process.exit(1);
    }
  });
