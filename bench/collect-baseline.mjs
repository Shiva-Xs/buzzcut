// The ground-truth baseline: PRs and commits from before AI coding assistants existed
// (merged before June 2021, when Copilot's first preview shipped), so "written by a person"
// is certain. buzzcut must leave these alone.
//   node bench/collect-baseline.mjs && node bench/fetch.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('corpus.json', import.meta.url);
const corpus = JSON.parse(readFileSync(file, 'utf8'));
const gh = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 << 20 }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WINDOW = '2018-01-01..2021-05-31';
const UNTIL = '2021-05-31T00:00:00Z';
const SQUASH = /\(#\d+\)\s*$/;
const isBot = (a) => !a || a.is_bot || a.type === 'Bot' || /\[bot\]$|^app\//.test(a.login ?? '');

const PR_REPOS = [
  'tailscale/tailscale', 'kubernetes/kubernetes', 'microsoft/vscode', 'microsoft/TypeScript', 'facebook/react',
  'vercel/next.js', 'nodejs/node', 'python/cpython', 'rust-lang/rust', 'denoland/deno', 'vitejs/vite',
  'sveltejs/svelte', 'withastro/astro', 'tauri-apps/tauri', 'neovim/neovim', 'django/django', 'rails/rails',
  'pytorch/pytorch', 'huggingface/transformers', 'grafana/grafana', 'prometheus/prometheus', 'redis/redis',
  'curl/curl', 'Homebrew/brew', 'home-assistant/core', 'godotengine/godot', 'electron/electron', 'flutter/flutter',
  'angular/angular', 'supabase/supabase', 'bevyengine/bevy', 'excalidraw/excalidraw', 'golang/go', 'hashicorp/terraform',
  'ansible/ansible', 'elastic/kibana',
];
const COMMIT_REPOS = [
  'torvalds/linux', 'git/git', 'golang/go', 'postgres/postgres', 'curl/curl', 'nodejs/node', 'rust-lang/rust',
  'systemd/systemd', 'FFmpeg/FFmpeg', 'kubernetes/kubernetes', 'openssl/openssl', 'neovim/neovim', 'php/php-src',
  'rails/rails', 'django/django', 'redis/redis', 'tailscale/tailscale', 'llvm/llvm-project',
];

corpus.baselinePrs ??= [];
corpus.baselineCommits ??= [];
const have = new Set([...corpus.baselinePrs, ...corpus.baselineCommits.map((c) => c.sha)]);

for (const repo of PR_REPOS) {
  try {
    const found = gh(['search', 'prs', '--repo', repo, '--merged', '--merged-at', WINDOW, '--limit', '80', '--json', 'url,author']);
    const perAuthor = new Map();
    let n = 0;
    for (const p of found) {
      const who = p.author?.login ?? '';
      if (isBot(p.author) || have.has(p.url) || (perAuthor.get(who) ?? 0) >= 2) continue;
      perAuthor.set(who, (perAuthor.get(who) ?? 0) + 1);
      corpus.baselinePrs.push(p.url);
      have.add(p.url);
      if (++n >= 9) break;
    }
    process.stderr.write(`baseline PRs ${repo}: ${n}\n`);
  } catch (e) {
    process.stderr.write(`baseline PRs ${repo}: failed (${e.message.split('\n')[0]})\n`);
  }
  await sleep(4000);
}

for (const repo of COMMIT_REPOS) {
  try {
    const commits = gh(['api', `repos/${repo}/commits?until=${UNTIL}&per_page=100`]);
    const perAuthor = new Map();
    let n = 0;
    for (const c of commits) {
      const who = c.author?.login ?? c.commit.author?.email ?? '';
      if (c.parents.length !== 1 || SQUASH.test(c.commit.message.split('\n')[0]) || isBot(c.author) || have.has(c.sha) || (perAuthor.get(who) ?? 0) >= 2) continue;
      perAuthor.set(who, (perAuthor.get(who) ?? 0) + 1);
      corpus.baselineCommits.push({ repo, sha: c.sha });
      have.add(c.sha);
      if (++n >= 10) break;
    }
    process.stderr.write(`baseline commits ${repo}: ${n}\n`);
  } catch (e) {
    process.stderr.write(`baseline commits ${repo}: failed (${e.message.split('\n')[0]})\n`);
  }
}

writeFileSync(file, JSON.stringify(corpus, null, 2) + '\n');
console.log(`baseline: ${corpus.baselinePrs.length} PRs, ${corpus.baselineCommits.length} commits`);
