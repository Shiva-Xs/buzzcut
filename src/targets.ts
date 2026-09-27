// Where each coding agent reads skills and hooks, at the user level (`buzzcut setup`)
// and the repo level (`buzzcut init`). Paths follow each tool's docs and the
// open `skills` installer (vercel-labs/skills).
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentFlavor } from './hooks.js';

export type Json = Record<string, unknown>;

export interface HookSpec {
  flavor: AgentFlavor;
  /** user-level hook file */
  userFile: (home: string) => string;
  /** repo-level hook file, relative to the repo root */
  repoFile: (root: string) => string;
  /** add our entry (command) or remove it (null), leaving everything else alone */
  merge: (config: Json, command: string | null) => Json;
}

export interface AgentTarget {
  id: string;
  name: string;
  /** installed on this machine */
  detect: (home: string) => boolean;
  userSkillsDir: (home: string) => string;
  /** repo-level skills folder, relative to the repo root */
  repoSkillsDir: string;
  hook?: HookSpec;
}

const OURS = /buzzcut\S*"?\s+hook\s+(claude|copilot|cursor|windsurf|antigravity)\b/;
export const isOurs = (cmd: unknown): boolean => typeof cmd === 'string' && OURS.test(cmd);

/** Only git commit / gh pr commands reach the Cursor hook, so it never weighs in on anything else. */
export const CURSOR_MATCHER = String.raw`\bgit\b.*\bcommit\b|\bgh\b.*\bpr\b`;
/** GitHub connector (MCP) tools that open PRs or commit. */
export const MCP_TOOLS = String.raw`pull_request|push_files|create_or_update_file`;
/** Claude Code: shell commands, plus any MCP tool (the hook ignores the ones that don't matter). */
export const CLAUDE_MATCHER = 'Bash|mcp__.*';

interface ClaudeEntry {
  matcher?: string;
  hooks?: { type?: string; command?: string; timeout?: number }[];
  [k: string]: unknown;
}

/** Claude Code settings.json (also read by VS Code's agent mode). */
export function mergeClaudeSettings(settings: Json, command: string | null): Json {
  const hooks = { ...((settings.hooks as Json) ?? {}) };
  const pre = ((hooks.PreToolUse as ClaudeEntry[]) ?? [])
    .map((e) => ({ ...e, hooks: (e.hooks ?? []).filter((h) => !isOurs(h.command)) }))
    .filter((e) => e.hooks.length);
  if (command) pre.push({ matcher: CLAUDE_MATCHER, hooks: [{ type: 'command', command, timeout: 30 }] });
  if (pre.length) hooks.PreToolUse = pre;
  else delete hooks.PreToolUse;
  const out = { ...settings };
  if (Object.keys(hooks).length) out.hooks = hooks;
  else delete out.hooks;
  return out;
}

/** VS Code agent hooks file (~/.copilot/hooks/buzzcut.json, .github/hooks/buzzcut.json): ours alone. */
export function mergeCopilotHooks(_config: Json, command: string | null): Json {
  return command ? { hooks: { PreToolUse: [{ type: 'command', command, timeout: 30 }] } } : {};
}

/** Cursor hooks.json: beforeShellExecution and beforeMCPExecution, each narrowed by a matcher. */
export function mergeCursorHooks(config: Json, command: string | null): Json {
  const hooks = { ...((config.hooks as Json) ?? {}) };
  for (const [event, matcher] of [['beforeShellExecution', CURSOR_MATCHER], ['beforeMCPExecution', MCP_TOOLS]] as const) {
    const list = ((hooks[event] as { command?: string }[]) ?? []).filter((h) => !isOurs(h.command));
    if (command) list.push({ command, matcher } as { command: string });
    if (list.length) hooks[event] = list;
    else delete hooks[event];
  }
  return { version: 1, ...config, hooks };
}

/** Windsurf / Devin hooks.json: pre_run_command and pre_mcp_tool_use. */
export function mergeWindsurfHooks(config: Json, command: string | null): Json {
  const hooks = { ...((config.hooks as Json) ?? {}) };
  for (const event of ['pre_run_command', 'pre_mcp_tool_use']) {
    const list = ((hooks[event] as { command?: string }[]) ?? []).filter((h) => !isOurs(h.command));
    if (command) list.push({ command, show_output: true } as { command: string });
    if (list.length) hooks[event] = list;
    else delete hooks[event];
  }
  return { ...config, hooks };
}

/** Antigravity hooks.json: named hook groups at the top level; ours is "buzzcut". */
export function mergeAntigravityHooks(config: Json, command: string | null): Json {
  const out = { ...config };
  delete out.buzzcut;
  if (command) {
    out.buzzcut = { PreToolUse: [{ matcher: `run_command|.*(${MCP_TOOLS}).*`, hooks: [{ type: 'command', command, timeout: 30 }] }] };
  }
  return out;
}

const claudeHome = (home: string) => process.env.CLAUDE_CONFIG_DIR || join(home, '.claude');
const codexHome = (home: string) => process.env.CODEX_HOME || join(home, '.codex');

export const TARGETS: AgentTarget[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    detect: (home) => existsSync(claudeHome(home)),
    userSkillsDir: (home) => join(claudeHome(home), 'skills'),
    repoSkillsDir: '.claude/skills',
    hook: {
      flavor: 'claude',
      userFile: (home) => join(claudeHome(home), 'settings.json'),
      repoFile: (root) => join(root, '.claude', 'settings.json'),
      merge: mergeClaudeSettings,
    },
  },
  {
    id: 'copilot',
    name: 'VS Code (Copilot agent)',
    detect: (home) => existsSync(join(home, '.copilot')) || vscodeUserDirs(home).some((d) => existsSync(d)),
    userSkillsDir: (home) => join(home, '.copilot', 'skills'),
    repoSkillsDir: '.agents/skills',
    hook: {
      flavor: 'claude',
      userFile: (home) => join(home, '.copilot', 'hooks', 'buzzcut.json'),
      repoFile: (root) => join(root, '.github', 'hooks', 'buzzcut.json'),
      merge: mergeCopilotHooks,
    },
  },
  {
    id: 'cursor',
    name: 'Cursor',
    detect: (home) => existsSync(join(home, '.cursor')),
    userSkillsDir: (home) => join(home, '.cursor', 'skills'),
    repoSkillsDir: '.agents/skills',
    hook: {
      flavor: 'cursor',
      userFile: (home) => join(home, '.cursor', 'hooks.json'),
      repoFile: (root) => join(root, '.cursor', 'hooks.json'),
      merge: mergeCursorHooks,
    },
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    detect: (home) => existsSync(join(home, '.codeium', 'windsurf')),
    userSkillsDir: (home) => join(home, '.codeium', 'windsurf', 'skills'),
    repoSkillsDir: '.windsurf/skills',
    hook: {
      flavor: 'windsurf',
      userFile: (home) => join(home, '.codeium', 'windsurf', 'hooks.json'),
      // Devin-era builds read .devin/hooks.json and fall back to .windsurf/hooks.json.
      repoFile: (root) => (existsSync(join(root, '.devin', 'hooks.json')) ? join(root, '.devin', 'hooks.json') : join(root, '.windsurf', 'hooks.json')),
      merge: mergeWindsurfHooks,
    },
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    detect: (home) => ['antigravity', 'antigravity-ide', 'antigravity-cli'].some((d) => existsSync(join(home, '.gemini', d))),
    // Antigravity 2.x discovers global customizations in ~/.gemini/config/; older builds
    // read ~/.gemini/antigravity/skills.
    userSkillsDir: (home) =>
      existsSync(join(home, '.gemini', 'config')) ? join(home, '.gemini', 'config', 'skills') : join(home, '.gemini', 'antigravity', 'skills'),
    repoSkillsDir: '.agents/skills',
    hook: {
      flavor: 'antigravity',
      userFile: (home) => join(home, '.gemini', 'config', 'hooks.json'),
      repoFile: (root) => join(root, '.agents', 'hooks.json'),
      merge: mergeAntigravityHooks,
    },
  },
  {
    id: 'codex',
    name: 'Codex',
    detect: (home) => existsSync(codexHome(home)),
    userSkillsDir: (home) => join(codexHome(home), 'skills'),
    repoSkillsDir: '.agents/skills',
  },
  {
    id: 'agents',
    name: 'Other agents (~/.agents)',
    detect: (home) => existsSync(join(home, '.agents')),
    userSkillsDir: (home) => join(home, '.agents', 'skills'),
    repoSkillsDir: '.agents/skills',
  },
];

/** VS Code user settings folders (stable and Insiders) on this OS. */
export function vscodeUserDirs(home: string = homedir()): string[] {
  const names = ['Code', 'Code - Insiders'];
  if (process.platform === 'darwin') return names.map((n) => join(home, 'Library', 'Application Support', n, 'User'));
  if (process.platform === 'win32') return names.map((n) => join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), n, 'User'));
  return names.map((n) => join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), n, 'User'));
}
