#!/usr/bin/env node

import { Command } from 'commander';
import { indexCommand } from './commands/index-cmd';
import { searchCommand } from './commands/search';
import { statsCommand } from './commands/stats';
import { learnCommand } from './commands/learn';
import { recommendCommand } from './commands/recommend';
import { cleanCommand } from './commands/clean';
import { reviewCommand } from './commands/review';
import { syncCommand } from './commands/sync';

const program = new Command();

program
  .name('cai')
  .description('Code Agent Insights - Analytics and memory for coding agents')
  .version('0.1.0');

// Add commands
program.addCommand(indexCommand);
program.addCommand(searchCommand);
program.addCommand(statsCommand);
program.addCommand(learnCommand);
program.addCommand(recommendCommand);
program.addCommand(cleanCommand);
program.addCommand(reviewCommand);
program.addCommand(syncCommand);

program.parse();
