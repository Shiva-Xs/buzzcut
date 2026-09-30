// The checker arm B runs on its own draft: `node bench/eval/v3/check.mjs <set> B prNN`, e.g. `devR B pr03`.
// This branch's buzzcut, with the changed lines and a search of the repo as it stood before the PR.
// It prints what `buzzcut pr` would and exits 1 when it blocks.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [set, arm, id] = process.argv.slice(2);
if (!/^[a-z0-9]+[RT]$/.test(set ?? '') || arm !== 'B' || !/^pr\d+$/.test(id ?? '')) {
  console.error('usage: node bench/eval/v3/check.mjs <set> B prNN   (for example: devR B pr03)');
  process.exit(2);
}
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const lib = await import('../../../dist/index.js');
const data = JSON.parse(readFileSync(here(`data/${set.slice(0, -1)}/${id}.json`), 'utf8'));
const file = here(`out/${set}/B/${id}.md`);
if (!existsSync(file)) {
  console.error(`no draft at bench/eval/v3/out/${set}/B/${id}.md`);
  process.exit(2);
}
const raw = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const nl = raw.indexOf('\n');
const title = (nl === -1 ? raw : raw.slice(0, nl)).trim();
const body = nl === -1 ? '' : raw.slice(nl + 1).replace(/^\n+/, '');
const files = data.files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions, ...(f.renamed ? { renamed: true } : {}), ...(f.patch ? { added: f.added, removed: f.removed } : {}) }));
const diff = lib.buildDiff(files, { additions: data.additions, deletions: data.deletions }, data.files.length < data.changedFiles);
const report = lib.analyze(lib.prMessage(title, body), diff, { repo: lib.gitRepoSearch(data.snapshot) });
process.stdout.write(lib.renderReport(report, { color: false, max: lib.DEFAULT_CONFIG.max, label: 'pr' }) + '\n');
process.exit(lib.passes(report, lib.DEFAULT_CONFIG.max) ? 0 : 1);
