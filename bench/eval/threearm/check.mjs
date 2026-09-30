// The checker an arm's writer runs on its own draft: `node bench/eval/threearm/check.mjs <A|B> prNN`.
// A is the published buzzcut 0.1.2. B is this branch, with the changed lines and a search of the
// repo as it stood before the PR. It prints what `buzzcut pr` would and exits 1 when it blocks.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [arm, id] = process.argv.slice(2);
if (!['A', 'B'].includes(arm ?? '') || !/^pr\d+$/.test(id ?? '')) {
  console.error('usage: node bench/eval/threearm/check.mjs <A|B> prNN');
  process.exit(2);
}
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const lib = await import(pathToFileURL(here(arm === 'A' ? 'old/node_modules/buzzcut/dist/index.js' : '../../../dist/index.js')).href);
const data = JSON.parse(readFileSync(here(`data/${id}.json`), 'utf8'));
const file = here(`out/${arm}/${id}.md`);
if (!existsSync(file)) {
  console.error(`no draft at bench/eval/threearm/out/${arm}/${id}.md`);
  process.exit(2);
}
const raw = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const nl = raw.indexOf('\n');
const title = (nl === -1 ? raw : raw.slice(0, nl)).trim();
const body = nl === -1 ? '' : raw.slice(nl + 1).replace(/^\n+/, '');
const files = data.files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions, ...(f.renamed ? { renamed: true } : {}), ...(arm === 'B' && f.patch ? { added: f.added, removed: f.removed } : {}) }));
const diff = lib.buildDiff(files, { additions: data.additions, deletions: data.deletions }, data.files.length < data.changedFiles);
const report = lib.analyze(lib.prMessage(title, body), diff, arm === 'B' ? { repo: lib.gitRepoSearch(data.snapshot) } : {});
process.stdout.write(lib.renderReport(report, { color: false, max: lib.DEFAULT_CONFIG.max, label: 'pr' }) + '\n');
process.exit(lib.passes(report, lib.DEFAULT_CONFIG.max) ? 0 : 1);
