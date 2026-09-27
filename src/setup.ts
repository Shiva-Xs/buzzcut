// `buzzcut setup`: one command per machine. After it, every repo and every coding agent
// on the machine gets buzzcut, whichever editor or terminal the commit comes from:
//   1. a global git hooks folder (commit-msg, pre-push): git runs it for every commit,
//      so it works in VS Code, Cursor, Windsurf, Antigravity and plain terminals alike
//   2. the skill, copied into each agent's user skills folder, so agents write well
//   3. each agent's pre-command hook, so a bad `git commit` / `gh pr create` is stopped
//      before it runs and the agent gets told what to fix
//   4. VS Code's ✨ commit-message / PR-description buttons, pointed at the same rules
// Everything is recorded in a state file, and `--uninstall` puts it all back.
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BEGIN, END, insertBlock, stripBlock } from './init.js';
import { TARGETS, vscodeUserDirs, type Json } from './targets.js';

export interface SetupOptions {
  home: string;
  env: NodeJS.ProcessEnv;
  uninstall: boolean;
  dryRun: boolean;
  gitHooks: boolean;
  agents: boolean;
  vscode: boolean;
  /** absolute path of the node binary the hooks will use */
  node: string;
  /** the single-file buzzcut build to copy (bundle/buzzcut.mjs) */
  bundleSource: string;
  /** the SKILL.md to copy */
  skillSource: string;
  version: string;
}

export interface SetupResult {
  ok: boolean;
  done: string[];
  notes: string[];
  error?: string;
}

interface State {
  version: string;
  node: string;
  bundle: string;
  /** unix seconds of the first setup: commits authored before it are history, not agent work */
  installedAt?: number;
  /** the global hooks folder we manage, and whether we created it (vs. adding to the user's own) */
  git?: { dir: string; own: boolean };
}

export function configDir(home: string, env: NodeJS.ProcessEnv): string {
  return env.XDG_CONFIG_HOME ? join(env.XDG_CONFIG_HOME, 'buzzcut') : join(home, '.config', 'buzzcut');
}

const q = (p: string) => `"${p}"`;

/** The command an agent hook runs: absolute node + absolute script, so a GUI app's PATH doesn't matter. */
export function hookCommand(node: string, bundle: string, flavor: string): string {
  return `${q(node)} ${q(bundle)} hook ${flavor}`;
}

function runGit(args: string[], env: NodeJS.ProcessEnv): string | null {
  try {
    return execFileSync('git', args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

// Client-side hooks git may run. With a global core.hooksPath, git stops looking in each
// repo's .git/hooks, so every one of these passes through to the repo's own copy (git-lfs,
// pre-commit and friends keep working). reference-transaction and fsmonitor-watchman are
// left out: they fire constantly and are almost never used as repo hooks.
export const PASS_THROUGH = [
  'applypatch-msg',
  'pre-applypatch',
  'post-applypatch',
  'pre-commit',
  'pre-merge-commit',
  'prepare-commit-msg',
  'post-commit',
  'pre-rebase',
  'post-checkout',
  'post-merge',
  'post-rewrite',
  'push-to-checkout',
  'pre-auto-gc',
  'sendemail-validate',
];

const LOCAL = (name: string) => `buzzcut_local="$(git rev-parse --git-common-dir 2>/dev/null)/hooks/${name}"`;

export function passThroughScript(name: string): string {
  return [
    '#!/bin/sh',
    '# Installed by `buzzcut setup`. A global core.hooksPath hides each repo\'s own',
    `# .git/hooks, so this hands ${name} on to the repo's copy when there is one.`,
    LOCAL(name),
    'if [ -x "$buzzcut_local" ]; then exec "$buzzcut_local" "$@"; fi',
    'exit 0',
    '',
  ].join('\n');
}

function runner(node: string, bundle: string): string[] {
  // The node that ran setup, or whichever node is on PATH if that one was removed (nvm).
  return [`buzzcut_node=${q(node)}`, '[ -x "$buzzcut_node" ] || buzzcut_node="$(command -v node 2>/dev/null)"', `buzzcut_js=${q(bundle)}`];
}

/** Our block for a global hook, with absolute paths (no PATH lookup). */
export function globalBlock(hook: 'commit-msg' | 'pre-push', node: string, bundle: string): string {
  const lines =
    hook === 'commit-msg'
      ? [
          BEGIN,
          '# Checks the commit message against the staged diff: blocks coding agents, warns people.',
          '# Installed by `buzzcut setup`; remove with `buzzcut setup --uninstall`.',
          ...runner(node, bundle),
          'if [ -n "$buzzcut_node" ] && [ -f "$buzzcut_js" ]; then',
          '  "$buzzcut_node" "$buzzcut_js" hook commit-msg "$1" || exit $?',
          'fi',
          '# A repo-level buzzcut hook further down the line needn\'t check again.',
          'BUZZCUT_CHECKED=1; export BUZZCUT_CHECKED',
          END,
        ]
      : [
          BEGIN,
          "# Re-checks the commits being pushed (catches an agent's --no-verify commits).",
          '# Installed by `buzzcut setup`; remove with `buzzcut setup --uninstall`.',
          ...runner(node, bundle),
          'buzzcut_refs="$(cat)"',
          'if [ -n "$buzzcut_node" ] && [ -f "$buzzcut_js" ]; then',
          '  printf \'%s\\n\' "$buzzcut_refs" | "$buzzcut_node" "$buzzcut_js" hook pre-push "$@" || exit $?',
          'fi',
          'BUZZCUT_CHECKED=1; export BUZZCUT_CHECKED',
          'exec <<BUZZCUT_REFS',
          '$buzzcut_refs',
          'BUZZCUT_REFS',
          END,
        ];
  return lines.join('\n') + '\n';
}

/** A hook script in our own global folder: our check, then the repo's own hook. */
export function ownHookScript(hook: 'commit-msg' | 'pre-push', node: string, bundle: string): string {
  return ['#!/bin/sh', globalBlock(hook, node, bundle).trimEnd(), LOCAL(hook), 'if [ -x "$buzzcut_local" ]; then exec "$buzzcut_local" "$@"; fi', 'exit 0', ''].join('\n');
}

// ─── VS Code ✨ buttons ──────────────────────────────────────────────────────

export const VSCODE_MARK = '(buzzcut)';
export const VSCODE_SETTINGS: Record<string, string> = {
  'github.copilot.chat.commitMessageGeneration.instructions': `${VSCODE_MARK} Subject: imperative, 72 characters or fewer, no trailing period; match the repo's existing style (past tense if its history uses it, conventional prefixes only if the repo uses them). Add a body only when the why isn't obvious: 1 to 3 lines on why (what was broken, who needed it), plus a few plain "- " bullets if the change has several parts. Plain text, no markdown headers, bold or emoji. Never claim tests were added unless test files changed, and never claim something is faster or safer without a number.`,
  'github.copilot.chat.pullRequestDescriptionGeneration.instructions': `${VSCODE_MARK} Open with one or two sentences: what changed and why (the bug, the error message, the issue link, who asked), in plain words with no "What:" or "Why:" labels. Then 2 to 5 bullets with the changes a reviewer would ask about, each saying where to look (function, setting, endpoint) and the concrete values (old → new, limits, defaults); group by area, never file by file. A tiny change needs no bullets. Add one line for a risk, breaking change or migration if there is one. End with "Tested:" and only commands that were actually run, with their results, or "Not tested:" and what should be checked. Short plain headers only for very large PRs. No emoji headers, bold labels, or words like comprehensive, robust, seamless, leverage. Never claim tests were added unless test files changed.`,
};

/** Positions of structural characters in JSONC, skipping strings and comments. */
function significant(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
      out.push(i);
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 1;
    } else if (c && !/\s/.test(c)) out.push(i);
  }
  return out;
}

const keyRe = (key: string) => new RegExp(`"${key.replace(/[.]/g, '\\.')}"\\s*:`);

/**
 * Add our two settings to a VS Code settings.json (JSON with comments). Existing keys are
 * never overwritten, comments survive, and each setting goes on one line so it can be
 * removed cleanly. Returns null when nothing changes.
 */
export function addVscodeSettings(text: string): string | null {
  const add = Object.entries(VSCODE_SETTINGS).filter(([k]) => !keyRe(k).test(text));
  if (!add.length) return null;
  const src = text.trim() ? text : '{\n}\n';
  const pos = significant(src);
  const close = pos[pos.length - 1];
  if (close === undefined || src[close] !== '}') return null;
  const prev = pos[pos.length - 2];
  const needComma = prev !== undefined && src[prev] !== '{' && src[prev] !== ',';
  const lines = add.map(([k, v]) => `    ${JSON.stringify(k)}: [{ "text": ${JSON.stringify(v)} }]`);
  const insert = (needComma ? ',' : '') + '\n' + lines.join(',\n') + '\n';
  const before = src.slice(0, prev === undefined ? close : prev + 1);
  return before + insert + src.slice(close);
}

/** Remove the lines addVscodeSettings added (VS Code tolerates the trailing comma this can leave). */
export function removeVscodeSettings(text: string): string | null {
  const lines = text.split('\n');
  const kept = lines.filter((l) => !(l.includes(VSCODE_MARK) && Object.keys(VSCODE_SETTINGS).some((k) => l.includes(JSON.stringify(k)))));
  if (kept.length === lines.length) return null;
  return kept.join('\n');
}

// ─── setup ───────────────────────────────────────────────────────────────────

function readJson(path: string): Json {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, 'utf8');
  if (!text.trim()) return {};
  const v = JSON.parse(text) as unknown;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error("isn't a JSON object");
  return v as Json;
}

const isOurSkill = (path: string) => existsSync(path) && /^name:\s*buzzcut\s*$/m.test(readFileSync(path, 'utf8'));

export function setup(o: SetupOptions): SetupResult {
  const res: SetupResult = { ok: true, done: [], notes: [] };
  const dir = configDir(o.home, o.env);
  const bundle = join(dir, 'buzzcut.mjs');
  const statePath = join(dir, 'state.json');
  const tilde = (p: string) => (p.startsWith(o.home) ? '~' + p.slice(o.home.length) : p);
  const write = (path: string, content: string, mode?: number) => {
    if (o.dryRun) return;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    if (mode) chmodSync(path, mode);
  };
  let state: State | null = null;
  try {
    state = existsSync(statePath) ? (JSON.parse(readFileSync(statePath, 'utf8')) as State) : null;
  } catch {
    state = null;
  }

  if (!o.uninstall) {
    if (!existsSync(o.bundleSource)) return { ...res, ok: false, error: `can't find the buzzcut build at ${o.bundleSource}` };
    // Our own copy, so the hooks keep working if the npm install moves or npx cleans its cache.
    if (!o.dryRun) {
      mkdirSync(dir, { recursive: true });
      copyFileSync(o.bundleSource, bundle);
    }
    res.done.push(`copied buzzcut ${o.version} to ${tilde(bundle)} (hooks run it with ${tilde(o.node)})`);
  }

  // 1. Global git hooks
  if (o.gitHooks) {
    const gitEnv = { ...o.env, HOME: o.home };
    const current = runGit(['config', '--global', '--get', 'core.hooksPath'], gitEnv)?.trim() || null;
    const ownDir = join(dir, 'git-hooks');
    if (o.uninstall) {
      const g = state?.git;
      if (g?.own) {
        if (current && resolve(current) === resolve(g.dir) && !o.dryRun) runGit(['config', '--global', '--unset', 'core.hooksPath'], gitEnv);
        if (!o.dryRun) rmSync(g.dir, { recursive: true, force: true });
        res.done.push('removed the global git hooks and unset core.hooksPath');
      } else if (g) {
        for (const hook of ['commit-msg', 'pre-push']) {
          const p = join(g.dir, hook);
          if (existsSync(p) && readFileSync(p, 'utf8').includes(BEGIN)) {
            if (!o.dryRun) writeFileSync(p, stripBlock(readFileSync(p, 'utf8')));
            res.done.push(`removed the buzzcut block from ${tilde(p)}`);
          }
        }
      }
    } else if (current && resolve(current.replace(/^~/, o.home)) !== resolve(ownDir)) {
      // The user already has a global hooks folder: add our block to its scripts.
      const target = resolve(current.replace(/^~/, o.home));
      for (const hook of ['commit-msg', 'pre-push'] as const) {
        const p = join(target, hook);
        write(p, insertBlock(existsSync(p) ? readFileSync(p, 'utf8') : null, globalBlock(hook, o.node, bundle)), 0o755);
      }
      state = { ...(state ?? ({} as State)), git: { dir: target, own: false } };
      res.done.push(`added commit-msg and pre-push checks to your global hooks folder ${tilde(target)}`);
    } else {
      for (const name of PASS_THROUGH) write(join(ownDir, name), passThroughScript(name), 0o755);
      for (const hook of ['commit-msg', 'pre-push'] as const) write(join(ownDir, hook), ownHookScript(hook, o.node, bundle), 0o755);
      if (!o.dryRun) runGit(['config', '--global', 'core.hooksPath', ownDir], gitEnv);
      state = { ...(state ?? ({} as State)), git: { dir: ownDir, own: true } };
      res.done.push(`git: every repo now checks commits and pushes (core.hooksPath → ${tilde(ownDir)}); each repo's own hooks still run`);
      res.notes.push("Repos that set their own hooks path (husky) keep using theirs; run `buzzcut init` inside those once.");
    }
  }

  // 2 + 3. Skills and agent hooks
  if (o.agents) {
    const skill = o.uninstall ? '' : readFileSync(o.skillSource, 'utf8');
    for (const t of TARGETS) {
      if (!t.detect(o.home)) continue;
      const did: string[] = [];
      const skillPath = join(t.userSkillsDir(o.home), 'buzzcut', 'SKILL.md');
      if (o.uninstall) {
        if (isOurSkill(skillPath)) {
          if (!o.dryRun) rmSync(dirname(skillPath), { recursive: true, force: true });
          did.push('skill');
        }
      } else if (!existsSync(skillPath) || isOurSkill(skillPath)) {
        write(skillPath, skill);
        did.push('skill');
      } else {
        res.notes.push(`${t.name}: ${tilde(skillPath)} belongs to something else, left alone`);
      }
      if (t.hook) {
        const path = t.hook.userFile(o.home);
        try {
          const before = readJson(path);
          const after = t.hook.merge(before, o.uninstall ? null : hookCommand(o.node, bundle, t.hook.flavor));
          if (JSON.stringify(before) !== JSON.stringify(after) && !(o.uninstall && !existsSync(path))) {
            if (o.uninstall && !Object.keys(after).length) {
              if (!o.dryRun) rmSync(path, { force: true });
            } else write(path, JSON.stringify(after, null, 2) + '\n');
            did.push('hook');
          }
        } catch (e) {
          res.notes.push(`${t.name}: skipped ${tilde(path)} (${(e as Error).message})`);
        }
      }
      if (did.length) res.done.push(`${t.name}: ${o.uninstall ? 'removed' : 'installed'} the ${did.join(' and ')}`);
    }
  }

  // 4. VS Code's ✨ buttons
  if (o.vscode) {
    for (const d of vscodeUserDirs(o.home)) {
      if (!existsSync(d)) continue;
      const p = join(d, 'settings.json');
      const text = existsSync(p) ? readFileSync(p, 'utf8') : '';
      const next = o.uninstall ? removeVscodeSettings(text) : addVscodeSettings(text);
      if (next === null) {
        if (!o.uninstall && Object.keys(VSCODE_SETTINGS).some((k) => keyRe(k).test(text) && !text.includes(VSCODE_MARK))) {
          res.notes.push(`VS Code: ${tilde(p)} already has its own commit/PR instructions, left alone`);
        }
        continue;
      }
      write(p, next);
      res.done.push(`VS Code: ${o.uninstall ? 'removed' : 'pointed'} the ✨ commit message and PR description buttons ${o.uninstall ? 'from' : 'at'} buzzcut's rules (${tilde(p)})`);
    }
  }

  if (o.uninstall) {
    if (!o.dryRun) rmSync(dir, { recursive: true, force: true });
    res.done.push(`removed ${tilde(dir)}`);
  } else if (!o.dryRun) {
    const installedAt = state?.installedAt ?? Math.floor(Date.now() / 1000);
    writeFileSync(statePath, JSON.stringify({ ...state, version: o.version, node: o.node, bundle, installedAt }, null, 2) + '\n');
  }
  return res;
}

const semver = (v: string) => (v.match(/^(\d+)\.(\d+)\.(\d+)/)?.slice(1) ?? []).map(Number);

/** a > b for plain x.y.z versions. */
export function newerVersion(a: string, b: string): boolean {
  const [x, y] = [semver(a), semver(b)];
  if (x.length !== 3 || y.length !== 3) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! > y[i]!;
  return false;
}

/**
 * The hooks run the copy `setup` made, so `npm update -g buzzcut` alone wouldn't reach
 * them. Whenever a newer buzzcut runs, it refreshes that copy and the skills it installed.
 * Returns a note for the user, or null when there was nothing to do.
 */
export function refreshInstall(o: { home: string; env: NodeJS.ProcessEnv; version: string; bundleSource: string; skillSource: string }): string | null {
  const statePath = join(configDir(o.home, o.env), 'state.json');
  let state: State;
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8')) as State;
  } catch {
    return null;
  }
  if (!state.bundle || !newerVersion(o.version, state.version) || !existsSync(o.bundleSource) || !existsSync(o.skillSource)) return null;
  copyFileSync(o.bundleSource, state.bundle);
  const skill = readFileSync(o.skillSource, 'utf8');
  for (const t of TARGETS) {
    const p = join(t.userSkillsDir(o.home), 'buzzcut', 'SKILL.md');
    if (isOurSkill(p)) writeFileSync(p, skill);
  }
  writeFileSync(statePath, JSON.stringify({ ...state, version: o.version }, null, 2) + '\n');
  const nodeGone = state.node && !existsSync(state.node) ? ' The node it ran with is gone: run `buzzcut setup` again.' : '';
  return `updated this machine's hooks and skills from buzzcut ${state.version} to ${o.version}.${nodeGone}`;
}

/** When `buzzcut setup` first ran on this machine, or null if it never did. */
export function installedAt(home: string, env: NodeJS.ProcessEnv): number | null {
  try {
    const state = JSON.parse(readFileSync(join(configDir(home, env), 'state.json'), 'utf8')) as State;
    return typeof state.installedAt === 'number' ? state.installedAt : null;
  } catch {
    return null;
  }
}

// ─── doctor ──────────────────────────────────────────────────────────────────

export interface DoctorLine {
  ok: boolean | null;
  text: string;
}

export function doctor(home: string, env: NodeJS.ProcessEnv, cwd: string): DoctorLine[] {
  const out: DoctorLine[] = [];
  const dir = configDir(home, env);
  const tilde = (p: string) => (p.startsWith(home) ? '~' + p.slice(home.length) : p);
  let state: State | null = null;
  try {
    state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) as State;
  } catch {
    state = null;
  }
  if (!state) {
    out.push({ ok: false, text: 'machine setup: not installed (run `buzzcut setup`)' });
  } else {
    const nodeOk = existsSync(state.node);
    const bundleOk = existsSync(state.bundle);
    out.push({ ok: nodeOk && bundleOk, text: `buzzcut ${state.version} at ${tilde(state.bundle)}, run by ${tilde(state.node)}${nodeOk ? '' : ' (that node is gone: run `buzzcut setup` again)'}` });
  }
  const gitEnv = { ...env, HOME: home };
  const global = runGit(['config', '--global', '--get', 'core.hooksPath'], gitEnv)?.trim();
  const globalHook = global ? join(resolve(global.replace(/^~/, home)), 'commit-msg') : null;
  const globalOk = Boolean(globalHook && existsSync(globalHook) && readFileSync(globalHook, 'utf8').includes(BEGIN));
  out.push({ ok: globalOk, text: `git, every repo: ${globalOk ? `commit-msg and pre-push checks in ${tilde(global!)}` : 'no global buzzcut hooks'}` });

  const local = runGit(['-C', cwd, 'config', '--local', '--get', 'core.hooksPath'], gitEnv)?.trim();
  const inRepo = runGit(['-C', cwd, 'rev-parse', '--is-inside-work-tree'], gitEnv)?.trim() === 'true';
  if (inRepo) {
    // Not `--git-path hooks`: with a global core.hooksPath that points at the global folder.
    const common = runGit(['-C', cwd, 'rev-parse', '--git-common-dir'], gitEnv)?.trim();
    const hooksDir = common ? join(common, 'hooks') : null;
    const repoHook = local ? join(resolve(cwd, local.replace(/(^|[\\/])\.husky[\\/]_$/, '$1.husky')), 'commit-msg') : hooksDir ? join(resolve(cwd, hooksDir), 'commit-msg') : null;
    const repoOk = Boolean(repoHook && existsSync(repoHook) && readFileSync(repoHook, 'utf8').includes(BEGIN));
    if (local) {
      out.push({ ok: repoOk, text: `this repo: uses its own hooks path (${local}), so ${repoOk ? 'its buzzcut hook runs' : 'global hooks are skipped here: run `buzzcut init`'}` });
    } else {
      out.push({ ok: repoOk || globalOk, text: `this repo: ${repoOk ? 'has its own buzzcut hooks' : globalOk ? 'covered by the global hooks' : 'not covered'}` });
    }
  }

  for (const t of TARGETS) {
    if (!t.detect(home)) {
      out.push({ ok: null, text: `${t.name}: not installed on this machine` });
      continue;
    }
    const skillOk = isOurSkill(join(t.userSkillsDir(home), 'buzzcut', 'SKILL.md'));
    let hookOk: boolean | null = null;
    if (t.hook) {
      const p = t.hook.userFile(home);
      hookOk = existsSync(p) && /buzzcut\S*"?\s+hook\s/.test(readFileSync(p, 'utf8'));
    }
    const parts = [`skill ${skillOk ? '✓' : '✗'}`];
    if (hookOk !== null) parts.push(`hook ${hookOk ? '✓' : '✗'}`);
    out.push({ ok: skillOk && hookOk !== false, text: `${t.name}: ${parts.join(', ')}` });
  }

  for (const d of vscodeUserDirs(home)) {
    if (!existsSync(d)) continue;
    const p = join(d, 'settings.json');
    const ok = existsSync(p) && readFileSync(p, 'utf8').includes(VSCODE_MARK);
    out.push({ ok, text: `VS Code ✨ buttons (${tilde(d)}): ${ok ? 'use buzzcut rules' : 'not configured'}` });
  }
  return out;
}

/** Where the running package keeps its single-file build and skill. */
export function packageFiles(moduleUrl: string): { bundle: string; skill: string } {
  const here = dirname(fileURLToPath(moduleUrl));
  const root = [resolve(here, '..'), here].find((d) => existsSync(join(d, 'skills', 'buzzcut', 'SKILL.md'))) ?? resolve(here, '..');
  return { bundle: join(root, 'bundle', 'buzzcut.mjs'), skill: join(root, 'skills', 'buzzcut', 'SKILL.md') };
}

