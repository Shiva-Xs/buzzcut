// `buzzcut context`: what an agent should know before it writes a commit message or
// PR description. Facts only: a map of the diff, the shape and length that fit it, and how
// this repo writes.
import { sizeOf, wordRange, type Size } from './analyze.js';
import type { Length } from './config.js';
import { areasOf, generatedFile } from './diff.js';
import { branchCommits, branchDiff, defaultBase, stagedDiff, worktreeDiff } from './git.js';
import { loadRepo } from './repo.js';
import type { StyleProfile } from './style.js';
import type { DiffFacts, FileChange, Kind } from './types.js';

export interface FileLines {
  path: string;
  lines: number;
}

export interface AgentContext {
  kind: Kind;
  source: 'staged' | 'working tree' | 'branch' | 'none';
  base: string | null;
  diff: {
    files: number;
    additions: number;
    deletions: number;
    /** additions + deletions without lockfiles and generated files */
    changedLines: number;
    /** tiny under 30 changed lines, big from 300 */
    size: Size;
    paths: string[];
    testFiles: number;
    docFiles: number;
    /** 500+ changed lines or 25+ files: the description should be a map */
    large: boolean;
    /** where the lines are, biggest first */
    areas: { area: string; lines: number; files: number }[];
    /** areas left out of `areas` */
    moreAreas: number;
    tests: FileLines[];
    docs: FileLines[];
    /** lockfiles and build output: not counted in changedLines */
    generated: FileLines[];
    /** files moved or renamed with no other change */
    renames: string[];
    pureRenames: number;
  } | null;
  /** subjects of the branch's own commits, oldest first (PRs only) */
  commits: string[] | null;
  /** the repo's `length` setting, already applied to `range` */
  length: Length;
  /** prose words that fit: floor and ceiling (the ceiling is the budget) */
  range: { floor: number; budget: number };
  budget: number;
  /** the suggested shape of the description, one line per part */
  shape: string[];
  style: {
    sample: number;
    conventional: number;
    types: string[];
    capitalized: number;
    ticketExample: string | null;
    ticket: number;
    subjectP50: number;
    body: number;
    mood: 'imperative' | 'past' | null;
    examples: string[];
  } | null;
  template: string[] | null;
}

const linesOf = (f: FileChange) => f.additions + f.deletions;
const byLines = (files: FileChange[]): FileLines[] => [...files].sort((a, b) => linesOf(b) - linesOf(a)).map((f) => ({ path: f.path, lines: linesOf(f) }));

/** The shape a description of this size should take, as the skill describes it. */
export function shapeFor(kind: Kind, size: Size | null): string[] {
  if (kind === 'commit') {
    return [
      "Subject: what changed, 72 characters or fewer, plain text, in this repo's style.",
      "Body only if the why isn't obvious: 1 to 3 lines on why, plus a few plain \"- \" bullets if the change has several parts.",
    ];
  }
  const opening = 'Opening, 1 or 2 sentences: what changed and why, in plain words (no "What:" or "Why:" labels).';
  const tested = 'Tested only when something ran or you were told what ran or that tests pass: the command and what it returned. If nothing ran and nobody said, leave testing out (no "Not tested" line).';
  const carry = 'What you were given comes first, in their words: the reason, the issue link with its word ("Closes #12"), docs and other PRs cited and why, what was run and what it showed, a question the author is asking, what it leaves for later, an example. Cut padding, never these.';
  if (size === 'tiny') return [opening, carry, 'Bullets only if there are 2 or more separate behavior changes.', tested];
  const bullets =
    size === 'big'
      ? 'Bullets for the changes a reviewer would ask about, each with where to look and the values (old → new, limits, defaults); more bullets, not longer ones. Group by area, never file by file. Say which part is mechanical (tests, generated, renamed) with the line counts above, not a percentage.'
      : 'Bullets, up to 5, only for the changes a reviewer would ask about, each with where to look and the values (old → new, limits, defaults). Group by area, never file by file.';
  return [opening, carry, bullets, tested];
}

// What each non-default length asks of the writer. The facts rules are the same at every length.
const LENGTH_NOTE: Record<Exclude<Length, 'normal'>, string> = {
  short: 'Fewer, tighter bullets and no extra background; still say what changed and why, and keep every fact and anything you ran.',
  detailed: 'More room for reasoning: the design choices, what was ruled out and why, and the risks, still grouped by area, never file by file.',
};

export function buildContext(kind: Kind, cwd: string, base?: string): AgentContext {
  const repo = loadRepo(cwd);
  let diff: DiffFacts | null = null;
  let source: AgentContext['source'] = 'none';
  let usedBase: string | null = null;
  let commits: string[] | null = null;
  if (repo.root) {
    if (kind === 'commit') {
      diff = stagedDiff(cwd);
      source = 'staged';
      if (!diff) {
        diff = worktreeDiff(cwd);
        source = diff ? 'working tree' : 'none';
      }
    } else {
      usedBase = base ?? defaultBase(cwd);
      diff = usedBase ? branchDiff(usedBase, cwd) : null;
      source = diff ? 'branch' : 'none';
      commits = usedBase ? branchCommits(usedBase, cwd) : null;
    }
  }
  return contextOf(kind, diff, { source, base: usedBase, commits, style: repo.style, template: kind === 'pr' ? (repo.template?.paths ?? null) : null, length: repo.config.length });
}

/** The context for a diff already in hand (a PR fetched from GitHub, say), with no repo to read. */
export function contextOf(
  kind: Kind,
  diff: DiffFacts | null,
  opts: { source?: AgentContext['source']; base?: string | null; commits?: string[] | null; style?: StyleProfile | null; template?: string[] | null; length?: Length } = {},
): AgentContext {
  const { source = diff ? 'branch' : 'none', base = null, commits = null, style: s = null, template = null, length = 'normal' } = opts;
  const range = wordRange(kind, diff, length);
  const areas = diff ? areasOf(diff.files, Infinity) : [];
  const AREAS = 8;
  return {
    kind,
    source,
    base,
    diff: diff && {
      files: diff.files.length,
      additions: diff.additions,
      deletions: diff.deletions,
      changedLines: diff.changedLines,
      size: sizeOf(diff),
      // Biggest changes first: that's what the description should be about.
      paths: byLines(diff.files).slice(0, 12).map((f) => f.path),
      testFiles: diff.tests.length,
      docFiles: diff.docs.length,
      large: diff.changedLines >= 500 || diff.files.length >= 25,
      areas: areas.slice(0, AREAS),
      moreAreas: Math.max(0, areas.length - AREAS),
      tests: byLines(diff.tests),
      docs: byLines(diff.docs),
      generated: byLines(diff.files.filter(generatedFile)),
      renames: diff.files.filter((f) => f.renamed && linesOf(f) === 0).map((f) => f.path),
      pureRenames: diff.files.filter((f) => f.renamed && linesOf(f) === 0).length,
    },
    commits,
    length,
    range,
    budget: range.budget,
    shape: shapeFor(kind, diff ? sizeOf(diff) : null),
    style: s && {
      sample: s.sample,
      conventional: s.conventional,
      types: s.types.slice(0, 6),
      capitalized: s.capitalized,
      ticket: s.ticket,
      ticketExample: s.ticketExample,
      subjectP50: s.subjectP50,
      body: s.body,
      mood: s.mood,
      examples: s.examples,
    },
    template,
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const n = (x: number) => x.toLocaleString('en-US');
const plural = (k: number, one: string, many = `${one}s`) => `${n(k)} ${k === 1 ? one : many}`;

/** "a.ts (120), b.ts (30), +4 more" */
function list(files: FileLines[], max = 6): string {
  const shown = files.slice(0, max).map((f) => `${f.path} (${n(f.lines)})`);
  return shown.join(', ') + (files.length > max ? `, +${files.length - max} more` : '');
}

const SIZE: Record<Size, string> = { tiny: 'tiny, under 30 lines', normal: 'normal, 30 to 300 lines', big: 'big, 300+ lines' };

export function renderContext(c: AgentContext): string {
  const out: string[] = [`buzzcut context · ${c.kind === 'commit' ? 'commit message' : 'PR description'}`, ''];
  if (c.diff) {
    const d = c.diff;
    out.push(`Changes (${c.source}${c.base ? ` vs ${c.base}` : ''}): ${plural(d.files, 'file')}, +${n(d.additions)} −${n(d.deletions)}, ${n(d.changedLines)} changed lines (${SIZE[d.size]}).`);
    if (c.kind === 'pr' || d.large || d.areas.length > 1) {
      out.push('By area, biggest first:');
      const w = Math.max(...d.areas.map((a) => a.area.length));
      for (const a of d.areas) out.push(`  ${a.area.padEnd(w)}  ${plural(a.lines, 'line')}, ${plural(a.files, 'file')}`);
      if (d.moreAreas) out.push(`  +${plural(d.moreAreas, 'more area')}`);
    } else {
      out.push(`Files: ${d.paths.join(', ')}${d.files > d.paths.length ? `, +${d.files - d.paths.length} more` : ''}`);
    }
    out.push(d.tests.length ? `Tests: ${list(d.tests)}.` : "Tests: none changed, so don't say tests were added.");
    if (d.docs.length) out.push(`Docs: ${list(d.docs)}.`);
    if (d.generated.length) out.push(`Generated or lockfiles, not counted: ${list(d.generated, 4)}.`);
    if (d.renames.length) {
      const shown = d.renames.slice(0, 4).join(', ') + (d.renames.length > 4 ? `, +${d.renames.length - 4} more` : '');
      out.push(`Only moved or renamed: ${plural(d.renames.length, 'file')} (${shown}). That part is mechanical.`);
    }
  } else {
    out.push('No diff found (nothing staged or changed), so only the wording can be checked.');
  }

  if (c.commits?.length) {
    out.push('', `Commits on this branch (${c.commits.length}), oldest first:`);
    for (const s of c.commits.slice(-12)) out.push(`  ${s}`);
    if (c.commits.length > 12) out.push(`  (${c.commits.length - 12} older not shown)`);
  }

  out.push('', `Shape${c.diff ? ` for a ${c.diff.size} ${c.kind === 'commit' ? 'change' : 'diff'}` : ''}:`);
  if (c.kind === 'pr') {
    const prefixed = c.style && c.style.conventional >= 0.6 && c.style.types.length;
    out.push(`  Title: what changed, specific, 72 characters or fewer${prefixed ? `, with a prefix like this repo's commits (${c.style!.types.slice(0, 3).map((t) => `${t}:`).join(', ')})` : ''}.`);
  }
  c.shape.forEach((line, i) => out.push(c.kind === 'pr' ? `  ${i + 1}. ${line}` : `  ${line}`));
  if (c.kind === 'pr' && c.diff?.size === 'big') out.push("  A few short plain headers are fine on a diff this big: Behavior changes / What's mechanical / How to review / Risk.");
  if (c.length !== 'normal') out.push(`Length: ${c.length}, set in this repo's buzzcut config. ${LENGTH_NOTE[c.length]}`);
  if (c.kind === 'pr') {
    out.push("Length follows what you were given, not the size of the diff: a short note and a small change is a title and a sentence or two. Don't add detail from the diff to make it longer; padding is flagged, facts you were given never are.");
    out.push(
      '',
      'From what you were given, not the diff: the why (the bug, the error message quoted, the issue link, who asked) and what ran, if anything (the commands and what they returned). Put those in first, then add where and what from the diff.',
    );
  } else {
    out.push(`Body words: ${n(c.range.budget)} at most, up to 2.5× more if it's dense with specifics (numbers, code references, links). A body is optional.`);
  }

  if (c.style) {
    const s = c.style;
    const parts: string[] = [];
    if (s.conventional >= 0.6) parts.push(`conventional commits (${pct(s.conventional)}; types: ${s.types.join(', ')})`);
    else if (s.conventional <= 0.1) parts.push('no conventional prefixes');
    if (s.ticket >= 0.6) parts.push(`subjects start with a ticket id like ${s.ticketExample}`);
    if (s.mood === 'past') parts.push('subjects are in the past tense ("Added …", not "Add …"), so write yours that way');
    else if (s.mood === 'imperative') parts.push('subjects are imperative ("Add …")');
    if (s.capitalized >= 0.85) parts.push('subjects start with a capital letter');
    else if (s.capitalized <= 0.15) parts.push('subjects start lowercase');
    parts.push(`median subject ${s.subjectP50} characters`);
    parts.push(`${pct(s.body)} of commits have a body`);
    out.push('', `Repo style (last ${s.sample} commits): ${parts.join('; ')}.`);
    if (c.kind === 'commit' && s.examples.length) {
      out.push('Recent subjects:');
      for (const e of s.examples) out.push(`  ${e}`);
    }
  }
  if (c.template?.length) out.push('', `PR template: ${c.template.join(', ')}. Fill it in briefly in this shape; its boilerplate isn't counted.`);
  out.push(
    '',
    c.kind === 'commit'
      ? 'Next: write the message to .git/BUZZCUT_MSG and run `buzzcut check .git/BUZZCUT_MSG`.'
      : 'Next: write the body to a file and run `buzzcut pr <file> --title "<title>"`.',
  );
  return out.join('\n');
}
