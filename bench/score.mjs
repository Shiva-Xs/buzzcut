// Scores the cached corpus offline and writes what needs a human look.
//   npm run build && node bench/score.mjs
// Prints pass/block rates per group and how often each rule fires; writes
// bench/results.json and review/*.md (every blocked PR by a person, and more).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { analyze, buildDiff, DEFAULT_CONFIG, historyMessage, parseTemplate, passes, prMessage } from '../dist/index.js';

// Subjects buzzcut never judges (merges, reverts, releases, dependency bumps), as in the product.
const skipped = (it) => DEFAULT_CONFIG.ignore.some((re) => re.test(it.kind === 'pr' ? it.title : it.message.split('\n')[0]));

const CACHE = new URL('cache/', import.meta.url);
const REVIEW = new URL('review/', import.meta.url);
mkdirSync(REVIEW, { recursive: true });
const MAX = DEFAULT_CONFIG.max;

const items = readdirSync(CACHE).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(new URL(f, CACHE), 'utf8')));

function score(it) {
  const diff = buildDiff(it.files, { additions: it.additions, deletions: it.deletions }, it.kind === 'pr' && it.files.length < it.changedFiles);
  if (it.kind === 'pr') {
    const template = it.template ? parseTemplate([it.template]) : null;
    return analyze(prMessage(it.title, it.body), diff, { template });
  }
  // GitHub squash merges carry the PR description, and are judged as one (like `log` does).
  return analyze(historyMessage(it.message), diff);
}
const squash = (it) => it.kind === 'commit' && /\(#\d+\)\s*$/.test(it.message.split('\n')[0]);

const rows = [];
let skippedCount = 0;
for (const it of items) {
  if (skipped(it)) {
    skippedCount++;
    continue;
  }
  // What the product does: dependency bots and the like are skipped, coding agents are not.
  const r = score(it);
  rows.push({ it, r, pass: passes(r, MAX), errors: r.findings.filter((f) => f.severity === 'error').map((f) => f.rule) });
}

// "before AI": merged before June 2021, so certainly written by people (the ground truth).
// "2026": recent work by people in the same projects, some of it possibly AI-assisted.
const groups = {
  'PRs before AI': rows.filter((x) => x.it.kind === 'pr' && x.it.set === 'baseline'),
  'commits before AI': rows.filter((x) => x.it.kind === 'commit' && x.it.set === 'baseline' && !squash(x.it)),
  'PRs 2026 people': rows.filter((x) => x.it.kind === 'pr' && x.it.set === 'human'),
  'commits 2026 people': rows.filter((x) => x.it.kind === 'commit' && x.it.set === 'human' && !squash(x.it)),
  'PRs by agents': rows.filter((x) => x.it.kind === 'pr' && x.it.set === 'agent'),
  'commits by agents': rows.filter((x) => x.it.kind === 'commit' && x.it.set === 'agent' && !squash(x.it)),
  'squash merges': rows.filter((x) => squash(x.it)),
};

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const summary = {};
for (const [name, g] of Object.entries(groups)) {
  const grades = Object.fromEntries(['A', 'B', 'C', 'D', 'F'].map((k) => [k, g.filter((x) => x.r.grade === k).length]));
  const blocked = g.filter((x) => !x.pass).length;
  summary[name] = { n: g.length, blocked, grades, medianWords: median(g.map((x) => x.r.words)) };
  console.log(`${name.padEnd(20)} n=${String(g.length).padStart(3)}  blocked ${String(blocked).padStart(3)} (${pct(blocked, g.length).padStart(5)})  A ${grades.A} · B ${grades.B} · C ${grades.C} · D ${grades.D} · F ${grades.F}  · median ${summary[name].medianWords} words`);
}

console.log(`(${skippedCount} merges, reverts, releases and dependency bumps skipped, as buzzcut does)`);

// By agent source
console.log('\nagent PRs by source');
const sources = [...new Set(groups['PRs by agents'].map((x) => x.it.source))];
for (const s of sources) {
  const g = groups['PRs by agents'].filter((x) => x.it.source === s);
  const blocked = g.filter((x) => !x.pass).length;
  console.log(`  ${s.padEnd(18)} n=${String(g.length).padStart(3)}  blocked ${String(blocked).padStart(3)} (${pct(blocked, g.length)})  median ${median(g.map((x) => x.r.words))} words, median score ${median(g.map((x) => x.r.score))}`);
}

// Rule firing rates
console.log('\nrule fires (any severity / as error) per group');
const ruleIds = [...new Set(rows.flatMap((x) => x.r.findings.map((f) => f.rule)))].sort();
const head = Object.keys(groups).map((k) => k.replace(/ by | /, '/').slice(0, 15).padStart(16)).join('');
console.log(`  ${''.padEnd(22)}${head}`);
for (const id of ruleIds) {
  const cells = Object.values(groups).map((g) => {
    const any = g.filter((x) => x.r.findings.some((f) => f.rule === id)).length;
    const err = g.filter((x) => x.r.findings.some((f) => f.rule === id && f.severity === 'error')).length;
    return `${pct(any, g.length)}/${err}`.padStart(16);
  });
  console.log(`  ${id.padEnd(22)}${cells.join('')}`);
}

// Review files
const show = (x, bodyLines = 40) => {
  const text = x.it.kind === 'pr' ? `# ${x.it.title}\n${x.it.body}` : x.it.message;
  const lines = text.split('\n');
  return [
    `## ${x.it.url}`,
    `score ${x.r.score} ${x.r.grade} · ${x.r.words} words (budget ${x.r.budget}) · ${x.r.diff?.changedLines} lines, ${x.r.diff?.files.length} files, tests ${x.r.diff?.tests.length}${x.it.source ? ` · ${x.it.source}` : ''}`,
    ...x.r.findings.map((f) => `- ${f.severity === 'error' ? '✗' : f.severity === 'warn' ? '!' : '·'} ${f.rule}: ${f.message}${f.quote ? ` [${f.quote}]` : ''}`),
    '',
    '```',
    ...lines.slice(0, bodyLines),
    ...(lines.length > bodyLines ? [`… ${lines.length - bodyLines} more lines`] : []),
    '```',
    '',
  ].join('\n');
};
const write = (name, list, bodyLines) => writeFileSync(new URL(name, REVIEW), list.map((x) => show(x, bodyLines)).join('\n'));
write('before-ai-prs-blocked.md', groups['PRs before AI'].filter((x) => !x.pass));
write('before-ai-commits-blocked.md', groups['commits before AI'].filter((x) => !x.pass));
write('people-prs-blocked.md', groups['PRs 2026 people'].filter((x) => !x.pass));
write('people-prs-warned.md', groups['PRs 2026 people'].filter((x) => x.pass && x.r.score >= 15), 25);
write('people-commits-blocked.md', groups['commits 2026 people'].filter((x) => !x.pass));
write('agent-prs-blocked.md', groups['PRs by agents'].filter((x) => !x.pass), 60);
write('agent-prs-passed.md', groups['PRs by agents'].filter((x) => x.pass).sort((a, b) => b.r.words - a.r.words), 60);
write('agent-commits-blocked.md', groups['commits by agents'].filter((x) => !x.pass));
write('agent-commits-passed.md', groups['commits by agents'].filter((x) => x.pass).sort((a, b) => b.r.words - a.r.words), 40);

writeFileSync(
  new URL('results.json', import.meta.url),
  JSON.stringify(
    {
      summary,
      items: rows.map((x) => ({ url: x.it.url, set: x.it.set, kind: x.it.kind, source: x.it.source, score: x.r.score, grade: x.r.grade, pass: x.pass, words: x.r.words, rules: x.r.findings.map((f) => f.rule), errors: x.errors })),
    },
    null,
    1,
  ) + '\n',
);
