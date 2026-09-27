// Downloads the real diff of every cached PR into bench/cache/diffs/ (not committed: it's other
// projects' code). The corpus eval writes buzzcut's version of each PR from it.
//   node bench/fetch-diffs.mjs [--set agent]
// Diffs over 400 KB are cut and marked. When GitHub won't render a diff (too big), the per-file
// patches are stitched together instead. Failures go to diffs/failures.txt.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const SET = arg('--set', null);
const CACHE = new URL('cache/', import.meta.url);
const OUT = new URL('cache/diffs/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const token = process.env.GITHUB_TOKEN || execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
const MAX = 400 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(path, accept) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: accept, 'User-Agent': 'buzzcut-bench' },
    });
    if (res.ok) return res;
    if ([404, 406, 410, 422, 451].includes(res.status)) return res;
    if (res.status === 403 || res.status === 429) {
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      const out = res.headers.get('x-ratelimit-remaining') === '0' && reset;
      if (res.status === 403 && !out && attempt > 0) return res;
      const wait = out ? reset * 1000 - Date.now() + 2000 : 10000 * (attempt + 1);
      process.stderr.write(`  rate limited, waiting ${Math.round(wait / 1000)} s\n`);
      await sleep(wait);
      continue;
    }
    await sleep(3000 * (attempt + 1));
  }
  return null;
}

// GitHub refuses to render very large diffs; the files endpoint still has each file's patch.
async function stitched(repo, n) {
  const parts = [];
  for (let page = 1; page <= 10; page++) {
    const res = await call(`/repos/${repo}/pulls/${n}/files?per_page=100&page=${page}`, 'application/vnd.github+json');
    if (!res?.ok) break;
    const files = await res.json();
    for (const f of files) {
      parts.push(`diff --git a/${f.previous_filename ?? f.filename} b/${f.filename}\n--- a/${f.previous_filename ?? f.filename}\n+++ b/${f.filename}\n${f.patch ?? '(patch not shown by GitHub: binary or too large)'}\n`);
    }
    if (files.length < 100) break;
  }
  return parts.length ? parts.join('') : null;
}

const todo = readdirSync(CACHE)
  .filter((f) => /__pr\d+\.json$/.test(f))
  .map((f) => ({ f, it: JSON.parse(readFileSync(new URL(f, CACHE), 'utf8')) }))
  .filter(({ it }) => it.kind === 'pr' && (!SET || it.set === SET))
  .filter(({ f }) => !existsSync(new URL(f.replace(/\.json$/, '.diff'), OUT)));

console.log(`${todo.length} diffs to fetch`);
let done = 0;
let failed = 0;
async function worker() {
  while (todo.length) {
    const { f, it } = todo.shift();
    let text = null;
    const res = await call(`/repos/${it.repo}/pulls/${it.number}`, 'application/vnd.github.diff');
    if (res?.ok) text = await res.text();
    else if (res && res.status !== 404 && res.status !== 410 && res.status !== 451) text = await stitched(it.repo, it.number);
    if (!text) {
      failed++;
      appendFileSync(new URL('failures.txt', OUT), `${it.url}\t${res?.status ?? 'no response'}\n`);
    } else {
      if (text.length > MAX) text = `${text.slice(0, MAX)}\n[diff cut at 400 KB of ${Math.round(text.length / 1024)} KB]\n`;
      writeFileSync(new URL(f.replace(/\.json$/, '.diff'), OUT), text);
    }
    if (++done % 100 === 0) console.log(`  ${done} done, ${failed} failed`);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`done: ${done}, failed: ${failed}`);
