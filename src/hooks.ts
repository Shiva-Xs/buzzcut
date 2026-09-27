// What runs at the moment of commit, push, or PR: git hooks for everyone, plus
// Claude Code and Cursor hooks that stop an agent's `git commit` / `gh pr create`
// before the command runs and tell it exactly what to fix.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { detectAgent } from './agent.js';
import { analyze, keepableEvidence, parseCommit, passes, prMessage } from './analyze.js';
import { clearDraft, readDraft, saveDraft } from './facts.js';
import { isIgnored, type Block } from './config.js';
import { ICON, palette, renderReport } from './format.js';
import { buildDiff } from './diff.js';
import { amendDiff, branchDiff, commitDiff, commitMessage, defaultBase, git, operationInProgress, stagedDiff, worktreeDiff } from './git.js';
import { loadRepo, type RepoContext } from './repo.js';
import type { PreviousDraft, SessionFacts } from './rules/rule.js';
import { fingerprint, readSeen, recordSeen } from './seen.js';
import { readSession } from './session.js';
import { findCalls, mightMatter, type CommitCall, type PrCall } from './shell.js';
import type { Message, Report } from './types.js';

export interface HookResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface HookEnv {
  cwd: string;
  env: NodeJS.ProcessEnv;
  color: boolean;
}

const ok = (stderr = ''): HookResult => ({ code: 0, stdout: '', stderr });

export function shouldBlock(block: Block, agent: string | null): boolean {
  return block === 'always' || (block === 'agents' && agent !== null);
}

function readSafe(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** Plain-text findings an agent can act on. */
export function agentFeedback(what: string, r: Report, max: number): string {
  const errors = r.findings.filter((f) => f.severity === 'error').length;
  const lines = [
    `buzzcut: this ${what} doesn't pass (yap score ${r.score}/100, ${r.grade}${errors ? `, ${errors} error${errors > 1 ? 's' : ''}` : ''}; it needs ${max} or less and no errors). Fix these, then run the same command again:`,
  ];
  for (const f of r.findings.slice(0, 10)) lines.push(`${ICON[f.severity]} ${f.rule}: ${f.message}${/[.?!]$/.test(f.message) ? '' : '.'} ${f.hint}`);
  if (r.findings.length > 10) lines.push(`… and ${r.findings.length - 10} smaller notes.`);
  lines.push("Cut the padding, not the facts: keep the why (from the conversation), every number, error message, link and name the reviewer needs, and only the commands you actually ran. Rewrite it yourself and run the command again; there's no need to ask the user unless they asked for this exact wording.");
  return lines.join('\n');
}

// ─── git commit-msg ──────────────────────────────────────────────────────────

export function commitMsgHook(file: string, h: HookEnv): HookResult {
  const repo = loadRepo(h.cwd);
  const raw = readSafe(resolve(h.cwd, file));
  if (raw == null) return ok();
  const msg = parseCommit(raw);
  // Whatever goes through is remembered, so pre-push knows it was checked (see seen.ts).
  const through = (r: HookResult): HookResult => {
    if (msg.title) recordSeen(`${msg.title}\n${msg.body}`, h.cwd);
    return r;
  };
  // Git rejects an empty message itself, and merges/rebases/reverts carry someone else's text.
  if (!msg.title || isIgnored(msg.title, repo.config) || operationInProgress(h.cwd)) return through(ok());

  // An empty index usually means `--amend` with only a new message.
  const diff = stagedDiff(h.cwd) ?? amendDiff(h.cwd);
  const report = analyze(msg, diff, { style: repo.style, rules: repo.config.rules, length: repo.config.length });
  const max = repo.config.max;
  const p = palette(h.color);
  if (passes(report, max)) return through(ok(p.dim(`buzzcut ✓ yap score ${report.score} (${report.grade})`) + '\n'));

  const agent = detectAgent(h.env);
  const block = shouldBlock(repo.config.block, agent);
  let out = renderReport(report, { color: h.color, max, label: 'commit message' });
  if (block) {
    out += agent
      ? `\n  ${p.red('Commit blocked')} (${agent} detected). Rewrite the message and commit again.\n`
      : `\n  ${p.red('Commit blocked')} ("block": "always" in the buzzcut config). Rewrite the message and commit again.\n`;
  } else {
    // Agents buzzcut can't recognize get this path too, so it speaks to them directly.
    out += `\n  ${p.dim('buzzcut only warns people, so the commit went through.')}\n`;
    out += `  ${p.yellow('If you are a coding agent:')} rewrite this message to fix the lines above and amend it with \`git commit --amend -F <file>\`. Only amend a commit you just made.\n`;
  }
  return block ? { code: 1, stdout: '', stderr: out } : through({ code: 0, stdout: '', stderr: out });
}

// ─── git pre-push ────────────────────────────────────────────────────────────

const ZERO = /^0+$/;
const MAX_PUSH_COMMITS = 50;

/** Why a failing commit can't block a push, or null when it can. */
type Excuse = 'before buzzcut' | 'kept after a warning' | null;

/**
 * Re-checks the commits being pushed, to catch an agent's commit that skipped the
 * commit-msg hook (--no-verify, or a tool that doesn't run hooks). A commit a person was
 * warned about and kept, or one from before buzzcut was set up, only gets a note:
 * an agent must never be sent to rewrite someone else's history.
 */
export function prePushHook(remote: string, stdin: string, h: HookEnv, installedAt: number | null = null): HookResult {
  const repo = loadRepo(h.cwd);
  const shas: string[] = [];
  for (const line of stdin.split('\n')) {
    const [, local, , remoteSha] = line.trim().split(/\s+/);
    if (!local || ZERO.test(local)) continue;
    const range =
      remoteSha && !ZERO.test(remoteSha) && git(['cat-file', '-e', `${remoteSha}^{commit}`], h.cwd) != null
        ? [`${remoteSha}..${local}`]
        : [local, '--not', `--remotes=${remote}`];
    const out = git(['rev-list', '--no-merges', '-n', String(MAX_PUSH_COMMITS + 1), ...range], h.cwd) ?? '';
    for (const sha of out.split('\n').filter(Boolean)) if (!shas.includes(sha)) shas.push(sha);
  }
  if (!shas.length) return ok();

  const seen = readSeen(h.cwd);
  const starts = [seen?.since, installedAt ?? undefined].filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  const since = starts.length ? Math.min(...starts) : null;
  const failing: { sha: string; report: Report; excuse: Excuse }[] = [];
  for (const sha of shas.slice(0, MAX_PUSH_COMMITS)) {
    const raw = commitMessage(sha, h.cwd) ?? '';
    const msg = parseCommit(raw);
    if (!msg.title || isIgnored(msg.title, repo.config)) continue;
    const report = analyze(msg, commitDiff(sha, h.cwd), { style: repo.style, rules: repo.config.rules, length: repo.config.length });
    if (passes(report, repo.config.max)) continue;
    // Author time survives rebase and cherry-pick, so old work rebased today still counts as old.
    const authored = Number(git(['log', '-1', '--format=%at', sha], h.cwd)?.trim());
    const excuse: Excuse =
      since == null || !(authored >= since)
        ? 'before buzzcut'
        : seen?.prints.has(fingerprint(`${msg.title}\n${msg.body}`))
          ? 'kept after a warning'
          : null;
    failing.push({ sha, report, excuse });
  }
  const p = palette(h.color);
  const checked = Math.min(shas.length, MAX_PUSH_COMMITS);
  if (!failing.length) return ok(p.dim(`buzzcut ✓ ${checked} commit${checked > 1 ? 's' : ''} checked`) + '\n');

  const agent = detectAgent(h.env);
  const unchecked = failing.filter((f) => !f.excuse);
  const block = shouldBlock(repo.config.block, agent) && unchecked.length > 0;
  const lines = ['', `  ${p.bold('buzzcut')} ${p.dim(`· ${failing.length} of ${checked} commits being pushed need work`)}`, ''];
  for (const { sha, report: r, excuse } of failing) {
    const subject = r.title.length > 50 ? r.title.slice(0, 49) + '…' : r.title;
    const icon = excuse ? p.yellow(ICON.warn) : p.red(ICON.error);
    lines.push(`  ${icon} ${p.dim(sha.slice(0, 7))}  ${String(r.score).padStart(3)} ${r.grade}  ${subject}${excuse ? p.dim(`  (${excuse})`) : ''}`);
    for (const f of r.findings.slice(0, 3)) lines.push(`      ${p.dim(`${f.rule}: ${f.message}`)}`);
  }
  lines.push('');
  lines.push(`  ${p.dim('See the details with')} buzzcut check --rev <sha>`);
  if (block) {
    const n = unchecked.length;
    lines.push(`  ${p.red('Push blocked')}${agent ? ` (${agent} detected)` : ''}: ${n} commit${n > 1 ? 's' : ''} skipped the commit check (--no-verify?).`);
    lines.push(`  Reword ${n > 1 ? 'them' : 'it'}: \`git commit --amend\` for the latest, or squash your own commits into one`);
    lines.push(`  well-written commit. Only rewrite commits you made; if one isn't yours, tell the user instead.`);
  } else if (agent && unchecked.length === 0) {
    lines.push(`  ${p.dim("Not blocking: these were kept by a person or made before buzzcut was set up. Don't rewrite them.")}`);
  } else {
    lines.push(`  ${p.dim('buzzcut only warns people, so the push went through.')}`);
    lines.push(`  ${p.yellow('If you are a coding agent:')} tell the user about these commits; don't rewrite or force-push history that's already pushed.`);
  }
  lines.push('');
  return { code: block ? 1 : 0, stdout: '', stderr: lines.join('\n') };
}

// ─── agent hooks (Claude Code, Cursor) ───────────────────────────────────────

interface Problem {
  what: string;
  report: Report;
}

/**
 * Judge an agent's draft. A draft that's sent back is remembered, and the next one is sent
 * back once more if it quietly dropped facts from it (numbers, links, file:line pointers):
 * the agent may cut padding, not evidence. Returns the report when the draft doesn't pass.
 */
function judge(key: string, dir: string, msg: Message, max: number, run: (previous: PreviousDraft | null) => Report): Report | null {
  const prev = readDraft(key, dir);
  const report = run(prev && !prev.warned ? { evidence: prev.evidence, strict: true } : null);
  if (passes(report, max)) {
    clearDraft(key, dir);
    return null;
  }
  const warned = Boolean(prev?.warned) || report.findings.some((f) => f.rule === 'dropped-facts');
  const evidence = [...new Set([...(prev?.evidence ?? []), ...keepableEvidence(msg, report)])];
  saveDraft(key, dir, { evidence, at: Date.now(), warned });
  return report;
}

const branchKey = (dir: string) => `hook:pr:${git(['rev-parse', '--abbrev-ref', 'HEAD'], dir)?.trim() ?? ''}`;

function checkCommit(call: CommitCall, dir: string, repo: RepoContext, session: SessionFacts | null): Problem | null {
  const text = call.message ?? (call.file ? readSafe(resolve(dir, call.file)) : null);
  if (text == null) return null; // editor or --reuse-message: the git hook covers it
  const msg = parseCommit(text);
  if (!msg.title || isIgnored(msg.title, repo.config)) return null;
  const diff = call.stagesFirst
    ? worktreeDiff(dir)
    : call.all
      ? worktreeDiff(dir, { untracked: false })
      : call.amend
        ? amendDiff(dir)
        : stagedDiff(dir);
  const report = judge('hook:commit', dir, msg, repo.config.max, (previous) => analyze(msg, diff, { style: repo.style, rules: repo.config.rules, length: repo.config.length, session, previous }));
  return report ? { what: 'commit message', report } : null;
}

function checkPr(call: PrCall, dir: string, repo: RepoContext, session: SessionFacts | null): Problem | null {
  if (call.generated) return null;
  const body = call.body ?? (call.file ? readSafe(resolve(dir, call.file)) : null);
  // `gh pr edit --title` alone doesn't touch the description.
  if (body == null && (call.action === 'edit' || call.title == null)) return null;
  const base = call.base ?? defaultBase(dir);
  const diff = base ? branchDiff(base, dir) : null;
  const msg = prMessage(call.title ?? '', body ?? '');
  const report = judge(branchKey(dir), dir, msg, repo.config.max, (previous) =>
    analyze(msg, diff, { style: repo.style, template: repo.template, rules: repo.config.rules, length: repo.config.length, session, previous }),
  );
  return report ? { what: 'PR description', report } : null;
}

/** Problems with the commits and PRs in a shell command, or [] to let it run. */
export function checkCommand(command: string, cwd: string, transcript?: string): { problems: Problem[]; repo: RepoContext | null } {
  if (!mightMatter(command)) return { problems: [], repo: null };
  const calls = findCalls(command);
  if (!calls.length) return { problems: [], repo: null };
  const problems: Problem[] = [];
  const session = transcript ? readSession(transcript) : null;
  let first: RepoContext | null = null;
  for (const call of calls) {
    // The repo is the one the command runs in: `cd other && git commit` or `git -C other commit`
    // is judged by other's history and config, even when the agent started outside any repo.
    const dir = call.dir ? resolve(cwd, call.dir) : cwd;
    const repo = loadRepo(dir);
    first ??= repo;
    if (!repo.root) continue;
    const p = call.tool === 'git-commit' ? checkCommit(call, dir, repo, session) : checkPr(call, dir, repo, session);
    if (p) problems.push(p);
  }
  return { problems, repo: first };
}

/**
 * Agents with a pre-command hook, and the dialect each speaks.
 * - claude: Claude Code, and VS Code's agent mode, which reads the same hook format
 * - cursor: Cursor's beforeShellExecution
 * - windsurf: Windsurf (Devin) Cascade's pre_run_command
 * - antigravity: Google Antigravity's PreToolUse on run_command
 */
export type AgentFlavor = 'claude' | 'cursor' | 'windsurf' | 'antigravity';
export const AGENT_FLAVORS: AgentFlavor[] = ['claude', 'cursor', 'windsurf', 'antigravity'];

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const str = (...vs: unknown[]): string | undefined => vs.find((v): v is string => typeof v === 'string' && v !== '');

/** The shell command and working directory out of each agent's payload. */
export function extractCommand(input: Json, flavor: AgentFlavor): { command?: string; cwd?: string } {
  switch (flavor) {
    case 'claude': {
      // Claude Code sends tool_name "Bash"; VS Code sends its own terminal tool. Both put the
      // command line in tool_input.command, so any tool with one counts.
      const ti = obj(input.tool_input);
      return { command: str(ti.command), cwd: str(input.cwd, ti.cwd) };
    }
    case 'cursor':
      return { command: str(input.command), cwd: str(input.cwd, (input.workspace_roots as unknown[] | undefined)?.[0]) };
    case 'windsurf': {
      const ti = obj(input.tool_info);
      return { command: str(ti.command_line), cwd: str(ti.cwd) };
    }
    case 'antigravity': {
      const args = obj(obj(input.toolCall).args);
      return {
        command: str(args.CommandLine, args.commandLine, args.command),
        cwd: str(args.Cwd, args.cwd, (input.workspacePaths as unknown[] | undefined)?.[0]),
      };
    }
  }
}

/** "Let it run" in each dialect. Never an explicit approval where that could skip the user's own prompt. */
function pass(flavor: AgentFlavor): HookResult {
  // Cursor treats empty output as a block, so it needs an explicit allow; its matcher keeps
  // this hook to git commit / gh pr commands only (see init/setup).
  return flavor === 'cursor' ? { code: 0, stdout: JSON.stringify({ permission: 'allow' }), stderr: '' } : ok();
}

function deny(flavor: AgentFlavor, reason: string, summary: string): HookResult {
  switch (flavor) {
    case 'claude':
      return {
        code: 0,
        stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }),
        stderr: '',
      };
    case 'cursor':
      return { code: 0, stdout: JSON.stringify({ permission: 'deny', user_message: `buzzcut blocked this: ${summary}`, agent_message: reason }), stderr: '' };
    case 'windsurf':
      // Exit 2 blocks, and Cascade reads the reason from stderr.
      return { code: 2, stdout: '', stderr: reason + '\n' };
    case 'antigravity':
      return { code: 0, stdout: JSON.stringify({ decision: 'deny', reason }), stderr: '' };
  }
}

function advise(flavor: AgentFlavor, reason: string): HookResult {
  if (flavor === 'claude') return { code: 0, stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: reason } }), stderr: '' };
  if (flavor === 'cursor') return { code: 0, stdout: JSON.stringify({ permission: 'allow', agent_message: reason }), stderr: '' };
  return pass(flavor);
}

// ─── GitHub connector (MCP) calls ───────────────────────────────────────────
// Agents with a GitHub MCP server open PRs and even commit without touching the shell:
// create_pull_request / update_pull_request, and push_files / create_or_update_file.

export interface McpCall {
  tool: string;
  args: Json;
}

const PR_TOOL = /(?:^|[^a-z])(create|update)_?pull_?request(?:$|[^a-z])/i;
const COMMIT_TOOL = /(?:^|[^a-z])(push_files|create_or_update_file)(?:$|[^a-z])/i;

function parseArgs(v: unknown): Json {
  if (typeof v === 'string') {
    try {
      return obj(JSON.parse(v));
    } catch {
      return {};
    }
  }
  return obj(v);
}

/** The MCP tool call in a payload, or null when the payload is about something else. */
export function extractMcp(input: Json, flavor: AgentFlavor): McpCall | null {
  switch (flavor) {
    case 'claude': {
      // Claude Code: mcp__<server>__<tool>; VS Code passes its own MCP tool names.
      const tool = str(input.tool_name);
      return tool && !obj(input.tool_input).command ? { tool, args: obj(input.tool_input) } : null;
    }
    case 'cursor': {
      const tool = str(input.tool_name);
      return tool ? { tool, args: parseArgs(input.tool_input) } : null;
    }
    case 'windsurf': {
      const ti = obj(input.tool_info);
      const tool = str(ti.mcp_tool_name);
      return tool ? { tool, args: parseArgs(ti.mcp_tool_arguments) } : null;
    }
    case 'antigravity': {
      const tc = obj(input.toolCall);
      const tool = str(tc.name);
      return tool && tool !== 'run_command' ? { tool, args: parseArgs(tc.args) } : null;
    }
  }
}

function lineCount(text: string): number {
  return text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0;
}

export function checkMcp(call: McpCall, cwd: string, transcript?: string): { problems: Problem[]; repo: RepoContext | null } {
  const isPr = PR_TOOL.test(call.tool);
  const isCommit = COMMIT_TOOL.test(call.tool);
  if (!isPr && !isCommit) return { problems: [], repo: null };
  const repo = loadRepo(cwd);
  const session = transcript ? readSession(transcript) : null;
  const a = call.args;
  const opts = { style: repo.style, template: repo.template, rules: repo.config.rules, length: repo.config.length, session };

  if (isPr) {
    const title = str(a.title) ?? null;
    const body = str(a.body) ?? null;
    // update_pull_request with only a new state or base isn't a description change.
    if (body == null && (/update/i.test(call.tool) || title == null)) return { problems: [], repo };
    const base = str(a.base) ?? (repo.root ? defaultBase(cwd) : null);
    const head = str(a.head);
    const localHead = head && repo.root && git(['rev-parse', '--verify', '-q', head], cwd) ? head : 'HEAD';
    const diff = base && repo.root ? branchDiff(base, cwd, localHead) : null;
    const msg = prMessage(title ?? '', body ?? '');
    let failing: Report | null;
    if (repo.root) failing = judge(branchKey(cwd), cwd, msg, repo.config.max, (previous) => analyze(msg, diff, { ...opts, previous }));
    else {
      const report = analyze(msg, diff, opts);
      failing = passes(report, repo.config.max) ? null : report;
    }
    return { problems: failing ? [{ what: 'PR description', report: failing }] : [], repo };
  }

  // A commit made through the connector: the files are right there in the arguments.
  const message = str(a.message);
  if (!message) return { problems: [], repo };
  const files = Array.isArray(a.files)
    ? (a.files as unknown[]).map((f) => obj(f)).map((f) => ({ path: str(f.path) ?? 'file', additions: lineCount(str(f.content) ?? ''), deletions: 0 }))
    : str(a.path)
      ? [{ path: str(a.path)!, additions: lineCount(str(a.content) ?? ''), deletions: 0 }]
      : [];
  const msg = parseCommit(message);
  if (!msg.title || isIgnored(msg.title, repo.config)) return { problems: [], repo };
  const report = analyze(msg, files.length ? buildDiff(files) : null, opts);
  return { problems: passes(report, repo.config.max) ? [] : [{ what: 'commit message', report }], repo };
}

/**
 * Reads the hook payload from stdin. Never breaks the agent's tool call because of a
 * buzzcut problem: bad input or an internal error means "let it run".
 */
export function agentHook(payload: string, flavor: AgentFlavor, h: HookEnv): HookResult {
  let input: Json;
  try {
    input = obj(JSON.parse(payload));
  } catch {
    return pass(flavor);
  }
  const transcript = str(input.transcript_path, input.transcriptPath);
  // MCP first: Cursor's MCP payload also has a "command" (the server's launch command).
  const mcp = extractMcp(input, flavor);
  const { command, cwd = h.cwd } = mcp ? { command: undefined, cwd: str(input.cwd, (input.workspace_roots as unknown[] | undefined)?.[0], (input.workspacePaths as unknown[] | undefined)?.[0]) } : extractCommand(input, flavor);
  if (!mcp && !command) return pass(flavor);

  try {
    const { problems, repo } = mcp ? checkMcp(mcp, cwd ?? h.cwd, transcript) : checkCommand(command!, cwd ?? h.cwd, transcript);
    if (!problems.length || !repo) return pass(flavor);
    const reason = problems.map((p) => agentFeedback(p.what, p.report, repo.config.max)).join('\n\n');
    if (repo.config.block === 'never') return advise(flavor, reason);
    const summary = problems.map((p) => `${p.what}: yap score ${p.report.score} (${p.report.grade})`).join('; ');
    return deny(flavor, reason, summary);
  } catch (e) {
    return { ...pass(flavor), stderr: `buzzcut hook error (let the command run): ${(e as Error).message}\n` };
  }
}
