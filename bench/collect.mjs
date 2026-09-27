// Builds the stress-test corpus: lists of real PRs and commits, split into "people" (merged
// PRs from well-run projects) and "agents" (PRs and commits made by coding agents).
//   node bench/collect.mjs          → bench/corpus.json
// Needs `gh auth login`. Only lists are saved here; fetch.mjs downloads the contents.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const gh = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Projects with a culture of written PRs, across languages and PR-template styles.
const HUMAN_REPOS = [
  'tailscale/tailscale', 'kubernetes/kubernetes', 'microsoft/vscode', 'microsoft/TypeScript', 'facebook/react',
  'vercel/next.js', 'nodejs/node', 'python/cpython', 'rust-lang/rust', 'denoland/deno', 'oven-sh/bun',
  'vitejs/vite', 'sveltejs/svelte', 'withastro/astro', 'tauri-apps/tauri', 'zed-industries/zed',
  'ghostty-org/ghostty', 'neovim/neovim', 'django/django', 'rails/rails', 'pytorch/pytorch',
  'huggingface/transformers', 'grafana/grafana', 'prometheus/prometheus', 'redis/redis', 'curl/curl',
  'Homebrew/brew', 'home-assistant/core', 'godotengine/godot', 'electron/electron', 'flutter/flutter',
  'angular/angular', 'supabase/supabase', 'astral-sh/uv', 'bevyengine/bevy', 'excalidraw/excalidraw',
];
const PER_REPO = 9;

// Markers of agent-written text. PRs with these are left out of the "people" set.
const AI_MARK = /generated with \[?claude|co-authored-by: (claude|cursor|copilot)|chatgpt\.com\/codex|cursor\.com\/(agents|background)|devin\.ai|jules\.google|🤖 generated/i;
const isBotLogin = (a) => !a || a.is_bot || /\[bot\]$|^app\//.test(a.login ?? '') || a.type === 'Bot';

const corpus = { collected: new Date().toISOString(), human: [], agent: [], humanCommits: [], agentCommits: [] };

// ── people: merged PRs ──────────────────────────────────────────────────────
for (const repo of HUMAN_REPOS) {
  try {
    const prs = gh(['pr', 'list', '-R', repo, '--state', 'merged', '--limit', '40', '--json', 'number,author,body,title']);
    const picked = prs.filter((p) => !isBotLogin(p.author) && !AI_MARK.test(p.body ?? '')).slice(0, PER_REPO);
    for (const p of picked) corpus.human.push(`https://github.com/${repo}/pull/${p.number}`);
    process.stderr.write(`people  ${repo}: ${picked.length}\n`);
  } catch (e) {
    process.stderr.write(`people  ${repo}: failed (${e.message.split('\n')[0]})\n`);
  }
}

// ── agents: PRs ─────────────────────────────────────────────────────────────
const AGENT_SEARCHES = [
  ['claude-code', ['"Generated with Claude Code"', '--merged'], 70],
  ['claude-code-open', ['"Generated with Claude Code"', '--state', 'open'], 30],
  ['copilot-agent', ['--author', 'app/copilot-swe-agent', '--merged'], 50],
  ['codex', ['"chatgpt.com/codex/tasks"', '--merged'], 50],
  ['devin', ['--author', 'app/devin-ai-integration', '--merged'], 40],
  ['cursor', ['"cursor.com/agents"'], 30],
  ['jules', ['--author', 'app/google-labs-jules', '--merged'], 30],
];
const seen = new Set();
for (const [source, query, limit] of AGENT_SEARCHES) {
  try {
    const found = gh(['search', 'prs', ...query, '--limit', String(limit), '--json', 'url,repository,author']);
    // At most 3 per repo, so one busy repo doesn't dominate.
    const perRepo = new Map();
    let n = 0;
    for (const p of found) {
      const repo = p.repository.nameWithOwner;
      if (seen.has(p.url) || (perRepo.get(repo) ?? 0) >= 3) continue;
      perRepo.set(repo, (perRepo.get(repo) ?? 0) + 1);
      seen.add(p.url);
      corpus.agent.push({ url: p.url, source });
      n++;
    }
    process.stderr.write(`agents  ${source}: ${n}\n`);
  } catch (e) {
    process.stderr.write(`agents  ${source}: failed (${e.message.split('\n')[0]})\n`);
  }
  await sleep(2500);
}

// ── agents: commits ─────────────────────────────────────────────────────────
for (const [source, q, limit] of [
  ['claude-code', '"Co-Authored-By: Claude"', 100],
  ['claude-code-footer', '"Generated with Claude Code"', 60],
  ['cursor', '"Co-authored-by: Cursor Agent"', 40],
]) {
  try {
    const found = gh(['search', 'commits', q, '--limit', String(limit), '--json', 'sha,repository']);
    const perRepo = new Map();
    let n = 0;
    for (const c of found) {
      const repo = c.repository.fullName;
      if ((perRepo.get(repo) ?? 0) >= 2) continue;
      perRepo.set(repo, (perRepo.get(repo) ?? 0) + 1);
      corpus.agentCommits.push({ repo, sha: c.sha, source });
      n++;
    }
    process.stderr.write(`agent commits ${source}: ${n}\n`);
  } catch (e) {
    process.stderr.write(`agent commits ${source}: failed (${e.message.split('\n')[0]})\n`);
  }
  await sleep(2500);
}

// ── people: commits ─────────────────────────────────────────────────────────
for (const repo of HUMAN_REPOS) {
  try {
    const commits = gh(['api', `repos/${repo}/commits?per_page=30`]);
    const picked = commits
      .filter((c) => c.parents.length === 1 && !isBotLogin(c.author) && !AI_MARK.test(c.commit.message) && !/^Merge /.test(c.commit.message))
      .slice(0, 5);
    for (const c of picked) corpus.humanCommits.push({ repo, sha: c.sha });
    process.stderr.write(`people commits ${repo}: ${picked.length}\n`);
  } catch (e) {
    process.stderr.write(`people commits ${repo}: failed (${e.message.split('\n')[0]})\n`);
  }
}

writeFileSync(new URL('corpus.json', import.meta.url), JSON.stringify(corpus, null, 2) + '\n');
console.log(`human PRs ${corpus.human.length} · agent PRs ${corpus.agent.length} · human commits ${corpus.humanCommits.length} · agent commits ${corpus.agentCommits.length}`);
