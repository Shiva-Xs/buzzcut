// Un-blinds the judge's verdicts with key.json and counts them: who was preferred, and how many
// facts each side was missing or made up, per comparison and size.
//   node bench/eval/format/tally.mjs <out-dir of judge-prep.mjs> > bench/eval/format/judged.json
import { readFileSync, readdirSync } from 'node:fs';
const S = process.argv[2] ?? `${process.env.TMPDIR ?? '/tmp'}/buzzcut-format-judge`;
const key = JSON.parse(readFileSync(`${S}/key.json`, 'utf8'));
const rows = [];
for (const f of readdirSync(`${S}/out`)) {
  const cmp = f.split('-')[0];
  for (const j of JSON.parse(readFileSync(`${S}/out/${f}`, 'utf8'))) {
    const k = key[`${cmp}/${j.id}`];
    if (!k) { console.error('no key', cmp, j.id); continue; }
    const newSide = k.new, otherSide = newSide === 'A' ? 'B' : 'A';
    const winner = j.prefer === 'tie' ? 'tie' : j.prefer === newSide ? 'new' : 'other';
    rows.push({ cmp, id: j.id, key: k.key, size: k.size, winner, reason: j.reason,
      missingNew: j[`missing_${newSide}`] ?? [], missingOther: j[`missing_${otherSide}`] ?? [],
      unsupNew: j[`unsupported_${newSide}`] ?? [], unsupOther: j[`unsupported_${otherSide}`] ?? [] });
  }
}
for (const cmp of ['orig', 'old']) {
  for (const size of ['tiny', 'normal', 'big', 'all']) {
    const r = rows.filter((x) => x.cmp === cmp && (size === 'all' || x.size === size));
    const c = (w) => r.filter((x) => x.winner === w).length;
    const sum = (f) => r.reduce((n, x) => n + x[f].length, 0);
    const clean = (f) => r.filter((x) => x[f].length === 0).length;
    console.error(`${cmp.padEnd(4)} ${size.padEnd(6)} n=${r.length} new ${c('new')} other ${c('other')} tie ${c('tie')} | missing facts new ${sum('missingNew')} other ${sum('missingOther')} | unsupported new ${sum('unsupNew')} other ${sum('unsupOther')} | nothing unsupported: new ${clean('unsupNew')} other ${clean('unsupOther')}`);
  }
}
console.log(JSON.stringify(rows, null, 1));
