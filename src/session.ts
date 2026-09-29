// What an agent actually ran in its session, read from the transcript its hook payload
// points at (Claude Code: transcript_path, Antigravity: transcriptPath). Used to catch
// "tests pass" / "verified manually" claims that no command in the session backs up.
import { readFileSync, statSync } from 'node:fs';
import type { SessionFacts } from './rules/rule.js';
import { segments } from './shell.js';

// Anchored at the start of a simple command, so a commit message or PR body that
// merely mentions `npm test` doesn't count as running it.
const TEST_CMD =
  /^(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|npx\s+(?:vitest|jest|mocha|playwright|ava|tap)\b|vitest\b|jest\b|mocha\b|pytest\b|python3?\s+-m\s+(?:pytest|unittest)\b|go\s+test\b|cargo\s+(?:test|nextest)\b|mvnw?\b.*\b(?:test|verify)\b|gradlew?\b.*\btest\b|dotnet\s+test\b|phpunit\b|rspec\b|rake\s+test\b|mix\s+test\b|deno\s+test\b|make\s+(?:test|check)\b|ctest\b|tox\b|nox\b|swift\s+test\b|(?:flutter|dart)\s+test\b|bats\b)/i;

/** Each simple command in a command line, as its first few words ("npm run test"). */
function heads(cmd: string): string[] {
  return segments(cmd).map((seg) =>
    seg.words
      .filter((w, i, all) => !(/^[A-Za-z_]\w*=/.test(w) && all.slice(0, i).every((x) => /^[A-Za-z_]\w*=/.test(x))))
      .slice(0, 5)
      .map((w, i) => (i === 0 ? w.replace(/^.*\//, '') : w))
      .join(' '),
  );
}

// Commands that look around or manage the repo rather than run anything.
const INERT =
  /^(?:git|gh|ls|cat|head|tail|grep|rg|ag|find|fd|echo|printf|sed|awk|wc|pwd|cd|which|type|stat|file|diff|tree|less|more|mkdir|touch|cp|mv|rm|chmod|open|code|cursor|clear|true|false|sleep|export|set|source|\.|buzzcut)$/;

const MAX_BYTES = 50 * 1024 * 1024;
const KEYS = new Set(['command', 'CommandLine', 'commandLine', 'command_line', 'cmd']);

function collect(v: unknown, out: string[], depth = 0): void {
  if (depth > 12 || !v || typeof v !== 'object') return;
  if (Array.isArray(v)) {
    for (const x of v) collect(x, out, depth + 1);
    return;
  }
  for (const [k, x] of Object.entries(v)) {
    if (KEYS.has(k) && typeof x === 'string' && /\s|^\w+$/.test(x.trim()) && !x.startsWith('/')) out.push(x);
    else collect(x, out, depth + 1);
  }
}

/** Every command string in a transcript, in order. Works on JSONL and on plain JSON. */
export function transcriptCommands(text: string): string[] {
  const out: string[] = [];
  const lines = text.split('\n');
  let parsedAny = false;
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('{') && !t.startsWith('[')) continue;
    try {
      collect(JSON.parse(t), out);
      parsedAny = true;
    } catch {
      // not a JSON line
    }
  }
  if (!parsedAny) {
    try {
      collect(JSON.parse(text), out);
    } catch {
      // unknown format: no commands
    }
  }
  return out;
}

/** The programs a command line runs, e.g. "cd app && npm test | tee x" → ["cd", "npm", "tee"]. Heredoc bodies aren't commands. */
function programs(cmd: string): string[] {
  return segments(cmd)
    .map((seg) => seg.words.find((w) => !/^[A-Za-z_]\w*=/.test(w)) ?? '')
    .map((p) => p.replace(/^.*\//, ''))
    .filter((p) => /^[\w.+-]+$/.test(p));
}

export function sessionFacts(commands: string[], extra: Pick<SessionFacts, 'text' | 'hasOutput' | 'testCounts'> = {}): SessionFacts {
  const isTest = (c: string) => heads(c).some((h) => TEST_CMD.test(h));
  const tests = commands.filter(isTest);
  const exercised = commands.filter((c) => isTest(c) || programs(c).some((p) => !INERT.test(p)));
  return { tests, exercised, ...extra };
}

// ─── what the commands printed, and what the user said ───────────────────────

const MAX_TEXT = 1_500_000;
// A long output keeps its head and its tail: a test run's summary is the last thing it prints.
const HEAD = 10_000;
const TAIL = 30_000;

// A count is a number attached to a test-summary phrase, however each runner words it:
//   "212 passed"  "14 tests"  "Tests: 212"  "Tests run: 14"  "passed (413)"  "Ran 14 tests"  "12 of 12"
const N = String.raw`(\d[\d,]*)(?![\d.]*\d)(?!\s?(?:ms|s|sec|secs|seconds|m|min)\b)`;
const COUNT_PATTERNS = [
  new RegExp(String.raw`(?<![\w.])${N}\s+(?:tests?|specs?|cases?|examples?|assertions?|checks?|suites?|passed|passing|pass|failed|failing|failures?|skipped|total|ok)\b`, 'gi'),
  new RegExp(String.raw`\b(?:tests?|specs?|examples?)(?:\s+(?:files?|suites?))?\s*[:=]\s*${N}`, 'gi'),
  new RegExp(String.raw`\b(?:tests?|specs?|examples?)\s+run\s*[:=]?\s*${N}`, 'gi'),
  new RegExp(String.raw`\b(?:passed|passing|failed|failures?)\s*[:=(]\s*${N}`, 'gi'),
  new RegExp(String.raw`\bran\s+${N}\b`, 'gi'),
  new RegExp(String.raw`(?<![\w.])${N}\s+of\s+${N}(?![\w.])`, 'gi'),
];

/**
 * The whole numbers a test run printed as counts. Each has to sit on a summary phrase
 * ("212 passed", "Tests run: 14"), so a stray number near the word "test" doesn't count as a result.
 */
export function testCountsIn(output: string): number[] {
  const out = new Set<number>();
  for (const line of output.split('\n')) {
    if (line.length > 400) continue;
    for (const re of COUNT_PATTERNS) {
      for (const m of line.matchAll(re)) {
        for (const g of m.slice(1)) {
          const n = Number(g?.replace(/,/g, ''));
          if (g && Number.isSafeInteger(n)) out.add(n);
        }
      }
    }
  }
  return [...out];
}

interface Block {
  type?: string;
  text?: string;
  content?: unknown;
}

const asText = (v: unknown): string =>
  typeof v === 'string' ? v : Array.isArray(v) ? v.map((b) => (b && typeof b === 'object' && typeof (b as Block).text === 'string' ? (b as Block).text : '')).join('\n') : '';

/**
 * Command output and user messages from a Claude Code transcript (JSONL): `tool_result` blocks in
 * user entries are output, text in user entries is the user's. Other agents' transcripts don't
 * carry output in this shape, so for them `hasOutput` stays false and nothing is judged.
 */
export function transcriptText(text: string): { text: string; hasOutput: boolean; testCounts: number[] } {
  const parts: string[] = [];
  const counts = new Set<number>();
  let hasOutput = false;
  let size = 0;
  const keep = (s: string) => {
    if (!s || size > MAX_TEXT) return;
    const cut = s.length > HEAD + TAIL ? s.slice(0, HEAD) + '\n…\n' + s.slice(-TAIL) : s;
    parts.push(cut);
    size += cut.length;
  };
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let entry: { type?: string; message?: { content?: unknown } };
    try {
      entry = JSON.parse(t);
    } catch {
      continue;
    }
    if (entry.type !== 'user') continue;
    const content = entry.message?.content;
    if (typeof content === 'string') {
      keep(content);
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const b of content as Block[]) {
      if (b.type === 'tool_result') {
        hasOutput = true;
        const out = asText(b.content);
        for (const n of testCountsIn(out)) counts.add(n);
        keep(out);
      } else if (b.type === 'text') keep(b.text ?? '');
    }
  }
  return { text: parts.join('\n'), hasOutput, testCounts: [...counts] };
}

/** Session facts from a transcript file, or null when it can't be read. */
export function readSession(path: string): SessionFacts | null {
  try {
    if (statSync(path).size > MAX_BYTES) return null;
    const raw = readFileSync(path, 'utf8');
    return sessionFacts(transcriptCommands(raw), transcriptText(raw));
  } catch {
    return null;
  }
}
