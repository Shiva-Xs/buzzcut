// Builds the blind judge's inputs: for each picked PR, two comparisons (original vs new, and the
// old one-paragraph rewrite vs new), with anonymous ids and the new version first in exactly half
// of each, in a hashed order. The key goes to key.json, which the judges are never pointed at.
//   node bench/eval/format/judge-prep.mjs <repos-dir from fetch-diffs.sh> <out-dir>
// Judge diffs leave out lockfiles, and original descriptions lose tool footers, badges and bot
// summaries (Cursor, Devin, Jules, Amp, Greptile), which aren't the author's writing.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const REPOS = process.argv[2] ?? `${process.env.TMPDIR ?? '/tmp'}/buzzcut-format-repos`;
const S = process.argv[3] ?? `${process.env.TMPDIR ?? '/tmp'}/buzzcut-format-judge`;
const R = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
const picked = JSON.parse(readFileSync(`${R}/bench/eval/format/picked.json`, 'utf8'));
const h = (s) => createHash('sha1').update(s).digest('hex');

// Tool footers, badges and bot summaries: not the author's writing, and a giveaway.
function clean(body) {
  return (body ?? '')
    .replace(/\r/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<div><a href="https:\/\/cursor\.com[\s\S]*?<\/div>/g, '')
    .replace(/<a href="https:\/\/app\.devin\.ai\/review[\s\S]*?<\/a>/g, '')
    .replace(/<details><summary><h3>Greptile Summary[\s\S]*$/m, '')
    .replace(/^.*Generated with \[Claude Code\].*$/gm, '')
    .replace(/^\*PR created automatically by Jules.*$/gm, '')
    .replace(/^(Link to Devin session|Requested by|Amp-Thread-ID):.*$/gm, '')
    .replace(/^---\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
const readDesc = (key, v) => {
  const t = readFileSync(`${R}/bench/eval/format/descriptions/${key}.${v}.md`, 'utf8').replace(/\n$/, '');
  const [title, , ...rest] = t.split('\n');
  return { title, body: rest.join('\n') };
};
const key = {};
const order = picked.map((p) => p.url).sort((a, b) => h('order' + a).localeCompare(h('order' + b)));
picked.forEach((p) => {
  const [, o, r, n] = p.url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  const k = `${o}__${r}__pr${n}`;
  const cache = JSON.parse(readFileSync(`${R}/bench/cache/${k}.json`, 'utf8'));
  const id = `P${String(order.indexOf(p.url) + 1).padStart(2, '0')}`;
  // Judge diff: the real diff without lockfiles and generated files.
  const dir = `${REPOS}/${k}`;
  const mb = execFileSync('git', ['-C', dir, 'merge-base', 'refs/pr/head', cache.baseSha], { encoding: 'utf8' }).trim();
  const diff = execFileSync('git', ['-C', dir, 'diff', mb, 'refs/pr/head', '--', '.', ':(exclude)*package-lock.json', ':(exclude)*yarn.lock', ':(exclude)*pnpm-lock.yaml', ':(exclude)*.lock'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const original = { title: cache.title, body: clean(cache.body) };
  const neu = readDesc(k, 'new');
  const old = readDesc(k, 'old');
  const fmt = (d) => `# ${d.title}\n\n${d.body}\n`;
  for (const [cmp, other] of [['orig', original], ['old', old]]) {
    const out = `${S}/${cmp}/${id}`;
    mkdirSync(out, { recursive: true });
    // Exactly half of each comparison shows the new version first, in a hashed order.
    const slots = picked.map((x) => x.url).sort((a, b) => h(`${cmp}:${a}`).localeCompare(h(`${cmp}:${b}`)));
    const newIsA = slots.indexOf(p.url) % 2 === 0;
    writeFileSync(`${out}/A.md`, fmt(newIsA ? neu : other));
    writeFileSync(`${out}/B.md`, fmt(newIsA ? other : neu));
    writeFileSync(`${out}/change.diff`, diff);
    if (cmp === 'old') writeFileSync(`${out}/notes.md`, `# ${original.title}\n\n${original.body}\n`);
    key[`${cmp}/${id}`] = { key: k, url: p.url, size: p.size, lines: p.lines, new: newIsA ? 'A' : 'B', diffLines: diff.split('\n').length };
  }
});
writeFileSync(`${S}/key.json`, JSON.stringify(key, null, 1));
const sizes = {};
for (const [k, v] of Object.entries(key)) if (k.startsWith('orig/')) (sizes[v.size] ??= []).push(`${k.slice(5)}:${v.diffLines}`);
console.log(sizes);
console.log('new is A in', Object.values(key).filter((v) => v.new === 'A').length, 'of', Object.keys(key).length);
