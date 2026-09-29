// Rules that check what the text claims against what the diff did.
// Word lists are easy to copy; these are the checks only a diff-aware tool can make.
import { hasInlineTests, isCi } from '../diff.js';
import { droppedEvidence } from '../facts.js';
import { latinShare, quote } from '../text.js';
import { conventionalType, hits, lineOf, titleAndBody, type Hit, type Rule } from './rule.js';
import type { Line } from '../text.js';

const UNCHECKED = /^\s*[-*+]\s+\[ \]/;
const NEGATED = /\b(no|not|without|todo|follow[- ]?up|later|n\/a|none|pending)\b|n't\b/i;
// Recommendations aren't claims: "unit tests should cover the 5xx path".
const MODAL = /\b(should|would|could|might|need(?:s)? to|will need|to be (?:added|written)|recommend(?:ed)?|suggest(?:ed)?|consider|please)\b/i;
// "The existing tests already cover this" is about tests that were there before, not new ones.
const EXISTING = /\b(existing|already|pre-?existing|current(?:ly)?|previous(?:ly)?)\b/i;
const notAClaim = (text: string) => NEGATED.test(text) || MODAL.test(text) || EXISTING.test(text);

/**
 * Claims matching `re`, sentence by sentence. A "no", "not" or "should" only excuses a claim
 * right next to it ("no new tests", "tests should cover…"): a line that says "Unit tests cover
 * the retry path. Tests not run." still claims tests that don't exist.
 */
function claims(lines: Line[], re: RegExp, skipLine?: (l: Line) => boolean): Hit[] {
  const out: Hit[] = [];
  for (const line of lines) {
    if (skipLine?.(line)) continue;
    for (const sentence of line.text.split(/(?<=[.!?;])\s+/)) {
      const m = sentence.match(re);
      if (!m) continue;
      const at = m.index ?? 0;
      if (notAClaim(sentence.slice(Math.max(0, at - 30), at + m[0].length + 30))) continue;
      out.push({ line, match: m[0] });
      break;
    }
  }
  return out;
}

/**
 * From this many times its budget, a description is over-long, not detailed: its length counts
 * in full toward a send-back, and thin prose (few numbers, names or links) on a tiny diff is
 * sent back on length alone.
 */
export const OVERLONG = 2.5;

export const length: Rule = {
  id: 'length',
  kinds: ['commit', 'pr'],
  run({ text, budget, diff, msg, density }) {
    const ratio = text.words / budget;
    // A commit body that explains why with real specifics (numbers, paths, error text) is the
    // gold standard, however long. For commits, length only matters when it's also vague,
    // or truly extreme.
    if (msg.kind === 'commit' && density >= 4 && ratio < 3) return null;
    // Length alone only blocks when it's extreme: a long description full of real detail
    // should get advice, not a rejection that makes the agent delete facts. Commit bodies
    // that explain why get the most slack.
    const [flag, weight, cap] = msg.kind === 'commit' ? [1.5, 8, 30] : [1.3, 12, 35];
    if (ratio <= flag) return null;
    const what = msg.kind === 'commit' ? 'Commit body is ' : '';
    // Dense text (numbers, code, links per 100 words) is detail, not yap: half the points,
    // and a PR only blocks at 6×. Thin text blocks a tiny PR at OVERLONG (210 words on a
    // 9-line fix) and a bigger one at 4×: a long explanation of a real change, like
    // hashicorp/terraform#28781's 600 words on 254 lines, is how good PRs were written. A commit body in plain prose
    // is how the best projects explain a change (see any Linux commit), so length alone
    // blocks it only when it's extreme and says little.
    const dense = density >= 4;
    const blocks = msg.kind === 'commit' ? ratio >= 8 && !dense : ratio >= 6 || (!dense && ratio >= ((diff?.changedLines ?? Infinity) < 30 ? OVERLONG : 4));
    return {
      rule: 'length',
      severity: blocks ? 'error' : 'warn',
      points: Math.min(cap, Math.round(((ratio - 1) * weight) / (dense ? 2 : 1))),
      message: diff
        ? `${what}${text.words} words for a ${diff.changedLines}-line diff (budget ${budget})`
        : `${what}${text.words} words (budget ${budget}, no diff to compare)`,
      hint: `Cut the padding, not the facts: drop restatements, the file-by-file tour and generic claims, and keep every number, error message, link and name the reviewer needs. Aim for ${budget} words or fewer.`,
      data: { words: text.words, lines: diff?.changedLines ?? 0, budget, ratio: ratio.toFixed(1) },
    };
  },
};

// The sections of a generated template. A heading that says something specific
// ("Root cause: Cython 3.3.0", "Why only SDPAParams") is content, not a form, and a
// table is data (benchmarks, before/after), so neither counts.
//
// Pure form: sections that exist because a template has them.
const PURE_FORM =
  /^(?:(?:pr |pull request )?(?:summary|overview|description|tl;?dr|details)|(?:key |main |code |proposed )?changes?(?: made| summary| overview| in this pr| proposed)?|what(?:'s| has| was)? changed|what (?:this pr|it) does|changes? (?:description|details)|checklist|pre-?launch checklist|screenshots?(?: (?:\/|and|&) (?:videos?|recordings?))?|demo|preview|notes?|additional (?:notes|information|info|context)|impact|benefits|technical (?:details|notes)|implementation(?: details| notes)?|files? (?:changed|modified)|related(?: issues?| prs?| links)?|type of change|dependencies|documentation|future (?:work|improvements)|next steps|references?)$/i;
// Sections with a job in a good description, still a form when a small change is split into them.
const CONTENT_FORM =
  /^(?:motivation(?: (?:and|&) context)?|context|background|why|breaking changes?|risks?(?: (?:and|&) mitigations?)?|rollback(?: plan)?|deployment(?: notes)?|security(?: considerations)?|performance(?: impact)?|approach|solution|problem|fix|issue|result|outcome|scope)$/i;
// How it was checked: the target shape's Tested line, as a heading. Never counted.
const VERIFY_FORM =
  /^(?:tested|not tested|(?:test(?:ing)?|tests?|test plan|how to test|how (?:was|is) (?:this|it) tested|how did you test(?: (?:this|it))?(?: change)?\??|how to verify|verification|validation|qa)(?: (?:plan|steps|instructions|done|performed|notes|results))?)$/i;

const headingText = (line: string) =>
  line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/\*\*|__/g, '')
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/[:.\s]+$/, '')
    .trim();

export function isFormHeading(line: string): boolean {
  const t = headingText(line);
  return PURE_FORM.test(t) || CONTENT_FORM.test(t) || VERIFY_FORM.test(t);
}

export const templateOnTiny: Rule = {
  id: 'template-on-tiny',
  kinds: ['pr'],
  needsDiff: true,
  run({ text, diff }) {
    const n = diff!.changedLines;
    // The target shape (an opening, bullets, a Tested line) never counts, and a big diff may
    // use a few short plain headers (Behavior changes / What's mechanical / How to review / Risk).
    const allowed = n < 30 ? 1 : n < 100 ? 2 : n < 300 ? 3 : 6;
    const form = text.headings.filter((h) => isFormHeading(h.text));
    const counted = form.filter((h) => !VERIFY_FORM.test(headingText(h.text)));
    const excess = counted.length - allowed;
    // Blocking is for the full form on a small change ("## 🚀 Summary / ## ✨ Key Changes /
    // ## 📁 Files Changed / ## 🧪 Testing / ## 📝 Notes" on 9 lines). Problem / Fix / Result /
    // Testing on a small fix is content in a form's clothes: advice.
    const pure = form.filter((h) => PURE_FORM.test(headingText(h.text))).length;
    const emojiLed = form.filter((h) => text.emojiLed.includes(h)).length;
    const blocks = form.length - allowed >= 3 && (pure >= 3 || emojiLed >= 3);
    if (excess <= 0 && !blocks) return null;
    return {
      rule: 'template-on-tiny',
      severity: blocks ? 'error' : 'warn',
      points: Math.min(20, 4 + 3 * Math.max(excess, 1)),
      message: `${form.length} template sections on a ${n}-line diff`,
      hint:
        n < 30
          ? 'Drop the section headers. On a diff this size, one or two sentences on what changed and why, then a Tested line, say it all.'
          : 'Drop the section headers: an opening on what changed and why, a few bullets a reviewer would ask about, and a Tested line. Keep every fact that was under them.',
      line: form[0]!.n,
      data: { headers: form.length, lines: n },
    };
  },
};

// phantom-tests fires only on an author saying they added or wrote tests: "Added regression tests for
// X", "Add tests for X", "wrote 12 new tests", "a new test asserts…". Everything else that mentions
// tests is left to other rules: running them (unverified-in-session), ticked boxes, template
// instructions, docs about test commands, and "test" inside another noun (test step, test harness).

// The test noun: "tests", "test cases", "test coverage", "a test suite", "specs". Never inside a path
// or file name ("engine-test/page.tsx", "retry.test.ts").
const TEST_NOUN = String.raw`(?<![\w/.-])(?:tests?(?: cases?| coverage| suites?)?|specs?)(?![\w/-]|\.\w)`;
// Verbs of writing tests. Not "include", "update" or "run": those are template asks, edits and runs.
const AUTHOR = String.raw`\b(?:add|adds|added|wr(?:ite|ites|ote|itten)|creat(?:e|es|ed)|introduc(?:e|es|ed)|implement(?:s|ed)?)(?:\/[a-z]+)?`;
// What may stand between the verb and the noun: articles, counts and kinds of test, then at most two
// words naming what's tested ("webhook retry tests"). No "to" or "for": "added a script to run tests".
const QUALIFIER = String.raw`(?:a|an|the|some|more|several|extra|additional|new|missing|dedicated|focused|basic|initial|proper|comprehensive|a few|a couple of|\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|regression|unit|integration|e2e|end-to-end|smoke|snapshot|property(?:-based)?|fuzz|component|functional|acceptance|api|ui|browser|golden|parameteri[sz]ed|table-driven|and|or)`;
const AUTHORED = new RegExp(String.raw`${AUTHOR}\s+(?:${QUALIFIER}\s+){0,5}(?:[\w-]+\s+){0,2}?(${TEST_NOUN})`, 'gi');
// "A regression test asserts…", "the new tests confirm…": a test introduced as the subject of what it checks.
const TEST_VERB = String.raw`(?:asserts?|covers?|checks?|verif(?:y|ies)|ensures?|exercises?|reproduces?|confirms?|pins?|guards?|locks?|catch(?:es)?|demonstrates?|proves?)`;
const INTRODUCED = new RegExp(
  String.raw`(?:\b(?:a|an)\s+(?:new\s+)?|\b(?:(?:the|\d+|two|three|four|five|several|some)\s+)?new\s+)(?:${QUALIFIER}\s+){0,2}(?:[\w-]+\s+){0,1}?(${TEST_NOUN})\s+${TEST_VERB}\b`,
  'gi',
);
// A bullet that opens with "New tests for…" / "New regression test covering…".
const LEAD_NEW = new RegExp(String.raw`^\s*(?:[-*+]\s+)?new\s+(?:${QUALIFIER}\s+){0,2}(?:[\w-]+\s+){0,1}?(${TEST_NOUN})`, 'gi');

// After the noun, these keep it the thing being claimed. Any other word makes "test" a modifier naming
// something else: "test step", "test target", "test harness", "test toolchain", "test zip", "test
// parameters", "test behavior caveat".
const NOUN_ENDS = /^(?:\s*$|\s*[.,;:!?)(\]—–]|\s+-\s|\s+(?:for|to|that|which|and|or|in|on|around|of|with|under|against|so|as|plus|including|where|when|using|at|across|per|alongside|too|also|now|here|from|by|into|this|these|the|it|we|were|was|are|is|pass|passes|passed|[a-z]+ing)\b)/i;
// Not a claim about this change: a ticked or empty box, a quoted commit subject, a question.
const BOX = /^\s*(?:[-*+]|\d+[.)])?\s*\[[ xX]\]/;
const SHA_LED = /^\s*(?:[-*+]\s+)?[0-9a-f]{7,40}\b/;
const STRUCK = /~~[^~]*~~/g;
const QUESTION = /\?[\s*_]*$/;
// Template instructions: "please include tests", "make sure you add tests".
const INSTRUCTION = /\b(?:please|make sure|be sure|remember to|don't forget|do not forget|if (?:you|applicable|needed|relevant|necessary)|when (?:you|applicable))\b/i;
const CODE_SPAN = /`[^`]*`/g;

/** Where a line says tests were written, or null. */
function authoredTests(text: string): string | null {
  if (BOX.test(text) || SHA_LED.test(text)) return null;
  const clean = text.replace(STRUCK, ' ').replace(CODE_SPAN, 'code').replace(/\*\*|__/g, '');
  for (const sentence of clean.split(/(?<=[.!?;])\s+/)) {
    if (QUESTION.test(sentence)) continue;
    for (const re of [AUTHORED, INTRODUCED, LEAD_NEW]) {
      for (const m of sentence.matchAll(re)) {
        const noun = m[1]!;
        const at = m.index ?? 0;
        const end = at + m[0].length;
        // "GitHub Spec Kit": a capitalized Spec is a name, not a spec file
        if (/^Spec/.test(noun)) continue;
        // "test step", "test harness": the noun names something else
        if (re !== INTRODUCED && !NOUN_ENDS.test(sentence.slice(end))) continue;
        const near = sentence.slice(Math.max(0, at - 30), end + 30);
        if (NEGATED.test(near) || MODAL.test(near) || INSTRUCTION.test(sentence)) continue;
        return m[0];
      }
    }
  }
  return null;
}

export const phantomTests: Rule = {
  id: 'phantom-tests',
  kinds: ['commit', 'pr'],
  needsDiff: true,
  run(ctx) {
    const diff = ctx.diff!;
    if (!diff.files.length || diff.tests.length || diff.truncated) return null;
    if (diff.files.some((f) => hasInlineTests(f.path))) return null;
    // A diff that only touches CI config can't add a unit test; its "tests" are CI jobs.
    if (diff.files.every((f) => isCi(f.path))) return null;
    // Release PRs quote old commits: "- <sha>: subject", then the commit's body, indented under it.
    let quoted = false;
    for (const line of titleAndBody(ctx)) {
      if (SHA_LED.test(line.text)) quoted = true;
      else if (line.text.trim() && !/^\s/.test(line.text)) quoted = false;
      if (quoted) continue;
      const match = authoredTests(line.text);
      if (!match) continue;
      const q = quote(match);
      return {
        rule: 'phantom-tests',
        severity: 'error',
        points: 25,
        message: `Says "${q}" but no test files changed`,
        hint: 'Remove the claim or add the tests. If existing tests cover this, name the test and the command you ran.',
        line: lineOf(line),
        quote: q,
      };
    }
    return null;
  },
};

/** Named the command, or a result with a count: `npm test`, "212 passed", "all 48 tests". */
const CONCRETE = /`[^`]+`|\b\d+\s*(?:tests?|specs?|passed|passing|failures?|ok)\b|\b(?:all|\d+) of \d+\b/i;
// A test or build command written without backticks ("pnpm test:regression", "go test ./...",
// "python -m pytest"), or a test file named as the one that ran.
const COMMAND =
  /\b(?:(?:npm|pnpm|yarn|bun|npx|pnpx|deno)\s+(?:run\s+)?[\w:.-]+|python3?\s+-m\s+\w+|pytest|go (?:test|vet|build)|cargo (?:test|check|build|clippy)|mvn\s+\w+|\.?\/?gradlew?\s+\w+|make\s+\w+|tox|jest|vitest|rspec|phpunit|dotnet (?:test|build)|swift (?:test|build)|xcodebuild|ctest|bazel (?:test|build)|mix test|bundle exec \w+|rake \w+|flutter test|dart test|ruff|mypy|tsc|eslint)\b|\b[\w./-]+[._](?:spec|test)\.\w+\b|\btest_\w+\.py\b/i;
// A result somewhere in the text: "23 tests pass", "84 passed", "all 12 of 12".
const RESULT = /\b\d+\s*(?:tests?|specs?|cases?|checks?)\b[^.\n]{0,24}?\b(?:pass\w*|green|ok|succeed\w*)\b|\b\d+\s+(?:passed|passing|failures?|failed)\b|\b(?:all|\d+) of \d+\b/i;
const backed = (t: string) => CONCRETE.test(t) || COMMAND.test(t);

export const tickedBoxes: Rule = {
  id: 'ticked-boxes',
  kinds: ['commit', 'pr'],
  run({ text }) {
    // A ticked box that names the command or the result ("[x] `npm test`: 244 tests pass") is evidence.
    const bare = text.ticked.filter((l) => !backed(l.text));
    const c = bare.length;
    if (c < 2) return null;
    return {
      rule: 'ticked-boxes',
      severity: 'warn',
      points: Math.min(16, 4 + 2 * c),
      message: `${c} pre-ticked checkboxes`,
      hint: 'Replace the checklist with what you actually ran and what happened, e.g. `npm test` (212 passed).',
      line: bare[0]!.n,
      data: { count: c },
    };
  },
};

const VAGUE_VERIFY =
  /\b(?:all |existing |the )?tests? (?:are |were |still |continue to )?(?:pass(?:es|ed|ing)?|green)\b|\bcontinue to pass\b|\bstill pass(?:es)?\b|\btested (?:locally|thoroughly|manually|extensively|and (?:verified|working))\b|\bverified (?:that )?(?:everything|it|the changes?) works?\b|\bworks as expected\b|\beverything works\b|\b(?:works?|worked|working) (?:fine|locally|well|great|correctly|properly|as intended)\b|\bon my machine\b|\bverified locally\b|\bsanity[- ]check(?:ed)?\b/i;

export const vagueVerification: Rule = {
  id: 'vague-verification',
  kinds: ['commit', 'pr'],
  run({ text }) {
    // "Tests pass" is fine when the command or the count is right there, or anywhere else in the text.
    if (text.lines.some((l) => COMMAND.test(l.text) || RESULT.test(l.text))) return null;
    const found = claims(text.lines, VAGUE_VERIFY, (l) => CONCRETE.test(l.text))[0];
    if (!found) return null;
    const q = quote(found.match);
    return {
      rule: 'vague-verification',
      severity: 'warn',
      points: 6,
      message: `"${q}", but tested how?`,
      hint: 'Name the command or steps you ran and the result, e.g. `go test ./billing/...` passes, or the manual steps you took.',
      line: found.line.n,
      quote: q,
    };
  },
};

// Claims that something was run or tried, for the session check below.
const RAN_CLAIM =
  /\b(?:tests?|specs?|suite)\b[^.\n]{0,40}?\b(?:pass(?:es|ed|ing)?|green|cover(?:s|ed)?|confirm(?:s|ed)?|verif(?:y|ies|ied))\b|\b(?:verified|tested|confirmed|reproduced)\b|\bmanual(?:ly)? (?:verif|test)\w*|\bran (?:the )?(?:tests?|suite|it)\b|^\s*(?:[-*+]\s+\[[xX]\]|✅)/im;

/**
 * Session-grounded: when the agent's own transcript is available, a message that says
 * tests pass or the change was verified must be backed by a command the agent actually
 * ran in that session. The most common invented claim in agent-written PRs.
 */
export const unverifiedInSession: Rule = {
  id: 'unverified-in-session',
  kinds: ['commit', 'pr'],
  run(ctx) {
    const s = ctx.session;
    if (!s || s.tests.length) return null;
    const found = claims(titleAndBody(ctx), RAN_CLAIM, (l) => UNCHECKED.test(l.text))[0];
    if (!found) return null;
    const q = quote(found.line.text);
    const ranSomething = s.exercised.length > 0;
    return {
      rule: 'unverified-in-session',
      severity: ranSomething ? 'warn' : 'error',
      points: ranSomething ? 10 : 25,
      message: ranSomething
        ? `Says "${q}", but no test command ran in this session`
        : `Says "${q}", but nothing was run or tried in this session`,
      hint: 'Only report what actually happened: run the tests and quote the result, or write "Not tested" / "Tests not run".',
      line: lineOf(found.line),
      quote: q,
    };
  },
};

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const diffEcho: Rule = {
  id: 'diff-echo',
  kinds: ['commit', 'pr'],
  needsDiff: true,
  run({ text, diff }) {
    const names = new Set<string>();
    for (const f of diff!.files.slice(0, 300)) {
      names.add(f.path);
      const base = f.path.split('/').pop()!;
      if (base.length >= 5) names.add(base);
    }
    if (!names.size) return null;
    const alt = [...names].sort((a, b) => b.length - a.length).map(escape).join('|');
    const re = new RegExp(`(?<![\\w/.-])(?:${alt})(?![\\w-])`);
    const heads = new Set(text.headings);
    // A file tour lists files: "- `src/api.ts`: updated handler", "Updated api.ts to use X",
    // "`api.ts` — new retry". An explanation that happens to start with a file name
    // ("worker.js asks the asset binding for / because…") is exactly what we want, so
    // plain prose lines only count when they open with a change verb or a "file:" label.
    const bullet = /^\s*([-*+•]|\d{1,2}[.)])\s+/;
    const lead = (t: string) => t.replace(/^\s*([-*+•]|\d{1,2}[.)])?\s*(\*\*|__)?/, '').slice(0, 40);
    const verbFirst = new RegExp(`^(?:updated?|modif(?:y|ied)|chang(?:e|ed|es)|edit(?:ed|s)?|add(?:ed|s)?|remov(?:e|ed|es)|delet(?:e|ed|es)|renam(?:e|ed|es)|refactor(?:ed|s)?|creat(?:e|ed|es)|introduc(?:e|ed|es)|tweak(?:ed|s)?)\\b.{0,25}?(?<![\\w/.-])(?:${alt})(?![\\w-])`, 'i');
    const labelFirst = new RegExp(`^\`?(?:${alt})\`?\\s*(?::|—|–|-\\s)`);
    const echoes = text.lines.filter((l) => {
      if (heads.has(l)) return false;
      const t = l.text.trim();
      if (bullet.test(l.text)) return re.test(lead(l.text));
      return verbFirst.test(t) || labelFirst.test(t);
    });
    const k = echoes.length;
    if (k < 3 || (k < 5 && k < 0.3 * Math.max(1, text.bullets.length))) return null;
    return {
      rule: 'diff-echo',
      severity: 'warn',
      points: Math.min(20, 3 * k),
      message: `${k} lines walk through files the reviewer can already see in the diff`,
      hint: 'GitHub already lists the files. Group the changes by area instead: one bullet per change a reviewer would ask about, saying where to look (function, setting, file:line) and the values.',
      line: echoes[0]!.n,
      data: { count: k },
    };
  },
};

const CLAIMS = [
  /\b(?:improv|boost|enhanc|optimi[sz]|increas)\w*\b[^.\n]{0,30}?\b(?:performance|speed|efficiency|throughput|latency)\b/i,
  /\b(?:significantly |much |dramatically )?(?:faster|quicker|more performant|more efficient)\b(?! (?:merge|review|turnaround|iteration|feedback|release|landing|approval)s?\b)/i,
  /\b(?:improv|enhanc|harden|strengthen|bolster)\w*\b[^.\n]{0,30}?\bsecurity\b|\bmore secure\b/i,
  /\b(?:improv|enhanc|better|increas)\w*\b[^.\n]{0,30}?\b(?:maintainability|readability|code quality|developer experience|user experience|reliability|robustness|scalability|stability|resilience)\b/i,
  /\b(?:production[- ]ready|battle[- ]tested|enterprise[- ]grade|future[- ]proof)\b/i,
  /\b(?:fully|100%) backwards?[- ]compatible\b/i,
];
const EVIDENCE =
  /\d+(?:\.\d+)?\s?(?:%|x|×|ms|µs|us|ns|s|sec|secs|seconds|mb|kb|gb|rps|qps|req\/s)\b|\bbenchmark|\bp(?:50|90|95|99)\b|→|->|\bfrom \d/i;

export const unbackedClaim: Rule = {
  id: 'unbacked-claim',
  kinds: ['commit', 'pr'],
  run(ctx) {
    const found: { n?: number; q: string }[] = [];
    const lines = titleAndBody(ctx);
    const prose = lines.filter((l) => l.text.trim());
    for (const line of lines) {
      // The measurement often follows the claim: "Why: faster rendering." then "117ns → 31ns per hex".
      const at = prose.indexOf(line);
      const near = at === -1 ? [line] : prose.slice(at, at + 3);
      if (near.some((l) => EVIDENCE.test(l.text))) continue;
      for (const re of CLAIMS) {
        const m = line.text.match(re);
        if (m) found.push({ n: lineOf(line), q: quote(m[0]) });
      }
    }
    if (!found.length) return null;
    const first = found[0]!;
    return {
      rule: 'unbacked-claim',
      severity: 'warn',
      points: Math.min(20, 5 * found.length),
      message:
        found.length > 1
          ? `${found.length} claims with no evidence, e.g. "${first.q}"`
          : `"${first.q}" with no evidence`,
      hint: 'Back it with a measurement (before → after, with numbers) or delete it.',
      line: first.n,
      quote: first.q,
      data: { count: found.length },
    };
  },
};

export const WHY =
  /\b(?:because|since|so that|so we|in order to|otherwise|previously|used to|caus(?:e|ed|es|ing)|crash\w*|errors?|exceptions?|bugs?|regressions?|broke|breaks|broken|fail\w*|leak\w*|races?|timeouts?|deadlock\w*|report(?:ed|s)?|requested|needed|need to|required|requirement|blocks|blocked|unblock\w*|incidents?|outages?|panic\w*|flak\w*|slow|wrong|incorrect|missing|typo|dropp?ed|drops|lost|loses|down|stuck|stale|hang(?:s|ing)?|hung|duplicat\w*|corrupt\w*|overflow\w*|vulnerab\w*|cve|deprecat\w*|can't|cannot|couldn't|doesn't|didn't|wasn't|isn't)\b|\bto (?:fix|avoid|prevent|allow|support|enable|let|keep|stop|reduce|handle|match|unblock|make)\b|\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?|refs?)\b\s*:?\s*#?\d+|#\d+|https?:\/\/\S*(?:issues|jira|linear|browse|sentry)|\bproblems?\b|\bdegrad\w*|\bno (?:way|visibility)\b|\bhard to\b|\bconfus\w*|\b(?:did|does|do) nothing\b|\bsilent(?:ly)?\b|\bnever (?:\w+ )?(?:work|fire|run|load|open|show|appear|arrive)\w*|^\W*why\W*:|\bso (?:the |that |this |these |it |they |we |our |users? |tests? |reviewers? |agents? |\w+ )?(?:is|are|can|could|will|won't|get|gets|stay|stays|keep|keeps|work|works|run|runs|show|shows|pass|passes|resolve|resolves)\b|\btrapped\b|\bun(?:readable|usable|reachable|able)\b|\b(?:forced|had|having|have) to\b|\bto (?:provide|ensure)\b/im;
// A need stated as its own sentence is a reason: "Agents need durable memory across sessions."
// Case-sensitive and sentence-initial, so "check if elements need runtime access" isn't one.
const NEED = /(?:^|[.!?]\s+)(?:[A-Z][\w-]*)(?: [\w-]+)? needs? (?!to be\b)[a-z]/m;
// Ticket ids are case-sensitive: PAY-123 is a ticket; utf-8 and the tail of a UUID are not.
const TICKET_ID = /\b[A-Z][A-Z0-9]+-\d+\b/;

export const missingWhy: Rule = {
  id: 'missing-why',
  kinds: ['commit', 'pr'],
  run({ msg, text, diff }) {
    const n = diff?.changedLines;
    const all = [msg.title, ...text.lines.map((l) => l.text)].join('\n');
    if (WHY.test(all) || NEED.test(all) || TICKET_ID.test(all)) return null;
    // The reason words are English; a description in another language gets no verdict.
    if (latinShare(all) < 0.5) return null;
    if (msg.kind === 'pr') {
      if (n != null && n <= 20) return null;
      const empty = text.words === 0;
      // A big diff with no body at all is thin-description's to report.
      if (empty && n != null && n >= BIG) return null;
      return {
        rule: 'missing-why',
        severity: 'warn',
        points: 8,
        message: empty
          ? `No description${n != null ? ` for a ${n}-line diff` : ''}`
          : 'Explains what changed, never why',
        hint: 'Add one sentence on why, from what you know: the bug it fixes, who asked for it, or the issue link. If nobody said why, leave it out rather than guess.',
      };
    }
    // Commits: only nag about big changes with no body at all.
    if (n == null || n <= 150 || text.words > 0) return null;
    return {
      rule: 'missing-why',
      severity: 'info',
      points: 4,
      message: `${n}-line commit with no body saying why`,
      hint: 'Add a short body: what was wrong before, or what this unblocks.',
    };
  },
};

const BIG = 300;
// Says how it was checked, or that it wasn't: "Tested: `npm test`", "Not tested", "Verified on staging".
const VERIFIED =
  /\b(?:tested|untested|testing|verif(?:y|ied|ication)|validat(?:ed|ion)|reproduced|smoke[- ]test\w*|test plan|ran|(?:not|never) run|checked|confirmed|tried)\b|^\s*[-*+]\s+\[[xX ]\]|✅/im;

export const thinDescription: Rule = {
  id: 'thin-description',
  kinds: ['pr'],
  needsDiff: true,
  run({ text, diff, msg }) {
    const n = diff!.changedLines;
    const prose = text.lines.filter((l) => l.text.trim() && !text.headings.includes(l));
    // An empty or one-line body on a big diff: the reviewer gets a wall of code and a caption.
    if (n >= BIG && prose.length <= 1 && text.words < 30) {
      return {
        rule: 'thin-description',
        severity: 'warn',
        points: 12,
        message: text.words ? `A one-line description for a ${n}-line diff` : `No description for a ${n}-line diff`,
        hint: "Give the reviewer a map: what changed and why (the bug, the request, the issue), the few behavior changes worth a real look and where they are, what's mechanical and roughly how much of the diff it is, and a Tested line with what you ran.",
        data: { lines: n, words: text.words },
      };
    }
    // Every description past a tiny change says how it was checked, or that it wasn't.
    // Docs-only changes have nothing to run.
    if (n < 30 || !text.words || (!diff!.source.length && !diff!.tests.length)) return null;
    const all = [msg.title, ...prose.map((l) => l.text)].join('\n');
    if (VERIFIED.test(all) || /\bCI\b/.test(all) || prose.some((l) => COMMAND.test(l.text) || RESULT.test(l.text))) return null;
    return {
      rule: 'thin-description',
      severity: 'warn',
      points: 4,
      message: "Doesn't say how it was tested",
      hint: 'End with a Tested line: the commands you ran in this session and what they returned (`npm test`, 212 passed). If nothing ran, write "Not tested" and what should be checked.',
      data: { lines: n, words: text.words },
    };
  },
};

export const typeMismatch: Rule = {
  id: 'type-mismatch',
  kinds: ['commit', 'pr'],
  needsDiff: true,
  run({ msg, diff }) {
    const type = conventionalType(msg.title);
    const d = diff!;
    if (!type || !d.files.length) return null;
    const line = msg.kind === 'commit' ? 1 : undefined;
    if (['feat', 'fix', 'perf', 'refactor'].includes(type) && !d.source.length && !d.tests.length) {
      return {
        rule: 'type-mismatch',
        severity: 'warn',
        points: 6,
        message: `"${type}:" on a diff that only touches docs`,
        hint: 'Use "docs:" or say which code change this belongs to.',
        line,
      };
    }
    if (type === 'docs' && d.source.length) {
      return {
        rule: 'type-mismatch',
        severity: 'warn',
        points: 6,
        message: `"docs:" but ${d.source.length} non-doc file${d.source.length > 1 ? 's' : ''} changed`,
        hint: 'Pick the type that matches the code change, or split the docs into their own commit.',
        line,
      };
    }
    return null;
  },
};

export const droppedFacts: Rule = {
  id: 'dropped-facts',
  kinds: ['commit', 'pr'],
  run({ msg, previous }) {
    if (!previous?.evidence.length) return null;
    const lost = droppedEvidence(previous.evidence, `${msg.title}\n${msg.body}`);
    if (!lost.length) return null;
    const shown = lost.slice(0, 8).join(', ') + (lost.length > 8 ? ', …' : '');
    return {
      rule: 'dropped-facts',
      severity: previous.strict ? 'error' : 'warn',
      points: previous.strict ? 10 : 2,
      message: `${lost.length} fact${lost.length > 1 ? 's' : ''} from the last draft ${lost.length > 1 ? 'are' : 'is'} gone: ${shown}`,
      hint: 'Short means no padding, not fewer facts. Put these back unless they were wrong.',
      data: { count: lost.length },
    };
  },
};

export const groundedRules = [
  length,
  phantomTests,
  unverifiedInSession,
  templateOnTiny,
  diffEcho,
  tickedBoxes,
  vagueVerification,
  unbackedClaim,
  missingWhy,
  thinDescription,
  typeMismatch,
  droppedFacts,
];
