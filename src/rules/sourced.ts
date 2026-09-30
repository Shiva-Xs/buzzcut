// Rules that look up what a description says in what it can be checked against: the lines the
// change adds and removes, the rest of the repo, and what the session printed (see lookup.ts).
// A lookup confirms a thing exists, not that the sentence about it is true, so these catch what
// was made up, never what was got wrong. Every one stays silent without the evidence to judge.
import { claimsIn, factsIn, passedClaims, type Claim } from '../lookup.js';
import type { Finding, Severity } from '../types.js';
import type { Rule } from './rule.js';

/**
 * How hard each finding hits. A check sends a message back only when its false-alarm rate on
 * honest PRs was measured at 1% or less. On the held-out test half (212 PRs by people from before
 * AI coding tools) the name, file and "adds what it removes" checks together sent back 7 (3.3%),
 * so they ship as notes: an agent is shown them, nothing is blocked. To block on them anyway, set
 * `"rules": { "unsourced-name": "error" }` in .buzzcut.json.
 * `testCount` can't be measured on held-out PRs (they have no session): it fires only when a
 * transcript shows a count no run printed, and it is covered by unit tests, not by the benchmark.
 */
export const LEVELS: Record<'nameNowhere' | 'fileNowhere' | 'nameWeak' | 'addedButRemoved' | 'existsUntouched' | 'fact' | 'testCount', Severity> = {
  nameNowhere: 'warn',
  fileNowhere: 'warn',
  nameWeak: 'warn',
  addedButRemoved: 'warn',
  existsUntouched: 'info',
  fact: 'warn',
  testCount: 'error',
};

/** The rules that look something up. Their notes are shown to an agent and in CI even when the message passes. */
export const LOOKUP_RULES = new Set(['unsourced-name', 'unsourced-fact', 'unmentioned-area']);
/** True for a finding worth showing although nothing blocks: a lookup rule's warning or error. */
export const isLookupNote = (f: Finding) => LOOKUP_RULES.has(f.rule) && f.severity !== 'info';

/** "`a`, `b`, `c` and 2 more" */
function list(items: string[], max = 3): string {
  const shown = items.slice(0, max).map((s) => `\`${s}\``);
  return shown.join(', ') + (items.length > max ? ` and ${items.length - max} more` : '');
}

const first = (cs: Claim[]) => cs.find((c) => c.line !== undefined)?.line;

export const unsourcedName: Rule = {
  id: 'unsourced-name',
  kinds: ['commit', 'pr'],
  needsDiff: true,
  run(ctx) {
    const r = ctx.resolver;
    if (!r || !r.diffKnown) return null;
    const claims = claimsIn(ctx.msg.title, ctx.text.lines);
    if (!claims.length) return null;
    r.prime(claims.filter((c) => c.kind === 'name').map((c) => c.text));

    const madeUp: Claim[] = []; // says the change adds or touches it; it is nowhere
    const madeUpFile: Claim[] = [];
    const unsure: Claim[] = []; // mentioned, nowhere
    const addedButRemoved: Claim[] = [];
    const exists: Claim[] = []; // "adds X" but X is already there and the diff doesn't touch it
    for (const c of claims) {
      if (c.kind === 'name') {
        const w = r.where(c.text);
        if (c.plain) {
          // Whole-word, since `give` is in "given": only the diff's own removal of it makes "adds it" false.
          if (r.whereWord(c.text) === 'removed') addedButRemoved.push(c);
          continue;
        }
        // A name the change adds or touches that is nowhere is made up. With a session to look in,
        // even one only mentioned is: an agent that really read it about a dependency has it there.
        if (w === 'nowhere') (c.adds || c.touches || r.sessionKnown ? madeUp : unsure).push(c);
        else if (w === 'removed' && c.uses) addedButRemoved.push(c);
        else if (w === 'repo' && c.adds) exists.push(c);
      } else {
        const f = r.file(c.text);
        if (f === 'nowhere') (c.adds || c.touches ? madeUpFile : unsure).push(c);
        else if (f === 'repo' && c.adds) exists.push(c);
        else if (f === 'diff' && c.uses) {
          // "Adds `notes.md`" when the diff only deletes it
          const st = r.fileStat(c.text);
          if (st && st.additions === 0 && st.deletions > 0) addedButRemoved.push(c);
        }
      }
    }

    const out: Finding[] = [];
    const sure = [...madeUp, ...madeUpFile];
    if (sure.length) {
      const errors = sure.some((c) => (c.kind === 'name' ? LEVELS.nameNowhere : LEVELS.fileNowhere) === 'error');
      out.push({
        rule: 'unsourced-name',
        severity: errors ? 'error' : 'warn',
        points: Math.min(24, (errors ? 20 : 6) + 4 * (sure.length - 1)),
        message: `Says the change adds or touches ${list(sure.map((c) => c.text))}, but ${sure.length > 1 ? "they aren't" : "it isn't"} in the diff or anywhere in the repo`,
        hint: 'Use the name the diff really has (check the spelling against it) or drop the sentence. If it comes from outside this repo, say where.',
        line: first(sure),
        quote: sure[0]!.text,
        data: { count: sure.length, names: sure.map((c) => c.text).join(', ') },
      });
    }
    if (unsure.length) {
      out.push({
        rule: 'unsourced-name',
        severity: LEVELS.nameWeak,
        points: Math.min(12, 4 * unsure.length),
        message: `${list(unsure.map((c) => c.text))} ${unsure.length > 1 ? "aren't" : "isn't"} in the diff or anywhere in the repo`,
        hint: "Check the spelling against the diff. If it's from a dependency or another repo, say so.",
        line: first(unsure),
        quote: unsure[0]!.text,
        data: { count: unsure.length, names: unsure.map((c) => c.text).join(', ') },
      });
    }
    if (addedButRemoved.length) {
      out.push({
        rule: 'unsourced-name',
        severity: LEVELS.addedButRemoved,
        points: 8,
        message: `Says the change adds ${list(addedButRemoved.map((c) => c.text))}, but the diff only removes ${addedButRemoved.length > 1 ? 'them' : 'it'}`,
        hint: 'Say what the change does to it: removes, replaces or renames.',
        line: first(addedButRemoved),
        quote: addedButRemoved[0]!.text,
        data: { count: addedButRemoved.length, names: addedButRemoved.map((c) => c.text).join(', ') },
      });
    }
    if (exists.length) {
      out.push({
        rule: 'unsourced-name',
        severity: LEVELS.existsUntouched,
        points: 2,
        message: `${list(exists.map((c) => c.text))} already exist${exists.length > 1 ? '' : 's'} and this diff doesn't touch ${exists.length > 1 ? 'them' : 'it'}`,
        hint: 'If the change only uses it, say "uses", not "adds".',
        line: first(exists),
        quote: exists[0]!.text,
        data: { count: exists.length, names: exists.map((c) => c.text).join(', ') },
      });
    }
    return out.length ? out : null;
  },
};

export const unsourcedFact: Rule = {
  id: 'unsourced-fact',
  kinds: ['commit', 'pr'],
  run(ctx) {
    const r = ctx.resolver;
    // Only where there is a session to look in: a figure can come from a dashboard, an issue or
    // the user, and the transcript is the one place buzzcut can tell it was given.
    if (!r || !r.sessionKnown) return null;
    const missing = factsIn(ctx.text.lines).filter((f) => r.hasFact(f.text) === false);
    if (!missing.length) return null;
    return {
      rule: 'unsourced-fact',
      severity: LEVELS.fact,
      points: Math.min(15, 5 * missing.length),
      message: `${list(missing.map((f) => f.text))} ${missing.length > 1 ? "aren't" : "isn't"} in the diff, in anything a command printed, or in what the user wrote`,
      hint: 'Say where it comes from (a command you ran, an issue, what the user told you) or leave it out. Never write a figure you did not see.',
      line: missing[0]!.line,
      quote: missing[0]!.text,
      data: { count: missing.length, facts: missing.map((f) => f.text).join(', ') },
    };
  },
};

export const testCountMismatch: Rule = {
  id: 'test-count-mismatch',
  kinds: ['commit', 'pr'],
  run(ctx) {
    const s = ctx.session;
    // Needs the runs' output; without it "no test ran" (unverified-in-session) is the whole check.
    if (!s?.hasOutput || !s.tests.length || !s.testCounts?.length) return null;
    const printed = new Set(s.testCounts.slice(0, 300));
    // A description may add two runs together ("100 + 114").
    const sums = new Set<number>();
    const arr = [...printed];
    for (let i = 0; i < arr.length; i++) for (let j = i; j < arr.length; j++) sums.add(arr[i]! + arr[j]!);
    const wrong = passedClaims(ctx.msg.title, ctx.text.lines).filter((c) => !printed.has(c.n) && !sums.has(c.n));
    if (!wrong.length) return null;
    const seen = [...printed].filter((n) => n >= 5).sort((a, b) => b - a).slice(0, 4);
    return {
      rule: 'test-count-mismatch',
      severity: LEVELS.testCount,
      points: 20,
      message: `Says "${wrong[0]!.text}", but no test run in this session printed ${wrong[0]!.n}`,
      hint: `Quote what the run actually printed${seen.length ? ` (the runs here printed counts like ${seen.join(', ')})` : ''}, or run the tests again and copy the result.`,
      line: wrong[0]!.line,
      quote: wrong[0]!.text,
      data: { claimed: wrong[0]!.n },
    };
  },
};

export const sourcedRules = [unsourcedName, unsourcedFact, testCountMismatch];
