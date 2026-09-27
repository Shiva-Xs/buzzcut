// Tunes the PR word budget (the ceiling of wordRange) on data instead of by feel. For each
// candidate formula a + b·√(changed lines), floor m, it reports:
//   - how many of the 30 new-shape descriptions in descriptions/ go over the length rule's
//     warning line (1.3× the budget, after the specificity bonus): these are the target shape,
//     so the right budget flags none of them;
//   - how often the length rule would fire on PRs from before AI, people in 2026, and agents.
//   npm run build && node bench/eval/format/budget.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { analyze, buildDiff, DEFAULT_CONFIG, parseTemplate, prMessage } from '../../../dist/index.js';

const HERE = new URL('./', import.meta.url);
const CACHE = new URL('../../cache/', import.meta.url);
const load = (f) => JSON.parse(readFileSync(new URL(f, CACHE), 'utf8'));
const diffOf = (it) => buildDiff(it.files, { additions: it.additions, deletions: it.deletions }, it.files.length < it.changedFiles);

// Each item: its words, changed lines, and specificity bonus under the current rules. The bonus
// doesn't depend on the budget, so any formula can be checked from these three numbers.
function measure(it, title, body) {
  const r = analyze(prMessage(title, body), diffOf(it), { template: it.template ? parseTemplate([it.template]) : null });
  const base = Math.round(60 + 8 * Math.sqrt(r.diff.changedLines));
  const bonus = r.budget / Math.max(80, Math.min(500, base));
  return { words: r.words, lines: r.diff.changedLines, bonus };
}

const shaped = readdirSync(new URL('descriptions/', HERE))
  .filter((f) => f.endsWith('.new.md'))
  .map((f) => {
    const [title, , ...rest] = readFileSync(new URL(`descriptions/${f}`, HERE), 'utf8').trimEnd().split('\n');
    return measure(load(f.replace('.new.md', '.json')), title, rest.join('\n'));
  });

const groups = { 'before AI': [], 'people 2026': [], agents: [] };
const set = { baseline: 'before AI', human: 'people 2026', agent: 'agents' };
for (const f of readdirSync(CACHE).filter((f) => f.endsWith('.json'))) {
  const it = load(f);
  if (it.kind !== 'pr' || DEFAULT_CONFIG.ignore.some((re) => re.test(it.title))) continue;
  groups[set[it.set]].push(measure(it, it.title, it.body ?? ''));
}

const budget = (x, a, b, m) => Math.round(Math.min(500, Math.max(m, a + b * Math.sqrt(x.lines))));
const flagged = (x, a, b, m) => x.words > 1.3 * Math.round(budget(x, a, b, m) * x.bonus);
// The same shape with fewer numbers and names in it: no specificity bonus.
const plain = (x, a, b, m) => x.words > 1.3 * budget(x, a, b, m);
const pct = (k, n) => `${((100 * k) / n).toFixed(1)}%`;
console.log('formula              shape flagged  (no bonus)   before AI    people 2026   agents');
for (const [a, b, m] of [[40, 6, 60], [50, 7, 70], [55, 7, 75], [60, 8, 80], [60, 6, 80], [70, 8, 90], [80, 10, 100]]) {
  const row = [
    `${a} + ${b}·√n, min ${m}`.padEnd(20),
    `${shaped.filter((x) => flagged(x, a, b, m)).length} of ${shaped.length}`.padStart(8),
    `${shaped.filter((x) => plain(x, a, b, m)).length} of ${shaped.length}`.padStart(10),
  ];
  for (const g of Object.values(groups)) row.push(`${pct(g.filter((x) => flagged(x, a, b, m)).length, g.length)} of ${g.length}`.padStart(13));
  console.log(row.join('  '));
}
const ratios = shaped.map((x) => x.words / Math.round(Math.min(500, Math.max(80, 60 + 8 * Math.sqrt(x.lines))))).sort((p, q) => p - q);
console.log(`\nnew-shape words ÷ budget (60 + 8·√n, before the bonus): median ${ratios[15].toFixed(2)}, max ${ratios.at(-1).toFixed(2)}`);
const floors = shaped.map((x) => x.words / Math.min(120, Math.max(15, Math.round(8 + 3 * Math.sqrt(x.lines))))).sort((p, q) => p - q);
console.log(`new-shape words ÷ floor (8 + 3·√n): min ${floors[0].toFixed(2)}, median ${floors[15].toFixed(2)}`);
