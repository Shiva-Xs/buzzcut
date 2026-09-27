// Adds hand-written commits (not GitHub squash merges) to corpus.json: from projects known
// for good commit messages, and from coding agents (commits carrying their trailers).
//   node bench/collect-commits.mjs && node bench/fetch.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('corpus.json', import.meta.url);
const corpus = JSON.parse(readFileSync(file, 'utf8'));
const gh = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SQUASH = /\(#\d+\)\s*$/;
const AI_MARK = /co-authored-by: (claude|cursor|copilot)|generated with \[?claude|🤖/i;
const have = new Set([...corpus.humanCommits, ...corpus.agentCommits].map((c) => c.sha));

const HAND_REPOS = [
  'torvalds/linux', 'git/git', 'golang/go', 'postgres/postgres', 'curl/curl', 'nodejs/node', 'rust-lang/rust',
  'systemd/systemd', 'FFmpeg/FFmpeg', 'kubernetes/kubernetes', 'tailscale/tailscale', 'openssl/openssl',
  'neovim/neovim', 'ghostty-org/ghostty', 'bminor/binutils-gdb', 'php/php-src', 'llvm/llvm-project',
  'python/mypy', 'microsoft/TypeScript', 'rails/rails', 'django/django', 'zed-industries/zed',
];
let added = 0;
for (const repo of HAND_REPOS) {
  try {
    const commits = gh(['api', `repos/${repo}/commits?per_page=60`]);
    const picked = commits
      .filter((c) => c.parents.length === 1 && !SQUASH.test(c.commit.message.split('\n')[0]) && !AI_MARK.test(c.commit.message) && !/\[bot\]$/.test(c.author?.login ?? '') && !have.has(c.sha))
      .slice(0, 8);
    for (const c of picked) {
      corpus.humanCommits.push({ repo, sha: c.sha, hand: true });
      have.add(c.sha);
      added++;
    }
    process.stderr.write(`people ${repo}: ${picked.length}\n`);
  } catch (e) {
    process.stderr.write(`people ${repo}: failed (${e.message.split('\n')[0]})\n`);
  }
}

for (const [source, q] of [
  ['claude-code', '"Co-Authored-By: Claude Opus"'],
  ['claude-code', '"Co-Authored-By: Claude Sonnet"'],
  ['claude-code', '"Co-Authored-By: Claude <noreply@anthropic.com>"'],
  ['cursor', '"cursoragent@cursor.com"'],
  ['copilot', '"Co-authored-by: Copilot"'],
]) {
  await sleep(6000);
  try {
    const found = gh(['search', 'commits', q, '--limit', '100', '--json', 'sha,repository,commit']);
    const perRepo = new Map();
    let n = 0;
    for (const c of found) {
      const repo = c.repository.fullName;
      if (have.has(c.sha) || SQUASH.test(c.commit.message.split('\n')[0]) || (perRepo.get(repo) ?? 0) >= 2) continue;
      perRepo.set(repo, (perRepo.get(repo) ?? 0) + 1);
      corpus.agentCommits.push({ repo, sha: c.sha, source, hand: true });
      have.add(c.sha);
      n++;
    }
    process.stderr.write(`agents ${source} ${q}: ${n}\n`);
  } catch (e) {
    process.stderr.write(`agents ${q}: failed (${e.message.split('\n')[0]})\n`);
  }
}

writeFileSync(file, JSON.stringify(corpus, null, 2) + '\n');
console.log(`people commits ${corpus.humanCommits.length} (+${added}) · agent commits ${corpus.agentCommits.length}`);
