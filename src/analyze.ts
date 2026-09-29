import { applyRuleSettings, LENGTHS, type Length, type RuleSetting } from './config.js';
import { OVERLONG } from './rules/grounded.js';
import { RULES } from './rules/index.js';
import type { PreviousDraft, SessionFacts } from './rules/rule.js';
import type { StyleProfile } from './style.js';
import type { Template } from './template.js';
import { evidenceOf } from './facts.js';
import { makeResolver, verifiedSpecificity, type RepoSearch } from './lookup.js';
import { analyzeText, specificity } from './text.js';
import type { DiffFacts, Finding, Grade, Kind, Message, Report, Severity } from './types.js';

export interface AnalyzeOptions {
  /** the repo's commit style; enables the style-* rules */
  style?: StyleProfile | null;
  /** the repo's PR template; its boilerplate lines are ignored in PR bodies */
  template?: Template | null;
  /** per-rule overrides from config */
  rules?: Record<string, RuleSetting>;
  /** commands the agent ran this session (agent hooks only); enables unverified-in-session */
  session?: SessionFacts | null;
  /** evidence from the previous draft of this message; enables dropped-facts */
  previous?: PreviousDraft | null;
  /** the repo's `length` setting: scales the word budget and the bullets allowed */
  length?: Length;
  /** searches the repo for names the diff doesn't contain; enables the source lookups that need it */
  repo?: RepoSearch | null;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** How big a diff is, for the shape of its description. Lockfiles and generated files don't count. */
export type Size = 'tiny' | 'normal' | 'big';

export function sizeOf(diff: DiffFacts): Size {
  return diff.changedLines < 30 ? 'tiny' : diff.changedLines < 300 ? 'normal' : 'big';
}

/**
 * How many prose words a description deserves, as a range. Both ends grow with the square root
 * of the diff. For a PR, a 9-line fix gets about 15 to 85 words (an opening and a Tested line),
 * 100 lines about 40 to 140 (plus a few bullets), 1,000 lines about 100 to 310.
 * The ceiling is the budget the length rule checks; the floor is advice for `buzzcut context`.
 * A repo's `length` setting scales both ends (short 0.6×, detailed 1.6×).
 */
export function wordRange(kind: Kind, diff: DiffFacts | null, length: Length = 'normal'): { floor: number; budget: number } {
  const k = LENGTHS[length];
  const scaled = (r: { floor: number; budget: number }) => ({ floor: Math.round(r.floor * k), budget: Math.round(r.budget * k) });
  if (!diff) return scaled(kind === 'pr' ? { floor: 20, budget: 250 } : { floor: 0, budget: 80 });
  const root = Math.sqrt(diff.changedLines);
  if (kind === 'commit') return scaled({ floor: 0, budget: clamp(Math.round(25 + 4 * root), 30, 250) });
  return scaled({ floor: clamp(Math.round(8 + 3 * root), 15, 120), budget: clamp(Math.round(60 + 8 * root), 80, 500) });
}

/** The top of the range: how many prose words the body gets before the length rule speaks up. */
export function wordBudget(kind: Kind, diff: DiffFacts | null, length: Length = 'normal'): number {
  return wordRange(kind, diff, length).budget;
}

/**
 * Specific writing earns more room. At 3 or fewer specifics per 100 words the budget
 * stays as is; it grows to 2.5× for text dense with numbers, code references and links.
 */
export function specificityBonus(density: number): number {
  return clamp(1 + (density - 3) / 5, 1, 2.5);
}

const GRADES: [number, Grade, string][] = [
  [10, 'A', 'Says less. Ships more.'],
  [25, 'B', 'Mostly signal.'],
  [45, 'C', 'Starting to yap.'],
  [65, 'D', 'Yapping.'],
  [Infinity, 'F', 'Certified yapper.'],
];

export function gradeOf(score: number): { grade: Grade; verdict: string } {
  const [, grade, verdict] = GRADES.find(([max]) => score <= max)!;
  return { grade, verdict };
}

const EDITOR_TEMPLATE = /^# (Please enter the commit message|On branch |Changes to be committed|-+ >8 -+$)/;

/**
 * Split a raw commit message into subject and body. When it's git's editor template,
 * drop the `#` comment lines and everything below the scissors line, as git does.
 * Messages passed with -m or -F keep their `#` lines, and so do we: git commits them.
 */
export function parseCommit(raw: string): Message {
  let lines = raw.replace(/\r\n?/g, '\n').split('\n');
  if (lines.some((l) => EDITOR_TEMPLATE.test(l))) {
    const scissors = lines.findIndex((l) => /^# -+ >8 -+$/.test(l));
    if (scissors !== -1) lines = lines.slice(0, scissors);
    lines = lines.filter((l) => !l.startsWith('#'));
  }
  while (lines.length && !lines[0]!.trim()) lines.shift();
  const title = (lines[0] ?? '').trim();
  const body = lines.slice(1).join('\n').replace(/\s+$/, '');
  return { kind: 'commit', title, body, bodyLine: 2 };
}

/**
 * A commit from history. GitHub's squash merges ("Fix x (#123)") carry the PR description
 * as their body, so they're judged as the PR description they are.
 */
export function historyMessage(raw: string): Message {
  const msg = parseCommit(raw);
  return /\(#\d+\)$/.test(msg.title) ? prMessage(msg.title, msg.body) : msg;
}

export function prMessage(title: string, body: string): Message {
  return { kind: 'pr', title: title.trim(), body: body ?? '', bodyLine: 1 };
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

/**
 * The prose tells: buzzwords, forms, tours, bold labels, ticked boxes, claims with nothing behind
 * them. These make a description hard to read, so their warnings add up to a send-back in full.
 */
export const YAP_RULES = new Set([
  'ai-vocab', 'ai-opener', 'ai-closer', 'chatbot-leftovers', 'emoji', 'bold-spam', 'template-on-tiny',
  'diff-echo', 'ticked-boxes', 'vague-verification', 'unbacked-claim', 'markdown-in-commit',
]);

/**
 * The most that every other warning and note (length, bullet count, title length, em dashes,
 * a missing why or Tested line, house style) counts toward a send-back. They're about how much
 * is written, not whether it reads well, so on their own they stay advice: a long PR with facts
 * in it is never sent back for being long and listing its changes. The yap score itself isn't
 * capped.
 */
export const SHAPE_CAP = 20;

/** Advice, never a send-back: a thin description or a long bullet gets a note, not a rejection. */
const ADVICE_ONLY = new Set(['thin-description', 'long-bullet']);

/** The score a report is judged by: errors and prose tells in full, the rest up to SHAPE_CAP. */
export function blockingScore(r: Report): number {
  const fired = new Set(r.findings.map((f) => f.rule));
  // Over the word budget and over the bullet allowance at once: a wall to scroll, not a PR.
  const longList = fired.has('length') && fired.has('bullet-bloat');
  let full = 0;
  let shape = 0;
  for (const f of r.findings) {
    // More than twice the bullets a diff this size allows is a tour, however true each line is.
    const wall = f.rule === 'bullet-bloat' && (Number(f.data?.count) > 2 * Number(f.data?.allowed) || longList);
    const overlong = f.rule === 'length' && (Number(f.data?.ratio) >= OVERLONG || longList);
    if (f.severity === 'error' || YAP_RULES.has(f.rule) || wall || overlong) full += f.points;
    else if (ADVICE_ONLY.has(f.rule)) continue;
    else shape += f.points;
  }
  return Math.min(r.score, full + Math.min(SHAPE_CAP, shape));
}

/** A report passes when nothing is an error and its blocking score is at or under `max`. */
export function passes(r: Report, max: number): boolean {
  return blockingScore(r) <= max && !r.findings.some((f) => f.severity === 'error');
}

export function analyze(msg: Message, diff: DiffFacts | null, opts: AnalyzeOptions = {}): Report {
  const skip = msg.kind === 'pr' ? opts.template?.lines : undefined;
  const text = analyzeText(msg.body, msg.bodyLine, skip);
  const files = new Set(diff?.files.flatMap((f) => [f.path, f.path.split('/').pop()!]) ?? []);
  // Names, files and figures are looked up in the diff, the repo and the session when there is
  // something to look in; only the ones found earn extra room. With no evidence this is the old count.
  const resolver = makeResolver({ diff, session: opts.session, repo: opts.repo });
  const density = resolver ? verifiedSpecificity(text.lines, text.words, files, resolver) : specificity(text.lines, text.words, files);
  const length = opts.length ?? 'normal';
  const budget = Math.round(wordBudget(msg.kind, diff, length) * specificityBonus(density));
  const ctx = { msg, diff, text, budget, density, length, style: opts.style ?? null, session: opts.session ?? null, previous: opts.previous ?? null, resolver };

  let findings: Finding[] = [];
  for (const rule of RULES) {
    if (!rule.kinds.includes(msg.kind) || (rule.needsDiff && !diff)) continue;
    const out = rule.run(ctx);
    if (out) findings.push(...(Array.isArray(out) ? out : [out]));
  }
  if (opts.rules) findings = applyRuleSettings(findings, opts.rules);
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.points - a.points);

  const score = Math.min(100, findings.reduce((n, f) => n + f.points, 0));
  return { kind: msg.kind, title: msg.title, score, ...gradeOf(score), words: text.words, budget, density: Math.round(density * 10) / 10, diff, findings };
}

// Findings that mark a line as false or unbacked: its numbers may go, so dropped-facts
// never asks for them back.
const CLAIMS = new Set(['phantom-tests', 'unverified-in-session', 'vague-verification', 'ticked-boxes', 'unbacked-claim', 'unsourced-name', 'unsourced-fact', 'test-count-mismatch']);

/**
 * The evidence in a message worth keeping through a rewrite: everything except what sits on
 * a line buzzcut flagged as a false or unbacked claim.
 */
export function keepableEvidence(msg: Message, r: Report): string[] {
  const flagged = new Set(r.findings.filter((f) => CLAIMS.has(f.rule) && f.line).map((f) => f.line));
  const lines = msg.body.split('\n').filter((_, i) => !flagged.has(msg.bodyLine + i));
  return evidenceOf([msg.title, ...lines].join('\n'));
}
