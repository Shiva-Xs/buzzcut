// Packets for the graders: shuffled, letter-labelled descriptions with the notes, the diff and the checklist.
//   node bench/eval/v3/grade-prep.mjs <set> <round> <arm> <arm> [<arm> ...]
//   node bench/eval/v3/grade-prep.mjs devR 1 D C B
// Writes grade/<set>/r<round>/packets/prNN.txt and key.json (not to be opened until every packet is graded).
// An arm written as NAME=DIR reads out/<set>/DIR (for keeping an older B: B1=B-v1).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [set, round, ...armArgs] = process.argv.slice(2);
if (!set || !round || armArgs.length < 2) {
  console.error('usage: grade-prep.mjs <set> <round> <arm> <arm> [<arm> ...]');
  process.exit(2);
}
const arms = armArgs.map((a) => ({ name: a.split('=')[0], dir: a.split('=')[1] ?? a.split('=')[0] }));
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const rnd = (s) => parseInt(createHash('sha1').update(s).digest('hex').slice(0, 8), 16);
const clean = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
const manifest = JSON.parse(readFileSync(here(`manifest-${set.slice(0, -1)}.json`), 'utf8'));
const base = here(`grade/${set}/r${round}`);
mkdirSync(`${base}/packets`, { recursive: true });
mkdirSync(`${base}/out`, { recursive: true });
const letters = ['X', 'Y', 'Z', 'W', 'V'].slice(0, arms.length);
const key = {};
let n = 0;
for (const m of manifest) {
  const files = arms.map((a) => here(`out/${set}/${a.dir}/${m.id}.md`));
  if (files.some((f) => !existsSync(f))) continue;
  const order = [...arms].sort((a, b) => rnd(`${set}${round}${m.id}${a.name}`) - rnd(`${set}${round}${m.id}${b.name}`));
  key[m.id] = Object.fromEntries(order.map((a, i) => [letters[i], a.name]));
  const notes = clean(readFileSync(here(`sets/${set}/${m.id}/notes.md`), 'utf8'));
  const diff = readFileSync(here(`sets/${set}/${m.id}/diff.txt`), 'utf8');
  const cl = existsSync(here(`grade/${set}/checklist/${m.id}.json`)) ? JSON.parse(readFileSync(here(`grade/${set}/checklist/${m.id}.json`), 'utf8')) : [];
  let p = `########## ${m.id}\n\nAUTHOR NOTES (everything the author knew about why and how it was checked):\n${notes.slice(0, 3500)}${notes.length > 3500 ? '\n…(cut)' : ''}\n\nDIFF (changed lines, cut):\n${diff.slice(0, 3500)}${diff.length > 3500 ? '\n…(cut)' : ''}\n\nCHECKLIST of needed facts from the notes:\n${cl.length ? cl.map((f, i) => `${i + 1}. ${f}`).join('\n') : '(none)'}\n`;
  order.forEach((a, i) => {
    p += `\n----- ${letters[i]} -----\n${clean(readFileSync(here(`out/${set}/${a.dir}/${m.id}.md`), 'utf8'))}\n`;
  });
  writeFileSync(`${base}/packets/${m.id}.txt`, p);
  n++;
}
writeFileSync(`${base}/key.json`, JSON.stringify(key));
console.log(`wrote ${n} packets for ${arms.map((a) => a.name).join(', ')} to grade/${set}/r${round}/`);
