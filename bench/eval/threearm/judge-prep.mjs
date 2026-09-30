// Builds shuffled, labelled packets for a blind read: `node bench/eval/threearm/judge-prep.mjs <round> <arm> <arm> [<arm>]`
// e.g. `node bench/eval/threearm/judge-prep.mjs round2 B B1 C` (B1 is round 1's arm B, in out/B-v1).
// Writes judge/<round>/batch1..4.txt (six PRs each) and judge/<round>/key.json, which is not to be opened until every PR is judged.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [round, ...arms] = process.argv.slice(2);
if (!round || arms.length < 2) {
  console.error('usage: judge-prep.mjs <round> <arm> <arm> [<arm>]');
  process.exit(2);
}
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dirOf = (a) => (a === 'B1' ? 'B-v1' : a);
const rnd = (s) => parseInt(createHash('sha1').update(s).digest('hex').slice(0, 8), 16);
const clean = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
const manifest = JSON.parse(readFileSync(here('manifest.json'), 'utf8'));
mkdirSync(here(`judge/${round}`), { recursive: true });
const labels = ['X', 'Y', 'Z'].slice(0, arms.length);
const key = {};
const packets = [];
for (const m of manifest) {
  const order = [...arms].sort((a, b) => rnd(`${round}-${m.id}${a}`) - rnd(`${round}-${m.id}${b}`));
  key[m.id] = Object.fromEntries(order.map((a, i) => [labels[i], a]));
  const notes = clean(readFileSync(here(`prs/${m.id}/notes.md`), 'utf8'));
  const diff = readFileSync(here(`prs/${m.id}/diff.txt`), 'utf8');
  const d = JSON.parse(readFileSync(here(`data/${m.id}.json`), 'utf8'));
  let p = `########## ${m.id}  (${m.size}, ${m.lines} changed lines)  original title: ${d.title}\nFILES: ${d.files.map((f) => `${f.path} +${f.additions}/-${f.deletions}`).join(', ').slice(0, 400)}\n\nDIFF (changed lines, cut):\n${diff.slice(0, 2600)}${diff.length > 2600 ? '\n…(cut)' : ''}\n\nAUTHOR NOTES (what the author knew; boilerplate kept):\n${notes.slice(0, 2600)}${notes.length > 2600 ? '\n…(cut)' : ''}\n`;
  labels.forEach((l, i) => {
    p += `\n----- ${l} -----\n${clean(readFileSync(here(`out/${dirOf(order[i])}/${m.id}.md`), 'utf8'))}\n`;
  });
  packets.push(p);
}
writeFileSync(here(`judge/${round}/key.json`), JSON.stringify(key));
for (let b = 0; b < 4; b++) writeFileSync(here(`judge/${round}/batch${b + 1}.txt`), packets.slice(b * 6, b * 6 + 6).join('\n\n'));
console.log(`wrote ${packets.length} packets for ${arms.join(', ')} to judge/${round}/`);
