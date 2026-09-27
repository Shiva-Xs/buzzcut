// Prints the original PR and buzzcut's version side by side, with the judge's verdict and the
// fact check: node bench/eval/corpus/show.mjs <run> [url-substring …]
import { readFileSync } from 'node:fs';

const [RUN = 'v1', ...pick] = process.argv.slice(2);
const cache = (url) => {
  const [, o, r, n] = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  return JSON.parse(readFileSync(new URL(`../../cache/${o}__${r}__pr${n}.json`, import.meta.url), 'utf8'));
};
const rows = readFileSync(new URL(`runs/${RUN}/results.jsonl`, import.meta.url), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
for (const r of rows.filter((r) => !pick.length || pick.some((p) => r.url.includes(p)))) {
  const it = cache(r.url);
  console.log(`\n${'━'.repeat(100)}\n${r.url}  (${r.source}, ${r.lines} changed lines, ${r.size})\n${'━'.repeat(100)}`);
  console.log(`\n── ORIGINAL (${r.original.words} words, yap score ${r.original.score}) ──\n${it.title}\n\n${(it.body ?? '').trim()}`);
  console.log(`\n── BUZZCUT (${r.output.words} words, yap score ${r.output.score}, ${r.output.drafts} draft${r.output.drafts > 1 ? 's' : ''}) ──\n${r.output.title}\n\n${r.output.body}`);
  if (r.judge) console.log(`\n── JUDGE: prefers ${r.judge.prefer}. ${r.judge.reason}`);
  if (r.check) {
    const found = Object.entries(r.check).filter(([, v]) => (Array.isArray(v) ? v.length : v));
    console.log(`── FACT CHECK: ${found.length ? found.map(([k, v]) => `${k}: ${[].concat(v).join(' | ')}`).join('\n   ') : 'nothing invented, nothing dropped'}`);
  }
}
