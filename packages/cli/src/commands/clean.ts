import { Command } from 'commander';
import chalk from 'chalk';
import { InsightsDatabase } from '@code-agent-insights/core';

interface CleanOptions {
  duplicates?: boolean;
  lowConfidence?: boolean;
  type?: string;
  dryRun?: boolean;
  threshold?: string;
}

interface Learning {
  id: string;
  content: string;
  type: string;
  confidence: number;
  created_at: number;
}

interface DeletionCandidate {
  id: string;
  content: string;
  type: string;
  confidence: number;
  reason: string;
}

/**
 * Calculate simple word-based similarity between two strings
 * Returns percentage of shared words (0-1)
 */
function calculateSimilarity(str1: string, str2: string): number {
  const words1 = str1.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const words2 = str2.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  if (words1.length === 0 || words2.length === 0) {
    return 0;
  }

  const set1 = new Set(words1);
  const set2 = new Set(words2);

  // Count shared words
  let sharedCount = 0;
  for (const word of set1) {
    if (set2.has(word)) {
      sharedCount++;
    }
  }

  // Calculate similarity as shared / total unique words
  const totalUnique = new Set([...words1, ...words2]).size;
  return sharedCount / totalUnique;
}

/**
 * Find duplicate learnings based on content similarity
 */
function findDuplicates(learnings: Learning[]): DeletionCandidate[] {
  const duplicates: DeletionCandidate[] = [];
  const seen = new Set<string>();

  // Sort by created_at DESC (newer first) so we keep newer ones
  const sorted = [...learnings].sort((a, b) => b.created_at - a.created_at);

  for (let i = 0; i < sorted.length; i++) {
    if (seen.has(sorted[i].id)) continue;

    const current = sorted[i];

    // Check against all previous (newer) learnings
    for (let j = 0; j < i; j++) {
      if (seen.has(sorted[j].id)) continue;

      const other = sorted[j];

      // Only compare learnings of the same type
      if (current.type === other.type) {
        const similarity = calculateSimilarity(current.content, other.content);

        // If >80% similar, mark current (older) as duplicate
        if (similarity > 0.8) {
          duplicates.push({
            id: current.id,
            content: current.content,
            type: current.type,
            confidence: current.confidence,
            reason: `duplicate of newer learning (${Math.round(similarity * 100)}% similar)`,
          });
          seen.add(current.id);
          break;
        }
      }
    }
  }

  return duplicates;
}

export const cleanCommand = new Command('clean')
  .description('Clean up learnings database')
  .option('--duplicates', 'Remove duplicate/near-duplicate learnings')
  .option('--low-confidence', 'Remove learnings with confidence below threshold')
  .option('--type <type>', 'Remove all learnings of a specific type')
  .option('--dry-run', 'Show what would be removed without actually removing')
  .option('--threshold <number>', 'Confidence threshold for --low-confidence', '0.5')
  .addHelpText('after', `
Examples:
  $ cai clean --duplicates --dry-run        Preview duplicate removal
  $ cai clean --type context                Remove all context learnings
  $ cai clean --low-confidence --threshold 0.6   Remove low-confidence learnings
  $ cai clean --duplicates --low-confidence      Remove both duplicates and low-confidence`)
  .action(async (options: CleanOptions) => {
    const db = new InsightsDatabase();

    try {
      const toDelete: DeletionCandidate[] = [];
      const threshold = parseFloat(options.threshold || '0.5');

      // Validate threshold
      if (isNaN(threshold) || threshold < 0 || threshold > 1) {
        console.error(chalk.red('Error: Threshold must be a number between 0 and 1'));
        return;
      }

      // 1. Find duplicates if requested
      if (options.duplicates) {
        console.log(chalk.blue('Searching for duplicate learnings...'));

        const allLearnings = db.getAllLearnings();
        const duplicates = findDuplicates(allLearnings);

        console.log(chalk.green(`Found ${duplicates.length} duplicate learnings`));
        toDelete.push(...duplicates);
      }

      // 2. Find low-confidence learnings if requested
      if (options.lowConfidence) {
        console.log(chalk.blue(`Searching for learnings with confidence < ${threshold}...`));

        const lowConfidence = db.getLearningsByConfidence(threshold);

        console.log(chalk.green(`Found ${lowConfidence.length} low-confidence learnings`));

        for (const learning of lowConfidence) {
          toDelete.push({
            id: learning.id,
            content: learning.content,
            type: learning.type,
            confidence: learning.confidence,
            reason: `low confidence (${learning.confidence.toFixed(2)})`,
          });
        }
      }

      // 3. Find learnings by type if requested
      if (options.type) {
        console.log(chalk.blue(`Searching for learnings of type "${options.type}"...`));

        const byType = db.getLearningsByType(options.type);

        console.log(chalk.green(`Found ${byType.length} learnings of type "${options.type}"`));

        for (const learning of byType) {
          toDelete.push({
            id: learning.id,
            content: learning.content,
            type: learning.type,
            confidence: learning.confidence,
            reason: `type filter: ${options.type}`,
          });
        }
      }

      // Remove duplicates from toDelete list (in case multiple filters match same learning)
      const uniqueToDelete = Array.from(
        new Map(toDelete.map(item => [item.id, item])).values()
      );

      // 4. Show what will be deleted
      if (uniqueToDelete.length === 0) {
        console.log(chalk.yellow('\nNo learnings found matching the criteria.'));
        return;
      }

      console.log(chalk.yellow(`\n${uniqueToDelete.length} learnings to remove:\n`));

      // Show first 10 as preview
      const preview = uniqueToDelete.slice(0, 10);
      for (const item of preview) {
        const contentPreview = item.content.length > 80
          ? item.content.substring(0, 77) + '...'
          : item.content;
        console.log(
          chalk.dim(`[${item.type}]`) + ` ${contentPreview}\n` +
          chalk.dim(`  → Reason: ${item.reason}`)
        );
      }

      if (uniqueToDelete.length > 10) {
        console.log(chalk.dim(`\n... and ${uniqueToDelete.length - 10} more`));
      }

      // 5. Delete or show dry-run message
      if (options.dryRun) {
        console.log(chalk.blue(`\n[DRY RUN] Would remove ${uniqueToDelete.length} learnings`));
        console.log(chalk.dim('Run without --dry-run to actually remove them'));
      } else {
        console.log(chalk.blue(`\nRemoving ${uniqueToDelete.length} learnings...`));

        const ids = uniqueToDelete.map(item => item.id);
        const deleted = db.deleteLearnings(ids);

        console.log(chalk.green(`✓ Successfully removed ${deleted} learnings`));
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
    } finally {
      db.close();
    }
  });
