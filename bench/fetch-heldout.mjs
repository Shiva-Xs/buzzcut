// Downloads what the source-lookup checks need for the frozen held-out set (bench/heldout.json):
//   - each PR's title, body and the lines it adds and removes, per file (bench/cache/heldout/)
//   - each repo as it stood on 2021-06-01, one commit deep, to search "does this name exist"
//     (HELDOUT_SNAPSHOTS, default bench/cache/snapshots/). It's a conservative stand-in: a name
//     that existed in 2018 and was deleted by 2021 looks missing, so false alarms are overstated.
//
//   node bench/fetch-heldout.mjs        (needs `gh auth login`; safe to re-run, it skips what's there)
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
// POOL_FILE / POOL_CACHE point this at another frozen list (eval/v3/pool.json), same format.
const frozen = JSON.parse(readFileSync(process.env.POOL_FILE || new URL('heldout.json', import.meta.url), 'utf8'));
const cacheDir = process.env.POOL_CACHE || fileURLToPath(new URL('cache/heldout/', import.meta.url));
const snapDir = process.env.HELDOUT_SNAPSHOTS || fileURLToPath(new URL('cache/snapshots/', import.meta.url));
mkdirSync(cacheDir, { recursive: true });
mkdirSync(snapDir, { recursive: true });

const gh = async (args) => JSON.parse((await run('gh', args, { maxBuffer: 256 << 20 })).stdout);
const key = (owner, repo) => `${owner}__${repo}`;

/** Lines a patch adds and removes, without the +++/--- headers and "no newline" markers. */
function split(patch) {
  const added = [];
  const removed = [];
  for (const l of patch.split('\n')) {
    if (l.startsWith('+') && !l.startsWith('+++')) added.push(l.slice(1));
    else if (l.startsWith('-') && !l.startsWith('---')) removed.push(l.slice(1));
  }
  return { added: added.join('\n'), removed: removed.join('\n') };
}

async function fetchPr(url) {
  const [, owner, repo, number] = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  const file = join(cacheDir, `${key(owner, repo)}__pr${number}.json`);
  if (existsSync(file)) return 'cached';
  const pr = await gh([`api`, `repos/${owner}/${repo}/pulls/${number}`]);
  const files = [];
  for (let page = 1; page <= 10 && files.length < pr.changed_files; page++) {
    const batch = await gh(['api', `repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`]);
    for (const f of batch) {
      const { added = '', removed = '' } = f.patch ? split(f.patch) : {};
      files.push({ path: f.filename, additions: f.additions, deletions: f.deletions, ...(f.status === 'renamed' ? { renamed: true } : {}), patch: Boolean(f.patch), added: added.slice(0, 200_000), removed: removed.slice(0, 200_000) });
    }
    if (batch.length < 100) break;
  }
  writeFileSync(file, JSON.stringify({ url, owner, repo, number: Number(number), title: pr.title, body: pr.body ?? '', additions: pr.additions, deletions: pr.deletions, changedFiles: pr.changed_files, merged: pr.merged_at, files }));
  return 'fetched';
}

async function snapshot(fullName) {
  const [owner, repo] = fullName.split('/');
  const dir = join(snapDir, key(owner, repo));
  if (existsSync(join(dir, '.buzzcut-snapshot'))) return 'cached';
  const sha = (await gh(['api', `repos/${owner}/${repo}/commits?until=2021-06-01T00:00:00Z&per_page=1`]))[0]?.sha;
  if (!sha) return 'no commit before the cutoff';
  mkdirSync(dir, { recursive: true });
  const git = (...a) => run('git', ['-C', dir, ...a], { maxBuffer: 64 << 20 });
  await run('git', ['init', '-q', dir]);
  await git('remote', 'add', 'origin', `https://github.com/${owner}/${repo}.git`).catch(() => {});
  await git('fetch', '-q', '--depth', '1', 'origin', sha);
  await git('checkout', '-q', 'FETCH_HEAD');
  writeFileSync(join(dir, '.buzzcut-snapshot'), sha + '\n');
  return `snapshot ${sha.slice(0, 8)}`;
}

/** Runs `fn` over `items`, `n` at a time, logging one line each. */
async function pool(items, n, fn, label) {
  let i = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const item = items[i++];
        try {
          const r = await fn(item);
          process.stderr.write(`[${label} ${++done}/${items.length}] ${item.replace('https://github.com/', '')}: ${r}\n`);
        } catch (e) {
          process.stderr.write(`[${label} ${++done}/${items.length}] ${item}: FAILED ${String(e.message).split('\n')[0]}\n`);
        }
      }
    }),
  );
}

await pool(frozen.prs, 4, fetchPr, 'pr');
await pool(frozen.repos, 3, snapshot, 'repo');
process.stderr.write('done\n');
