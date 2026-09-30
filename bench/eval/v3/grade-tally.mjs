// Unblinds the grades and tallies them per arm.
//   node bench/eval/v3/grade-tally.mjs <round> <set>[,<set>...]     e.g. 1 devR,devT
//   node bench/eval/v3/grade-tally.mjs 1 devR --audit 8              prints 8 random packets with their grades, for a spot-check
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const [round, setArg, flag, nAudit] = process.argv.slice(2);
const sets = (setArg ?? '').split(',').filter(Boolean);
if (!round || !sets.length) {
  console.error('usage: grade-tally.mjs <round> <set>[,<set>...] [--audit N]');
  process.exit(2);
}
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const rows = []; // one per (set, pr, arm)
for (const set of sets) {
  const base = here(`grade/${set}/r${round}`);
  const key = read(`${base}/key.json`);
  const manifest = Object.fromEntries(read(here(`manifest-${set.slice(0, -1)}.json`)).map((m) => [m.id, m]));
  for (const [id, labels] of Object.entries(key)) {
    const f = `${base}/out/${id}.json`;
    if (!existsSync(f)) continue;
    let g;
    try { g = read(f); } catch { console.error(`unreadable grade: ${f}`); continue; }
    const cl = existsSync(here(`grade/${set}/checklist/${id}.json`)) ? read(here(`grade/${set}/checklist/${id}.json`)) : [];
    for (const [letter, arm] of Object.entries(labels)) {
      const e = g[letter];
      if (!e || g.rank?.[letter] == null) continue;
      rows.push({ set, id, arm, size: manifest[id].size, rank: g.rank[letter], facts: cl.length, kept: Math.min(cl.length, new Set(e.kept ?? []).size), unsupported: (e.unsupported ?? []).length, testing: Boolean(e.testing_claim) });
    }
  }
}
if (flag === '--audit') {
  const pick = [...new Set(rows.map((r) => `${r.set}/${r.id}`))].sort((a, b) => createHash('sha1').update(a).digest('hex').localeCompare(createHash('sha1').update(b).digest('hex'))).slice(0, Number(nAudit ?? 8));
  for (const p of pick) {
    const [set, id] = p.split('/');
    console.log(readFileSync(here(`grade/${set}/r${round}/packets/${id}.txt`), 'utf8'));
    console.log(`\n>>> GRADE ${set}/${id}:\n${readFileSync(here(`grade/${set}/r${round}/out/${id}.json`), 'utf8')}\n${'='.repeat(70)}\n`);
  }
  process.exit(0);
}
const arms = [...new Set(rows.map((r) => r.arm))];
const byPr = {};
for (const r of rows) ((byPr[`${r.set}/${r.id}`] ??= {})[r.arm] = r);
const prs = Object.values(byPr);
console.log(`graded PRs: ${prs.length} (${sets.join(', ')}), round ${round}\n`);
const table = (label, pick) => {
  console.log(`${label}`);
  console.log('| arm | PRs | mean rank | best | worst | facts kept | PRs missing a fact | unsupported claims (PRs) | testing claims the notes lack |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const a of arms) {
    const mine = rows.filter((r) => r.arm === a && pick(r));
    if (!mine.length) continue;
    let best = 0, worst = 0;
    for (const p of prs) {
      const rs = Object.values(p).filter((r) => pick(r));
      if (rs.length < 2 || !p[a] || !pick(p[a]) || new Set(rs.map((r) => r.rank)).size === 1) continue;
      const mn = Math.min(...rs.map((r) => r.rank)), mx = Math.max(...rs.map((r) => r.rank));
      if (p[a].rank === mn) best += 1 / rs.filter((r) => r.rank === mn).length;
      if (p[a].rank === mx) worst += 1 / rs.filter((r) => r.rank === mx).length;
    }
    const f = mine.filter((r) => r.facts > 0);
    console.log(`| ${a} | ${mine.length} | ${mean(mine.map((r) => r.rank)).toFixed(2)} | ${best.toFixed(1)} | ${worst.toFixed(1)} | ${f.length ? Math.round((100 * f.reduce((n, r) => n + r.kept, 0)) / f.reduce((n, r) => n + r.facts, 0)) + '%' : 'n/a'} | ${f.filter((r) => r.kept < r.facts).length} of ${f.length} | ${mine.reduce((n, r) => n + r.unsupported, 0)} (${mine.filter((r) => r.unsupported).length}) | ${mine.filter((r) => r.testing).length} |`);
  }
  console.log('');
};
table('All graded PRs', () => true);
for (const s of sets) table(`Set ${s}`, (r) => r.set === s);
for (const size of ['tiny', 'normal', 'big']) if (rows.some((r) => r.size === size)) table(`${size} PRs`, (r) => r.size === size);
console.log('Head to head (wins, losses, ties over PRs both were graded on):');
for (let i = 0; i < arms.length; i++) for (let j = i + 1; j < arms.length; j++) {
  let w = 0, l = 0, t = 0;
  for (const p of prs) if (p[arms[i]] && p[arms[j]]) { const a = p[arms[i]].rank, b = p[arms[j]].rank; a < b ? w++ : a > b ? l++ : t++; }
  console.log(`  ${arms[i]} vs ${arms[j]}: ${w}, ${l}, ${t}`);
}
writeFileSync(here(`grade/tally-r${round}-${sets.join('-')}.json`), JSON.stringify(rows, null, 1));
