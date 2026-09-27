// The corpus eval: every cached PR next to buzzcut's version of it, judged blind.
//
//   npm run build && node bench/eval/corpus/run.mjs --run r1 [--split tune|test] [--set agent]
//     [--only <url,url>] [--sample N] [--jobs 8] [--no-judge]
//
// What "buzzcut's version" means depends on who wrote the PR:
//   agent PRs   the PR an agent with buzzcut installed writes: the skill, `buzzcut context` for
//               the real diff, then `buzzcut pr` until it passes (at most 3 drafts). The original
//               PR is the agent's notes from its session: keep its facts, add none.
//   people      buzzcut as the team's GitHub Action. A PR that passes is left as it is; one that's
//               sent back is edited only as far as the feedback asks, as its author would.
// A judge who never learns which is which then reads the diff and both descriptions.
//
// Writer and judge are Claude Sonnet 5 through your Claude login (`claude -p`); override with
// --model. Results append to runs/<run>/*.jsonl, so an interrupted run picks up where it stopped.
// Needs the real diffs: node bench/fetch-diffs.mjs.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  analyze, buildDiff, contextOf, DEFAULT_CONFIG, isGenerated, keepableEvidence, parseTemplate, passes, prMessage, renderContext, renderReport,
} from '../../../dist/index.js';

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const RUN = arg('--run', 'r1');
const SPLIT = arg('--split', null);
const SET = arg('--set', null);
const ONLY = arg('--only', null)?.split(',').map((u) => u.trim()).filter(Boolean) ?? null;
const SAMPLE = Number(arg('--sample', 0));
const JOBS = Number(arg('--jobs', 8));
const MODEL = arg('--model', 'claude-sonnet-5');
const JUDGE = !process.argv.includes('--no-judge');
const MAX = DEFAULT_CONFIG.max;

const HERE = new URL('./', import.meta.url);
const CACHE = new URL('../../cache/', import.meta.url);
const OUT = new URL(`runs/${RUN}/`, HERE);
mkdirSync(OUT, { recursive: true });
const h = (s) => createHash('sha1').update(s).digest('hex');

// ─── the corpus and its split ──────────────────────────────────────────────────────────────
// Tuning happens on 70% of the repos; the other 30% are only ever measured. Split by repo, so
// one project's habits can't be in both.
const inTest = (repo) => parseInt(h(`split:${repo}`).slice(0, 8), 16) % 10 >= 7;
const skipped = (it) => DEFAULT_CONFIG.ignore.some((re) => re.test(it.title));
const all = readdirSync(CACHE)
  .filter((f) => /__pr\d+\.json$/.test(f))
  .map((f) => ({ ...JSON.parse(readFileSync(new URL(f, CACHE), 'utf8')), key: f.replace(/\.json$/, '') }))
  .filter((it) => it.kind === 'pr' && !skipped(it));
for (const it of all) it.split = inTest(it.repo) ? 'test' : 'tune';
if (!existsSync(new URL('split.json', HERE))) {
  const repos = (s) => [...new Set(all.filter((it) => it.split === s).map((it) => it.repo))].sort();
  writeFileSync(new URL('split.json', HERE), JSON.stringify({ rule: "sha1('split:' + repo), first 8 hex digits, mod 10 >= 7 is test", tune: repos('tune'), test: repos('test') }, null, 1) + '\n');
}

const sizeOf = (lines) => (lines < 30 ? 'tiny' : lines < 300 ? 'normal' : 'big');
const diffOf = (it) => buildDiff(it.files, { additions: it.additions, deletions: it.deletions }, it.files.length < it.changedFiles);
const reportOf = (it, title, body, previous = null) =>
  analyze(prMessage(title, body), diffOf(it), { template: it.template ? parseTemplate([it.template]) : null, previous });
const rawDiff = (it) => {
  const f = new URL(`diffs/${it.key}.diff`, CACHE);
  return existsSync(f) ? readFileSync(f, 'utf8') : null;
};

// The diff a writer or judge reads: lockfiles and generated files dropped, each file cut at 12 KB
// and the whole at `max`, with a note of what was cut.
function readableDiff(text, max) {
  const files = text.split(/(?=^diff --git )/m);
  const kept = [];
  const dropped = [];
  let size = 0;
  for (const f of files) {
    const path = f.match(/^diff --git a\/\S+ b\/(\S+)/)?.[1];
    if (path && isGenerated(path)) {
      dropped.push(path);
      continue;
    }
    let part = f.length > 12_000 ? `${f.slice(0, 12_000)}\n[… rest of this file's diff cut]\n` : f;
    if (size + part.length > max) {
      dropped.push(path ?? '?');
      continue;
    }
    size += part.length;
    kept.push(part);
  }
  const note = dropped.length ? `\n[${dropped.length} more file${dropped.length > 1 ? 's' : ''} not shown (lockfiles, generated or past the size limit): ${dropped.slice(0, 15).join(', ')}${dropped.length > 15 ? ', …' : ''}]\n` : '';
  return kept.join('') + note;
}

// Tool footers, badges and bot summaries aren't the author's writing, and they'd give the
// original away to the judge.
function clean(body) {
  return (body ?? '')
    .replace(/\r/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<div><a href="https:\/\/cursor\.com[\s\S]*?<\/div>/g, '')
    .replace(/<a href="https:\/\/app\.devin\.ai\/review[\s\S]*?<\/a>/g, '')
    .replace(/<details><summary><h3>Greptile Summary[\s\S]*$/m, '')
    .replace(/^.*Generated with \[Claude Code\].*$/gm, '')
    .replace(/^.*(?:Co-authored-by|Co-Authored-By):.*$/gm, '')
    .replace(/^\*PR created automatically by Jules.*$/gm, '')
    .replace(/^.*(?:Link to Devin session|Requested by|Amp-Thread-ID|Devin run):.*$/gm, '')
    .replace(/^\[.*\]\(https:\/\/(?:cursor\.com|chatgpt\.com\/codex|app\.devin\.ai|jules\.google)[^)]*\).*$/gm, '')
    .replace(/^---\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── Claude ────────────────────────────────────────────────────────────────────────────────
const SCRATCH = new URL('../../../node_modules/.cache/buzzcut-eval/', import.meta.url);
mkdirSync(SCRATCH, { recursive: true });
let spent = 0;
function claude(system, prompt) {
  const once = () =>
    new Promise((resolve) => {
      const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^CLAUDE(CODE|_CODE_)/.test(k)));
      const p = spawn(
        'claude',
        ['-p', '--model', MODEL, '--output-format', 'json', '--tools', '', '--system-prompt', system, '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands', '--no-session-persistence'],
        { env, cwd: SCRATCH.pathname },
      );
      let out = '';
      p.stdout.on('data', (b) => (out += b));
      p.on('close', () => {
        try {
          const j = JSON.parse(out);
          spent += j.total_cost_usd ?? 0;
          resolve(j.is_error ? { error: String(j.result).slice(0, 200) } : { text: j.result ?? '', cost: j.total_cost_usd ?? 0 });
        } catch {
          resolve({ error: out.slice(0, 200) || 'no output' });
        }
      });
      p.stdin.end(prompt);
    });
  return (async () => {
    let r;
    for (let attempt = 0; attempt < 5; attempt++) {
      r = await once();
      if (!r.error) return r;
      if (attempt < 4) await new Promise((ok) => setTimeout(ok, 15_000 * (attempt + 1)));
    }
    return r;
  })();
}

const SKILL = readFileSync(new URL('../../../skills/buzzcut/SKILL.md', import.meta.url), 'utf8')
  .replace(/^---[\s\S]*?---\n/, '')
  .replace(/## Workflow[\s\S]*?(?=## Keep the facts)/, '');

const WRITER = `You are the software engineer who just made a code change, writing its pull request description for the reviewer. Follow these writing rules exactly.\n\n${SKILL}`;

// Models sometimes put a note or a code fence around the PR; keep only the PR.
function parsePr(text) {
  let t = text.trim().replace(/^```\w*\n([\s\S]*?)\n```$/m, '$1').trim();
  const lines = t.split('\n');
  const rule = lines.findIndex((l, i) => i < 12 && /^\s*(---+|\*\*\*+)\s*$/.test(l));
  if (rule > 0 && rule < lines.length - 2) t = lines.slice(rule + 1).join('\n').trim();
  const [title = '', ...rest] = t.split('\n');
  return { title: title.replace(/^#+\s*/, '').replace(/^Title:\s*/i, '').trim(), body: rest.join('\n').replace(/^\s*\n/, '').trimEnd() };
}

const facts = (r) => ({ words: r.words, score: r.score, grade: r.grade, pass: passes(r, MAX), rules: r.findings.map((f) => `${f.rule}:${f.severity[0]}`) });

// ─── buzzcut's version ─────────────────────────────────────────────────────────────────────
async function agentVersion(it, before) {
  const diff = diffOf(it);
  const context = renderContext(contextOf('pr', diff)).split('\nNext:')[0];
  const notes = `${it.title}\n\n${clean(it.body)}`;
  const first = await claude(
    WRITER,
    `You made the change in the diff below. Your notes from the session (the description you first jotted down) follow it: everything in them is true, and they are all you know about why the change was made and how it was checked. Write the pull request description.

- Keep every fact from the notes a reviewer needs, unless the diff contradicts it. Add nothing that isn't in the diff or the notes.
- The why and the Tested line come only from the notes. If the notes don't say what was run, write "Not tested:" and what should be checked. A test plan or "How to test" list is a plan, not a result: only steps the notes say were run, with a result or a ticked box, count as tested.
- Write as the author. Never mention "the notes" or "the session" in the PR.
- Output only the PR: the title on the first line, a blank line, then the body. No preamble.

# buzzcut context
${context}

# The diff
${readableDiff(rawDiff(it), 60_000)}

# Your notes
${notes}`,
  );
  if (first.error) return { error: first.error };
  const drafts = [parsePr(first.text)];
  let cost = first.cost;
  // The skill's loop: check, fix every ✗, apply the ! advice unless it would cut a fact, check
  // again until it passes. At most 3 drafts.
  for (let round = 1; round < 3; round++) {
    const d = drafts.at(-1);
    const previous = round > 1 ? { evidence: keepableEvidence(prMessage(drafts[0].title, drafts[0].body), reportOf(it, drafts[0].title, drafts[0].body)), strict: false } : null;
    const r = reportOf(it, d.title, d.body, previous);
    const failing = !passes(r, MAX);
    const advice = r.findings.some((f) => f.severity === 'warn');
    if (!failing && (!advice || round > 1)) break;
    const next = await claude(
      WRITER,
      `You ran \`buzzcut pr\` on your pull request description. Fix every ✗ line. Apply each ! line unless that would remove a fact the reviewer needs; if a finding is wrong for this change, leave the text as it is. Never add a fact to satisfy a finding: if the notes don't say why, leave the why out. Output only the fixed PR: the title on the first line, a blank line, then the body.

# buzzcut context
${context}

# Your notes from the session
${notes}

# Your draft
${d.title}

${d.body}

# buzzcut pr
${renderReport(r, { color: false, max: MAX, label: 'pr' })}`,
    );
    if (next.error) break;
    cost += next.cost;
    drafts.push(parsePr(next.text));
  }
  const out = drafts.at(-1);
  return { ...out, drafts: drafts.length, cost };
}

async function authorEdit(it, before) {
  // A PR that passes is left alone: that's the GitHub Action's job done.
  if (passes(before, MAX)) return { title: it.title, body: it.body, drafts: 0, cost: 0, unchanged: true };
  const context = renderContext(contextOf('pr', diffOf(it))).split('\nNext:')[0];
  let d = { title: it.title, body: it.body };
  let cost = 0;
  let drafts = 0;
  for (let round = 0; round < 3; round++) {
    const r = reportOf(it, d.title, d.body);
    if (passes(r, MAX)) break;
    const next = await claude(
      'You are a software engineer editing the description of your own pull request after a check on it failed.',
      `Your team's buzzcut check sent your PR description back with the feedback below. Edit it only as far as the feedback asks: fix every ✗ line, keep everything else as you wrote it, and keep every fact. Output only the PR: the title on the first line, a blank line, then the body.

# buzzcut context
${context}

# Your PR description
${d.title}

${d.body}

# buzzcut's feedback
${renderReport(r, { color: false, max: MAX, label: 'pr' })}`,
    );
    if (next.error) return { error: next.error };
    cost += next.cost;
    drafts++;
    d = parsePr(next.text);
  }
  return { ...d, drafts, cost };
}

// ─── the blind judge ───────────────────────────────────────────────────────────────────────
const JUDGE_SYSTEM = 'You are a senior software engineer who reviews pull requests every day. You judge PR descriptions by one standard: can a reviewer understand what changed and why, correctly, without asking anyone.';

async function judge(it, a, b) {
  const res = await claude(
    JUDGE_SYSTEM,
    `Below is a code change and two descriptions of it, A and B (title first). Both were written for this change by people who worked on it, so either may know things the diff doesn't show, like why it was made or what was run to test it. Judge them as the reviewer of this PR.

Answer in JSON only, no other text:
{
  "prefer": "A" | "B" | "tie",
  "reason": one sentence,
  "A": {
    "what_and_why": true if its first one or two sentences say what changed and why,
    "length": "too_short" | "right" | "too_long", for this diff,
    "shape": "cramped" | "good" | "sprawling": cramped if facts are crammed into dense prose that is hard to scan, sprawling if it is padded with template sections, repetition or a wall of bullets,
    "understood_in_30s": true if a reviewer would know what changed and why within 30 seconds,
    "missing": facts a reviewer needs that A leaves out but the diff or B has, as short phrases (behavior changes, why, risks, what was tested); not things the file list already shows,
    "unsupported": claims in A that the diff contradicts, or that neither the diff nor B supports (invented tests, results, numbers, behavior, motivation), quoted briefly
  },
  "B": { the same fields }
}

# The change
${readableDiff(rawDiff(it), 40_000)}

# A
${a.title}

${a.body}

# B
${b.title}

${b.body}`,
  );
  if (res.error) return { error: res.error };
  try {
    const t = res.text;
    return { ...JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)), cost: res.cost };
  } catch {
    return { error: `unparseable: ${res.text.slice(0, 120)}` };
  }
}

// ─── the fact check ───────────────────────────────────────────────────────────────────────
// The blind judge can't tell an invented reason from one the author knew, since either side may
// know things the diff doesn't show. This check isn't blind: it holds buzzcut's version against
// the diff and the notes it was written from.
async function factCheck(it, notes, version) {
  const context = renderContext(contextOf('pr', diffOf(it))).split('\nShape for')[0];
  const res = await claude(
    'You fact-check pull request descriptions against the code change and the author\'s notes. You are strict and literal.',
    `A pull request description was written from three sources: the code change (the diff), its line counts (the diffstat), and the author's notes from their session (what they knew about why the change was made and what they ran). Check the description against them.

Supported, so never list these: a fair reading of the diff (what the code now does, and the plain purpose of a change it makes); line counts and file counts from the diffstat; a "Not tested:" line, with what to check, when the notes don't report running anything.

Answer in JSON only, no other text:
{
  "invented_verification": claims that something was run, tested or checked, or passed, that the notes don't report as done (a test plan or "How to test" list is not a report that it ran), quoted briefly,
  "invented_reason": a reason, motivation, history or problem ("we had no way to…", "users kept hitting…") that neither the notes nor the diff states, quoted briefly,
  "invented_other": any other claim neither source supports (a number, a behavior, a risk), quoted briefly,
  "wrong": claims the diff contradicts, quoted briefly,
  "dropped": facts in the notes a reviewer needs that the description leaves out (why, behavior changes, risks, what was tested and its result), as short phrases. Not formatting, links to tools, or restatements of the diff's file list.
}

# The diffstat
${context}

# The diff
${readableDiff(rawDiff(it), 60_000)}

# The author's notes
${notes}

# The description
${version.title}

${version.body}`,
  );
  if (res.error) return { error: res.error };
  try {
    const t = res.text;
    return { ...JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)), cost: res.cost };
  } catch {
    return { error: `unparseable: ${res.text.slice(0, 120)}` };
  }
}

// ─── run ───────────────────────────────────────────────────────────────────────────────────
const done = new Set(existsSync(new URL('results.jsonl', OUT)) ? readFileSync(new URL('results.jsonl', OUT), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).url) : []);
let todo = all.filter((it) => (!SPLIT || it.split === SPLIT) && (!SET || it.set === SET) && (!ONLY || ONLY.includes(it.url)) && rawDiff(it) && !done.has(it.url));
if (SAMPLE) {
  // Stratified by set, size and source, in a fixed hashed order.
  const groups = new Map();
  for (const it of [...todo].sort((x, y) => h(`sample:${x.url}`).localeCompare(h(`sample:${y.url}`)))) {
    const k = `${it.set}/${sizeOf(diffOf(it).changedLines)}/${it.source ?? ''}`;
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  const picked = [];
  for (let i = 0; picked.length < SAMPLE && [...groups.values()].some((g) => g.length > i); i++) for (const g of groups.values()) if (g[i] && picked.length < SAMPLE) picked.push(g[i]);
  todo = picked;
}
console.log(`${RUN}: ${todo.length} PRs to run (${done.size} done before), writer and judge ${MODEL}`);

let n = 0;
async function worker() {
  while (todo.length) {
    const it = todo.shift();
    const before = reportOf(it, it.title, it.body);
    const lines = diffOf(it).changedLines;
    const version = it.set === 'agent' ? await agentVersion(it, before) : await authorEdit(it, before);
    const row = { url: it.url, set: it.set, source: it.source ?? null, split: it.split, size: sizeOf(lines), lines, original: { title: it.title, ...facts(before) } };
    if (version.error) {
      appendFileSync(new URL('errors.jsonl', OUT), JSON.stringify({ url: it.url, stage: 'write', error: version.error }) + '\n');
      continue;
    }
    const after = reportOf(it, version.title, version.body);
    Object.assign(row, { output: { title: version.title, body: version.body, drafts: version.drafts, ...facts(after) }, unchanged: !!version.unchanged, cost: version.cost });
    if (JUDGE && !version.unchanged) {
      const original = { title: it.title, body: clean(it.body) };
      const buzzIsA = parseInt(h(`order:${it.url}`).slice(0, 8), 16) % 2 === 0;
      const v = await judge(it, buzzIsA ? version : original, buzzIsA ? original : version);
      if (v.error) appendFileSync(new URL('errors.jsonl', OUT), JSON.stringify({ url: it.url, stage: 'judge', error: v.error }) + '\n');
      else {
        const side = (s) => (s === 'tie' ? 'tie' : (s === 'A') === buzzIsA ? 'buzzcut' : 'original');
        row.judge = { prefer: side(v.prefer), reason: v.reason, buzzcut: buzzIsA ? v.A : v.B, original: buzzIsA ? v.B : v.A };
        row.cost += v.cost;
      }
    }
    if (JUDGE && !version.unchanged) {
      const c = await factCheck(it, `${it.title}\n\n${clean(it.body)}`, version);
      if (c.error) appendFileSync(new URL('errors.jsonl', OUT), JSON.stringify({ url: it.url, stage: 'check', error: c.error }) + '\n');
      else {
        row.check = { verification: c.invented_verification ?? [], reason: c.invented_reason ?? [], other: c.invented_other ?? [], wrong: c.wrong ?? [], dropped: c.dropped ?? [] };
        row.cost += c.cost;
      }
    }
    appendFileSync(new URL('results.jsonl', OUT), JSON.stringify(row) + '\n');
    if (++n % 25 === 0) console.log(`  ${n} done, $${spent.toFixed(2)} so far`);
  }
}
await Promise.all(Array.from({ length: JOBS }, worker));
console.log(`${RUN}: ${n} PRs, $${spent.toFixed(2)}`);
