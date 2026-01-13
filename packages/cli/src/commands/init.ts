import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface InitOptions {
  force?: boolean;
}

const CONVENTIONS_MARKER_START = '<!-- code-agent-insights:conventions:start -->';
const CONVENTIONS_MARKER_END = '<!-- code-agent-insights:conventions:end -->';

const CONVENTIONS_CONTENT = `
## Code Agent Insights - Usage Conventions

### Command Defaults
- \`cai sync\`: Defaults to **project-only** learnings (no \`--global\`)
- Always use \`--dry-run\` first for data modifications
- \`cai correlate --insights\`: Detailed commit correlation analysis

### AI Agent Workflow Checklist

When using code-agent-insights:

1. **Use recall first** - Before debugging or making changes
   - Check if similar issues were solved before
   - Review past learnings: "path issues", "sync defaults", "database errors"

2. **Check conventions** - Review command defaults
   - Understand what each command does by default
   - Check this section before running commands

3. **Use dry-run** - For data modification commands
   - \`cai sync --dry-run\` - Preview what will be synced
   - \`cai clean --dry-run\` - Preview what will be deleted

4. **Save learnings** - Document solutions
   - Use \`cai learn "description"\` or \`remember\` MCP tool
   - Tag appropriately: fix, pattern, convention

### When to Use Recall (MANDATORY)

**ALWAYS use the recall tool before:**
- Debugging issues (check if solved before)
- Running sync commands (verify conventions)
- Path normalization issues (recurring pattern)
- Database/foreign key errors (documented fixes)

### Common Pitfalls

❌ **Don't:**
- Run \`cai sync\` without \`--dry-run\` first
- Debug without using recall
- Assume command defaults without checking

✅ **Do:**
- Always \`cai sync --dry-run\` before syncing
- Use recall before investigating issues
- Default is project-only (no \`--global\` needed)
`;

export const initCommand = new Command('init')
  .description('Initialize code-agent-insights conventions for a project')
  .argument('[project-path]', 'Project directory (default: current directory)')
  .option('--force', 'Overwrite existing files')
  .addHelpText('after', `
Examples:
  $ cai init                    Initialize current project
  $ cai init /path/to/project   Initialize specific project
  $ cai init --force            Overwrite existing files`)
  .action(async (projectPath: string | undefined, options: InitOptions) => {
    const projectDir = path.resolve(projectPath || process.cwd());

    console.log(chalk.bold(`\n🚀 Initializing code-agent-insights for ${projectDir}...\n`));

    try {
      // Verify directory exists
      if (!fs.existsSync(projectDir)) {
        console.error(chalk.red(`✗ Directory does not exist: ${projectDir}`));
        process.exit(1);
      }

      let updatedFiles = 0;
      let createdFiles = 0;

      // 1. Update or create CLAUDE.md
      const claudeMdPath = path.join(projectDir, 'CLAUDE.md');

      if (fs.existsSync(claudeMdPath)) {
        // Update existing CLAUDE.md
        let content = fs.readFileSync(claudeMdPath, 'utf-8');

        // Check if conventions section already exists
        const hasConventions = content.includes(CONVENTIONS_MARKER_START);

        if (hasConventions && !options.force) {
          console.log(chalk.yellow('⚠ CLAUDE.md already has conventions section'));
          console.log(chalk.dim('  Use --force to overwrite\n'));
        } else if (hasConventions && options.force) {
          // Remove existing section
          const startIdx = content.indexOf(CONVENTIONS_MARKER_START);
          const endIdx = content.indexOf(CONVENTIONS_MARKER_END);

          if (startIdx !== -1 && endIdx !== -1) {
            content = content.substring(0, startIdx) + content.substring(endIdx + CONVENTIONS_MARKER_END.length);
          }

          // Append new section
          content += `\n${CONVENTIONS_MARKER_START}${CONVENTIONS_CONTENT}\n${CONVENTIONS_MARKER_END}\n`;

          fs.writeFileSync(claudeMdPath, content, 'utf-8');
          console.log(chalk.green('✓ Updated CLAUDE.md with conventions'));
          updatedFiles++;
        } else {
          // Append conventions section
          content += `\n${CONVENTIONS_MARKER_START}${CONVENTIONS_CONTENT}\n${CONVENTIONS_MARKER_END}\n`;

          fs.writeFileSync(claudeMdPath, content, 'utf-8');
          console.log(chalk.green('✓ Updated CLAUDE.md with conventions'));
          updatedFiles++;
        }
      } else {
        // Create new CLAUDE.md
        const newContent = `# ${path.basename(projectDir)}

Project documentation.

${CONVENTIONS_MARKER_START}${CONVENTIONS_CONTENT}
${CONVENTIONS_MARKER_END}
`;

        fs.writeFileSync(claudeMdPath, newContent, 'utf-8');
        console.log(chalk.green('✓ Created CLAUDE.md with conventions'));
        createdFiles++;
      }

      // 2. Create skill file
      const skillDir = path.join(projectDir, '.claude', 'skills', 'code-agent-insights');
      const skillPath = path.join(skillDir, 'SKILL.md');

      if (fs.existsSync(skillPath) && !options.force) {
        console.log(chalk.yellow('⚠ Skill file already exists'));
        console.log(chalk.dim('  Use --force to overwrite\n'));
      } else {
        // Read template from ~/.code-agent-insights/templates/SKILL.md
        const templatePath = path.join(os.homedir(), '.code-agent-insights', 'templates', 'SKILL.md');

        if (fs.existsSync(templatePath)) {
          const skillContent = fs.readFileSync(templatePath, 'utf-8');

          // Create skill directory
          if (!fs.existsSync(skillDir)) {
            fs.mkdirSync(skillDir, { recursive: true });
          }

          fs.writeFileSync(skillPath, skillContent, 'utf-8');
          console.log(chalk.green(`✓ Created .claude/skills/code-agent-insights/SKILL.md`));
          createdFiles++;
        } else {
          console.log(chalk.yellow('⚠ Skill template not found'));
          console.log(chalk.dim(`  Run ${chalk.cyan('cai setup-mcp')} first to create templates\n`));
        }
      }

      // Summary
      console.log('');
      if (updatedFiles > 0 || createdFiles > 0) {
        console.log(chalk.bold('✨ Initialization complete!\n'));
        console.log(chalk.dim('Claude Code will now follow best practices for this tool.\n'));

        console.log(chalk.bold('📚 What was set up:\n'));
        if (updatedFiles > 0 || createdFiles > 0) {
          console.log(chalk.dim('  • Conventions and workflow checklist in CLAUDE.md'));
        }
        if (fs.existsSync(skillPath)) {
          console.log(chalk.dim('  • Project-specific skill file for Claude Code'));
        }

        console.log('');
        console.log(chalk.bold('🎯 Key takeaways:\n'));
        console.log(chalk.cyan('  • Always use \'recall\' before debugging'));
        console.log(chalk.cyan('  • Run \'cai sync --dry-run\' before syncing'));
        console.log(chalk.cyan('  • Default: project-only learnings\n'));
      } else {
        console.log(chalk.yellow('No changes made. Use --force to overwrite existing files.\n'));
      }

    } catch (error) {
      console.error(chalk.red('✗ Error during initialization:'), error);
      process.exit(1);
    }
  });
