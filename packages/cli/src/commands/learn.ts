import { Command } from 'commander';
import chalk from 'chalk';
import { v4 as uuidv4 } from 'uuid';
import { InsightsDatabase, type Learning } from '@code-agent-insights/core';

interface LearnOptions {
  type?: string;
  scope?: string;
  tags?: string;
  project?: string;
}

const VALID_TYPES = ['pattern', 'antipattern', 'convention', 'fix', 'preference', 'context'];
const VALID_SCOPES = ['global', 'project', 'file', 'language'];

export const learnCommand = new Command('learn')
  .description('Manually add a learning')
  .argument('<content>', 'The learning content')
  .option('-t, --type <type>', 'Learning type (pattern|antipattern|convention|fix|preference|context)', 'pattern')
  .option('-s, --scope <scope>', 'Scope (global|project|file|language)', 'project')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('-p, --project <path>', 'Project path', process.cwd())
  .action(async (content: string, options: LearnOptions) => {
    const db = new InsightsDatabase();

    try {
      // 2. Parse tags
      const parsedTags = options.tags ? options.tags.split(',').map((t) => t.trim()) : [];

      // 3. Validate type is one of the allowed values
      const type = (options.type || 'pattern') as Learning['type'];
      if (!VALID_TYPES.includes(type)) {
        console.error(
          chalk.red(`Invalid type: ${type}. Must be one of: ${VALID_TYPES.join(', ')}`)
        );
        process.exit(1);
      }

      // Validate scope
      const scope = (options.scope || 'project') as Learning['scope'];
      if (!VALID_SCOPES.includes(scope)) {
        console.error(
          chalk.red(`Invalid scope: ${scope}. Must be one of: ${VALID_SCOPES.join(', ')}`)
        );
        process.exit(1);
      }

      // 4. Create learning object
      const learning: Learning = {
        id: uuidv4(),
        content: content,
        type: type,
        scope: scope,
        confidence: 1.0,
        tags: parsedTags,
        relatedFiles: [],
        relatedErrors: [],
        source: 'explicit',
        appliedCount: 0,
        projectPath: options.project,
        createdAt: new Date(),
      };

      // 5. Insert with db.insertLearning
      db.insertLearning(learning);

      // 6. Log success
      console.log(
        chalk.green('✓') + ` Remembered: ` + chalk.cyan(`[${type}]`) + ` ${content}`
      );
      if (parsedTags.length > 0) {
        console.log(chalk.dim(`  Tags: ${parsedTags.join(', ')}`));
      }
    } finally {
      // 7. Close database in finally block
      db.close();
    }
  });
