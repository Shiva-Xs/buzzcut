// Numbers from a corpus eval run: node bench/eval/corpus/summary.mjs <run> [--split test] [--losses]
import { readFileSync } from 'node:fs';

const RUN = process.argv[2] ?? 'r1';
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const SPLIT = arg('--split', null);
const rows = readFileSync(new URL(`runs/${RUN}/results.jsonl`, import.meta.url), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .filter((r) => !SPLIT || r.split === SPLIT);
// A judge sometimes answers a list field with a sentence; read it as a one-item list.
const list = (v) => (Array.isArray(v) ? v : v ? [String(v)] : []);
for (const r of rows) {
  for (const k of ['verification', 'reason', 'other', 'wrong', 'dropped']) if (r.check) r.check[k] = list(r.check[k]);
  for (const s of ['buzzcut', 'original']) if (r.judge?.[s]) for (const k of ['missing', 'unsupported']) r.judge[s][k] = list(r.judge[s][k]);
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-');
const count = (xs, f) => xs.filter(f).length;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

function table(name, xs) {
  const j = xs.filter((r) => r.judge);
  if (!j.length) return;
  const side = (s, f) => count(j, (r) => f(r.judge[s]));
  const line = (label, f) => `${label.padEnd(22)} buzzcut ${pct(side('buzzcut', f), j.length).padStart(4)}   original ${pct(side('original', f), j.length).padStart(4)}`;
  console.log(`\n${name}: ${j.length} judged`);
  console.log(`  preferred              buzzcut ${pct(count(j, (r) => r.judge.prefer === 'buzzcut'), j.length)}, original ${pct(count(j, (r) => r.judge.prefer === 'original'), j.length)}, tie ${pct(count(j, (r) => r.judge.prefer === 'tie'), j.length)}`);
  console.log(`  ${line('what and why first', (s) => s?.what_and_why === true)}`);
  console.log(`  ${line('understood in 30 s', (s) => s?.understood_in_30s === true)}`);
  console.log(`  ${line('length right', (s) => s?.length === 'right')}`);
  console.log(`  ${line('too short', (s) => s?.length === 'too_short')}`);
  console.log(`  ${line('too long', (s) => s?.length === 'too_long')}`);
  console.log(`  ${line('shape good', (s) => s?.shape === 'good')}`);
  console.log(`  ${line('cramped', (s) => s?.shape === 'cramped')}`);
  console.log(`  ${line('sprawling', (s) => s?.shape === 'sprawling')}`);
  console.log(`  ${line('missing a fact', (s) => s?.missing?.length > 0)}`);
  console.log(`  ${line('unsupported claim', (s) => s?.unsupported?.length > 0)}`);
  const f = xs.filter((r) => r.check);
  if (f.length) {
    const has = (k) => pct(count(f, (r) => r.check[k]?.length > 0), f.length);
    console.log(`  fact check (${f.length})       invented: a test run ${has('verification')}, a reason ${has('reason')}, other ${has('other')}; contradicts the diff ${has('wrong')}; dropped a needed fact ${has('dropped')}`);
  }
  console.log(`  median words           original ${median(xs.map((r) => r.original.words))}, buzzcut ${median(xs.map((r) => r.output.words))}; buzzcut's version passes ${pct(count(xs, (r) => r.output.pass), xs.length)}`);
}

for (const s of [...new Set(rows.map((r) => r.set))]) {
  const xs = rows.filter((r) => r.set === s);
  console.log(`\n=== ${s}: ${xs.length} PRs, ${count(xs, (r) => r.unchanged)} left unchanged by buzzcut`);
  table(`${s}, all sizes`, xs);
  for (const size of ['tiny', 'normal', 'big']) table(`${s}, ${size}`, xs.filter((r) => r.size === size));
  if (s === 'agent') {
    console.log('\nby agent source (preferred buzzcut / original / tie):');
    for (const src of [...new Set(xs.map((r) => r.source))].sort()) {
      const j = xs.filter((r) => r.source === src && r.judge);
      console.log(`  ${String(src).padEnd(18)} n=${String(j.length).padStart(4)}  ${pct(count(j, (r) => r.judge.prefer === 'buzzcut'), j.length)} / ${pct(count(j, (r) => r.judge.prefer === 'original'), j.length)} / ${pct(count(j, (r) => r.judge.prefer === 'tie'), j.length)}`);
    }
  }
}
console.log(`\ncost: $${rows.reduce((n, r) => n + (r.cost ?? 0), 0).toFixed(2)} for ${rows.length} PRs`);

if (process.argv.includes('--losses')) {
  console.log('\nwhere the original won:');
  for (const r of rows.filter((r) => r.judge?.prefer === 'original')) console.log(`- ${r.size} ${r.url}\n  ${r.judge.reason}`);
  for (const k of ['verification', 'reason', 'other', 'wrong']) {
    console.log(`\nfact check, ${k}:`);
    for (const r of rows.filter((r) => r.check?.[k]?.length)) console.log(`- ${r.size} ${r.url}\n  ${r.check[k].join(' | ')}`);
  }
}
