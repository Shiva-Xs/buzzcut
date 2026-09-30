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

// Names people write to illustrate, not to point at: someFoo(), myFunction, fooBar, yourName.
const PLACEHOLDER = /^(?:some|my|your|foo|bar|baz|qux|example|sample|dummy|placeholder|fake)(?:[A-Z_.-]|$)/i;

const EXT = 'js|mjs|cjs|ts|tsx|jsx|py|pyi|go|rs|java|kt|kts|scala|rb|php|html|htm|css|scss|sass|less|json|jsonc|ya?ml|toml|md|mdx|rst|adoc|txt|sh|bash|zsh|bat|cmd|ps1|sql|xml|xsl|lock|conf|cfg|ini|env|in|c|h|cc|cpp|hpp|cxx|cs|swift|m|mm|vue|svelte|hbs|ejs|erb|haml|pug|njk|liquid|dart|ex|exs|erl|hs|ml|lua|pl|pm|r|jl|tf|tfvars|proto|graphql|gql|gradle|mk|cmake|dockerfile';
const PATH = new RegExp(String.raw`^(?:\.\/)?(?:[\w@.-]+\/)+[\w@.-]+\.(?:${EXT})$`);
const DOMAINY = /(?:^|\/)[\w-]+\.(?:com|io|org|net|dev|app|co|ai)(?:\/|$)/;
const FILENAME = new RegExp(String.raw`^[\w.-]+\.(?:${EXT})$`);

/** A bare file name with a known extension (`man_test.go`), or null. Only worth checking in backticks: "Node.js" is not a file. */
export function bareFileOf(s: string): string | null {
  const t = s.trim();
  return FILENAME.test(t) && !/^\d/.test(t) && !/^v?\d+(?:\.\d+)+$/.test(t) && t.length >= 5 ? t : null;
}

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
  if (norm(t).length < 6 || NOT_A_NAME.has(norm(t)) || PLACEHOLDER.test(t)) return false;
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
  /** …says the change uses, calls or changes it, or the sentence opens with a verb about the change */
  touches: boolean;
  /** a plain word in backticks rather than a code-shaped name: worth checking only against what the diff removes */
  plain?: boolean;
  /** the verb the sentence says the change does with it: "adds", "throws", "configures" */
  verb?: string;
  /** the verb is one of using or bringing in something ("adds", "throws", "configures"), not renaming, replacing or moving it */
  uses: boolean;
}

// Verbs that bring in or use a thing. A name only the diff's removed lines have contradicts these.
const USING = /^(?:add\w*|introduc\w*|creat\w*|implement\w*|expos\w*|defin\w*|export\w*|emit\w*|attach\w*|use[sd]?|using|call\w*|invok\w*|set|sets|setting|return\w*|throw\w*|threw|rais\w*|configur\w*|initializ\w*|initialis\w*|regist\w*|provid\w*|support\w*|enabl\w*|pass(?:es|ed|ing)?|send\w*|sent|read|reads|reading|writ\w*|new|wrap\w*|inject\w*|generat\w*|load\w*|import\w*|require\w*|assign\w*)$/i;

const ADD_VERB = String.raw`add(?:s|ed|ing)?|introduc(?:e|es|ed|ing)|creat(?:e|es|ed|ing)|implement(?:s|ed|ing)?|expos(?:e|es|ed|ing)|defin(?:e|es|ed|ing)|export(?:s|ed|ing)?|emit(?:s|ted)?|attach(?:es|ed)?|new`;
const REMOVE_VERB = String.raw`remov(?:e|es|ed|ing)|delet(?:e|es|ed|ing)|drop(?:s|ped|ping)?|deprecat(?:e|es|ed|ing)|strip(?:s|ped)?|get(?:s)? rid of|no longer`;
const TOUCH_VERB = String.raw`us(?:e|es|ed|ing)|call(?:s|ed|ing)?|updat(?:e|es|ed|ing)|chang(?:e|es|ed|ing)|modif(?:y|ies|ied)|renam(?:e|es|ed)|replac(?:e|es|ed)|wrap(?:s|ped)?|extend(?:s|ed)?|switch(?:es|ed)?|mov(?:e|es|ed)|handl(?:e|es|ed)|read(?:s)?|writ(?:e|es)|set(?:s)?|send(?:s)?|return(?:s|ed)?|pass(?:es|ed)?|check(?:s|ed)?|fix(?:es|ed)?`;
const VERBS = new RegExp(String.raw`\b(?:(${ADD_VERB})|(${REMOVE_VERB})|(${TOUCH_VERB}))\b`, 'gi');
// A sentence that is about something else: code that was already there, an example, a plan, or a
// name attributed to somewhere else ("from the AWS SDK"). Whole-sentence cues.
const NOT_ABOUT_THIS_CHANGE =
  /\b(?:(?:add|adds|added|put|puts|bring|brings|brought)\b[^.;]{0,25}\b(?:back|again)|re-?add\w*|restor\w*|revert\w*|e\.g\.|such as|for example|instead of|rather than|unlike|existing|already|pre-?existing|currently|previously|todo|follow[- ]?up|later|n\/a)\b/i;
// Said of the name, not the sentence: "does not add `X`", "without `X`", "should use `X`". Only the words just before it count.
const NEGATED_NEAR = /\b(?:not|no|without|never|should|would|could|might|consider|pending)\b[^.;]{0,40}$|n't\b[^.;]{0,40}$/i;
// The name is attributed to something outside this repo, so the repo can't be expected to have it.
const EXTERNAL_CUE =
  /\b(?:(?:from|in|of|by|per|via)\s+(?:the\s+)?(?:[\w@./-]+\s+)?(?:sdk|api|library|package|module|crate|gem|docs?|documentation|spec|rfc|dependency|upstream|plugin|framework|runtime|kernel|stdlib|standard library|server|service|manual|standard)|third[- ]party|external|upstream|vendor(?:ed)?|built-?in|standard library|not (?:part of|in|included in|tracked in|checked in to|committed to) (?:the )?(?:repo|repository|tree|codebase|project)|outside (?:of )?(?:the )?(?:repo|repository)|git-?ignored|untracked|local(?:ly)?[- ]only)\b/i;
const TESTED_LINE = /^\s*(?:[-*+]\s+)?(?:\*\*)?(?:not tested|tested|verified|ran)\b/i;

/** The verb closest before `at` in the sentence: what the sentence says the change does to the name. */
function verbBefore(sentence: string, at: number): { kind: 'add' | 'remove' | 'touch'; word: string } | null {
  let last: { kind: 'add' | 'remove' | 'touch'; word: string } | null = null;
  for (const m of sentence.slice(Math.max(0, at - 90), at).matchAll(VERBS)) last = { kind: m[1] ? 'add' : m[2] ? 'remove' : 'touch', word: m[0] };
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

/** Prose without its links: a branch name in a URL or a comment anchor (#discussion_r123) isn't a name the change makes. */
const unlinked = (text: string) =>
  text
    .replace(/\]\([^)\n]*\)/g, ']')
    .replace(/<https?:[^>\n]*>/g, ' ')
    .replace(/\b(?:https?:\/\/|www\.)\S+/g, ' ');

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
  // Names a sentence places outside this repo ("(not part of the repository)", "from the SDK"): every
  // mention of them is left alone, wherever it is.
  const outside = new Set<string>();
  const scan = (raw: string, n: number | undefined) => {
    if (!raw.trim() || /^\s*>/.test(raw) || TESTED_LINE.test(raw)) return;
    for (const sentence of sentencesOf(unlinked(raw).replace(/^\s*(?:[-*+•]|\d{1,2}[.)])\s+/, ''))) {
      // A question is not a claim; a sentence about code that was already there or a plan is not one either.
      if (/\?\s*$/.test(sentence) || NOT_ABOUT_THIS_CHANGE.test(sentence) || TESTED_LINE.test(sentence)) continue;
      // "Outlines the quorum for `X`", "Also whitelists `X`": a description opens with what the change does.
      const first = sentence.replace(/^(?:also|and|now|then|additionally|plus)\s+/i, '').match(/^([A-Za-z][a-z]{2,})\b/)?.[1]?.toLowerCase() ?? '';
      const verbFirst = /(?:s|ed|es|ing)$/.test(first) && !/^(?:this|that|these|those|its|was|has|is|does|use|uses|used|thus|plus|also|yes|less|class|access|process|progress|success|address|based|related|inspired|following|given|according|depending|regarding|considering|compared|similar|due|prior|thanks|updated|tested|verified)$/.test(first);
      const spans: { text: string; at: number; backticked: boolean; header?: boolean }[] = [];
      for (const m of sentence.matchAll(/`([^`\n]+)`/g)) spans.push({ text: m[1]!.trim(), at: m.index!, backticked: true });
      const bare = sentence.replace(/`[^`\n]*`/g, (s) => ' '.repeat(s.length));
      for (const m of bare.matchAll(PLAIN_PATH)) spans.push({ text: m[0], at: m.index!, backticked: false });
      for (const m of bare.matchAll(PLAIN_NAME)) spans.push({ text: m[0], at: m.index!, backticked: false });
      for (const m of bare.matchAll(HEADER_IN_PROSE)) spans.push({ text: m[1]!, at: m.index!, backticked: false, header: true });
      for (const s of spans) {
        // the cue is about this name when it is right next to it
        if (EXTERNAL_CUE.test(sentence.slice(Math.max(0, s.at - 45), s.at + s.text.length + 45))) {
          outside.add(s.text.toLowerCase());
          outside.add(norm(s.text));
          continue;
        }
        if (NEGATED_NEAR.test(sentence.slice(Math.max(0, s.at - 60), s.at))) continue;
        const v = verbBefore(sentence, s.at);
        const verb = v?.word ?? (verbFirst ? first : undefined);
        const flags = {
          line: n,
          backticked: s.backticked,
          adds: v?.kind === 'add',
          removes: v?.kind === 'remove',
          touches: v?.kind === 'touch' || (v === null && verbFirst),
          verb,
          uses: v?.kind === 'add' || (v?.kind !== 'remove' && Boolean(verb && USING.test(verb))),
        };
        const path = pathOf(s.text);
        const bareFile = s.backticked ? bareFileOf(s.text) : null;
        if (path) push({ kind: 'file', text: path, ...flags });
        else if (bareFile) push({ kind: 'file', text: bareFile, ...flags });
        else if (s.header) {
          if (norm(s.text).length >= 6 && !STANDARD_HEADERS.has(norm(s.text))) push({ kind: 'name', text: s.text, ...flags });
        } else if (codeShaped(s.text) && !STANDARD_HEADERS.has(norm(s.text))) push({ kind: 'name', text: s.text.replace(/\(\)$/, ''), ...flags });
        // A plain word in backticks says nothing checkable on its own, but "adds `pip`" on a diff that
        // only removes it is a contradiction: kept, marked plain, for that one check.
        else if (s.backticked && flags.uses && /^[A-Za-z_][\w.-]{2,}$/.test(s.text) && !NOT_A_NAME.has(norm(s.text))) push({ kind: 'name', text: s.text, ...flags, plain: true });
      }
    }
  };
  scan(title, undefined);
  for (const l of lines) scan(l.text, l.n > 0 ? l.n : undefined);
  return out.filter((c) => !outside.has(c.text.toLowerCase()) && !outside.has(norm(c.text)));
}

/** Every code-shaped name in the text, however its sentence uses it. */
export function codeShapedNames(text: string): string[] {
  const out = new Set<string>();
  const t = unlinked(text);
  for (const m of t.matchAll(/`([^`\n]+)`/g)) if (codeShaped(m[1]!.trim())) out.add(m[1]!.trim().replace(/\(\)$/, ''));
  for (const m of t.replace(/`[^`\n]*`/g, ' ').matchAll(PLAIN_NAME)) if (codeShaped(m[0])) out.add(m[0].replace(/\(\)$/, ''));
  return [...out];
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
    const prose = unlinked(l.text).replace(/`[^`\n]*`/g, ' ');
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
      // `git grep -o` prints non-overlapping matches, so a name inside a longer one that matched
      // (`Policy` in `retryPolicy`) is never printed on its own: a name is found when any printed
      // match is it or contains it.
      const printed = out.split('\n').map((l) => norm(l)).filter(Boolean);
      const exact = new Set(printed);
      return new Set(names.filter((n) => exact.has(norm(n)) || printed.some((t) => t.includes(norm(n)))));
    },
    hasFile(path) {
      const top = toplevel();
      if (!top) return null;
      if (path.includes('/')) return existsSync(join(top, path));
      // A bare name (`man_test.go`) is in the repo if any folder has it.
      try {
        return execFileSync('git', ['-C', top, 'ls-files', '--', `:(glob)**/${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).trim().length > 0;
      } catch {
        return null;
      }
    },
  };
}

// ─── the resolver ────────────────────────────────────────────────────────────

export interface Resolver {
  /** Look up all these names in one repo search, so `where` can answer for each. */
  prime(names: string[]): void;
  where(name: string): Where;
  /** A plain word, matched whole: `give` isn't in "given". `added` wins over `removed`; null when it is in neither. */
  whereWord(name: string): 'added' | 'removed' | null;
  file(path: string): 'diff' | 'repo' | 'nowhere' | 'unknown';
  /** The lines the diff adds and removes in the files that path names, or null when it names none. */
  fileStat(path: string): { additions: number; deletions: number } | null;
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
      // A dotted name (`Blueprint.add_url_rule`) is accepted when each of its parts is somewhere, so
      // the parts are searched with it: `where()` reads them from here.
      const all = new Set<string>();
      for (const n of names) {
        all.add(n);
        if (n.includes('.')) for (const part of n.split('.')) if (norm(part).length >= 3) all.add(part);
      }
      const todo = [...all].filter((n) => !inRepo.has(n) && !local(norm(n)));
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
    whereWord(name) {
      if (!diff) return null;
      const c = changedText(diff);
      const re = new RegExp(String.raw`(?<![A-Za-z0-9_])${escapeRe(name)}(?![A-Za-z0-9_])`, 'i');
      if (re.test(c.added)) return 'added';
      return re.test(c.removed) ? 'removed' : null;
    },
    fileStat(path) {
      if (!diff) return null;
      const base = path.split('/').pop()!;
      const hit = diff.files.filter((f) => f.path === path || f.path.endsWith('/' + path) || path.endsWith('/' + f.path) || (!path.includes('/') && f.path.split('/').pop() === base));
      return hit.length ? { additions: hit.reduce((n, f) => n + f.additions, 0), deletions: hit.reduce((n, f) => n + f.deletions, 0) } : null;
    },
    file(path) {
      if (!diff) return 'unknown';
      const base = path.split('/').pop()!;
      for (const f of diff.files) if (f.path === path || f.path.endsWith('/' + path) || path.endsWith('/' + f.path) || ((f.renamed || !path.includes('/')) && f.path.split('/').pop() === base)) return 'diff';
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
