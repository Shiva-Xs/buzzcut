// Prepares the three-arm writing test: the same PRs, written three ways by the same model.
//   A  the skill + the published buzzcut 0.1.2 as the checker
//   B  the skill + this branch's buzzcut as the checker (lookups included)
//   C  a plain "write a clear PR description", with no skill, no context and no checker
// Same facts allowed in every arm: the diff and the author's own notes (the original PR text).
// Only the checker differs between A and B, and only the skill and checker between C and the rest.
//
//   npm run build && (cd bench/eval/threearm && npm i --no-save --prefix old buzzcut@0.1.2)
//   HELDOUT_SNAPSHOTS=... node bench/eval/threearm/prep.mjs
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDiff, contextOf, DEFAULT_CONFIG, renderContext, sizeOf } from '../../../dist/index.js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const SNAP = process.env.HELDOUT_SNAPSHOTS || here('../../cache/snapshots');
const frozen = JSON.parse(readFileSync(here('../../heldout.json'), 'utf8'));
const sha = (s) => createHash('sha1').update(s).digest('hex');
const isTest = (repo) => parseInt(sha(repo.toLowerCase()).slice(0, 8), 16) % 2 === 1;
const words = (s) => (s.match(/\S+/g) ?? []).length;

// The TEST half of the held-out repos, PRs whose own text says something (the notes), in hash order.
const cands = frozen.prs
  .map((url) => {
    const [, owner, repo, number] = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    return { url, owner, repo, number, file: here(`../../cache/heldout/${owner}__${repo}__pr${number}.json`) };
  })
  .filter((p) => isTest(`${p.owner}/${p.repo}`) && existsSync(p.file))
  .map((p) => ({ ...p, pr: JSON.parse(readFileSync(p.file, 'utf8')) }))
  .filter(({ pr }) => words(pr.body ?? '') >= 25 && !DEFAULT_CONFIG.ignore.some((re) => re.test(pr.title)) && pr.files.every((f) => f.patch || f.additions + f.deletions === 0))
  .sort((a, b) => sha(a.url).localeCompare(sha(b.url)));

const diffOf = (pr) =>
  buildDiff(
    pr.files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions, ...(f.renamed ? { renamed: true } : {}), ...(f.patch ? { added: f.added, removed: f.removed } : {}) })),
    { additions: pr.additions, deletions: pr.deletions },
    pr.files.length < pr.changedFiles,
  );

// Ten of each size where there are ten, so a big diff isn't crowded out by tiny ones.
const picked = [];
for (const size of ['tiny', 'normal', 'big']) {
  picked.push(...cands.filter((c) => sizeOf(diffOf(c.pr)) === size).slice(0, 10));
}

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

const manifest = [];
picked.forEach((c, i) => {
  const id = `pr${String(i + 1).padStart(2, '0')}`;
  const dir = here(`prs/${id}`);
  mkdirSync(dir, { recursive: true });
  const d = diffOf(c.pr);
  writeFileSync(join(dir, 'diff.txt'), text(c.pr));
  writeFileSync(join(dir, 'notes.md'), c.pr.body.trim() + '\n');
  writeFileSync(join(dir, 'context.txt'), renderContext(contextOf('pr', d, { source: 'branch', base: 'main' })) + '\n');
  writeFileSync(here(`data/${id}.json`), JSON.stringify({ id, url: c.url, owner: c.owner, repo: c.repo, snapshot: join(SNAP, `${c.owner}__${c.repo}`), title: c.pr.title, additions: c.pr.additions, deletions: c.pr.deletions, changedFiles: c.pr.changedFiles, files: c.pr.files }));
  manifest.push({ id, url: c.url, size: sizeOf(d), lines: d.changedLines, title: c.pr.title });
});
for (const arm of ['A', 'B', 'C']) mkdirSync(here(`out/${arm}`), { recursive: true });
writeFileSync(here('manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
const by = manifest.reduce((m, x) => ((m[x.size] = (m[x.size] ?? 0) + 1), m), {});
console.log(`prepared ${manifest.length} PRs`, by);
