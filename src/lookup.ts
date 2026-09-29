// Looks up what a description says in what it can be checked against: the lines the change adds
// and removes, the rest of the repo, and what a session's commands printed and its user wrote.
// It answers "does this exist?", never "is this sentence true?". `X` appearing in the diff
// doesn't make "retries X times" right; a name that appears nowhere is almost certainly made up.
//
// It never judges from evidence it doesn't have: no patch text, no checkout, no transcript
// means "unknown", and an unknown is silent.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { changedText } from './diff.js';
import type { SessionFacts } from './rules/rule.js';
import { SPECIFIC, type Line } from './text.js';
import type { DiffFacts } from './types.js';

/** Where a name in the text was found. `nowhere` needs a searchable diff and a repo search; without them it is `unknown`. */
export type Where = 'added' | 'removed' | 'session' | 'repo' | 'nowhere' | 'unknown';

export interface RepoSearch {
  /** Which of these names the repo mentions, spelled loosely; null when it couldn't be searched. */
  find(names: string[]): Set<string> | null;
  /** Whether a file exists at this repo-relative path; null when that can't be checked. */
  hasFile(path: string): boolean | null;
}

// ─── names ───────────────────────────────────────────────────────────────────

/** "Idempotency-Key", "idempotency_key", "idempotencyKey()" and "IDEMPOTENCY_KEY" are one name. */
export function norm(name: string): string {
  return name.toLowerCase().replace(/\(\)$/, '').replace(/[-_.\s]/g, '');
}

/** Text with the separators names differ by taken out, so a normalized name can be looked for in it. */
const flat = (s: string) => s.toLowerCase().replace(/[-_.]/g, '');

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The words of a name: camelCase and separators split, so `retryPolicy` and `retry_policy` share them. */
function words(name: string): string[] {
  return name
    .replace(/\(\)$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[-_.\s]+/)
    .filter(Boolean);
}

/** An extended regex for a name, spelled any way: retry[-_.]?policy. */
export function looseRegex(name: string): string {
  return words(name).map(escapeRe).join('[-_.]?');
}

// Words that are code-shaped but aren't the project's own, and brand names with an inner capital.
const NOT_A_NAME = new Set(
  'json http https url uri api cli todo readme license changelog javascript typescript github gitlab linkedin youtube postgresql mongodb graphql openapi oauth iphone ipad imac ios macos tvos watchos icloud ebay webos jquery grpc mtls npm pnpm nodejs devops nextjs nuxtjs vuejs reactjs openai chatgpt vscode'.split(' '),
);

const EXT = 'js|mjs|cjs|ts|tsx|jsx|py|go|rs|java|kt|rb|php|html|css|scss|json|ya?ml|toml|md|txt|sh|sql|xml|lock|conf|ini|c|h|cc|cpp|hpp|cs|swift|vue|svelte';
const PATH = new RegExp(String.raw`^(?:\.\/)?(?:[\w@.-]+\/)+[\w@.-]+\.(?:${EXT})$`);
const DOMAINY = /(?:^|\/)[\w-]+\.(?:com|io|org|net|dev|app|co|ai)(?:\/|$)/;
const FILENAME = new RegExp(String.raw`^[\w.-]+\.(?:${EXT})$`);

/** A relative path with a directory and a known extension, or null. URLs, absolute paths and vendored folders don't count. */
export function pathOf(s: string): string | null {
  const t = s.trim();
  if (!PATH.test(t) || t.startsWith('/') || t.startsWith('~') || t.includes('..') || DOMAINY.test(t) || /(^|\/)node_modules\//.test(t)) return null;
  return t.replace(/^\.\//, '');
}

/** True for a name that looks like code: a hump, an underscore, a call, a dotted chain or a Header-Name. */
export function codeShaped(s: string): boolean {
  const t = s.replace(/\(\)$/, '');
  if (!/^[A-Za-z_$][\w$]*(?:[.-][A-Za-z_$][\w$]*)*$/.test(t) || FILENAME.test(t)) return false;
  if (norm(t).length < 6 || NOT_A_NAME.has(norm(t))) return false;
  const camel = /[a-z0-9][A-Z]/.test(t);
  const snake = /[A-Za-z0-9]_[A-Za-z0-9]/.test(t);
  const screaming = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(t);
  const header = /^[A-Z][A-Za-z0-9]*(?:-[A-Z][A-Za-z0-9]*)+$/.test(t);
  const dotted = t.includes('.') && !t.includes('-') && t.split('.').every((p) => p.length >= 2);
  return camel || snake || screaming || header || dotted || s.endsWith('()');
}

// ─── claims: names and files a description says about the change ─────────────

export interface Claim {
  kind: 'name' | 'file';
  /** as written, without backticks */
  text: string;
  line?: number;
  backticked: boolean;
  /** the closest verb before it says this change adds or creates it */
  adds: boolean;
  /** …says it removes it */
  removes: boolean;
  /** …says the change uses, calls or changes it (something that has to exist) */
  touches: boolean;
}

const ADD_VERB = String.raw`add(?:s|ed|ing)?|introduc(?:e|es|ed|ing)|creat(?:e|es|ed|ing)|implement(?:s|ed|ing)?|expos(?:e|es|ed|ing)|defin(?:e|es|ed|ing)|export(?:s|ed|ing)?|emit(?:s|ted)?|attach(?:es|ed)?|new`;
const REMOVE_VERB = String.raw`remov(?:e|es|ed|ing)|delet(?:e|es|ed|ing)|drop(?:s|ped)?|deprecat(?:e|es|ed)|strip(?:s|ped)?|get(?:s)? rid of|no longer`;
const TOUCH_VERB = String.raw`us(?:e|es|ed|ing)|call(?:s|ed|ing)?|updat(?:e|es|ed|ing)|chang(?:e|es|ed|ing)|modif(?:y|ies|ied)|renam(?:e|es|ed)|replac(?:e|es|ed)|wrap(?:s|ped)?|extend(?:s|ed)?|switch(?:es|ed)?|mov(?:e|es|ed)|handl(?:e|es|ed)|read(?:s)?|writ(?:e|es)|set(?:s)?|send(?:s)?|return(?:s|ed)?|pass(?:es|ed)?|check(?:s|ed)?|fix(?:es|ed)?`;
const VERBS = new RegExp(String.raw`\b(?:(${ADD_VERB})|(${REMOVE_VERB})|(${TOUCH_VERB}))\b`, 'gi');
// A sentence that is about something else: "add it back", an example, a plan, or code that was already there.
const NOT_ABOUT_THIS_CHANGE =
  /\b(?:(?:add|adds|added|put|puts|bring|brings|brought)\b[^.;]{0,25}\b(?:back|again)|re-?add\w*|restor\w*|revert\w*|e\.g\.|such as|for example|instead of|rather than|unlike|existing|already|pre-?existing|currently|previously|should|would|could|might|consider|todo|follow[- ]?up|later|not|no|without|n\/a|pending)\b|n't\b/i;
const TESTED_LINE = /^\s*(?:[-*+]\s+)?(?:\*\*)?(?:not tested|tested|verified|ran)\b/i;

/** The verb closest before `at` in the sentence: what the sentence says the change does to the name. */
function verbBefore(sentence: string, at: number): 'add' | 'remove' | 'touch' | null {
  let last: 'add' | 'remove' | 'touch' | null = null;
  for (const m of sentence.slice(Math.max(0, at - 90), at).matchAll(VERBS)) last = m[1] ? 'add' : m[2] ? 'remove' : 'touch';
  return last;
}

const PLAIN_NAMES = [
  String.raw`\b[A-Za-z_][\w.]*\(\)`, // send(), Ledger.post()
  String.raw`\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b`, // max_order_usd
  String.raw`\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b`, // MAX_RETRIES
  String.raw`\b[a-z]+(?:[A-Z][a-z0-9]*)+\b`, // retryPolicy
  String.raw`\bX-[A-Z][A-Za-z0-9]*(?:-[A-Z][A-Za-z0-9]*)*\b`, // X-Retry-After
];
const PLAIN_NAME = new RegExp(PLAIN_NAMES.join('|'), 'g');
// "an Idempotency-Key header": a hyphenated name right before the word header is a header name.
const HEADER_IN_PROSE = /\b([A-Z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+|[a-z][a-z0-9]*(?:-[a-z0-9]+)+)\s+(?:HTTP\s+)?headers?\b/g;
// Headers HTTP itself defines: a change can set them without the name appearing anywhere in the repo.
const STANDARD_HEADERS = new Set(
  'contenttype contentlength contentencoding contentdisposition contentlanguage authorization proxyauthorization wwwauthenticate accept acceptencoding acceptlanguage acceptcharset useragent cachecontrol etag ifnonematch ifmodifiedsince lastmodified location setcookie cookie host origin referer retryafter forwarded xforwardedfor xforwardedproto xrequestedwith accesscontrolalloworigin accesscontrolallowheaders accesscontrolallowmethods strictransportsecurity stricttransportsecurity contentsecuritypolicy xframeoptions xcontenttypeoptions vary connection keepalive upgrade range acceptranges date server allow expires pragma link'.split(' '),
);
const PLAIN_PATH = new RegExp(String.raw`(?<![\w/.:~-])(?:[\w@.-]+/)+[\w@.-]+\.(?:${EXT})(?![\w/-])`, 'g');

const sentencesOf = (text: string) => text.split(/(?<=[.!?;])\s+(?=[A-Z0-9`"'(])/);

/**
 * The code names and file paths a description says something about, with what its sentence says
 * the change does to each. Test claims, quoted lines and sentences about other things are skipped.
 */
export function claimsIn(title: string, lines: Line[], max = 30): Claim[] {
  const out: Claim[] = [];
  const seen = new Set<string>();
  const push = (c: Claim) => {
    const key = `${c.kind}:${c.kind === 'name' ? norm(c.text) : c.text}`;
    if (seen.has(key) || out.length >= max) return;
    seen.add(key);
    out.push(c);
  };
  const scan = (raw: string, n: number | undefined) => {
    if (!raw.trim() || /^\s*>/.test(raw) || TESTED_LINE.test(raw)) return;
    for (const sentence of sentencesOf(raw.replace(/^\s*(?:[-*+•]|\d{1,2}[.)])\s+/, ''))) {
      if (NOT_ABOUT_THIS_CHANGE.test(sentence) || TESTED_LINE.test(sentence)) continue;
      const spans: { text: string; at: number; backticked: boolean; header?: boolean }[] = [];
      for (const m of sentence.matchAll(/`([^`\n]+)`/g)) spans.push({ text: m[1]!.trim(), at: m.index!, backticked: true });
      const bare = sentence.replace(/`[^`\n]*`/g, (s) => ' '.repeat(s.length));
      for (const m of bare.matchAll(PLAIN_PATH)) spans.push({ text: m[0], at: m.index!, backticked: false });
      for (const m of bare.matchAll(PLAIN_NAME)) spans.push({ text: m[0], at: m.index!, backticked: false });
      for (const m of bare.matchAll(HEADER_IN_PROSE)) spans.push({ text: m[1]!, at: m.index!, backticked: false, header: true });
      for (const s of spans) {
        const verb = verbBefore(sentence, s.at);
        const flags = { line: n, backticked: s.backticked, adds: verb === 'add', removes: verb === 'remove', touches: verb === 'touch' };
        const path = pathOf(s.text);
        if (path) push({ kind: 'file', text: path, ...flags });
        else if (s.header) {
          if (norm(s.text).length >= 6 && !STANDARD_HEADERS.has(norm(s.text))) push({ kind: 'name', text: s.text, ...flags });
        } else if (codeShaped(s.text) && !STANDARD_HEADERS.has(norm(s.text))) push({ kind: 'name', text: s.text.replace(/\(\)$/, ''), ...flags });
      }
    }
  };
  scan(title, undefined);
  for (const l of lines) scan(l.text, l.n > 0 ? l.n : undefined);
  return out;
}

// ─── numbers and references ──────────────────────────────────────────────────

export interface FactClaim {
  /** as written: "2.1%", "#4121" */
  text: string;
  line?: number;
}

// A figure with a unit, or an issue reference: what a reader takes as measured or looked up.
const FACT = new RegExp(
  [
    String.raw`(?<![\w.#])\d+(?:[.,]\d+)?\s?(?:%|ms|µs|s|sec|secs|seconds|minutes?|min|x|×|kb|mb|gb|rps|qps|req\/s)(?![\w])`,
    String.raw`(?<![\w/&])#\d{2,}\b`,
    // an HTTP status code, when a word before it says it is one: "returns 502", "status 429", "on a 503"
    String.raw`(?<=\b(?:status|http|code|returns?|returned|responds?|responded|responses?|errors?|retry|retries|retried|on an?)\s+(?:code\s+|status\s+)?)(?:100|101|20[0-6]|30[1-4]|307|308|4(?:0[0-9]|1[0-8]|2[2-4]|26|28|29|31)|451|50[0-8]|511)(?=xx|s?\b)`,
  ].join('|'),
  'gi',
);

const HTTP_CODE = /(?<![\w.#/])(?:100|101|20[0-6]|30[1-4]|307|308|4(?:0[0-9]|1[0-8]|2[2-4]|26|28|29|31)|451|50[0-8]|511)(?=xx|s?(?![\w.]))/g;
// A line that is about HTTP: a listed status code anywhere in it is one.
const HTTP_CUE = /\b(?:[1-5]xx|status|http|responses?|error codes?|status codes?)\b/i;

/** Measured figures and issue references in the prose, leaving out tested lines (test counts have their own check). */
export function factsIn(lines: Line[], max = 12): FactClaim[] {
  const out: FactClaim[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    if (!l.text.trim() || /^\s*>/.test(l.text) || TESTED_LINE.test(l.text)) continue;
    const prose = l.text.replace(/`[^`\n]*`/g, ' ');
    const found = [...prose.matchAll(FACT)].map((m) => m[0].trim());
    if (HTTP_CUE.test(prose)) found.push(...[...prose.matchAll(HTTP_CODE)].map((m) => m[0]));
    for (const text of found) {
      if (seen.has(text) || out.length >= max) continue;
      seen.add(text);
      out.push({ text, line: l.n > 0 ? l.n : undefined });
    }
  }
  return out;
}

const PASSED = /(?<![\w.])(\d[\d,]*)\s+(?:tests?\s+|specs?\s+)?(?:passed|passing|pass|green)\b|\ball\s+(\d[\d,]*)\s+(?:tests?|specs?)\b/gi;

/** "212 passed", "all 48 tests": the counts a description says came out passing. */
export function passedClaims(title: string, lines: Line[]): { n: number; text: string; line?: number }[] {
  const out: { n: number; text: string; line?: number }[] = [];
  for (const [text, line] of [[title, undefined] as const, ...lines.map((l) => [l.text, l.n > 0 ? l.n : undefined] as const)]) {
    if (/^\s*>/.test(text)) continue;
    for (const m of text.matchAll(PASSED)) {
      const n = Number((m[1] ?? m[2])!.replace(/,/g, ''));
      if (Number.isSafeInteger(n)) out.push({ n, text: m[0].trim(), line });
    }
  }
  return out;
}

// ─── the repo ────────────────────────────────────────────────────────────────

const EXCLUDE = [':(exclude,glob)**/node_modules/**', ':(exclude,glob)**/dist/**', ':(exclude,glob)**/*.min.*', ':(exclude,glob)**/*.map', ':(exclude,glob)**/package-lock.json', ':(exclude,glob)**/*.lock'];

/**
 * Searches the tracked files with `git grep`, one call for every name, spelled loosely. Untracked
 * files are left out on purpose: one a command is about to commit is already in the diff, and any
 * other is scratch, like the very file the description was written in, which must not vouch for
 * its own names. It is the slow part, so it runs only for names the diff and the session didn't
 * already contain, and gives up after two seconds.
 */
export function gitRepoSearch(cwd: string): RepoSearch {
  // Found on first use: most hook calls never need to look anything up.
  let root: string | null | undefined;
  const toplevel = (): string | null => {
    if (root === undefined) {
      try {
        root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
      } catch {
        root = null;
      }
    }
    return root;
  };
  return {
    find(names) {
      if (!names.length) return new Set();
      const top = toplevel();
      if (!top) return null;
      const args = ['-C', top, 'grep', '-h', '-o', '-i', '-I', '-E', '--no-color'];
      for (const n of names) args.push('-e', looseRegex(n));
      args.push('--', '.', ...EXCLUDE);
      let out = '';
      try {
        out = execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 8 * 1024 * 1024, timeout: 2000 });
      } catch (e) {
        const err = e as { status?: number; code?: string };
        if (err.code === 'ENOBUFS') return new Set(names); // so many matches that every name is plainly there
        if (err.status === 1) return new Set(); // git grep's "no match"
        return null; // a timeout or an error: we don't know
      }
      const printed = new Set(out.split('\n').map((l) => norm(l)));
      return new Set(names.filter((n) => printed.has(norm(n))));
    },
    hasFile(path) {
      const top = toplevel();
      return top ? existsSync(join(top, path)) : null;
    },
  };
}

// ─── the resolver ────────────────────────────────────────────────────────────

export interface Resolver {
  /** Look up all these names in one repo search, so `where` can answer for each. */
  prime(names: string[]): void;
  where(name: string): Where;
  file(path: string): 'diff' | 'repo' | 'nowhere' | 'unknown';
  /** Whether a figure, link or reference appears in the change or the session; null when there is no session to look in. */
  hasFact(text: string): boolean | null;
  /** The diff carries every changed line, so a name missing from it is missing from the change. */
  readonly diffKnown: boolean;
  /** The session's transcript carried command output and the user's messages. */
  readonly sessionKnown: boolean;
}

interface Sources {
  diff: DiffFacts | null;
  session?: SessionFacts | null;
  repo?: RepoSearch | null;
}

const flatCache = new WeakMap<object, { added: string; removed: string }>();
const flatSession = new WeakMap<SessionFacts, string>();

/** A resolver over the evidence there is, or null when there is none (nothing would ever be judged). */
export function makeResolver(s: Sources): Resolver | null {
  const diff = s.diff && s.diff.searchable ? s.diff : null;
  const session = s.session?.hasOutput && s.session.text ? s.session : null;
  if (!diff && !session) return null;

  let changed = { added: '', removed: '' };
  if (diff) {
    let hit = flatCache.get(diff);
    if (!hit) {
      const c = changedText(diff);
      hit = { added: flat(c.added), removed: flat(c.removed) };
      flatCache.set(diff, hit);
    }
    changed = hit;
  }
  let sessionFlat = '';
  if (session) {
    sessionFlat = flatSession.get(session) ?? flat(session.text!);
    flatSession.set(session, sessionFlat);
  }
  let rawText: string | null = null;
  const raw = () => {
    if (rawText === null) {
      const c = diff ? changedText(diff) : { added: '', removed: '' };
      rawText = `${c.added}\n${c.removed}\n${session?.text ?? ''}`.toLowerCase();
    }
    return rawText;
  };

  const inRepo = new Map<string, boolean | null>();
  const local = (n: string): Where | null => {
    if (diff && changed.added.includes(n)) return 'added';
    if (diff && changed.removed.includes(n)) return 'removed';
    if (session && sessionFlat.includes(n)) return 'session';
    return null;
  };

  return {
    diffKnown: Boolean(diff),
    sessionKnown: Boolean(session),
    prime(names) {
      if (!s.repo) return;
      const todo = [...new Set(names)].filter((n) => !inRepo.has(n) && !local(norm(n)));
      if (!todo.length) return;
      const found = s.repo.find(todo);
      for (const n of todo) inRepo.set(n, found ? found.has(n) : null);
    },
    where(name) {
      const n = norm(name);
      const here = local(n);
      if (here) return here;
      // a dotted name (`Ledger.post`) counts when each of its parts is somewhere
      if (name.includes('.')) {
        const parts = name.split('.').filter((p) => norm(p).length >= 3);
        if (parts.length > 1 && parts.every((p) => local(norm(p)) || inRepo.get(p) === true)) return 'repo';
      }
      const r = inRepo.get(name);
      if (r === true) return 'repo';
      if (r === false && diff) return 'nowhere';
      return 'unknown';
    },
    file(path) {
      if (!diff) return 'unknown';
      const base = path.split('/').pop()!;
      for (const f of diff.files) if (f.path === path || f.path.endsWith('/' + path) || path.endsWith('/' + f.path) || (f.renamed && f.path.split('/').pop() === base)) return 'diff';
      const has = s.repo?.hasFile(path);
      if (has === true) return 'repo';
      if (has === false) return 'nowhere';
      return 'unknown';
    },
    hasFact(text) {
      if (!session) return null;
      const text2 = raw();
      const num = text.match(/^#?(\d+(?:[.,]\d+)?)/)?.[1];
      if (text.startsWith('#')) return new RegExp(String.raw`#${num}(?!\d)`).test(text2) || new RegExp(String.raw`(?:issues|pull)/${num}(?!\d)`).test(text2);
      if (!num) return text2.includes(text.toLowerCase());
      return new RegExp(String.raw`(?<![\d.,])${escapeRe(num)}(?![\d]|[.,]\d)`).test(text2);
    },
  };
}

// ─── a budget that only specifics it can find earn ───────────────────────────

/** What a SPECIFIC match is, for deciding whether it can be checked. */
function kindOf(m: RegExpMatchArray): { kind: 'name' | 'file' | 'fact' | 'other'; value: string } {
  const code = m[1];
  if (code !== undefined) {
    const path = pathOf(code);
    if (path) return { kind: 'file', value: path };
    if (codeShaped(code)) return { kind: 'name', value: code.replace(/\(\)$/, '') };
    return { kind: 'other', value: code };
  }
  const t = m[0].trim();
  if (/^https?:/.test(t) || /^#\d/.test(t) || /^[A-Z][A-Z0-9]+-\d+$/.test(t)) return { kind: 'fact', value: t };
  // A figure with a unit, a decimal, or three digits or more is a measurement worth checking; "5 bullets" isn't.
  if (/^\d/.test(t)) return /[%a-zµ×]|[.,]\d|^\d{3,}/i.test(t.replace(/\s/g, '')) ? { kind: 'fact', value: t } : { kind: 'other', value: t };
  if (m[2] !== undefined) {
    const path = pathOf(m[2]);
    return path ? { kind: 'file', value: path } : { kind: 'other', value: t };
  }
  return codeShaped(t) ? { kind: 'name', value: t.replace(/\(\)$/, '') } : { kind: 'other', value: t };
}

/**
 * Specifics per 100 prose words, counting only the ones that can be found: a name in the diff,
 * the session or the repo, a file that exists, a figure the session printed or the user wrote.
 * What can't be checked (no session, no checkout) still counts, so a person's CLI run is judged
 * as before; what is checked and missing is worth nothing.
 */
export function verifiedSpecificity(lines: Line[], wordCount: number, files: Set<string>, r: Resolver): number {
  if (!wordCount) return 0;
  const found: { kind: string; value: string }[] = [];
  const names: string[] = [];
  for (const l of lines) {
    for (const m of l.text.matchAll(SPECIFIC)) {
      const name = m[1] ?? m[2];
      if (name && (files.has(name) || files.has(name.split('/').pop()!))) continue;
      const k = kindOf(m);
      found.push(k);
      if (k.kind === 'name') names.push(k.value);
    }
  }
  r.prime(names);
  let n = 0;
  for (const k of found) {
    if (k.kind === 'name' && r.where(k.value) === 'nowhere') continue;
    if (k.kind === 'file' && r.file(k.value) === 'nowhere') continue;
    if (k.kind === 'fact' && r.hasFact(k.value) === false) continue;
    n++;
  }
  return (100 * n) / wordCount;
}
