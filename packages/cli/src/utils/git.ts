import { execSync } from 'child_process';

export interface GitInfo {
  branch: string | null;
  user: string | null;
  email: string | null;
  lastCommit: {
    hash: string;
    message: string;
    date: Date;
  } | null;
  isRepo: boolean;
}

export function getGitInfo(projectPath: string): GitInfo {
  const result: GitInfo = {
    branch: null,
    user: null,
    email: null,
    lastCommit: null,
    isRepo: false
  };

  try {
    // Check if it's a git repo
    execSync('git rev-parse --git-dir', { cwd: projectPath, stdio: 'pipe' });
    result.isRepo = true;
  } catch {
    return result;
  }

  try {
    result.branch = execSync('git branch --show-current', { cwd: projectPath, encoding: 'utf-8' }).trim();
  } catch {}

  try {
    result.user = execSync('git config user.name', { cwd: projectPath, encoding: 'utf-8' }).trim();
  } catch {}

  try {
    result.email = execSync('git config user.email', { cwd: projectPath, encoding: 'utf-8' }).trim();
  } catch {}

  try {
    const log = execSync('git log -1 --format="%H|%s|%aI"', { cwd: projectPath, encoding: 'utf-8' }).trim();
    const [hash, message, dateStr] = log.split('|');
    result.lastCommit = {
      hash,
      message,
      date: new Date(dateStr)
    };
  } catch {}

  return result;
}

export function getRecentCommits(projectPath: string, since: Date, limit: number = 20): Array<{
  hash: string;
  message: string;
  date: Date;
  author: string;
}> {
  try {
    const sinceStr = since.toISOString();
    const log = execSync(
      `git log --since="${sinceStr}" -${limit} --format="%H|%s|%aI|%an"`,
      { cwd: projectPath, encoding: 'utf-8' }
    ).trim();

    if (!log) return [];

    return log.split('\n').map(line => {
      const [hash, message, dateStr, author] = line.split('|');
      return { hash, message, date: new Date(dateStr), author };
    });
  } catch {
    return [];
  }
}

export function getFilesChangedInCommit(projectPath: string, commitHash: string): string[] {
  try {
    const output = execSync(
      `git diff-tree --no-commit-id --name-only -r ${commitHash}`,
      { cwd: projectPath, encoding: 'utf-8' }
    ).trim();

    return output ? output.split('\n') : [];
  } catch {
    return [];
  }
}
