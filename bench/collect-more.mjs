// Grows corpus.json past 2,000 PRs: more agent PRs (more sources, spread over months so one
// week or one repo doesn't dominate), recent PRs by people from more projects, and more PRs
// from before AI coding assistants existed. Appends; items already in the corpus are skipped.
//   node bench/collect-more.mjs && node bench/fetch.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('corpus.json', import.meta.url);
const corpus = JSON.parse(readFileSync(file, 'utf8'));
const gh = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 << 20 }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => process.stderr.write(s + '\n');

const AI_MARK = /generated with \[?claude|co-authored-by: (claude|cursor|copilot)|chatgpt\.com\/codex|cursor\.com\/(agents|background)|devin\.ai|jules\.google|ampcode\.com|🤖 generated/i;
const isBot = (a) => !a || a.is_bot || a.type === 'Bot' || /\[bot\]$|^app\//.test(a.login ?? '');

const seen = new Set([
  ...corpus.human,
  ...corpus.agent.map((a) => a.url),
  ...(corpus.baselinePrs ?? []),
]);
const perRepo = new Map();
for (const url of seen) {
  const repo = url.match(/github\.com\/([^/]+\/[^/]+)\//)?.[1];
  if (repo) perRepo.set(repo, (perRepo.get(repo) ?? 0) + 1);
}

// ── agents: PRs, a few per repo, spread over six months ──────────────────────
const SOURCES = [
  ['claude-code', ['"Generated with Claude Code"', '--merged']],
  ['claude-code-open', ['"Generated with Claude Code"', '--state', 'open']],
  ['copilot-agent', ['--author', 'app/copilot-swe-agent', '--merged']],
  ['codex', ['"chatgpt.com/codex/tasks"', '--merged']],
  ['devin', ['--author', 'app/devin-ai-integration', '--merged']],
  ['cursor', ['"cursor.com/agents"']],
  ['jules', ['--author', 'app/google-labs-jules', '--merged']],
  ['amp', ['"ampcode.com/threads"']],
];
const MONTHS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
const monthRange = (m) => {
  const [y, mo] = m.split('-').map(Number);
  const end = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `${m}-01..${m}-${String(end).padStart(2, '0')}`;
};
const AGENT_TARGET = 150; // new PRs per source, at most
let agentAdded = 0;
for (const [source, query] of SOURCES) {
  let n = 0;
  for (const m of MONTHS) {
    if (n >= AGENT_TARGET) break;
    try {
      const found = gh(['search', 'prs', ...query, '--created', monthRange(m), '--limit', '100', '--json', 'url,repository,author']);
      for (const p of found) {
        const repo = p.repository.nameWithOwner;
        if (seen.has(p.url) || (perRepo.get(repo) ?? 0) >= 2) continue;
        perRepo.set(repo, (perRepo.get(repo) ?? 0) + 1);
        seen.add(p.url);
        corpus.agent.push({ url: p.url, source });
        n++;
        if (n >= AGENT_TARGET) break;
      }
    } catch (e) {
      log(`agents  ${source} ${m}: failed (${e.message.split('\n')[0]})`);
    }
    await sleep(2500);
  }
  agentAdded += n;
  log(`agents  ${source}: +${n}`);
}

// ── people: recent merged PRs from more projects ─────────────────────────────
const MORE_REPOS = [
  'golang/go', 'hashicorp/terraform', 'ansible/ansible', 'elastic/kibana', 'facebook/docusaurus', 'remix-run/react-router',
  'tailwindlabs/tailwindcss', 'prisma/prisma', 'drizzle-team/drizzle-orm', 'trpc/trpc', 'TanStack/query', 'vuejs/core',
  'nuxt/nuxt', 'pnpm/pnpm', 'biomejs/biome', 'evanw/esbuild', 'rollup/rollup', 'webpack/webpack', 'jestjs/jest',
  'vitest-dev/vitest', 'microsoft/playwright', 'cypress-io/cypress', 'storybookjs/storybook', 'mui/material-ui',
  'ant-design/ant-design', 'apache/airflow', 'apache/arrow', 'apache/kafka', 'duckdb/duckdb', 'ClickHouse/ClickHouse',
  'cockroachdb/cockroach', 'etcd-io/etcd', 'containerd/containerd', 'moby/moby', 'traefik/traefik', 'caddyserver/caddy',
  'nats-io/nats-server', 'grpc/grpc-go', 'open-telemetry/opentelemetry-collector', 'getsentry/sentry', 'posthog/posthog',
  'mastodon/mastodon', 'discourse/discourse', 'gitlabhq/gitlabhq', 'go-gitea/gitea', 'nextcloud/server', 'immich-app/immich',
  'jellyfin/jellyfin', 'obsproject/obs-studio', 'mpv-player/mpv', 'tokio-rs/tokio', 'rust-lang/cargo', 'astral-sh/ruff',
  'pola-rs/polars', 'pydantic/pydantic', 'fastapi/fastapi', 'scikit-learn/scikit-learn', 'numpy/numpy', 'pandas-dev/pandas',
  'matplotlib/matplotlib', 'python-poetry/poetry', 'psf/black', 'pytest-dev/pytest', 'sqlalchemy/sqlalchemy',
];
const PER_REPO = 8;
let humanAdded = 0;
for (const repo of MORE_REPOS) {
  try {
    const prs = gh(['pr', 'list', '-R', repo, '--state', 'merged', '--limit', '40', '--json', 'number,author,body']);
    let n = 0;
    for (const p of prs) {
      const url = `https://github.com/${repo}/pull/${p.number}`;
      if (seen.has(url) || isBot(p.author) || AI_MARK.test(p.body ?? '')) continue;
      corpus.human.push(url);
      seen.add(url);
      if (++n >= PER_REPO) break;
    }
    humanAdded += n;
    log(`people  ${repo}: +${n}`);
  } catch (e) {
    log(`people  ${repo}: failed (${e.message.split('\n')[0]})`);
  }
}

// ── before AI: merged between 2018 and May 2021 ──────────────────────────────
const WINDOW = '2018-01-01..2021-05-31';
let baseAdded = 0;
corpus.baselinePrs ??= [];
for (const repo of MORE_REPOS.slice(0, 40)) {
  try {
    const found = gh(['search', 'prs', '--repo', repo, '--merged', '--merged-at', WINDOW, '--limit', '60', '--json', 'url,author']);
    const perAuthor = new Map();
    let n = 0;
    for (const p of found) {
      const who = p.author?.login ?? '';
      if (isBot(p.author) || seen.has(p.url) || (perAuthor.get(who) ?? 0) >= 2) continue;
      perAuthor.set(who, (perAuthor.get(who) ?? 0) + 1);
      corpus.baselinePrs.push(p.url);
      seen.add(p.url);
      if (++n >= 8) break;
    }
    baseAdded += n;
    log(`before AI ${repo}: +${n}`);
  } catch (e) {
    log(`before AI ${repo}: failed (${e.message.split('\n')[0]})`);
  }
  await sleep(2500);
}

corpus.extended = new Date().toISOString();
writeFileSync(file, JSON.stringify(corpus, null, 2) + '\n');
const total = corpus.human.length + corpus.agent.length + corpus.baselinePrs.length;
console.log(`added: ${agentAdded} agent PRs, ${humanAdded} PRs by people, ${baseAdded} PRs from before AI · PRs in the corpus: ${total}`);
