import { DEFAULT_IGNORE } from './config.js';
import { git } from './git.js';
import { isVague } from './vague.js';
import { verbForm } from './verbs.js';

/** How this repo writes commit subjects, learned from its history. */
export interface StyleProfile {
  /** commits the profile was built from */
  sample: number;
  /** share of subjects with a conventional prefix (`fix:`, `feat(api):`) */
  conventional: number;
  /** conventional types in use, most common first */
  types: string[];
  /** share of subjects that start with a ticket id (`PAY-123`) */
  ticket: number;
  ticketExample: string | null;
  /** share of subjects whose first letter (after any prefix) is uppercase */
  capitalized: number;
  subjectP50: number;
  subjectP90: number;
  /** share of commits with a body */
  body: number;
  /**
   * How subjects that open with a verb conjugate it: "imperative" (Add), "past" (Added),
   * or null when the history is mixed or too few subjects start with a known verb.
   */
  mood: 'imperative' | 'past' | null;
  /** a few recent subjects, for an agent to imitate */
  examples: string[];
}

export interface CommitText {
  subject: string;
  body: string;
}

const CONVENTIONAL = /^(\w+)(\([^)]*\))?!?:\s/;
const TICKET = /^\[?([A-Z][A-Z0-9]+-\d+)\]?/;
const MIN_SAMPLE = 10;

function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
}

function core(subject: string): string {
  return subject.replace(TICKET, '').replace(/^:?\s*/, '').replace(CONVENTIONAL, '').replace(TICKET, '').replace(/^:?\s*/, '');
}

export function profileFrom(commits: CommitText[]): StyleProfile | null {
  const own = commits.filter((c) => c.subject && !DEFAULT_IGNORE.some((re) => re.test(c.subject)));
  if (own.length < MIN_SAMPLE) return null;
  const n = own.length;
  const types = new Map<string, number>();
  let conventional = 0;
  let ticket = 0;
  let ticketExample: string | null = null;
  let letters = 0;
  let upper = 0;
  let body = 0;
  const moods = { imperative: 0, past: 0, other: 0 };
  for (const c of own) {
    const conv = c.subject.match(CONVENTIONAL);
    if (conv) {
      conventional++;
      const t = conv[1]!.toLowerCase();
      types.set(t, (types.get(t) ?? 0) + 1);
    }
    const tk = c.subject.match(TICKET);
    if (tk) {
      ticket++;
      ticketExample ??= tk[1]!;
    }
    const first = core(c.subject)[0];
    if (first && /\p{L}/u.test(first)) {
      letters++;
      if (first !== first.toLowerCase()) upper++;
    }
    if (c.body.trim()) body++;
    const verb = core(c.subject).match(/^[A-Za-z]+/)?.[0];
    const form = verb ? verbForm(verb) : null;
    if (form) moods[form]++;
  }
  const verbLed = moods.imperative + moods.past + moods.other;
  const mood = verbLed < 5 ? null : moods.past / verbLed >= 0.6 ? 'past' : moods.imperative / verbLed >= 0.6 ? 'imperative' : null;
  const lengths = own.map((c) => [...c.subject].length);
  return {
    sample: n,
    conventional: conventional / n,
    types: [...types.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t),
    ticket: ticket / n,
    ticketExample,
    capitalized: letters ? upper / letters : 0.5,
    subjectP50: percentile(lengths, 0.5),
    subjectP90: percentile(lengths, 0.9),
    body: body / n,
    mood,
    // Only subjects worth imitating: a history full of "wip" shouldn't teach an agent "wip".
    examples: own
      .filter((c) => [...c.subject].length <= 72 && !isVague(core(c.subject)))
      .slice(0, 5)
      .map((c) => c.subject),
  };
}

/** Profile of the last 200 non-merge commits, or null for a young or shallow repo. */
export function repoStyle(cwd?: string): StyleProfile | null {
  const out = git(['log', '-n', '200', '--no-merges', '--format=%s%x1f%b%x1e'], cwd);
  if (!out) return null;
  const commits = out
    .split('\x1e')
    .map((r) => r.replace(/^\n/, ''))
    .filter(Boolean)
    .map((r) => {
      const [subject = '', body = ''] = r.split('\x1f');
      return { subject: subject.trim(), body };
    });
  return profileFrom(commits);
}

export { CONVENTIONAL, TICKET };
