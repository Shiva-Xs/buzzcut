import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildDiff, parseNumstat } from './diff.js';
import type { DiffFacts, FileChange } from './types.js';

export function git(args: string[], cwd?: string): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

export function inRepo(cwd?: string): boolean {
  return git(['rev-parse', '--is-inside-work-tree'], cwd)?.trim() === 'true';
}

/**
 * Mark the files .gitattributes calls `linguist-generated` (GitHub collapses them in PRs too),
 * so build output doesn't count as lines to explain.
 */
export function markGenerated(files: FileChange[], cwd?: string): FileChange[] {
  if (!files.length) return files;
  let out: string | null = null;
  try {
    out = execFileSync('git', ['check-attr', '-z', '--stdin', 'linguist-generated'], {
      cwd,
      encoding: 'utf8',
      input: files.map((f) => f.path).join('\0'),
      stdio: ['pipe', 'pipe', 'ignore'],
    });
  } catch {
    return files;
  }
  const parts = out.split('\0');
  const marked = new Set<string>();
  for (let i = 0; i + 2 < parts.length; i += 3) if (parts[i + 2] === 'true' || parts[i + 2] === 'set') marked.add(parts[i]!);
  return marked.size ? files.map((f) => (marked.has(f.path) ? { ...f, generated: true } : f)) : files;
}

const diffOf = (out: string, cwd?: string) => buildDiff(markGenerated(parseNumstat(out), cwd));

/** The staged changes, i.e. what `git commit` is about to record. */
export function stagedDiff(cwd?: string): DiffFacts | null {
  const out = git(['diff', '--cached', '--numstat', '-M'], cwd);
  if (!out?.trim()) return null;
  return diffOf(out, cwd);
}

export function commitDiff(rev: string, cwd?: string): DiffFacts | null {
  const out = git(['show', '--numstat', '--format=', '-M', rev], cwd);
  if (out == null) return null;
  return diffOf(out, cwd);
}

export function commitMessage(rev: string, cwd?: string): string | null {
  return git(['log', '-1', '--format=%B', rev], cwd);
}

export function recentCommits(n: number, cwd?: string): string[] {
  return (git(['log', `-${n}`, '--no-merges', '--format=%H'], cwd) ?? '').split('\n').filter(Boolean);
}

/** Best guess at the branch a PR would merge into. */
export function defaultBase(cwd?: string): string | null {
  const head = git(['rev-parse', '--abbrev-ref', 'origin/HEAD'], cwd)?.trim();
  if (head && head !== 'origin/HEAD') return head;
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    if (git(['rev-parse', '--verify', '--quiet', ref], cwd)) return ref;
  }
  return null;
}

/** Subjects of the commits on this branch that `base` doesn't have, oldest first. */
export function branchCommits(base: string, cwd?: string, max = 30): string[] {
  const out = git(['log', '--no-merges', '--reverse', '--format=%s', `${base}..HEAD`], cwd);
  const all = (out ?? '').split('\n').filter(Boolean);
  return all.length > max ? all.slice(-max) : all;
}

/** Everything on this branch since it left `base`, like a PR diff. */
export function branchDiff(base: string, cwd?: string, head = 'HEAD'): DiffFacts | null {
  const out = git(['diff', '--numstat', '-M', `${base}...${head}`], cwd);
  if (out == null) return null;
  return diffOf(out, cwd);
}

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** What `git commit --amend` would record: the index against HEAD's parent. */
export function amendDiff(cwd?: string): DiffFacts | null {
  if (git(['rev-parse', '--verify', '-q', 'HEAD'], cwd) == null) return stagedDiff(cwd);
  const parent = git(['rev-parse', '--verify', '-q', 'HEAD^'], cwd)?.trim() || EMPTY_TREE;
  const out = git(['diff', '--cached', '--numstat', '-M', parent], cwd);
  return out?.trim() ? diffOf(out, cwd) : null;
}

function lineCount(path: string): number {
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size > 2 * 1024 * 1024) return 0;
    const buf = readFileSync(path);
    if (buf.includes(0)) return 0; // binary
    let n = 0;
    for (const b of buf) if (b === 10) n++;
    return n + (buf.length && buf[buf.length - 1] !== 10 ? 1 : 0);
  } catch {
    return 0;
  }
}

/**
 * The working tree against HEAD, for when staging and committing happen in one command
 * (`git add -A && git commit ...`): at that moment the index doesn't have the changes yet.
 */
export function worktreeDiff(cwd?: string, opts: { untracked: boolean } = { untracked: true }): DiffFacts | null {
  const root = git(['rev-parse', '--show-toplevel'], cwd)?.trim();
  if (!root) return null;
  const hasHead = git(['rev-parse', '--verify', '-q', 'HEAD'], root) != null;
  const files = parseNumstat((hasHead ? git(['diff', 'HEAD', '--numstat', '-M'], root) : git(['diff', '--cached', '--numstat'], root)) ?? '');
  if (opts.untracked) {
    const others = (git(['ls-files', '--others', '--exclude-standard', '-z'], root) ?? '').split('\0').filter(Boolean);
    for (const p of others.slice(0, 1000)) files.push({ path: p, additions: lineCount(join(root, p)), deletions: 0 });
  }
  return files.length ? buildDiff(markGenerated(files, root)) : null;
}

/** Path of a file inside .git (respects worktrees), or null outside a repo. */
export function gitPath(name: string, cwd?: string): string | null {
  const p = git(['rev-parse', '--git-path', name], cwd)?.trim();
  return p ? resolve(cwd ?? process.cwd(), p) : null;
}

/** A merge, rebase, cherry-pick or revert is in progress: the message isn't the author's own. */
export function operationInProgress(cwd?: string): boolean {
  return ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply'].some((n) => {
    const p = gitPath(n, cwd);
    return p != null && existsSync(p);
  });
}
