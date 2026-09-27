// `buzzcut roast`: the screenshot. One PR as a card, or a repo's recent PRs (or your own
// commits) as a leaderboard. It asks what every reviewer asks (does it say what changed, and
// why?), then cuts in proportion: a good PR gets a compliment, a decent one a nit or two, a
// yappy one the full roast. No author names, no "AI wrote this" accusations, and every
// burn is backed by a number from the report.
import { gradeOf, passes } from './analyze.js';
import { DEFAULTS } from './config.js';
import { whyOf, worthKeeping } from './keep.js';
import { ICON, palette, severityPaint, gradePaint, wrap, type Paint, type Palette } from './format.js';
import type { PullRequest } from './github.js';
import type { Template } from './template.js';
import type { Finding, Grade, Report, Severity } from './types.js';

interface Stats {
  words: number;
  lines: number;
  budget: number;
}

type Line = (f: Finding, s: Stats) => string | null;

const ROASTS: Record<string, Line[]> = {
  length: [
    (f, s) => (s.lines > 0 && s.words > s.lines ? `${s.words} words for ${changed(s.lines)}. The description is longer than the code.` : `${s.words} words where ${s.budget} would do.`),
    (f) => `${f.data?.ratio}× over the word budget. A blog post with a diff attached.`,
    (f, s) => `Could have been ${s.budget} words. It's ${s.words}.`,
  ],
  'template-on-tiny': [
    (f) => `${f.data?.headers} section headers for ${f.data?.lines} lines of code. It's a PR, not a tax form.`,
    (f) => `A ${f.data?.headers}-section document for a ${f.data?.lines}-line change.`,
    (f) => `Filled out the whole form for a ${f.data?.lines}-line diff.`,
  ],
  'diff-echo': [
    (f) => `${f.data?.count} lines reading the file list out loud. GitHub already shows it.`,
    (f) => `A guided tour of ${f.data?.count} files the reviewer can already see.`,
    () => 'Narrates the diff, file by file. The diff was right there.',
  ],
  'phantom-tests': [(f) => `Says "${f.quote}". Test files changed: 0.`, () => "Mentions tests. The diff has none. Schrödinger's test suite."],
  'unverified-in-session': [(f) => `"${f.quote}". Nothing was run. We checked.`],
  'ticked-boxes': [(f) => `${f.data?.count} boxes ticked. Commands shown: none.`, (f) => `Checklist theater: ${f.data?.count} ticked boxes and no evidence.`],
  'vague-verification': [(f) => `"${f.quote}". Tested how, exactly?`],
  'unbacked-claim': [(f) => `"${f.quote}". No number, no benchmark, just vibes.`, (f) => `Claims "${f.quote}". Source: trust me.`],
  'type-mismatch': [(f) => `${f.message}. The prefix and the diff disagree.`],
  'ai-vocab': [
    (f) => `Buzzword bingo: ${f.data?.words}.`,
    (f) => `Vocabulary straight from a press release: ${f.data?.words}.`,
    (f) => `${f.data?.words}. The LinkedIn post writes itself.`,
  ],
  'ai-opener': [(f) => `Opens with "${f.quote}…". Classic.`, (f) => `"${f.quote}…": the opening line of every generated PR.`],
  'ai-closer': [(f) => `Ends with "${f.quote}…". Nobody asked for a conclusion.`, (f) => `Signs off with "${f.quote}…". It's a PR, not an essay.`],
  'chatbot-leftovers': [(f) => `The chatbot is still talking: "${f.quote}".`],
  emoji: [(f) => `${f.data?.count} emoji-led headers. This is a diff, not a launch party. 🚀`],
  'bold-spam': [(f) => `${f.data?.count} bold phrases. When everything is bold, nothing is.`],
  'bullet-bloat': [(f) => `${f.data?.count} bullet points for ${f.data?.lines} lines of code.`, (f) => `${f.data?.count} bullets. It reads like a slide deck.`],
  'thin-description': [
    (f) => (/tested/.test(f.message) ? 'Says what it does. Not whether anyone ran it.' : `${f.data?.words} words for ${changed(Number(f.data?.lines))}. A caption, not a description.`),
  ],
  'long-bullet': [(f) => `A ${f.data?.longest}-word bullet. That's a paragraph wearing a hyphen.`],
  'em-dash': [(f) => `${f.data?.count} em dashes. The telltale kind.`],
  'subject-length': [() => 'A title so long it needs its own summary.'],
  'commit-changelog': [(f) => `A ${f.data?.bullets}-bullet changelog in a commit message. git log is not a release note.`],
  'markdown-in-commit': [() => 'Markdown in a commit message. git log shows every ** and ## as is.'],
};

// For a good PR with a rough edge: say it once, kindly.
const NITS: Record<string, Line> = {
  length: (f, s) => `A little long: ${s.words} words where about ${s.budget} would do.`,
  'template-on-tiny': (f) => `${f.data?.headers} section headers for a ${f.data?.lines}-line change. An opening and a Tested line would do.`,
  'diff-echo': (f) => `Walks through ${f.data?.count} files the diff already shows.`,
  'unbacked-claim': (f) => `"${f.quote}" could use a number.`,
  'ticked-boxes': (f) => `${f.data?.count} ticked boxes. Name the command instead.`,
  'vague-verification': (f) => `"${f.quote}". Say which command.`,
  'ai-vocab': (f) => `A buzzword or two: ${f.data?.words}.`,
  'ai-opener': (f) => `Opens with "${f.quote}…". Start with the change.`,
  'ai-closer': () => 'The closing summary can go.',
  emoji: () => 'The emoji headers can go.',
  'bold-spam': (f) => `${f.data?.count} bold phrases. Bold one thing, at most.`,
  'bullet-bloat': (f) => `${f.data?.count} bullets. Keep the ones a reviewer would ask about.`,
  'thin-description': (f) => (/tested/.test(f.message) ? 'Add a Tested line: what ran, and what it returned.' : `${f.data?.words} words for ${changed(Number(f.data?.lines))}. The reviewer needs a map.`),
  'long-bullet': (f) => `A ${f.data?.longest}-word bullet. One change per bullet, about 25 words.`,
  'subject-length': () => 'The title could be shorter.',
  'commit-changelog': (f) => `${f.data?.bullets} bullets in a commit body. git log reads better as prose.`,
  'markdown-in-commit': () => 'Markdown in a commit message shows up as raw symbols in git log.',
};

// Pedantry doesn't make the roast: info-level notes (a trailing period, the house style) stay out.
const SKIP = new Set(['subject-mood', 'subject-period', 'blank-line', 'style-convention', 'style-case', 'style-ticket']);
// "Says what changed" and "says why" get a line of their own on the card, so their findings
// aren't repeated as burns.
const BASICS = new Set(['subject-vague', 'empty-subject', 'missing-why']);

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const pick = <T>(xs: T[], seed: string): T => xs[hash(seed) % xs.length]!;
const sentence = (s: string) => (/[.!?…"]$/.test(s) ? s : s + '.');

/** How hard to cut: a compliment, a nit or two, or the full roast. */
export type Heat = 'praise' | 'nit' | 'roast';

export function roastLine(f: Finding, s: Stats, seed: string, heat: Heat = 'roast'): string {
  // Errors are never softened: a false claim is a false claim on any grade.
  const nit = heat !== 'roast' && f.severity !== 'error' ? NITS[f.rule] : undefined;
  const options = ROASTS[f.rule];
  const line = nit ? nit(f, s) : options?.length ? pick(options, seed + f.rule)(f, s) : null;
  return line ?? sentence(f.message);
}

function statsOf(r: Report): Stats {
  return { words: r.words, lines: r.diff?.changedLines ?? 0, budget: r.budget };
}

const n = (x: number) => x.toLocaleString('en-US');
const clip = (s: string, max: number) => ([...s].length > max ? [...s].slice(0, max - 1).join('').trimEnd() + '…' : s);

// ─── what changed, and why ───────────────────────────────────────────────────

/** ok ✓, bad ✗, meh ! (there, but weak), none – (not said, and that's fine here) */
export type Mark = 'ok' | 'bad' | 'meh' | 'none';

export interface Basic {
  mark: Mark;
  text: string;
}

/**
 * The two things every good description does, in whatever words it likes: say what changed,
 * and say why. These are what the card checks for, not headings a PR should have.
 */
export interface Basics {
  what: Basic;
  why: Basic;
}

/** A change this small can carry its reason in the title. */
const SMALL = 20;

export function basicsOf(r: Report, body: string, template?: Template | null): Basics {
  const find = (id: string) => r.findings.find((f) => f.rule === id);
  const lines = r.diff?.changedLines;
  const small = lines != null && lines <= SMALL;

  let what: Basic;
  if (!r.title.trim()) what = { mark: 'bad', text: 'no title' };
  else if (find('subject-vague')) what = { mark: 'bad', text: `"${clip(r.title, 40)}" doesn't say what changed` };
  else if (find('subject-length')?.severity === 'error') what = { mark: 'meh', text: `a ${[...r.title].length}-character title` };
  else what = { mark: 'ok', text: `"${clip(r.title, 60)}"` };

  let why: Basic;
  const reason = whyOf(r.title, body, template?.lines);
  if (reason) why = { mark: 'ok', text: reason === r.title ? 'the title says it' : `"${reason}"` };
  // A few words on a small change can leave the reason to the title; 146 words can't.
  else if (small && r.words <= 40) why = { mark: 'none', text: r.words ? "doesn't say, but the change is small" : 'title only, fine for a change this small' };
  else why = { mark: 'bad', text: r.words ? 'never says why' : lines != null ? `no description for ${changed(lines)}` : 'no description' };

  return { what, why };
}

// ─── the verdict ─────────────────────────────────────────────────────────────

function verdictLine(r: Report, heat: Heat, b: Basics, seed: string): string {
  const s = statsOf(r);
  if (r.words === 0) {
    if (b.what.mark === 'bad') return 'A title that says nothing, and nothing under it. The reviewer has questions.';
    if (b.why.mark !== 'bad') return 'Title only. For a change this size, fair enough.';
    return r.diff ? `No description for ${changed(s.lines)}. The reviewer gets to guess.` : 'No description. The reviewer gets to guess.';
  }
  if (heat === 'praise') {
    if (b.what.mark === 'ok' && b.why.mark === 'ok') return 'Says what changed and why, in plain words. Frame this one.';
    return pick(['Short, specific, done.', 'The reviewer read it in one breath.', 'Senior engineer energy.', 'Nothing to cut. Next.'], seed);
  }
  if (heat === 'nit' && b.why.mark === 'bad') return pick(['Tidy. Now tell the reviewer why.', 'Clean cut. The reviewer still has to ask why.', 'Says what it does. Not why it matters.'], seed);
  if (heat === 'nit') return pick(['Clean. One trim and it is perfect.', 'The reviewer approves. Mostly.', 'Almost no yap. Almost.', 'Good cut. A little off the top.'], seed);
  const longer = s.lines > 0 && s.words > s.lines;
  const options: Record<'C' | 'D' | 'F', string[]> = {
    C: ['Starting to yap. Keep the why, cut the recap.', 'Half description, half cover letter.', 'Good bones. Too much padding.'],
    D: ['Yapping. The diff said it better.', 'The reviewer skimmed it. Everyone skims it.', 'Somewhere in here is a good five-line description.'],
    F: [
      "This isn't a PR description. It's a TED talk.",
      'The reviewer is still reading. Send snacks.',
      ...(longer ? ["Longer than the diff, and it isn't close."] : []),
      ...(b.why.mark === 'bad' ? ['A wall of words and not one reason why.'] : []),
      'Certified yapper. The diff could have spoken for itself.',
    ],
  };
  return pick(options[r.grade as 'C' | 'D' | 'F'] ?? options.C, seed);
}

// ─── pieces ──────────────────────────────────────────────────────────────────

const WIDTH = 68;

export function meter(score: number, p: Palette, grade: Grade, width = 30): string {
  const filled = Math.round((Math.min(100, Math.max(0, score)) / 100) * width);
  return gradePaint(p, grade)('█'.repeat(filled)) + p.dim('░'.repeat(width - filled));
}

function banner(p: Palette, left: string, right: string): string[] {
  const rule = p.dim('━'.repeat(WIDTH));
  return [`  ${rule}`, `   ${p.bold(left)}   ${p.dim(right)}`, `  ${rule}`];
}

function scoreBlock(p: Palette, r: { score: number; grade: Grade; verdict: string }, label = ''): string[] {
  const g = gradePaint(p, r.grade);
  return [`   ${p.bold('YAP-O-METER')}  ${meter(r.score, p, r.grade)}  ${g(p.bold(`${r.score}/100`))}  ${g(p.inverse(` ${r.grade} `))}${label}`, `                ${p.dim(r.verdict)}`];
}

export const MARK: Record<Mark, string> = { ok: '✓', bad: '✗', meh: '!', none: '–' };

function markPaint(p: Palette, m: Mark): Paint {
  return m === 'ok' ? p.green : m === 'bad' ? p.red : m === 'meh' ? p.yellow : p.dim;
}

// ─── one PR ──────────────────────────────────────────────────────────────────

export interface RoastOptions {
  color: boolean;
  template?: Template | null;
  /** the share link is printed below, so skip the hint */
  share?: boolean;
}

/** Everything a roast says about one PR, for any renderer (terminal, Markdown, the website). */
export interface RoastCard {
  ref: string;
  title: string;
  url: string;
  score: number;
  grade: Grade;
  verdict: string;
  heat: Heat;
  basics: Basics;
  words: number;
  /** changed lines, or null without a diff */
  lines: number | null;
  budget: number;
  /** words per changed line, when it's worth saying */
  perLine: number | null;
  /** share of the words over budget, when length is one of the problems */
  yapPct: number | null;
  burns: { severity: Severity; text: string }[];
  /** burns left out for space */
  more: number;
  /** the sentences with facts in them; null when the PR is within reason */
  keep: { sentences: string[]; words: number } | null;
  closer: string;
}

const MAX_BURNS: Record<Grade, number> = { A: 2, B: 2, C: 4, D: 5, F: 5 };

export function roastCard(pr: PullRequest, r: Report, opts: { template?: Template | null } = {}): RoastCard {
  const s = statsOf(r);
  const basics = basicsOf(r, pr.body, opts.template);
  // A tidy PR that never says what changed or why doesn't get framed.
  const loud = r.findings.some((f) => !SKIP.has(f.rule) && f.severity !== 'info');
  const gap = Object.values(basics).some((b) => b.mark === 'bad');
  const heat: Heat = r.grade === 'A' && !loud && !gap ? 'praise' : r.grade === 'A' || r.grade === 'B' ? 'nit' : 'roast';
  // An empty body already gets its own verdict; the thin-description burn would say it twice.
  const said = (f: Finding) => BASICS.has(f.rule) || (f.rule === 'thin-description' && r.words === 0);
  const burnable = heat === 'praise' ? [] : r.findings.filter((f) => !SKIP.has(f.rule) && !said(f) && (heat === 'roast' || f.severity !== 'info'));
  const max = MAX_BURNS[r.grade];
  let keep: RoastCard['keep'] = null;
  if (heat === 'roast' && s.words > s.budget) {
    const files = new Set(r.diff?.files.flatMap((f) => [f.path, f.path.split('/').pop()!]) ?? []);
    const kept = worthKeeping(pr.body, s.budget, files, opts.template?.lines);
    keep = { sentences: kept.sentences, words: kept.words };
  }
  const long = r.findings.some((f) => f.rule === 'length');
  return {
    ref: `${pr.owner}/${pr.repo}#${pr.number}`,
    title: pr.title,
    url: pr.url,
    score: r.score,
    grade: r.grade,
    verdict: r.verdict,
    heat,
    basics,
    words: s.words,
    lines: r.diff ? s.lines : null,
    budget: s.budget,
    perLine: heat === 'roast' && r.diff && s.lines > 0 && s.words >= 2 * s.lines ? Math.round((10 * s.words) / s.lines) / 10 : null,
    yapPct: long && s.words > s.budget ? Math.round((100 * (s.words - s.budget)) / s.words) : null,
    burns: burnable.slice(0, max).map((f) => ({ severity: f.severity, text: roastLine(f, s, pr.url, heat) })),
    more: Math.max(0, burnable.length - max),
    keep,
    closer: verdictLine(r, heat, basics, pr.url),
  };
}

function statLines(c: RoastCard): string[] {
  const size = c.lines != null ? `${n(c.words)} words for a ${n(c.lines)}-line diff` : `${n(c.words)} words`;
  const out = [`${size}${c.perLine ? ` (${c.perLine} words per changed line)` : ''}.`];
  if (c.yapPct != null) out.push(`Could have been ~${n(c.budget)} words. ${c.yapPct}% of it is yap.`);
  return out;
}

const BURNS_TITLE: Record<Heat, string> = { praise: '', nit: 'NITS', roast: 'THE ROAST' };

export function renderRoast(pr: PullRequest, r: Report, opts: RoastOptions): string {
  const p = palette(opts.color);
  const c = roastCard(pr, r, opts);
  const out: string[] = [''];
  out.push(...banner(p, '💈 THE BUZZCUT ROAST', c.ref));
  out.push(`   ${p.dim(`"${clip(c.title, WIDTH - 6)}"`)}`, '');
  out.push(...scoreBlock(p, r), '');
  for (const [label, b] of [['WHAT CHANGED', c.basics.what], ['WHY         ', c.basics.why]] as const) {
    const text = wrap(b.text, WIDTH - 21);
    out.push(`   ${markPaint(p, b.mark)(MARK[b.mark])} ${p.bold(label)}  ${text[0]}`, ...text.slice(1).map((t) => `                   ${t}`));
  }
  out.push('');
  for (const l of statLines(c)) for (const w of wrap(l, WIDTH - 4)) out.push(`   ${w}`);
  out.push('');
  if (c.burns.length) {
    out.push(`   ${p.bold(BURNS_TITLE[c.heat])}`);
    for (const b of c.burns) {
      const text = wrap(b.text, WIDTH - 6);
      out.push(`   ${severityPaint(p, b.severity)(ICON[b.severity])} ${text[0]}`, ...text.slice(1).map((t) => `     ${t}`));
    }
    if (c.more) out.push(p.dim(`     … and ${c.more} more`));
    out.push('');
  }
  if (c.keep) {
    if (c.keep.sentences.length) {
      out.push(`   ${p.bold('WORTH KEEPING')}  ${p.dim(`the ${c.keep.words} words with facts in them`)}`);
      for (const s of c.keep.sentences) for (const w of wrap(s, WIDTH - 6)) out.push(`   ${p.dim('│')} ${w}`);
    } else {
      out.push(`   ${p.bold('WORTH KEEPING')}  ${p.dim('nothing: no numbers, no errors, no reason why')}`);
    }
    out.push('');
  }
  out.push(`   ${p.bold('VERDICT')}  ${c.closer}`, '');
  out.push(`   ${p.dim('Roast any PR')}  ${p.cyan('npx buzzcut roast <pr-url>')}`);
  if (!opts.share) out.push(`   ${p.dim('Post this   ')}  ${p.cyan('add --share')}`);
  out.push('');
  return out.join('\n');
}

export function renderRoastMarkdown(pr: PullRequest, r: Report, opts: { template?: Template | null } = {}): string {
  const c = roastCard(pr, r, opts);
  const out: string[] = [];
  const bar = '█'.repeat(Math.round(r.score / 10)) + '░'.repeat(10 - Math.round(r.score / 10));
  out.push(`### 💈 buzzcut roast: [${c.ref}](${c.url})`);
  out.push('');
  out.push(`**Yap-o-meter** \`${bar}\` **${r.score}/100 (${r.grade})**, ${r.verdict}`);
  out.push('');
  out.push(`${MARK[c.basics.what.mark]} **What changed:** ${c.basics.what.text}  `);
  out.push(`${MARK[c.basics.why.mark]} **Why:** ${c.basics.why.text}`);
  out.push('');
  out.push(statLines(c).join(' '));
  out.push('');
  for (const b of c.burns) out.push(`- ${ICON[b.severity]} ${b.text}`);
  if (c.more) out.push(`- … and ${c.more} more`);
  if (c.keep?.sentences.length) {
    out.push('', `**Worth keeping** (the ${c.keep.words} words with facts in them):`, '');
    for (const s of c.keep.sentences) out.push(`> ${s}`);
  }
  out.push('', `**Verdict:** ${c.closer}`);
  out.push('');
  out.push('<sub>Roast any PR: `npx buzzcut roast <pr-url>`</sub>');
  return out.join('\n');
}

/** A link that opens a pre-filled post on X. Only the score and the PR link go in it. */
export function shareUrl(pr: PullRequest, r: Report): string {
  const s = statsOf(r);
  const what = r.diff ? `${n(s.words)} words for a ${n(s.lines)}-line diff` : `${n(s.words)} words`;
  const text = `This PR scored ${r.score}/100 on the yap-o-meter (${r.grade}, ${r.verdict.replace(/\.$/, '').toLowerCase()}): ${what}. 💈\n\nRoast any PR: npx buzzcut roast <pr-url>`;
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(pr.url)}`;
}

// ─── leaderboards: a repo's recent PRs, or your own commits ──────────────────

export interface BoardRow {
  /** "#123" or a short sha */
  id: string;
  title: string;
  report: Report;
}

export interface Board {
  /** what was roasted, e.g. "vercel/next.js · last 10 merged PRs" */
  subject: string;
  kind: 'pr' | 'commit';
  rows: BoardRow[];
  /** how to roast one of them */
  next: string;
}

export function boardSummary(b: Board) {
  const rows = [...b.rows].sort((x, y) => y.report.score - x.report.score);
  const avg = rows.length ? Math.round(rows.reduce((t, r) => t + r.report.score, 0) / rows.length) : 0;
  const words = rows.reduce((t, r) => t + r.report.words, 0);
  const over = rows.reduce((t, r) => t + Math.max(0, r.report.words - r.report.budget), 0);
  const lazy = rows.filter((r) => r.report.findings.some((f) => f.rule === 'subject-vague' || f.rule === 'empty-subject'));
  const withDiff = rows.filter((r) => r.report.diff && r.report.words > 0);
  const tightest = withDiff.length ? withDiff.reduce((a, c) => (c.report.diff!.changedLines / c.report.words > a.report.diff!.changedLines / a.report.words ? c : a)) : null;
  return { rows, avg, words, over, lazy, yappiest: rows[0] ?? null, tightest };
}

const lines = (r: Report) => r.diff?.changedLines ?? 0;
const changed = (k: number) => `${n(k)} changed line${k === 1 ? '' : 's'}`;
const failing = (rows: BoardRow[]) => rows.filter((r) => !passes(r.report, DEFAULTS.max)).length;

export function renderBoard(b: Board, opts: { color: boolean }): string {
  const p = palette(opts.color);
  const { rows, avg, words, over, lazy, yappiest, tightest } = boardSummary(b);
  const out: string[] = [''];
  out.push(...banner(p, '💈 THE BUZZCUT ROAST', b.subject), '');
  const { grade, verdict } = gradeOf(avg);
  out.push(...scoreBlock(p, { score: avg, grade, verdict }, p.dim('  average')), '');
  const unit = b.kind === 'pr' ? 'PR' : 'commit';
  const bad = failing(rows);
  const failLine = bad ? `${bad} of ${rows.length} ${unit === 'PR' ? 'PRs' : 'commits'} would be sent back to rewrite.` : `All ${rows.length} would pass.`;
  const idWidth = Math.max(...rows.map((r) => r.id.length), 4);
  for (const { id, title, report: r } of rows) {
    const g = gradePaint(p, r.grade);
    const w = `${n(r.words)}w`.padStart(6);
    const d = `${n(lines(r))}L`.padStart(6);
    const mark = passes(r, DEFAULTS.max) ? p.green('✓') : p.red('✗');
    out.push(`   ${mark} ${p.dim(id.padEnd(idWidth))}  ${g(String(r.score).padStart(3))} ${g(r.grade)}  ${w} ${p.dim(d)}  ${clip(title, WIDTH - idWidth - 27)}`);
  }
  out.push('');
  if (yappiest && yappiest.report.score > 10) {
    out.push(`   ${p.bold('Yappiest')}  ${yappiest.id}: ${n(yappiest.report.words)} words for ${changed(lines(yappiest.report))}.`);
  }
  if (tightest && tightest !== yappiest && tightest.report.score <= 10) {
    out.push(`   ${p.bold('Tightest')}  ${tightest.id}: ${n(tightest.report.words)} words for ${changed(lines(tightest.report))}. Respect.`);
  }
  if (lazy.length) {
    const examples = [...new Set(lazy.map((r) => `"${clip(r.title, 16)}"`))].slice(0, 3).join(', ');
    out.push(`   ${p.bold('Laziest ')}  ${lazy.length} ${unit}${lazy.length > 1 ? 's that say' : ' that says'} nothing: ${examples}.`);
  }
  if (over >= 100) {
    out.push(`   ${p.bold('Total   ')}  ${n(words)} words, ${n(over)} of them over budget.`);
  }
  out.push(`   ${p.bold('Verdict ')}  ${failLine}`);
  out.push('');
  out.push(`   ${p.dim(`Roast one ${unit}`)}  ${p.cyan(b.next)}`, '');
  return out.join('\n');
}

export function renderBoardMarkdown(b: Board): string {
  const { rows, avg, words, over, yappiest } = boardSummary(b);
  const { grade } = gradeOf(avg);
  const out = [`### 💈 buzzcut roast: ${b.subject}`, '', `**Average yap score ${avg}/100 (${grade})**`, ''];
  out.push(`| | ${b.kind === 'pr' ? 'PR' : 'Commit'} | Score | Words | Lines | Title |`, '|---|---|---|---|---|---|');
  for (const { id, title, report: r } of rows) out.push(`| ${passes(r, DEFAULTS.max) ? '✓' : '✗'} | ${id} | ${r.score} ${r.grade} | ${r.words} | ${lines(r)} | ${title.replace(/\|/g, '\\|')} |`);
  out.push('');
  if (yappiest && yappiest.report.score > 10) out.push(`Yappiest: ${yappiest.id}, ${yappiest.report.words} words for ${changed(lines(yappiest.report))}.`);
  if (over > 0) out.push(`${words} words in total, ${over} over budget.`);
  out.push('', '<sub>Roast yours: `npx buzzcut roast owner/repo`</sub>');
  return out.join('\n');
}

/** A pre-filled post on X for a leaderboard: the average and the repo, nothing else. */
export function boardShareUrl(b: Board): string {
  const { avg, yappiest } = boardSummary(b);
  const { grade } = gradeOf(avg);
  const worst = yappiest && yappiest.report.score > 10 ? ` Yappiest: ${n(yappiest.report.words)} words for ${changed(lines(yappiest.report))}.` : '';
  const text = `Roasted ${b.subject}: average yap score ${avg}/100 (${grade}).${worst} 💈\n\nRoast yours: npx buzzcut roast owner/repo`;
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;
}
