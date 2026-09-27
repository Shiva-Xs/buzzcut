// `buzzcut init`: installs the hooks that run before a commit, push, or PR leaves
// the machine. Safe to re-run (it replaces its own block) and to undo (--uninstall).
// It never touches anything outside its marked blocks and entries.
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, relative, resolve } from 'node:path';
import { git } from './git.js';
import { markInstalled } from './seen.js';
import { TARGETS, type AgentTarget, type Json } from './targets.js';

export const BEGIN = '# >>> buzzcut >>>';
export const END = '# <<< buzzcut <<<';

export interface InitOptions {
  cwd: string;
  /**
   * Which agents to set up in this repo: ids from TARGETS, "all", or "none".
   * Undefined = the agents whose folders the repo already has (.claude, .cursor, …).
   */
  agents?: string[] | 'all' | 'none';
  /** the SKILL.md to copy into the repo's skill folders */
  skillSource?: string;
  gitHooks: boolean;
  uninstall: boolean;
  dryRun: boolean;
  env: NodeJS.ProcessEnv;
}

export interface InitResult {
  ok: boolean;
  done: string[];
  notes: string[];
  error?: string;
}

const FIND_BIN = [
  'buzzcut_bin="$(git rev-parse --show-toplevel)/node_modules/.bin/buzzcut"',
  '[ -x "$buzzcut_bin" ] || buzzcut_bin="$(command -v buzzcut 2>/dev/null)"',
];

export function hookBlock(hook: 'commit-msg' | 'pre-push'): string {
  const lines =
    hook === 'commit-msg'
      ? [
          BEGIN,
          '# Checks the commit message against the staged diff: blocks coding agents, warns people.',
          '# https://github.com/Shiva-Xs/buzzcut  ·  remove with: buzzcut init --uninstall',
          ...FIND_BIN,
          'if [ -n "$buzzcut_bin" ]; then',
          '  "$buzzcut_bin" hook commit-msg "$1" || exit $?',
          'fi',
          END,
        ]
      : [
          BEGIN,
          '# Re-checks the commits being pushed (catches an agent\'s --no-verify commits).',
          '# https://github.com/Shiva-Xs/buzzcut  ·  remove with: buzzcut init --uninstall',
          ...FIND_BIN,
          '# Read the ref list once and hand it back to the rest of this hook afterwards.',
          'buzzcut_refs="$(cat)"',
          'if [ -n "$buzzcut_bin" ]; then',
          '  printf \'%s\\n\' "$buzzcut_refs" | "$buzzcut_bin" hook pre-push "$@" || exit $?',
          'fi',
          'exec <<BUZZCUT_REFS',
          '$buzzcut_refs',
          'BUZZCUT_REFS',
          END,
        ];
  return lines.join('\n') + '\n';
}

/** Remove our block from a hook script, leaving everything else as it was. */
export function stripBlock(content: string): string {
  const start = content.indexOf(BEGIN);
  if (start === -1) return content;
  const stop = content.indexOf(END, start);
  if (stop === -1) return content;
  let after = stop + END.length;
  if (content[after] === '\n') after++;
  return content.slice(0, start) + content.slice(after);
}

/**
 * Put our block right after the shebang, so an `exit 0` later in an existing hook
 * can't skip it. A new file gets a POSIX sh shebang.
 */
export function insertBlock(content: string | null, block: string): string {
  const base = content == null || !content.trim() ? '#!/bin/sh\n' : stripBlock(content);
  if (base.startsWith('#!')) {
    const nl = base.indexOf('\n');
    const head = nl === -1 ? base + '\n' : base.slice(0, nl + 1);
    return head + block + (nl === -1 ? '' : base.slice(nl + 1));
  }
  return block + base;
}

/**
 * Where this repo's hooks go: its own core.hooksPath (husky included), or .git/hooks.
 * Only a repo-local core.hooksPath counts. A global one (`buzzcut setup`'s, or the user's own)
 * is shared by every repo on the machine, so `init` must never write into it; buzzcut's global
 * hooks run the repo's .git/hooks after their own check. `shadowed` names a global folder that
 * doesn't, so the caller can say the repo hooks won't run.
 */
export function hooksDir(root: string): { dir: string; husky: boolean; shadowed?: string } {
  const configured = git(['config', '--local', '--get', 'core.hooksPath'], root)?.trim();
  if (configured) {
    const abs = resolve(root, configured);
    // husky v9 points core.hooksPath at .husky/_ and runs the scripts in .husky/.
    if (/(^|[\\/])\.husky[\\/]_$/.test(configured)) return { dir: dirname(abs), husky: true };
    return { dir: abs, husky: /(^|[\\/])\.husky$/.test(configured) };
  }
  // Not --git-path hooks: that follows core.hooksPath, including a global one.
  const common = git(['rev-parse', '--git-common-dir'], root)?.trim();
  const dir = resolve(root, common || '.git', 'hooks');
  const shared = git(['config', '--get', 'core.hooksPath'], root)?.trim();
  if (shared) {
    const hook = join(resolve(root, shared), 'commit-msg');
    const chains = existsSync(hook) && readFileSync(hook, 'utf8').includes('--git-common-dir');
    if (!chains) return { dir, husky: false, shadowed: resolve(root, shared) };
  }
  return { dir, husky: false };
}

/** A durable buzzcut on PATH, ignoring the temporary copy `npx` runs from. */
function globalBin(env: NodeJS.ProcessEnv): string | null {
  const names = process.platform === 'win32' ? ['buzzcut.cmd', 'buzzcut.exe', 'buzzcut'] : ['buzzcut'];
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir || /[\\/]_npx[\\/]/.test(dir)) continue;
    for (const n of names) if (existsSync(join(dir, n))) return join(dir, n);
  }
  return null;
}

export type Runner = 'local' | 'global';

/** How the hooks will find buzzcut: the repo's node_modules, or a global install. */
export function detectRunner(root: string, env: NodeJS.ProcessEnv): Runner | null {
  if (existsSync(join(root, 'node_modules', '.bin', 'buzzcut'))) return 'local';
  if (globalBin(env)) return 'global';
  return null;
}

/**
 * The hook command committed to the repo. It must work for every teammate, so it finds
 * buzzcut in node_modules or on PATH and quietly does nothing when it isn't installed.
 */
export function repoCommand(runner: Runner, t: AgentTarget): string {
  const flavor = t.id === 'copilot' ? 'copilot' : t.hook!.flavor;
  // Editors run hooks from different folders (Antigravity: the one holding hooks.json),
  // so find the repo root instead of trusting the working directory.
  const bin =
    runner === 'local'
      ? t.id === 'claude'
        ? '"$CLAUDE_PROJECT_DIR/node_modules/.bin/buzzcut"'
        : '"$(git rev-parse --show-toplevel)/node_modules/.bin/buzzcut"'
      : 'buzzcut';
  const have = runner === 'local' ? `[ -x ${bin} ]` : 'command -v buzzcut >/dev/null 2>&1';
  // Cursor fails open on "command not found"; Windsurf needs exit code 2 to get through.
  if (flavor === 'cursor') return `${bin} hook cursor`;
  if (flavor === 'windsurf') return `${have} || exit 0; ${bin} hook windsurf`;
  return `${have} && ${bin} hook ${flavor} || true`;
}

/** Agents this repo is already set up for, judging by their folders. */
export function repoAgents(root: string, env: NodeJS.ProcessEnv): string[] {
  const has = (p: string) => existsSync(join(root, p));
  const ids: string[] = [];
  if (has('.claude') || env.CLAUDECODE) ids.push('claude');
  if (has('.cursor')) ids.push('cursor');
  if (has('.windsurf') || has('.devin')) ids.push('windsurf');
  if (has('.agents/hooks.json')) ids.push('antigravity');
  if (has('.github/hooks')) ids.push('copilot');
  return ids;
}

function readJson(path: string): Json {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, 'utf8');
  if (!text.trim()) return {};
  const v = JSON.parse(text) as unknown;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error("isn't a JSON object");
  return v as Json;
}

const isOurSkill = (path: string) => existsSync(path) && /^name:\s*buzzcut\s*$/m.test(readFileSync(path, 'utf8'));

export function init(o: InitOptions): InitResult {
  const res: InitResult = { ok: true, done: [], notes: [] };
  const root = git(['rev-parse', '--show-toplevel'], o.cwd)?.trim();
  if (!root) return { ...res, ok: false, error: 'not inside a git repository' };
  const rel = (p: string) => relative(o.cwd, p) || '.';
  const write = (path: string, content: string, mode?: number) => {
    if (o.dryRun) return;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    if (mode) chmodSync(path, mode);
  };

  const runner = detectRunner(root, o.env);
  if (!o.uninstall && !runner) {
    return {
      ...res,
      ok: false,
      error:
        'install buzzcut first, so the hooks run offline and fast:\n' +
        '  npm i -D buzzcut     (JavaScript/TypeScript repos)\n' +
        '  npm i -g buzzcut     (any other repo)\n' +
        'then run `buzzcut init` again.',
    };
  }

  // Git hooks
  if (o.gitHooks) {
    const { dir, husky, shadowed } = hooksDir(root);
    if (shadowed && !o.uninstall) res.notes.push(`git runs the hooks in ${shadowed} for every repo (core.hooksPath), so the ones in ${rel(dir)} won't run. Run \`buzzcut setup\`, which checks every repo and still runs each repo's own hooks, or add \`buzzcut hook commit-msg "$1"\` to that folder's commit-msg.`);
    for (const hook of ['commit-msg', 'pre-push'] as const) {
      const path = join(dir, hook);
      const before = existsSync(path) ? readFileSync(path, 'utf8') : null;
      if (o.uninstall) {
        if (before == null || !before.includes(BEGIN)) continue;
        const after = stripBlock(before);
        if (!o.dryRun) {
          if (/^(#![^\n]*\n?)?\s*$/.test(after)) unlinkSync(path);
          else writeFileSync(path, after);
        }
        res.done.push(`removed the ${hook} hook block from ${rel(path)}`);
      } else {
        write(path, insertBlock(before, hookBlock(hook)), 0o755);
        res.done.push(`${before?.includes(BEGIN) ? 'updated' : before ? 'added to' : 'created'} ${rel(path)}`);
      }
    }
    // Commits from before today are history: pre-push never makes an agent rewrite them.
    if (!o.uninstall && !o.dryRun) markInstalled(root);
    if (husky && !o.uninstall) res.notes.push('husky detected: the hooks went into .husky/, so commit them to share with your team.');
    for (const f of ['lefthook.yml', 'lefthook.yaml', '.lefthook.yml', '.pre-commit-config.yaml']) {
      if (existsSync(join(root, f)) && !o.uninstall) {
        res.notes.push(`${f} found: that tool may overwrite git hooks. Add \`buzzcut hook commit-msg {1}\` as a commit-msg command there too.`);
      }
    }
  }

  // Agents: each one's hook file, plus the skill in the folders they read.
  const wanted =
    o.agents === 'all' ? TARGETS.map((t) => t.id) : o.agents === 'none' ? [] : (o.agents ?? repoAgents(root, o.env));
  const unknown = Array.isArray(wanted) ? wanted.filter((id) => !TARGETS.some((t) => t.id === id)) : [];
  if (unknown.length) return { ...res, ok: false, error: `unknown agent "${unknown[0]}". Choose from: ${TARGETS.map((t) => t.id).join(', ')}` };
  const skillDirs = new Set<string>();
  for (const t of TARGETS) {
    const selected = wanted.includes(t.id);
    if (!selected && !o.uninstall) continue;
    if (t.hook) {
      const path = t.hook.repoFile(root);
      try {
        const before = readJson(path);
        const after = t.hook.merge(before, o.uninstall ? null : repoCommand(runner ?? 'global', t));
        if (JSON.stringify(before) !== JSON.stringify(after) && !(o.uninstall && !existsSync(path))) {
          if (o.uninstall && !Object.keys(after).length) {
            if (!o.dryRun) unlinkSync(path);
          } else write(path, JSON.stringify(after, null, 2) + '\n');
          res.done.push(`${t.name}: ${o.uninstall ? 'removed the hook from' : 'added a hook to'} ${rel(path)}`);
        }
      } catch (e) {
        res.notes.push(`${t.name}: skipped ${rel(path)} (${(e as Error).message})`);
      }
    }
    if (selected || o.uninstall) skillDirs.add(t.repoSkillsDir);
  }
  for (const d of skillDirs) {
    const path = join(root, d, 'buzzcut', 'SKILL.md');
    if (o.uninstall) {
      if (isOurSkill(path)) {
        if (!o.dryRun) unlinkSync(path);
        res.done.push(`removed the skill from ${rel(path)}`);
      }
    } else if (o.skillSource && (!existsSync(path) || isOurSkill(path))) {
      write(path, readFileSync(o.skillSource, 'utf8'));
      res.done.push(`added the skill to ${rel(path)}`);
    }
  }

  if (!o.uninstall && runner === 'global') {
    res.notes.push('using the global buzzcut: teammates need `npm i -g buzzcut` too, or the hooks quietly skip.');
  }
  return res;
}
