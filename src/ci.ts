// GitHub Action: checks the PR description and every commit in the PR, writes a job
// summary, and keeps one PR comment up to date. On a push it checks the pushed commits, for
// teams that commit straight to main. Catches what local hooks can't: people and agents
// without buzzcut installed.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentFooter } from './agent.js';
import { analyze, parseCommit, passes, prMessage } from './analyze.js';
import { DEFAULTS, isIgnored, loadConfig, type Config } from './config.js';
import { buildDiff } from './diff.js';
import { gitRepoSearch } from './lookup.js';
import { createClient, fetchPrFiles, fetchTemplate, fileChange, GitHubError, isBot, isCodingAgent, type ApiFile, type ApiPull, type Client } from './github.js';
import { RULE_IDS } from './rules/index.js';
import { repoStyle, type StyleProfile } from './style.js';
import { findTemplate } from './template.js';
import type { Report } from './types.js';

export const MARKER = '<!-- buzzcut -->';
const MAX_COMMITS = 30;
const DOCS = 'https://github.com/Shiva-Xs/buzzcut#how-the-score-works';

export interface CiRun {
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
  cwd: string;
  log: (line: string) => void;
}

interface CommitResult {
  sha: string;
  report: Report;
}

function input(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const v = env[`INPUT_${name.toUpperCase()}`] ?? env[`INPUT_${name.toUpperCase().replace(/-/g, '_')}`];
  return v === undefined || v === '' ? fallback : v.trim();
}

/**
 * Whether a failing check should fail the job. `fail: false` never does and `fail: always` always
 * does; otherwise it follows the repo's `block` setting, like the git hooks: coding agents are
 * failed, people get the comment and a warning.
 */
export function enforces(env: NodeJS.ProcessEnv, config: Config, agent: boolean): boolean {
  const fail = input(env, 'fail', 'true').toLowerCase();
  if (fail === 'false') return false;
  if (fail === 'always') return true;
  return config.block === 'always' || (config.block === 'agents' && agent);
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const ICON = { error: '✗', warn: '!', info: '·' } as const;

export function renderMarkdown(pr: Report, commits: CommitResult[], max: number, checkedCommits: number): string {
  const prOk = passes(pr, max);
  const bad = commits.filter((c) => !passes(c.report, max));
  const out = [MARKER];
  if (prOk && !bad.length) {
    out.push(`### buzzcut: yap score ${pr.score}/100 (${pr.grade}) ✓`, '');
    const passed = checkedCommits ? `The description and ${checkedCommits} commit message${checkedCommits > 1 ? 's' : ''} pass.` : 'The description passes.';
    const advice = pr.findings.filter((f) => f.severity === 'warn');
    if (pr.grade === 'A' || pr.grade === 'B' || !advice.length) {
      out.push(`Short and specific. ${passed}`);
      return out.join('\n');
    }
    // Warnings alone never block, but a C or worse is worth a look.
    out.push(`${passed} No ✗ errors; the notes below are advice.`, '', '| | Finding | How to fix |', '|---|---|---|');
    for (const f of advice) out.push(`| ${ICON[f.severity]} | ${cell(f.message)} | ${cell(f.hint)} |`);
    return out.join('\n');
  }
  out.push(`### buzzcut: yap score ${pr.score}/100 (${pr.grade})`, '');
  if (pr.diff) out.push(`The description is **${pr.words} words for a ${pr.diff.changedLines}-line diff** (budget ${pr.budget}).`, '');
  if (!prOk) {
    out.push('| | Finding | How to fix |', '|---|---|---|');
    for (const f of pr.findings) out.push(`| ${ICON[f.severity]} | ${cell(f.message)} | ${cell(f.hint)} |`);
    out.push('');
  } else {
    out.push('The description passes.', '');
  }
  if (bad.length) {
    out.push(`**Commit messages:** ${bad.length} of ${checkedCommits} need work.`, '');
    out.push('| Commit | Score | Top finding |', '|---|---|---|');
    for (const { sha, report: r } of bad) {
      const f = r.findings[0];
      out.push(`| \`${sha.slice(0, 7)}\` ${cell(r.title.slice(0, 60))} | ${r.score} (${r.grade}) | ${f ? cell(`${f.rule}: ${f.message}`) : ''} |`);
    }
    out.push('');
  }
  out.push(
    `<sub>Passes with no ✗ errors and a score of ${max} or less; warnings about length and shape count for 20 at most. Check locally with \`npx buzzcut check --kind pr --title "…" body.md\`, or have your coding agent fix it: \`npx skills add Shiva-Xs/buzzcut\`. [How scoring works](${DOCS})</sub>`,
  );
  return out.join('\n');
}

interface ApiCommit {
  sha: string;
  commit: { message: string };
  parents: { sha: string }[];
}

interface ApiCommitDetail {
  files?: ApiFile[];
  parents?: { sha: string }[];
}

interface PushEvent {
  deleted?: boolean;
  commits?: { id: string; message: string; distinct?: boolean }[];
}

/** One commit, against its own diff. Null for merges and ignored subjects. */
async function checkCommit(client: Client, owner: string, repo: string, sha: string, message: string, parents: number | null, opts: { style: StyleProfile | null; config: Config }): Promise<CommitResult | null> {
  const msg = parseCommit(message);
  if (parents != null && parents > 1) return null;
  if (!msg.title || isIgnored(msg.title, opts.config)) return null;
  const detail = await client.get<ApiCommitDetail>(`/repos/${owner}/${repo}/commits/${sha}`);
  if ((detail.parents?.length ?? 1) > 1) return null;
  const diff = buildDiff((detail.files ?? []).map(fileChange));
  return { sha, report: analyze(msg, diff, { style: opts.style, rules: opts.config.rules, length: opts.config.length }) };
}

export function renderPushMarkdown(commits: CommitResult[], max: number): string {
  const bad = commits.filter((c) => !passes(c.report, max));
  const n = commits.length;
  if (!bad.length) return `### buzzcut: ${n} commit message${n === 1 ? '' : 's'} checked ✓\n\nEach one says what changed, with nothing to cut.`;
  const out = [`### buzzcut: ${bad.length} of ${n} commit message${n === 1 ? '' : 's'} need work`, '', '| Commit | Score | Top finding |', '|---|---|---|'];
  for (const { sha, report: r } of bad) {
    const f = r.findings[0];
    out.push(`| \`${sha.slice(0, 7)}\` ${cell(r.title.slice(0, 60))} | ${r.score} (${r.grade}) | ${f ? cell(`${f.rule}: ${f.message}`) : ''} |`);
  }
  out.push('', `<sub>Passes with no ✗ errors and a score of ${max} or less; warnings about length and shape count for 20 at most. Check one locally with \`npx buzzcut check --rev <sha>\`. [How scoring works](${DOCS})</sub>`);
  return out.join('\n');
}

interface ApiComment {
  id: number;
  body?: string;
  user?: { type?: string } | null;
}

async function findComment(client: Client, owner: string, repo: string, n: number): Promise<ApiComment | null> {
  for (let page = 1; page <= 5; page++) {
    const batch = await client.get<ApiComment[]>(`/repos/${owner}/${repo}/issues/${n}/comments?per_page=100&page=${page}`);
    const hit = batch.find((c) => c.body?.includes(MARKER));
    if (hit) return hit;
    if (batch.length < 100) return null;
  }
  return null;
}

/** Config, client and repo style: everything a run needs besides the event itself. */
function setup(run: CiRun) {
  const { env, log } = run;
  const [owner = '', repo = ''] = (env.GITHUB_REPOSITORY ?? '').split('/');
  const workspace = env.GITHUB_WORKSPACE || run.cwd;
  let config: Config = DEFAULTS;
  try {
    config = loadConfig(existsSync(workspace) ? workspace : null, RULE_IDS);
  } catch (e) {
    log(`::warning::buzzcut: ${(e as Error).message} (using defaults)`);
  }
  const max = Number(input(env, 'max', String(config.max)));
  const token = input(env, 'github-token', env.GITHUB_TOKEN ?? '') || null;
  const client = createClient({ token, fetch: run.fetch, baseUrl: env.GITHUB_API_URL });
  // Style needs history; with a shallow checkout there isn't enough and this is null.
  const style: StyleProfile | null = existsSync(workspace) ? repoStyle(workspace) : null;
  return { owner, repo, workspace, config, max, client, style };
}

/** A push: check each commit it brings (up to 30), with no PR to comment on. */
async function runPush(run: CiRun): Promise<number> {
  const { env, log } = run;
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH ?? '', 'utf8')) as PushEvent;
  const pushed = (event.commits ?? []).filter((c) => c.distinct !== false).slice(-MAX_COMMITS);
  if (event.deleted || !pushed.length) {
    log('buzzcut: no new commits in this push.');
    return 0;
  }
  const { owner, repo, config, max, client, style } = setup(run);
  const commits: CommitResult[] = [];
  for (const c of pushed) {
    const r = await checkCommit(client, owner, repo, c.id, c.message, null, { style, config });
    if (r) commits.push(r);
  }
  const allPass = commits.every((c) => passes(c.report, max));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, renderPushMarkdown(commits, max) + '\n');
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `pass=${allPass}\n`);
  log(`buzzcut: ${commits.length} commit${commits.length === 1 ? '' : 's'} checked; ${allPass ? 'all pass' : 'some need work'}.`);
  if (allPass) return 0;
  if (enforces(env, config, pushed.some((c) => agentFooter(c.message)))) {
    log(`::error::buzzcut: a commit message in this push doesn't pass (max ${max}, no ✗ errors). See the job summary.`);
    return 1;
  }
  log(`::warning::buzzcut: a commit message in this push doesn't pass (max ${max}, no ✗ errors). Not failing the job: buzzcut only fails agents' work unless "block" is "always". See the job summary.`);
  return 0;
}

export async function runCi(run: CiRun): Promise<number> {
  const { env, log } = run;
  const eventName = env.GITHUB_EVENT_NAME ?? '';
  if (eventName === 'push') return runPush(run);
  if (!/^pull_request/.test(eventName)) {
    log(`buzzcut: "${eventName || 'unknown'}" isn't a pull_request or push event, so there's nothing to check.`);
    return 0;
  }
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH ?? '', 'utf8')) as { pull_request?: ApiPull & { base: { sha: string; ref: string } } };
  const pull = event.pull_request;
  if (!pull) {
    log('buzzcut: the event has no pull_request payload.');
    return 0;
  }
  if (isBot(pull.user)) {
    log(`buzzcut: #${pull.number} was opened by a bot (${pull.user?.login}), skipping.`);
    return 0;
  }

  const { owner, repo, workspace, config, max, client, style } = setup(run);
  const ref = { owner, repo, number: pull.number };

  const files = await fetchPrFiles(client, ref, pull.changed_files);
  const diff = buildDiff(files, { additions: pull.additions, deletions: pull.deletions }, files.length < pull.changed_files);
  const template = findTemplate(existsSync(workspace) ? workspace : null) ?? (await fetchTemplate(client, owner, repo, pull.base.sha).catch(() => null));
  const opts = { style, template, rules: config.rules, length: config.length };
  // The checkout is the PR merged into its base, so a name the PR adds is there; a name that is
  // nowhere in it, the diff included, is one the description made up. No checkout, no lookup.
  const prReport = analyze(prMessage(pull.title, pull.body ?? ''), diff, { ...opts, repo: existsSync(join(workspace, '.git')) ? gitRepoSearch(workspace) : null });

  const commits: CommitResult[] = [];
  const messages: string[] = [];
  let checked = 0;
  if (input(env, 'commits', 'true') !== 'false') {
    const list = await client.get<ApiCommit[]>(`/repos/${owner}/${repo}/pulls/${pull.number}/commits?per_page=100`);
    for (const c of list) {
      messages.push(c.commit.message);
      if (checked >= MAX_COMMITS) break;
      const r = await checkCommit(client, owner, repo, c.sha, c.commit.message, c.parents.length, { style, config });
      if (!r) continue;
      commits.push(r);
      checked++;
    }
  }

  const allPass = passes(prReport, max) && commits.every((c) => passes(c.report, max));
  const markdown = renderMarkdown(prReport, commits, max, checked);

  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, markdown.replace(MARKER + '\n', '') + '\n');
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `score=${prReport.score}\ngrade=${prReport.grade}\npass=${allPass}\n`);

  if (input(env, 'comment', 'true') !== 'false') {
    try {
      const existing = await findComment(client, owner, repo, pull.number);
      // Stay quiet on passing PRs, but flip an old complaint to ✓ once it's fixed.
      if (existing) {
        await client.send('PATCH', `/repos/${owner}/${repo}/issues/comments/${existing.id}`, { body: markdown });
        log(`buzzcut: updated comment ${existing.id}`);
      } else if (!allPass) {
        await client.send('POST', `/repos/${owner}/${repo}/issues/${pull.number}/comments`, { body: markdown });
        log('buzzcut: posted a comment');
      }
    } catch (e) {
      const status = e instanceof GitHubError ? e.status : 0;
      log(
        `::warning::buzzcut couldn't comment${status === 403 ? ' (the token is read-only: add `permissions: pull-requests: write`, or this is a fork PR)' : ''}: ${(e as Error).message}`,
      );
    }
  }

  log(`buzzcut: PR yap score ${prReport.score}/100 (${prReport.grade}); ${checked} commit${checked === 1 ? '' : 's'} checked; ${allPass ? 'passes' : 'needs work'}.`);
  if (allPass) return 0;
  // A coding agent's account, or its footer in the text or a commit trailer: the same
  // "block agents, warn people" the git hooks follow.
  const agent = isCodingAgent(pull.user) || agentFooter(pull.body) || messages.some(agentFooter);
  if (enforces(env, config, agent)) {
    log(`::error::buzzcut: the PR description or a commit message doesn't pass (max ${max}, no ✗ errors). See the job summary.`);
    return 1;
  }
  log(`::warning::buzzcut: the PR description or a commit message doesn't pass (max ${max}, no ✗ errors). Not failing the job: buzzcut only fails agents' work unless "block" is "always" (or the action's "fail" is "always"). See the comment.`);
  return 0;
}
