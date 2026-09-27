// What the commit-msg hook has already let through in this repo. pre-push uses it to
// tell an agent's commit that skipped the hook (--no-verify) from a person's commit that
// was warned and kept on purpose, or history from before buzzcut was set up. Only the
// first kind is worth blocking a push over: nobody should rewrite someone else's commits.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { git } from './git.js';

const TRAILER = /^\s*([\w-]+-by|change-id):/i;
const MAX = 2000;

/** A fingerprint that survives git's whitespace cleanup and trailers added by later hooks. */
export function fingerprint(message: string): string {
  const lines = message
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() && !l.startsWith('#') && !TRAILER.test(l));
  return createHash('sha1').update(lines.join('\n')).digest('hex').slice(0, 16);
}

function seenFile(cwd: string): string | null {
  const common = git(['rev-parse', '--git-common-dir'], cwd)?.trim();
  return common ? join(resolve(cwd, common), 'buzzcut-seen') : null;
}

export interface Seen {
  /** unix seconds when buzzcut first checked a commit in this repo */
  since: number;
  prints: Set<string>;
}

export function readSeen(cwd: string): Seen | null {
  const file = seenFile(cwd);
  if (!file || !existsSync(file)) return null;
  try {
    const [head = '', ...rest] = readFileSync(file, 'utf8').split('\n');
    const since = Number(head.match(/^since (\d+)$/)?.[1]);
    if (!Number.isFinite(since)) return null;
    return { since, prints: new Set(rest.filter(Boolean)) };
  } catch {
    return null;
  }
}

/** Start the clock for a repo (on `buzzcut init`), so commits made after it count as checked. */
export function markInstalled(cwd: string, now = Math.floor(Date.now() / 1000)): void {
  try {
    const file = seenFile(cwd);
    if (file && !existsSync(file)) writeFileSync(file, `since ${now}\n`);
  } catch {
    // bookkeeping only
  }
}

/** Remember a message the commit-msg hook let through. Never throws: it's bookkeeping. */
export function recordSeen(message: string, cwd: string, now = Math.floor(Date.now() / 1000)): void {
  try {
    const file = seenFile(cwd);
    if (!file) return;
    const print = fingerprint(message);
    if (!existsSync(file)) {
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, `since ${now}\n${print}\n`);
      return;
    }
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n').filter(Boolean);
    if (lines.includes(print)) return;
    if (lines.length > MAX) writeFileSync(file, [lines[0], ...lines.slice(-(MAX / 2)), print].join('\n') + '\n');
    else appendFileSync(file, print + '\n');
  } catch {
    // A read-only .git or a full disk shouldn't break a commit.
  }
}
