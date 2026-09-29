// The lines a change adds and removes, so a name or number in a description can be looked up
// in them. Two sources: `git diff -U0 --numstat -p` (locally) and the `patch` field GitHub
// returns for each file (Action, site). Only the changed lines are kept, never the context.
import type { FileChange } from './types.js';

/** One file's changed lines are cut off here; a file that long isn't described line by line anyway. */
export const MAX_FILE_TEXT = 200_000;
/** Past this much changed text in all, the diff is called unsearchable rather than slow. */
export const MAX_TOTAL_TEXT = 2_000_000;

export interface Changed {
  added: string;
  removed: string;
}

/** The changed lines of a GitHub `patch`: hunks only, no file headers. */
export function splitPatch(patch: string): Changed {
  const added: string[] = [];
  const removed: string[] = [];
  for (const l of patch.split('\n')) {
    if (l.startsWith('+')) added.push(l.slice(1));
    else if (l.startsWith('-')) removed.push(l.slice(1));
  }
  return { added: added.join('\n').slice(0, MAX_FILE_TEXT), removed: removed.join('\n').slice(0, MAX_FILE_TEXT) };
}

/** Where git's numstat block ends and its patch begins. */
export function patchStart(out: string): number {
  return out.startsWith('diff --git ') ? 0 : out.indexOf('\ndiff --git ') + 1 || out.length;
}

/**
 * The changed lines of each file in git's patch output, by path. The path comes from the
 * `+++ b/…` line, or `--- a/…` for a deleted file, so spaces and renames need no guessing.
 */
export function parseGitPatch(patch: string): Map<string, Changed> {
  const byPath = new Map<string, Changed>();
  let cur: { added: string[]; removed: string[] } | null = null;
  let path: string | null = null;
  let oldPath: string | null = null;
  let inHunk = false;
  let sawHunk = false;
  const flush = () => {
    // A binary file, a pure rename or a mode change has no hunks and nothing to search.
    if (path && cur && sawHunk) byPath.set(path, { added: cur.added.join('\n').slice(0, MAX_FILE_TEXT), removed: cur.removed.join('\n').slice(0, MAX_FILE_TEXT) });
    cur = null;
    path = null;
    oldPath = null;
    inHunk = false;
    sawHunk = false;
  };
  const strip = (p: string) => p.replace(/\t.*$/, '');
  for (const l of patch.split('\n')) {
    if (l.startsWith('diff --git ')) {
      flush();
      cur = { added: [], removed: [] };
      // Until a header says otherwise: "diff --git a/x b/x" → x
      const m = l.match(/^diff --git a\/(.+) b\/(.+)$/);
      path = m ? m[2]! : null;
    } else if (!inHunk && l.startsWith('--- ')) {
      oldPath = l.startsWith('--- a/') ? strip(l.slice(6)) : null;
    } else if (!inHunk && l.startsWith('+++ ')) {
      if (l.startsWith('+++ b/')) path = strip(l.slice(6));
      else if (oldPath) path = oldPath; // +++ /dev/null: the file was deleted
    } else if (l.startsWith('@@')) {
      inHunk = true;
      sawHunk = true;
    } else if (inHunk && cur) {
      if (l.startsWith('+')) cur.added.push(l.slice(1));
      else if (l.startsWith('-')) cur.removed.push(l.slice(1));
    }
  }
  flush();
  return byPath;
}

/** Put each file's changed lines on its FileChange; files git printed no hunks for are left alone. */
export function attach(files: FileChange[], changed: Map<string, Changed>): FileChange[] {
  return files.map((f) => {
    const c = changed.get(f.path);
    return c ? { ...f, added: c.added, removed: c.removed } : f;
  });
}
