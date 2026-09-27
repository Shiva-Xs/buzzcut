// Downloads every PR and commit in corpus.json into bench/cache/ (one JSON file each),
// so scoring can be rerun offline while the rules change.
//   node bench/fetch.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const corpus = JSON.parse(readFileSync(new URL('corpus.json', import.meta.url), 'utf8'));
const CACHE = new URL('cache/', import.meta.url);
mkdirSync(CACHE, { recursive: true });
const token = process.env.GITHUB_TOKEN || execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Waits out GitHub's hourly limit instead of giving up: a big corpus needs more than 5,000 calls.
async function get(path) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'buzzcut-bench' },
    });
    if (res.ok) return res.json();
    if (res.status === 404 || res.status === 410 || res.status === 451) return null;
    if (res.status === 403 || res.status === 429) {
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      const out = res.headers.get('x-ratelimit-remaining') === '0' && reset;
      // A 403 with calls left is a repo we can't read, not a rate limit.
      if (res.status === 403 && !out && attempt > 0) return null;
      const wait = out ? reset * 1000 - Date.now() + 2000 : 15000 * (attempt + 1);
      process.stderr.write(`  rate limited, waiting ${Math.round(wait / 1000)} s\n`);
      await sleep(wait);
      continue;
    }
    throw new Error(`${res.status} ${path}`);
  }
  throw new Error(`gave up on ${path}`);
}

// One GraphQL call per repo finds the PR template in any of its usual places.
async function gql(query) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'buzzcut-bench' },
      body: JSON.stringify({ query }),
    });
    if (res.ok) return (await res.json()).data ?? null;
    if (res.status === 403 || res.status === 429 || res.status >= 500) {
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      await sleep(reset && res.headers.get('x-ratelimit-remaining') === '0' ? reset * 1000 - Date.now() + 2000 : 10000 * (attempt + 1));
      continue;
    }
    return null;
  }
  return null;
}

const TEMPLATE_PATHS = ['.github/pull_request_template.md', '.github/PULL_REQUEST_TEMPLATE.md', 'PULL_REQUEST_TEMPLATE.md', 'docs/pull_request_template.md'];
const templates = new Map();
// The template as it was when the PR was opened: a 2019 PR was written against the 2019 one.
async function template(repo, ref) {
  const k = `${repo}@${ref ?? ''}`;
  if (!templates.has(k)) {
    const [owner, name] = repo.split('/');
    const objects = TEMPLATE_PATHS.map((p, i) => `f${i}: object(expression: ${JSON.stringify(`${ref ?? 'HEAD'}:${p}`)}) { ... on Blob { text } }`).join(' ');
    templates.set(
      k,
      gql(`query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${objects} } }`).then((d) => {
        const i = TEMPLATE_PATHS.findIndex((_, j) => d?.repository?.[`f${j}`]?.text);
        return i === -1 ? null : { path: TEMPLATE_PATHS[i], text: d.repository[`f${i}`].text };
      }),
    );
  }
  return templates.get(k);
}

const key = (repo, id) => new URL(`${repo.replace('/', '__')}__${id}.json`, CACHE);

async function pr(url, extra) {
  const [, repo, n] = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  const file = key(repo, `pr${n}`);
  if (existsSync(file)) return;
  const p = await get(`/repos/${repo}/pulls/${n}`);
  if (!p) return;
  const files = [];
  for (let page = 1; page <= 3 && files.length < p.changed_files; page++) {
    const batch = (await get(`/repos/${repo}/pulls/${n}/files?per_page=100&page=${page}`)) ?? [];
    files.push(...batch.map((f) => ({ path: f.filename, additions: f.additions, deletions: f.deletions })));
    if (batch.length < 100) break;
  }
  writeFileSync(
    file,
    JSON.stringify({
      kind: 'pr', url, repo, number: Number(n), ...extra,
      title: p.title, body: p.body ?? '', authorType: p.user?.type,
      additions: p.additions, deletions: p.deletions, changedFiles: p.changed_files, files,
      baseSha: p.base?.sha,
      template: await template(repo, extra.set === 'baseline' ? p.base?.sha : undefined),
    }),
  );
}

async function commit(repo, sha, extra) {
  const file = key(repo, sha.slice(0, 12));
  if (existsSync(file)) return;
  const c = await get(`/repos/${repo}/commits/${sha}`);
  if (!c) return;
  writeFileSync(
    file,
    JSON.stringify({
      kind: 'commit', url: c.html_url, repo, sha, ...extra,
      message: c.commit.message,
      files: (c.files ?? []).map((f) => ({ path: f.filename, additions: f.additions, deletions: f.deletions })),
      additions: c.stats?.additions ?? 0, deletions: c.stats?.deletions ?? 0,
    }),
  );
}

// Older caches: give baseline PRs the template from their own time.
async function retemplate(file) {
  const it = JSON.parse(readFileSync(file, 'utf8'));
  if (it.kind !== 'pr' || it.set !== 'baseline' || it.baseSha) return;
  const p = await get(`/repos/${it.repo}/pulls/${it.number}`);
  if (!p) return;
  it.baseSha = p.base?.sha;
  it.template = await template(it.repo, it.baseSha);
  writeFileSync(file, JSON.stringify(it));
}

const jobs = [
  ...corpus.human.map((url) => () => pr(url, { set: 'human' })),
  ...corpus.agent.map(({ url, source }) => () => pr(url, { set: 'agent', source })),
  ...corpus.humanCommits.map(({ repo, sha }) => () => commit(repo, sha, { set: 'human' })),
  ...corpus.agentCommits.map(({ repo, sha, source }) => () => commit(repo, sha, { set: 'agent', source })),
  ...(corpus.baselinePrs ?? []).map((url) => () => pr(url, { set: 'baseline' })),
  ...(corpus.baselineCommits ?? []).map(({ repo, sha }) => () => commit(repo, sha, { set: 'baseline' })),
  ...readdirSync(CACHE).filter((f) => /__pr\d+\.json$/.test(f)).map((f) => () => retemplate(new URL(f, CACHE))),
];

let done = 0;
let failed = 0;
async function worker() {
  while (jobs.length) {
    const job = jobs.shift();
    try {
      await job();
    } catch (e) {
      failed++;
      process.stderr.write(`  ${e.message}\n`);
    }
    if (++done % 50 === 0) process.stderr.write(`${done} fetched\n`);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`done: ${done}, failed: ${failed}`);
