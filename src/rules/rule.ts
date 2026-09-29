import type { Length } from '../config.js';
import type { StyleProfile } from '../style.js';
import type { TextFacts, Line } from '../text.js';
import type { DiffFacts, Finding, Kind, Message } from '../types.js';

export interface Context {
  msg: Message;
  diff: DiffFacts | null;
  text: TextFacts;
  /** word budget for the body */
  budget: number;
  /** specific details (numbers, code references, paths, links) per 100 prose words */
  density: number;
  /** the repo's `length` setting, already applied to `budget` */
  length: Length;
  /** how this repo writes commits, when there's enough history to tell */
  style: StyleProfile | null;
  /** what the agent actually ran this session, when its transcript is available */
  session: SessionFacts | null;
  /** the evidence in the previous draft of this message, when buzzcut checked one */
  previous: PreviousDraft | null;
}

export interface PreviousDraft {
  evidence: string[];
  /** a hook sends the draft back (error) instead of advising (warning) */
  strict: boolean;
}

export interface SessionFacts {
  /** test-runner commands the agent ran */
  tests: string[];
  /** commands that ran or tried the code (tests included), as opposed to git/reading files */
  exercised: string[];
  /** what the commands printed and what the user wrote: where a number or a name in the text may have come from */
  text?: string;
  /** the transcript carried command output, so something missing from `text` really wasn't printed */
  hasOutput?: boolean;
  /** the numbers test runs printed next to a test or pass/fail word: "Tests: 212 passed" gives 212 */
  testCounts?: number[];
}

export interface Rule {
  id: string;
  kinds: Kind[];
  /** skip the rule when there is no diff to compare against */
  needsDiff?: boolean;
  run(ctx: Context): Finding | Finding[] | null;
}

export interface Hit {
  line: Line;
  match: string;
}

/** First match of `re` on each line. */
export function hits(lines: Line[], re: RegExp, skip?: (line: Line) => boolean): Hit[] {
  const out: Hit[] = [];
  for (const line of lines) {
    if (skip?.(line)) continue;
    const m = line.text.match(re);
    if (m) out.push({ line, match: m[0] });
  }
  return out;
}

/** The title plus the body's prose lines. The title gets line 1 for commits and no line for PRs. */
export function titleAndBody(ctx: Context): Line[] {
  const title = { n: ctx.msg.kind === 'commit' ? 1 : 0, text: ctx.msg.title };
  return [title, ...ctx.text.lines];
}

export const lineOf = (l: Line): number | undefined => (l.n > 0 ? l.n : undefined);

const CONVENTIONAL = /^(\w+)(\([^)]*\))?(!)?:\s*/;
const TICKET = /^\[?[A-Z][A-Z0-9]+-\d+\]?:?\s*/;

export function conventionalType(title: string): string | null {
  return title.match(CONVENTIONAL)?.[1]?.toLowerCase() ?? null;
}

/** The subject without `feat(scope):` or `ABC-123:` prefixes. */
export function subjectCore(title: string): string {
  return title.replace(TICKET, '').replace(CONVENTIONAL, '').replace(TICKET, '').trim();
}
