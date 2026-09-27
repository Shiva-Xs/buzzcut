#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';
import pkg from '../package.json';
import { analyze, historyMessage, keepableEvidence, parseCommit, passes, prMessage } from './analyze.js';
import { readDraft, saveDraft } from './facts.js';
import { diffSignature } from './diff.js';
import { ConfigError, DEFAULTS, isIgnored } from './config.js';
import { buildContext, renderContext } from './context.js';
import { gradePaint, palette, renderReport, toJson, useColor } from './format.js';
import { branchDiff, commitDiff, commitMessage, defaultBase, git, inRepo, recentCommits, stagedDiff } from './git.js';
import { createClient, fetchPr, fetchRecentPrs, fetchTemplate, GitHubError, parsePrRef, parseRepoRef, type RepoRef } from './github.js';
import { localToken } from './token.js';
import { agentHook, commitMsgHook, prePushHook, type HookResult } from './hooks.js';
import { init } from './init.js';
import { doctor, installedAt, packageFiles, refreshInstall, setup } from './setup.js';
import { TARGETS } from './targets.js';
import { loadRepo } from './repo.js';
import { boardShareUrl, boardSummary, renderBoard, renderBoardMarkdown, renderRoast, renderRoastMarkdown, shareUrl, type Board, type BoardRow } from './roast.js';
import type { DiffFacts, Kind, Message } from './types.js';

/** HOME when it's set (git for Windows reads it too), otherwise the OS's home folder. */
const userHome = (env: NodeJS.ProcessEnv = process.env): string => env.HOME || homedir();

const HELP = `
buzzcut ${pkg.version}: short, specific commit messages and PR descriptions,
checked against the actual diff. No API key, no LLM calls.

Set up this machine (once): every repo, every coding agent
  buzzcut setup                   Global git hooks, the skill for each agent found
                                   (Claude Code, Cursor, Windsurf, Antigravity, VS Code,
                                   Codex), their pre-command hooks, and VS Code's ✨ buttons
    --no-git-hooks / --no-agents / --no-vscode    Leave that part out
    --uninstall                    Put everything back
    --dry-run                      Show what would change
  buzzcut doctor                  What's installed where, and whether this repo is covered

Set up one repo for the whole team (commit the files it writes)
  buzzcut init                    commit-msg and pre-push hooks, plus hooks and the skill
                                   for the agents this repo already uses
    --agents <list>                claude,cursor,windsurf,antigravity,copilot, or all / none
    --no-git-hooks                 Only the agent files
    --uninstall                    Remove everything buzzcut added
    --dry-run                      Show what would change

Before you write
  buzzcut context [--kind pr]     Diff facts, word budget and repo style, for an agent

Check a draft
  buzzcut check [file|-]          A commit message against the staged diff
  buzzcut pr [file|-]             A PR body against the branch (no file: the open PR)
    -m, --message <text>           Text to check instead of a file or stdin
    --kind commit|pr               What the text is (check only; default: commit)
    --title <text>                 PR title
    --base <ref>                   Base branch (default: origin/HEAD, main, master)
    --rev <commit>                 Check an existing commit against its own diff
    --no-diff                      Skip the diff checks
    --max <n>                      Fail above this score (default: 35, or the config)
    --json                         Machine-readable output

Look back
  buzzcut log [-n 10]             Score your recent commits
  buzzcut roast <pr-url>          Roast any public GitHub PR (or owner/repo#123)
  buzzcut roast <owner/repo>      Leaderboard of a repo's last merged PRs  (-n 10)
  buzzcut roast                   Inside a repo: roast its last commits  (-n 20)
    --share                        Add a link that posts the roast on X
    --md, --json                   Markdown (for a comment) or machine-readable

Config: .buzzcut.json at the repo root, e.g.
  { "max": 30, "block": "agents", "rules": { "em-dash": "off" }, "ignore": ["^release:"] }
`;

type Opts = Record<string, string | boolean>;

const FLAGS_WITH_VALUE = new Set(['m', 'message', 'kind', 'title', 'base', 'rev', 'max', 'n', 'agents']);

function parseArgs(argv: string[]): { positional: string[]; opts: Opts } {
  const positional: string[] = [];
  const opts: Opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '-' || !a.startsWith('-')) {
      positional.push(a);
      continue;
    }
    const [rawKey, inline] = a.replace(/^--?/, '').split(/=(.*)/s);
    const key = rawKey!;
    if (key.startsWith('no-')) opts[key.slice(3)] = false;
    else if (FLAGS_WITH_VALUE.has(key)) {
      const v = inline ?? argv[++i];
      if (v === undefined) fail(`--${key} needs a value`);
      opts[key] = v!;
    } else opts[key] = true;
  }
  return { positional, opts };
}

function fail(msg: string, code = 2): never {
  process.stderr.write(`buzzcut: ${msg}\n`);
  process.exit(code);
}

function note(msg: string, json: boolean): void {
  if (!json) process.stderr.write(palette(useColor(process.stderr)).dim(`  ${msg}\n`));
}

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function maxScore(opts: Opts, fallback: number): number {
  const n = Number(opts.max ?? fallback);
  if (!Number.isFinite(n)) fail('--max must be a number');
  return n;
}

function repoOrFail(cwd = process.cwd()) {
  try {
    return loadRepo(cwd);
  } catch (e) {
    if (e instanceof ConfigError) fail(e.message);
    throw e;
  }
}

/** Text from -m, a file, or stdin. */
function readInput(positional: string[], opts: Opts, allowTtyEmpty = false): string | null {
  const file = positional[0];
  const message = (opts.m ?? opts.message) as string | undefined;
  if (typeof message === 'string') return message;
  if (file === '-' || (!file && !process.stdin.isTTY && !allowTtyEmpty)) return readStdin();
  if (file) {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      fail(`can't read ${file}`);
    }
  }
  return null;
}

function report(msg: Message, diff: DiffFacts | null, opts: Opts, label?: string, draftFile?: string, anchor?: string): number {
  const repo = repoOrFail();
  // Checking the same draft file again (the skill's loop): facts that were in the last
  // version and are gone now get flagged, so trimming never quietly loses evidence. The same
  // file reused for the next commit (.git/BUZZCUT_MSG) describes another change: no comparison.
  // A staged commit is also pinned to the commit it sits on: numstat can't tell adding a binary
  // file from deleting it, so the diff alone would call those two commits the same draft.
  const key = draftFile && draftFile !== '-' ? `file:${resolve(draftFile)}` : null;
  const sig = diff ? diffSignature(diff) + (anchor ? `@${anchor}` : '') : undefined;
  const saved = key ? readDraft(key, process.cwd()) : null;
  const prev = saved && (!saved.diff || !sig || saved.diff === sig) ? saved : null;
  const r = analyze(msg, diff, { style: repo.style, template: repo.template, rules: repo.config.rules, length: repo.config.length, previous: prev ? { evidence: prev.evidence, strict: false } : null });
  if (key) saveDraft(key, process.cwd(), { evidence: keepableEvidence(msg, r), at: Date.now(), diff: sig });
  const max = maxScore(opts, repo.config.max);
  const json = opts.json === true;
  process.stdout.write(json ? toJson(r, max) + '\n' : renderReport(r, { color: useColor(), max, label, width: process.stdout.columns }) + '\n');
  return passes(r, max) ? 0 : 1;
}

function check(positional: string[], opts: Opts): number {
  const json = opts.json === true;
  const title = typeof opts.title === 'string' ? opts.title : undefined;
  const kind = (opts.kind ?? (title !== undefined || opts.base ? 'pr' : 'commit')) as Kind;
  if (kind !== 'commit' && kind !== 'pr') fail('--kind must be "commit" or "pr"');
  const rev = typeof opts.rev === 'string' ? opts.rev : undefined;

  let raw = readInput(positional, opts, Boolean(rev));
  if (raw == null && rev) raw = commitMessage(rev);
  if (raw == null && !rev) fail('nothing to check. Pass a file, -m "text", pipe text in, or use --rev <commit>. See buzzcut --help.');
  if (raw == null) fail(`couldn't read commit ${rev}`);
  if (!raw.trim()) fail('nothing to check: the message is empty. Pass a file, -m "text", or pipe text in.');

  let msg: Message;
  if (kind === 'commit') msg = parseCommit(raw);
  else {
    // A body that starts with "# Title" carries its own title.
    const heading = !title && raw.match(/^# (.+)\n/);
    msg = heading ? prMessage(heading[1]!, raw.slice(heading[0].length)) : prMessage(title ?? '', raw);
  }

  let diff: DiffFacts | null = null;
  if (opts.diff !== false) {
    if (!inRepo()) note('not a git repo, so the diff checks were skipped', json);
    else if (rev) diff = commitDiff(rev);
    else if (kind === 'commit') {
      diff = stagedDiff();
      if (!diff) note('nothing staged, so the diff checks were skipped (stage first, or use --rev)', json);
    } else {
      const base = (opts.base as string | undefined) ?? defaultBase();
      diff = base ? branchDiff(base) : null;
      if (!diff) note(`couldn't diff against ${base ?? 'a base branch'}, so the diff checks were skipped (use --base)`, json);
    }
  }
  const anchor = kind === 'commit' && !rev && diff ? (git(['rev-parse', '-q', '--verify', 'HEAD']) ?? 'root') : undefined;
  return report(msg, diff, opts, undefined, typeof opts.m === 'string' || typeof opts.message === 'string' ? undefined : positional[0], anchor);
}

/** `buzzcut pr`: a PR body from a file/stdin, or the open PR for this branch via `gh`. */
function pr(positional: string[], opts: Opts): number {
  let raw = readInput(positional, opts);
  let title = typeof opts.title === 'string' ? opts.title : '';
  let base = typeof opts.base === 'string' ? opts.base : undefined;
  if (raw == null) {
    let view: { title: string; body: string; baseRefName: string };
    try {
      view = JSON.parse(
        execFileSync('gh', ['pr', 'view', '--json', 'title,body,baseRefName'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }),
      ) as typeof view;
    } catch {
      fail('no PR body given, and `gh pr view` found no open PR for this branch. Pass a file: buzzcut pr body.md --title "…"');
    }
    raw = view.body ?? '';
    title ||= view.title;
    if (!base) base = git(['rev-parse', '--verify', '-q', `origin/${view.baseRefName}`]) ? `origin/${view.baseRefName}` : view.baseRefName;
  }
  const b = base ?? defaultBase();
  const diff = opts.diff === false || !b ? null : branchDiff(b);
  if (!diff && opts.diff !== false) note(`couldn't diff against ${b ?? 'a base branch'}, so the diff checks were skipped (use --base)`, opts.json === true);
  return report(prMessage(title, raw), diff, opts, 'pr', typeof opts.m === 'string' || typeof opts.message === 'string' ? undefined : positional[0]);
}

function context(opts: Opts): number {
  const kind = (opts.kind ?? 'commit') as Kind;
  if (kind !== 'commit' && kind !== 'pr') fail('--kind must be "commit" or "pr"');
  let c;
  try {
    c = buildContext(kind, process.cwd(), typeof opts.base === 'string' ? opts.base : undefined);
  } catch (e) {
    if (e instanceof ConfigError) fail(e.message);
    throw e;
  }
  process.stdout.write(opts.json ? JSON.stringify(c, null, 2) + '\n' : renderContext(c) + '\n');
  return 0;
}

function log(opts: Opts): number {
  if (!inRepo()) fail('not a git repository');
  const repo = repoOrFail();
  const n = Math.max(1, Math.min(200, Number(opts.n ?? 10) || 10));
  const shas = recentCommits(n);
  if (!shas.length) fail('no commits found');
  const rows = shas
    .map((sha) => ({ sha, msg: historyMessage(commitMessage(sha) ?? '') }))
    .filter(({ msg }) => msg.title && !isIgnored(msg.title, repo.config))
    .map(({ sha, msg }) => ({ sha, report: analyze(msg, commitDiff(sha), { style: repo.style, rules: repo.config.rules, length: repo.config.length }) }));
  if (!rows.length) fail('no commits to score (merges, reverts and version bumps are skipped)');

  if (opts.json) {
    const out = rows.map(({ sha, report: r }) => ({ sha, score: r.score, grade: r.grade, title: r.title, rules: r.findings.map((f) => f.rule) }));
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return 0;
  }
  const p = palette(useColor());
  const out = ['', `  ${p.bold('buzzcut log')} ${p.dim(`· last ${rows.length} commits`)}`, ''];
  for (const { sha, report: r } of rows) {
    const g = gradePaint(p, r.grade);
    const subject = r.title.length > 60 ? r.title.slice(0, 59) + '…' : r.title;
    const top = r.findings[0] ? p.dim(`  ${r.findings[0].rule}`) : '';
    out.push(`  ${p.dim(sha.slice(0, 7))}  ${g(String(r.score).padStart(3))} ${g(r.grade)}  ${subject}${top}`);
  }
  const avg = Math.round(rows.reduce((s, r) => s + r.report.score, 0) / rows.length);
  const worst = rows.reduce((a, b) => (b.report.score > a.report.score ? b : a));
  out.push('');
  out.push(`  ${p.dim('average')} ${avg}  ${p.dim('· worst')} ${worst.sha.slice(0, 7)} (${worst.report.score})  ${p.dim('· details:')} buzzcut check --rev ${worst.sha.slice(0, 7)}`);
  out.push('');
  process.stdout.write(out.join('\n') + '\n');
  return 0;
}

const clampN = (v: unknown, fallback: number, max: number) => Math.max(1, Math.min(max, Number(v ?? fallback) || fallback));

function boardJson(b: Board): string {
  const { avg, rows } = boardSummary(b);
  return JSON.stringify(
    {
      subject: b.subject,
      average: avg,
      rows: rows.map(({ id, title, report: r }) => ({ id, title, score: r.score, grade: r.grade, words: r.words, budget: r.budget, changedLines: r.diff?.changedLines ?? null, rules: r.findings.map((f) => f.rule) })),
    },
    null,
    2,
  );
}

function printBoard(b: Board, opts: Opts): number {
  if (opts.json) process.stdout.write(boardJson(b) + '\n');
  else if (opts.md) process.stdout.write(renderBoardMarkdown(b) + '\n');
  else process.stdout.write(renderBoard(b, { color: useColor() }) + '\n');
  if (opts.share && !opts.json) process.stdout.write(`   Post it: ${boardShareUrl(b)}\n\n`);
  return 0;
}

/** `buzzcut roast` inside a repo: the last N commits, as a leaderboard. */
function roastCommits(opts: Opts): number {
  const repo = repoOrFail();
  const shas = recentCommits(clampN(opts.n, 20, 200));
  const rows: BoardRow[] = [];
  for (const sha of shas) {
    const msg = historyMessage(commitMessage(sha) ?? '');
    if (!msg.title || isIgnored(msg.title, repo.config)) continue;
    rows.push({ id: sha.slice(0, 7), title: msg.title, report: analyze(msg, commitDiff(sha), { style: repo.style, rules: repo.config.rules, length: repo.config.length }) });
  }
  if (!rows.length) fail('no commits to roast here');
  const name = basename(repo.root ?? process.cwd());
  const worst = [...rows].sort((a, b) => b.report.score - a.report.score)[0]!;
  return printBoard({ subject: `${name} · last ${rows.length} commits`, kind: 'commit', rows, next: `buzzcut check --rev ${worst.id}` }, opts);
}

async function roastRepo(ref: RepoRef, opts: Opts): Promise<number> {
  const client = createClient({ token: localToken() });
  // Without a token GitHub allows 60 requests an hour; each PR costs one.
  const count = clampN(opts.n, 10, client.authenticated ? 30 : 15);
  if (!opts.json) note(`fetching the last ${count} merged PRs of ${ref.owner}/${ref.repo}…`, false);
  const prs = await fetchRecentPrs(client, ref, count);
  if (!prs.length) fail(`no merged PRs by people found in ${ref.owner}/${ref.repo}`);
  const template = await fetchTemplate(client, ref.owner, ref.repo).catch(() => null);
  const rows: BoardRow[] = prs.map((pr) => ({ id: `#${pr.number}`, title: pr.title, report: analyze(prMessage(pr.title, pr.body), pr.diff, { template }) }));
  const worst = [...rows].sort((a, b) => b.report.score - a.report.score)[0]!;
  return printBoard({ subject: `${ref.owner}/${ref.repo} · last ${rows.length} merged PRs`, kind: 'pr', rows, next: `npx buzzcut roast ${ref.owner}/${ref.repo}${worst.id}` }, opts);
}

async function roast(positional: string[], opts: Opts): Promise<number> {
  const target = positional[0];
  if (!target) {
    if (!inRepo()) fail('usage: buzzcut roast <pr-url | owner/repo#123 | owner/repo>, or run it inside a git repo to roast its commits');
    return roastCommits(opts);
  }
  const ref = parsePrRef(target);
  if (!ref) {
    const repoRef = parseRepoRef(target);
    if (repoRef) return roastRepo(repoRef, opts);
    fail(`"${target}" isn't a GitHub PR (URL or owner/repo#123) or a repo (owner/repo)`);
  }
  const client = createClient({ token: localToken() });
  const pr = await fetchPr(ref, client);
  if (pr.bot && !opts.json) {
    process.stdout.write(
      `\n  🤖 ${pr.owner}/${pr.repo}#${pr.number} was opened by a bot (${pr.author}).\n` +
        `  Changelogs and dependency bumps aren't yap. Try a PR written by a person or their agent.\n\n`,
    );
    return 0;
  }
  const template = await fetchTemplate(client, ref.owner, ref.repo, pr.baseSha).catch(() => null);
  const r = analyze(prMessage(pr.title, pr.body), pr.diff, { template });
  if (opts.json) process.stdout.write(toJson(r, maxScore(opts, DEFAULTS.max), { pr: { url: pr.url, author: pr.author, bot: pr.bot } }) + '\n');
  else if (opts.md) process.stdout.write(renderRoastMarkdown(pr, r, { template }) + '\n');
  else process.stdout.write(renderRoast(pr, r, { color: useColor(), template, share: opts.share === true }) + '\n');
  if (opts.share && !opts.json) process.stdout.write(`   Post it: ${shareUrl(pr, r)}\n\n`);
  return 0;
}

function emit(r: HookResult): number {
  if (r.stdout) process.stdout.write(r.stdout.endsWith('\n') ? r.stdout : r.stdout + '\n');
  if (r.stderr) process.stderr.write(r.stderr);
  return r.code;
}

/** Hooks never block because buzzcut itself broke: errors are reported and the action goes through. */
function hook(positional: string[]): number {
  const [name, ...args] = positional;
  const h = { cwd: process.cwd(), env: process.env, color: useColor(process.stderr) };
  // A global hook that already checked this commit or push hands off to the repo's own
  // hook with this set, so the same message isn't judged twice.
  if ((name === 'commit-msg' || name === 'pre-push') && process.env.BUZZCUT_CHECKED === '1') return 0;
  try {
    switch (name) {
      case 'commit-msg':
        if (!args[0]) fail('usage: buzzcut hook commit-msg <message-file>');
        return emit(commitMsgHook(args[0], h));
      case 'pre-push':
        return emit(prePushHook(args[0] ?? 'origin', process.stdin.isTTY ? '' : readStdin(), h, installedAt(userHome(), process.env)));
      case 'claude':
      case 'copilot':
        return emit(agentHook(readStdin(), 'claude', h));
      case 'cursor':
      case 'windsurf':
      case 'antigravity':
        return emit(agentHook(readStdin(), name, h));
      default:
        fail('usage: buzzcut hook <commit-msg|pre-push|claude|copilot|cursor|windsurf|antigravity>');
    }
  } catch (e) {
    process.stderr.write(`buzzcut: ${(e as Error).message} (not blocking)\n`);
    if (name === 'cursor') process.stdout.write(JSON.stringify({ permission: 'allow' }) + '\n');
    return 0;
  }
}

function printResult(res: { ok: boolean; done: string[]; notes: string[]; error?: string }, dryRun: boolean): void {
  const p = palette(useColor());
  if (!res.ok) fail(res.error ?? 'failed', 1);
  const dry = dryRun ? p.dim(' (dry run, nothing written)') : '';
  process.stdout.write('\n');
  if (!res.done.length) process.stdout.write(`  ${p.dim('Nothing to change.')}${dry}\n`);
  for (const d of res.done) process.stdout.write(`  ${p.green('✓')} ${d}${dry}\n`);
  for (const n of res.notes) process.stdout.write(`  ${p.yellow('!')} ${n}\n`);
}

function runInit(opts: Opts): number {
  const raw = opts.agents;
  const agents = typeof raw === 'string' ? (raw === 'all' || raw === 'none' ? raw : raw.split(',').map((a) => a.trim()).filter(Boolean)) : undefined;
  const res = init({
    cwd: process.cwd(),
    agents,
    skillSource: packageFiles(import.meta.url).skill,
    gitHooks: opts['git-hooks'] !== false,
    uninstall: opts.uninstall === true,
    dryRun: opts['dry-run'] === true,
    env: process.env,
  });
  printResult(res, opts['dry-run'] === true);
  if (!opts.uninstall && res.done.length && opts['git-hooks'] !== false) {
    const p = palette(useColor());
    process.stdout.write(
      `\n  Commits and pushes in this repo are now checked. Coding agents get blocked until\n` +
        `  the message passes; people get a warning. Settings go in ${p.cyan('.buzzcut.json')}.\n`,
    );
  }
  process.stdout.write('\n');
  return 0;
}

function runSetup(opts: Opts): number {
  const files = packageFiles(import.meta.url);
  const dryRun = opts['dry-run'] === true;
  const res = setup({
    home: userHome(),
    env: process.env,
    uninstall: opts.uninstall === true,
    dryRun,
    gitHooks: opts['git-hooks'] !== false,
    agents: opts.agents !== false,
    vscode: opts.vscode !== false,
    node: process.execPath,
    bundleSource: files.bundle,
    skillSource: files.skill,
    version: pkg.version,
  });
  printResult(res, dryRun);
  if (!opts.uninstall && res.ok && !dryRun) {
    const p = palette(useColor());
    process.stdout.write(
      `\n  Done. From now on, commits and PRs are checked in every repo and every agent\n` +
        `  on this machine. Restart open editors so they pick up the new hooks.\n` +
        `  Check anytime with ${p.cyan('buzzcut doctor')}; undo with ${p.cyan('buzzcut setup --uninstall')}.\n`,
    );
  }
  process.stdout.write('\n');
  return 0;
}

function runDoctor(): number {
  const p = palette(useColor());
  const lines = doctor(userHome(), process.env, process.cwd());
  process.stdout.write(`\n  ${p.bold('buzzcut doctor')}\n\n`);
  for (const l of lines) {
    const icon = l.ok === true ? p.green('✓') : l.ok === false ? p.red('✗') : p.dim('·');
    process.stdout.write(`  ${icon} ${l.ok === null ? p.dim(l.text) : l.text}\n`);
  }
  process.stdout.write('\n');
  return lines.some((l) => l.ok === false) ? 1 : 0;
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    process.stdout.write(HELP);
    return 0;
  }
  if (cmd === '--version' || cmd === '-v') {
    process.stdout.write(pkg.version + '\n');
    return 0;
  }
  const { positional, opts } = parseArgs(rest);
  if (opts.help || opts.h) {
    process.stdout.write(HELP);
    return 0;
  }
  if (cmd !== 'hook' && cmd !== 'setup') {
    try {
      const files = packageFiles(import.meta.url);
      const updated = refreshInstall({ home: userHome(), env: process.env, version: pkg.version, bundleSource: files.bundle, skillSource: files.skill });
      if (updated) note(`buzzcut: ${updated}`, false);
    } catch {
      // never let housekeeping get in the way of the command
    }
  }
  switch (cmd) {
    case 'check':
      return check(positional, opts);
    case 'pr':
      return pr(positional, opts);
    case 'context':
      return context(opts);
    case 'log':
      return log(opts);
    case 'roast':
      return roast(positional, opts);
    case 'init':
      return runInit(opts);
    case 'setup':
      return runSetup(opts);
    case 'doctor':
      return runDoctor();
    case 'hook':
      return hook(positional);
  }
  if (parsePrRef(cmd)) return roast([cmd, ...positional], opts);
  fail(`unknown command "${cmd}". See buzzcut --help.`);
}

main().then(
  (code) => process.exit(code),
  (err) => fail(err instanceof GitHubError ? err.message : String(err?.stack ?? err), 2),
);
