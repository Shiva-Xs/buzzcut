// A second fresh pool, from repos not in the corpus, the held-out set or the first pool (pool.json). Same rules.
// A fresh pool of PRs for the writing test, from repos that appear nowhere else: not in the corpus,
// not in the held-out set, so nothing about them has been seen while the skill or the checks were
// written. Same window as the held-out set (merged 2018-01 to 2021-05, before AI assistants).
// Frozen once, before any of it is read; eval/v3/pool.json refuses to change.
//
//   node bench/eval/v3/collect-pool.mjs
//   POOL_FILE=bench/eval/v3/pool.json POOL_CACHE=bench/cache/v3 node bench/fetch-heldout.mjs
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const out = new URL('pool2.json', import.meta.url);
if (existsSync(out)) {
  console.error('eval/v3/pool2.json is frozen. Delete it deliberately if you really mean to redraw the pool.');
  process.exit(1);
}
const root = new URL('../../', import.meta.url);
const corpus = JSON.parse(readFileSync(new URL('corpus.json', root), 'utf8'));
const heldout = JSON.parse(readFileSync(new URL('heldout.json', root), 'utf8'));
const seen = new Set(heldout.repos.map((r) => r.toLowerCase()));
for (const r of JSON.parse(readFileSync(new URL('pool.json', import.meta.url), 'utf8')).repos) seen.add(r.toLowerCase());
const add = (u) => {
  const m = String(u).match(/github\.com\/([^/]+\/[^/]+)\//i);
  if (m) seen.add(m[1].toLowerCase());
};
for (const k of ['human', 'baselinePrs']) for (const u of corpus[k]) add(u);
for (const a of corpus.agent) add(a.url);
for (const k of ['humanCommits', 'agentCommits', 'baselineCommits']) for (const x of corpus[k]) seen.add(x.repo.toLowerCase());

// Chosen for range (languages, sizes, review cultures) and for PR text that says something.
const CANDIDATES = [
  'sympy/sympy', 'sphinx-doc/sphinx', 'dask/dask', 'networkx/networkx', 'scipy/scipy', 'tornadoweb/tornado',
  'python-attrs/attrs', 'Textualize/rich', 'tqdm/tqdm', 'pallets/werkzeug', 'gofiber/fiber', 'labstack/echo',
  'go-chi/chi', 'cli/cli', 'junegunn/fzf', 'rust-lang/rustfmt', 'dtolnay/syn', 'Automattic/mongoose',
  'sequelize/sequelize', 'typeorm/typeorm', 'koajs/koa', 'chartjs/Chart.js', 'mrdoob/three.js', 'moment/moment',
  'pydata/xarray', 'psycopg/psycopg2', 'ansible-collections/community.general', 'gitpython-developers/GitPython',
];
const repos = CANDIDATES.filter((r) => !seen.has(r.toLowerCase()));

const gh = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 << 20 }));
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const isBot = (a) => !a || a.is_bot || a.type === 'Bot' || /\[bot\]$|^app\//.test(a.login ?? '');

const prs = [];
const perRepo = {};
for (const repo of repos) {
  try {
    const found = gh(['search', 'prs', '--repo', repo, '--merged', '--merged-at', '2018-01-01..2021-05-31', '--limit', '150', '--json', 'url,author,title']);
    const perAuthor = new Map();
    let n = 0;
    for (const p of found) {
      const who = p.author?.login ?? '';
      if (isBot(p.author) || (perAuthor.get(who) ?? 0) >= 2) continue;
      perAuthor.set(who, (perAuthor.get(who) ?? 0) + 1);
      prs.push(p.url);
      if (++n >= 30) break;
    }
    perRepo[repo] = n;
    process.stderr.write(`${repo}: ${n}\n`);
  } catch (e) {
    process.stderr.write(`${repo}: skipped (${String(e.message).split('\n')[0]})\n`);
  }
  sleep(2500);
}
const frozen = { frozen: new Date().toISOString().slice(0, 10), window: '2018-01-01..2021-05-31', repos: Object.keys(perRepo).filter((r) => perRepo[r] > 0), prs, sha256: createHash('sha256').update(prs.join('\n')).digest('hex') };
writeFileSync(out, JSON.stringify(frozen, null, 2) + '\n');
console.log(`froze ${prs.length} PRs from ${frozen.repos.length} repos (${repos.length} candidates, ${CANDIDATES.length - repos.length} dropped for overlap). sha256 ${frozen.sha256.slice(0, 12)}`);
