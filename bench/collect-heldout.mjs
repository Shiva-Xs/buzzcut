// The held-out set for the source-lookup checks: PRs from before AI coding assistants existed
// (merged 2018-01 to 2021-05), from repos that appear nowhere else in the corpus. The list is
// chosen and frozen BEFORE any lookup rule was written, so the rules can't be tuned to it.
//
//   node bench/collect-heldout.mjs          # writes bench/heldout.json once; refuses to change it
//   node bench/fetch-heldout.mjs            # downloads the changed lines and repo snapshots
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const out = new URL('heldout.json', import.meta.url);
if (existsSync(out)) {
  console.error('bench/heldout.json is frozen. Delete it deliberately if you really mean to redraw the set.');
  process.exit(1);
}

const corpus = JSON.parse(readFileSync(new URL('corpus.json', import.meta.url), 'utf8'));
const seen = new Set();
const add = (u) => {
  const m = String(u).match(/github\.com\/([^/]+\/[^/]+)\//i);
  if (m) seen.add(m[1].toLowerCase());
};
for (const k of ['human', 'baselinePrs']) for (const u of corpus[k]) add(u);
for (const a of corpus.agent) add(a.url);
for (const k of ['humanCommits', 'agentCommits', 'baselineCommits']) for (const x of corpus[k]) seen.add(x.repo.toLowerCase());

// Chosen by hand for range (languages, sizes, review cultures), then filtered against the corpus.
const CANDIDATES = [
  'psf/requests', 'pallets/flask', 'scrapy/scrapy', 'numpy/numpy', 'pytest-dev/pytest', 'celery/celery',
  'encode/django-rest-framework', 'expressjs/express', 'fastify/fastify', 'axios/axios', 'eslint/eslint',
  'prettier/prettier', 'nestjs/nest', 'mochajs/mocha', 'gin-gonic/gin', 'gohugoio/hugo', 'spf13/cobra',
  'urfave/cli', 'serde-rs/serde', 'BurntSushi/ripgrep', 'clap-rs/clap', 'sharkdp/bat', 'square/okhttp',
  'ReactiveX/RxJava', 'netty/netty', 'laravel/framework', 'jekyll/jekyll', 'composer/composer',
  'hashicorp/vault', 'fish-shell/fish-shell', 'scikit-learn/scikit-learn', 'tokio-rs/tokio',
];
const repos = CANDIDATES.filter((r) => !seen.has(r.toLowerCase()));

const gh = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 << 20 }));
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const isBot = (a) => !a || a.is_bot || a.type === 'Bot' || /\[bot\]$|^app\//.test(a.login ?? '');

const prs = [];
const perRepo = {};
for (const repo of repos) {
  try {
    const found = gh(['search', 'prs', '--repo', repo, '--merged', '--merged-at', '2018-01-01..2021-05-31', '--limit', '80', '--json', 'url,author,title']);
    const perAuthor = new Map();
    let n = 0;
    for (const p of found) {
      const who = p.author?.login ?? '';
      if (isBot(p.author) || (perAuthor.get(who) ?? 0) >= 2) continue;
      perAuthor.set(who, (perAuthor.get(who) ?? 0) + 1);
      prs.push(p.url);
      if (++n >= 12) break;
    }
    perRepo[repo] = n;
    process.stderr.write(`${repo}: ${n}\n`);
  } catch (e) {
    process.stderr.write(`${repo}: skipped (${String(e.message).split('\n')[0]})\n`);
  }
  sleep(2500); // the search API allows 30 requests a minute
}

const frozen = { frozen: new Date().toISOString().slice(0, 10), window: '2018-01-01..2021-05-31', repos: Object.keys(perRepo).filter((r) => perRepo[r] > 0), prs, sha256: createHash('sha256').update(prs.join('\n')).digest('hex') };
writeFileSync(out, JSON.stringify(frozen, null, 2) + '\n');
console.log(`froze ${prs.length} PRs from ${frozen.repos.length} repos (${repos.length} candidates, ${CANDIDATES.length - repos.length} dropped for overlap). sha256 ${frozen.sha256.slice(0, 12)}`);
