// Builds one writing-test set from a frozen list of PRs: the same PRs, in two conditions.
//   R  rich notes: the author's own PR text, as in the three-arm test
//   T  thin notes: only its first lines, like an agent that barely kept track of why or how it was tested
// A set "dev" becomes the sets devR and devT (same diffs, same ids), with out/devR/<arm>/ and out/devT/<arm>/ waiting.
//
//   node bench/eval/v3/build.mjs <name> <heldout|pool|pool2> <dev|test|all> <tiny> <normal> <big>
//   node bench/eval/v3/build.mjs dev heldout dev 15 16 5
//   node bench/eval/v3/build.mjs test pool all 14 14 12      (the sealed set: build it, don't read it)
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDiff, contextOf, DEFAULT_CONFIG, renderContext, sizeOf } from '../../../dist/index.js';

const [name, source, half, nTiny, nNormal, nBig] = process.argv.slice(2);
if (!name || !['heldout', 'pool', 'pool2'].includes(source) || !['dev', 'test', 'all'].includes(half)) {
  console.error('usage: build.mjs <name> <heldout|pool|pool2> <dev|test|all> <tiny> <normal> <big>');
  process.exit(2);
}
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const bench = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const SNAP = process.env.HELDOUT_SNAPSHOTS || bench('cache/snapshots');
const list = JSON.parse(readFileSync(source === 'heldout' ? bench('heldout.json') : here(`${source}.json`), 'utf8'));
const cacheDir = source === 'heldout' ? bench('cache/heldout') : bench(source === 'pool' ? 'cache/v3' : 'cache/v3b');
const sha = (s) => createHash('sha1').update(s).digest('hex');
const isTest = (repo) => parseInt(sha(repo.toLowerCase()).slice(0, 8), 16) % 2 === 1;
const words = (s) => (s.match(/\S+/g) ?? []).length;
const take = { tiny: Number(nTiny), normal: Number(nNormal), big: Number(nBig) };
// PRs already used by an earlier writing test, or another set here, are never reused.
const used = new Set();
import { readdirSync } from 'node:fs';
for (const f of [bench('eval/threearm/manifest.json'), ...readdirSync(here('.')).filter((n) => /^manifest-.*\.json$/.test(n)).map((n) => here(n))]) {
  if (existsSync(f) && !f.endsWith(`manifest-${name}.json`)) for (const m of JSON.parse(readFileSync(f, 'utf8'))) used.add(m.url);
}

const cands = list.prs
  .map((url) => {
    const [, owner, repo, number] = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    return { url, owner, repo, number, file: join(cacheDir, `${owner}__${repo}__pr${number}.json`) };
  })
  .filter((p) => existsSync(p.file) && !used.has(p.url) && (half === 'all' || isTest(`${p.owner}/${p.repo}`) === (half === 'test')))
  .map((p) => ({ ...p, pr: JSON.parse(readFileSync(p.file, 'utf8')) }))
  .filter(({ pr }) => words(pr.body ?? '') >= 25 && !DEFAULT_CONFIG.ignore.some((re) => re.test(pr.title)) && pr.files.every((f) => f.patch || f.additions + f.deletions === 0))
  .sort((a, b) => sha(`v3${a.url}`).localeCompare(sha(`v3${b.url}`)));

const diffOf = (pr) =>
  buildDiff(
    pr.files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions, ...(f.renamed ? { renamed: true } : {}), ...(f.patch ? { added: f.added, removed: f.removed } : {}) })),
    { additions: pr.additions, deletions: pr.deletions },
    pr.files.length < pr.changedFiles,
  );

// At most three from one repo per size, so no repo's habits decide a set.
const picked = [];
for (const size of ['tiny', 'normal', 'big']) {
  const perRepo = {};
  for (const c of cands) {
    if (picked.filter((p) => p.size === size).length >= take[size]) break;
    if (sizeOf(diffOf(c.pr)) !== size || (perRepo[c.repo] ?? 0) >= 3) continue;
    perRepo[c.repo] = (perRepo[c.repo] ?? 0) + 1;
    picked.push({ ...c, size });
  }
}
picked.sort((a, b) => sha(`order${a.url}`).localeCompare(sha(`order${b.url}`)));

const text = (pr) => {
  let out = '(changed lines only; context lines are left out)\n\n';
  for (const f of pr.files) {
    out += `--- a/${f.path}\n+++ b/${f.path}\n`;
    if (!f.patch) out += `(no lines shown: +${f.additions} -${f.deletions})\n`;
    else out += [...(f.removed ? f.removed.split('\n').map((l) => '-' + l) : []), ...(f.added ? f.added.split('\n').map((l) => '+' + l) : [])].join('\n') + '\n';
    out += '\n';
  }
  return out.length > 60_000 ? out.slice(0, 60_000) + '\n…(cut at 60 KB)\n' : out;
};

/** What a writer with a thin memory would have: the body's first sentences, nothing after. */
export function thin(body, title) {
  const paras = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((p) => p.split('\n').filter((l) => !/^\s*(#{1,6}\s|[-*]\s*\[[ xX]\]|[-*_]{3,}\s*$|>)/.test(l)).join(' ').replace(/\s+/g, ' ').trim())
    .filter((p) => words(p) >= 5 && !/contributing|pull request template|thank you for|please (?:read|make sure|fill)|checklist/i.test(p));
  if (!paras.length) return title.trim();
  const sentences = paras[0].split(/(?<=[.!?])\s+/);
  let t = '';
  for (const s of sentences.slice(0, 2)) if (words(`${t} ${s}`) <= 32 || !t) t = `${t} ${s}`.trim();
  const w = t.trim().split(/\s+/);
  return (w.length > 32 ? w.slice(0, 32).join(' ') : t.trim()).replace(/[,;:(]$/, '');
}

const manifest = [];
mkdirSync(here(`data/${name}`), { recursive: true });
picked.forEach((c, i) => {
  const id = `pr${String(i + 1).padStart(2, '0')}`;
  const d = diffOf(c.pr);
  const common = { diff: text(c.pr), context: renderContext(contextOf('pr', d, { source: 'branch', base: 'main' })) + '\n' };
  for (const [cond, notes] of [['R', c.pr.body.trim()], ['T', thin(c.pr.body, c.pr.title)]]) {
    const dir = here(`sets/${name}${cond}/${id}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'diff.txt'), common.diff);
    writeFileSync(join(dir, 'notes.md'), notes + '\n');
    writeFileSync(join(dir, 'context.txt'), common.context);
  }
  writeFileSync(here(`data/${name}/${id}.json`), JSON.stringify({ id, url: c.url, owner: c.owner, repo: c.repo, snapshot: join(SNAP, `${c.owner}__${c.repo}`), title: c.pr.title, additions: c.pr.additions, deletions: c.pr.deletions, changedFiles: c.pr.changedFiles, files: c.pr.files }));
  manifest.push({ id, url: c.url, repo: `${c.owner}/${c.repo}`, size: sizeOf(d), lines: d.changedLines, title: c.pr.title });
});
for (const cond of ['R', 'T']) for (const arm of ['D', 'C', 'C2', 'B0', 'B']) mkdirSync(here(`out/${name}${cond}/${arm}`), { recursive: true });
for (const cond of ['R', 'T']) mkdirSync(here(`grade/${name}${cond}/checklist`), { recursive: true });
writeFileSync(here(`manifest-${name}.json`), JSON.stringify(manifest, null, 1) + '\n');
const by = manifest.reduce((m, x) => ((m[x.size] = (m[x.size] ?? 0) + 1), m), {});
console.log(`set ${name}: ${manifest.length} PRs`, by, `from ${new Set(manifest.map((m) => m.repo)).size} repos; sets ${name}R and ${name}T`);
