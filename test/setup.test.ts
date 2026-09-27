// Machine-wide setup, run for real through the built binary against a throwaway HOME and
// global git config, then exercised with real commits and pushes. Needs `npm run build`.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { agentHook, extractCommand } from '../src/hooks.js';
import { addVscodeSettings, removeVscodeSettings, VSCODE_MARK } from '../src/setup.js';

const BIN = resolve('bundle/buzzcut.mjs');
const STRIP = /^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_CONFIG_DIR|CODEX_HOME|CURSOR_AGENT|GEMINI_CLI|CODEX_.*|AI_AGENT|AGENT|BUZZCUT_.*|GIT_.*|NO_COLOR|FORCE_COLOR|XDG_CONFIG_HOME|APPDATA)$/;
// Where VS Code keeps user settings under a fake HOME (APPDATA is stripped, so Windows falls back to HOME).
const VSCODE_USER = process.platform === 'darwin' ? 'Library/Application Support/Code/User' : process.platform === 'win32' ? 'AppData/Roaming/Code/User' : '.config/Code/User';
const BAD = 'Added comprehensive unit tests for the robust retry logic';
const GOOD = 'Retry webhook sends on 5xx\n\nStripe returns 502 during deploys and we dropped the event.';

beforeAll(() => {
  if (!existsSync(BIN)) throw new Error('bundle/buzzcut.mjs is missing: run `npm run build` first');
});

/** A fake machine: HOME with the given agents "installed", its own global git config. */
class Machine {
  readonly home = mkdtempSync(join(tmpdir(), 'buzzcut-machine-'));
  constructor(agents: string[] = []) {
    writeFileSync(join(this.home, '.gitconfig'), '[user]\n\tname = Dev\n\temail = dev@example.com\n[init]\n\tdefaultBranch = main\n');
    const dirs: Record<string, string> = {
      claude: '.claude',
      cursor: '.cursor',
      windsurf: '.codeium/windsurf',
      antigravity: '.gemini/antigravity',
      'antigravity-2': '.gemini/config',
      copilot: '.copilot',
      codex: '.codex',
      vscode: VSCODE_USER,
    };
    for (const a of agents) mkdirSync(join(this.home, dirs[a]!), { recursive: true });
  }
  env(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!STRIP.test(k)) env[k] = v;
    return { ...env, HOME: this.home, GIT_CONFIG_GLOBAL: join(this.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', NO_COLOR: '1', ...extra };
  }
  yap(args: string[], cwd = this.home, input?: string, extra: NodeJS.ProcessEnv = {}) {
    const r = spawnSync(process.execPath, [BIN, ...args], { cwd, env: this.env(extra), encoding: 'utf8', input });
    return { status: r.status ?? -1, out: r.stdout + r.stderr, stdout: r.stdout };
  }
  git(cwd: string, args: string[], extra: NodeJS.ProcessEnv = {}) {
    const r = spawnSync('git', args, { cwd, env: this.env(extra), encoding: 'utf8' });
    return { status: r.status ?? -1, out: r.stdout + r.stderr };
  }
  /** A repo with no buzzcut of its own: only the machine setup can cover it. */
  repo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'buzzcut-plain-'));
    this.git(dir, ['init', '-q', '-b', 'main']);
    writeFileSync(join(dir, 'README.md'), '# app\n');
    this.git(dir, ['add', '.']);
    this.git(dir, ['commit', '-q', '-m', 'Start the app']);
    writeFileSync(join(dir, 'webhook.js'), 'export const retries = 3;\nexport const backoff = 200;\n');
    this.git(dir, ['add', '-A']);
    return dir;
  }
  read(rel: string): string {
    return readFileSync(join(this.home, rel), 'utf8');
  }
}

describe('buzzcut setup', () => {
  it('covers a repo that never ran init: blocks agents, warns people', () => {
    const m = new Machine();
    expect(m.yap(['setup']).status).toBe(0);
    const repo = m.repo();
    const agent = m.git(repo, ['commit', '-m', BAD], { CLAUDECODE: '1' });
    expect(agent.status).toBe(1);
    expect(agent.out).toContain('Commit blocked');
    const person = m.git(repo, ['commit', '-m', BAD], { BUZZCUT_AGENT: '0' });
    expect(person.status).toBe(0);
    expect(person.out).toContain('only warns people');
  });

  it("keeps each repo's own hooks working (git-lfs, pre-commit, …)", () => {
    const m = new Machine();
    m.yap(['setup']);
    const repo = m.repo();
    const hooks = join(repo, '.git', 'hooks');
    writeFileSync(join(hooks, 'pre-commit'), `#!/bin/sh\necho pre-commit ran > "${repo}/pre-commit.log"\n`, { mode: 0o755 });
    writeFileSync(join(hooks, 'commit-msg'), `#!/bin/sh\necho commit-msg ran > "${repo}/commit-msg.log"\n`, { mode: 0o755 });
    writeFileSync(join(hooks, 'post-checkout'), `#!/bin/sh\necho post-checkout ran > "${repo}/post-checkout.log"\n`, { mode: 0o755 });
    expect(m.git(repo, ['commit', '-m', GOOD], { CLAUDECODE: '1' }).status).toBe(0);
    m.git(repo, ['checkout', '-q', '-b', 'other']);
    for (const f of ['pre-commit', 'commit-msg', 'post-checkout']) expect(existsSync(join(repo, `${f}.log`))).toBe(true);
  });

  it("still lets a repo's own failing hook stop the commit", () => {
    const m = new Machine();
    m.yap(['setup']);
    const repo = m.repo();
    writeFileSync(join(repo, '.git', 'hooks', 'commit-msg'), '#!/bin/sh\necho "team rule failed" >&2\nexit 1\n', { mode: 0o755 });
    const r = m.git(repo, ['commit', '-m', GOOD], { CLAUDECODE: '1' });
    expect(r.status).toBe(1);
    expect(r.out).toContain('team rule failed');
  });

  it('passes the ref list through pre-push to both checks', () => {
    const m = new Machine();
    m.yap(['setup']);
    const repo = m.repo();
    const remote = mkdtempSync(join(tmpdir(), 'buzzcut-remote-'));
    m.git(remote, ['init', '-q', '--bare']);
    m.git(repo, ['remote', 'add', 'origin', remote]);
    writeFileSync(join(repo, '.git', 'hooks', 'pre-push'), `#!/bin/sh\ncat > "${repo}/refs.log"\n`, { mode: 0o755 });
    expect(m.git(repo, ['commit', '--no-verify', '-m', BAD]).status).toBe(0);
    const agent = m.git(repo, ['push', 'origin', 'main'], { CLAUDECODE: '1' });
    expect(agent.status).not.toBe(0);
    expect(agent.out).toContain('Push blocked');
    const person = m.git(repo, ['push', 'origin', 'main'], { BUZZCUT_AGENT: '0' });
    expect(person.status).toBe(0);
    expect(readFileSync(join(repo, 'refs.log'), 'utf8')).toMatch(/^refs\/heads\/main [0-9a-f]{40} refs\/heads\/main [0-9a-f]{40}/);
  });

  it("pre-push blocks an agent's own unchecked commit, never a person's or old history", () => {
    const m = new Machine();
    expect(m.yap(['setup', '--no-agents', '--no-vscode']).status).toBe(0);
    const repo = m.repo();
    const remote = mkdtempSync(join(tmpdir(), 'buzzcut-remote-'));
    m.git(remote, ['init', '-q', '--bare']);
    m.git(repo, ['remote', 'add', 'origin', remote]);
    m.git(repo, ['commit', '-q', '-m', 'Add the webhook retry settings']);
    // History from before setup: lazy, but not the agent's to rewrite.
    writeFileSync(join(repo, 'old.js'), '1\n');
    m.git(repo, ['add', '-A']);
    m.git(repo, ['commit', '-q', '--no-verify', '-m', 'fix'], { GIT_AUTHOR_DATE: '2024-03-01T10:00:00' });
    // A person was warned and kept it anyway.
    writeFileSync(join(repo, 'wip.js'), '1\n');
    m.git(repo, ['add', '-A']);
    expect(m.git(repo, ['commit', '-q', '-m', 'wip']).status).toBe(0);
    const ok = m.git(repo, ['push', 'origin', 'main'], { CLAUDECODE: '1' });
    expect(ok.status).toBe(0);
    expect(ok.out).toContain('before buzzcut');
    expect(ok.out).toContain('kept after a warning');
    expect(ok.out).toContain("Don't rewrite them");

    // The agent's own commit that skipped the hook does block.
    writeFileSync(join(repo, 'agent.js'), '1\n');
    m.git(repo, ['add', '-A']);
    m.git(repo, ['commit', '-q', '--no-verify', '-m', 'update'], { CLAUDECODE: '1' });
    const blocked = m.git(repo, ['push', 'origin', 'main'], { CLAUDECODE: '1' });
    expect(blocked.status).not.toBe(0);
    expect(blocked.out).toContain('Push blocked');
    expect(blocked.out).toContain('1 commit skipped the commit check');
    expect(m.git(repo, ['push', 'origin', 'main']).status).toBe(0);
  });

  it('refreshes the hooks and skills when a newer buzzcut runs, and falls back to node on PATH', () => {
    const m = new Machine(['claude']);
    expect(m.yap(['setup', '--no-vscode']).status).toBe(0);
    const statePath = join(m.home, '.config', 'buzzcut', 'state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    writeFileSync(statePath, JSON.stringify({ ...state, version: '0.0.1' }));
    writeFileSync(state.bundle, '// old build\n');
    writeFileSync(join(m.home, '.claude', 'skills', 'buzzcut', 'SKILL.md'), '---\nname: buzzcut\n---\nold\n');
    const r = m.yap(['doctor']);
    expect(r.out).toContain('from buzzcut 0.0.1 to');
    expect(readFileSync(state.bundle, 'utf8')).not.toContain('old build');
    expect(m.read('.claude/skills/buzzcut/SKILL.md')).toContain('npx -y buzzcut context');
    expect(JSON.parse(readFileSync(statePath, 'utf8')).version).toBe(state.version);
    expect(m.yap(['doctor']).out).not.toContain('from buzzcut');
    expect(m.read('.config/buzzcut/git-hooks/commit-msg')).toContain('command -v node');
  });

  it("doesn't check twice when the repo also ran init", () => {
    const m = new Machine();
    m.yap(['setup']);
    const repo = m.repo();
    mkdirSync(join(repo, 'node_modules', '.bin'), { recursive: true });
    writeFileSync(join(repo, 'node_modules', '.bin', 'buzzcut'), `#!/bin/sh\nexec "${process.execPath}" "${BIN}" "$@"\n`, { mode: 0o755 });
    m.yap(['init', '--agents', 'none'], repo);
    const r = m.git(repo, ['commit', '-m', BAD], { CLAUDECODE: '1' });
    expect(r.status).toBe(1);
    expect(r.out.split('YAP SCORE').length).toBe(2);
  });

  it('installs the skill and hook for every agent it finds, and nothing for the rest', () => {
    const m = new Machine(['claude', 'cursor', 'windsurf', 'antigravity', 'antigravity-2', 'copilot', 'codex']);
    expect(m.yap(['setup']).status).toBe(0);
    for (const d of ['.claude/skills', '.cursor/skills', '.codeium/windsurf/skills', '.gemini/config/skills', '.copilot/skills', '.codex/skills']) {
      expect(m.read(`${d}/buzzcut/SKILL.md`)).toContain('name: buzzcut');
    }
    expect(m.read('.claude/settings.json')).toContain('hook claude');
    expect(m.read('.cursor/hooks.json')).toContain('hook cursor');
    expect(m.read('.codeium/windsurf/hooks.json')).toContain('hook windsurf');
    expect(m.read('.gemini/config/hooks.json')).toContain('hook antigravity');
    expect(m.read('.copilot/hooks/buzzcut.json')).toContain('hook claude');
    // Hooks call node and the script by absolute path: GUI apps don't share the shell's PATH.
    expect(JSON.parse(m.read('.cursor/hooks.json')).hooks.beforeShellExecution[0].command).toContain(`"${process.execPath}"`);
    expect(existsSync(join(m.home, '.agents'))).toBe(false);
  });

  it('leaves existing settings alone, is idempotent, and uninstalls cleanly', () => {
    const m = new Machine(['claude', 'cursor', 'vscode']);
    writeFileSync(join(m.home, '.claude', 'settings.json'), JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } }));
    const vs = `${VSCODE_USER}/settings.json`;
    const vsBefore = '{\n  // my theme\n  "workbench.colorTheme": "Dark+",\n}\n';
    writeFileSync(join(m.home, vs), vsBefore);
    m.yap(['setup']);
    const once = m.read('.claude/settings.json');
    m.yap(['setup']);
    expect(m.read('.claude/settings.json')).toBe(once);
    expect(JSON.parse(once).model).toBe('opus');
    expect(m.read(vs)).toContain('// my theme');
    expect(m.read(vs)).toContain(VSCODE_MARK);

    expect(m.yap(['setup', '--uninstall']).status).toBe(0);
    expect(JSON.parse(m.read('.claude/settings.json'))).toEqual({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } });
    expect(existsSync(join(m.home, '.cursor', 'skills', 'buzzcut'))).toBe(false);
    expect(m.read(vs)).not.toContain(VSCODE_MARK);
    expect(m.read(vs)).toContain('"workbench.colorTheme": "Dark+"');
    expect(m.git(m.home, ['config', '--global', '--get', 'core.hooksPath']).status).not.toBe(0);
    expect(existsSync(join(m.home, '.config', 'buzzcut'))).toBe(false);
  });

  it("adds to the user's own global hooks folder instead of replacing it", () => {
    const m = new Machine();
    const mine = join(m.home, 'my-hooks');
    mkdirSync(mine);
    writeFileSync(join(mine, 'commit-msg'), '#!/bin/sh\necho mine >&2\n', { mode: 0o755 });
    m.git(m.home, ['config', '--global', 'core.hooksPath', mine]);
    m.yap(['setup']);
    expect(m.git(m.home, ['config', '--global', '--get', 'core.hooksPath']).out.trim()).toBe(mine);
    expect(readFileSync(join(mine, 'commit-msg'), 'utf8')).toContain('echo mine');
    const repo = m.repo();
    expect(m.git(repo, ['commit', '-m', BAD], { CLAUDECODE: '1' }).status).toBe(1);
    m.yap(['setup', '--uninstall']);
    expect(readFileSync(join(mine, 'commit-msg'), 'utf8')).toBe('#!/bin/sh\necho mine >&2\n');
    expect(m.git(m.home, ['config', '--global', '--get', 'core.hooksPath']).out.trim()).toBe(mine);
  });

  it('doctor reports what is installed and whether the current repo is covered', () => {
    const m = new Machine(['claude', 'windsurf']);
    expect(m.yap(['doctor']).status).toBe(1);
    m.yap(['setup']);
    const repo = m.repo();
    const d = m.yap(['doctor'], repo);
    expect(d.status).toBe(0);
    expect(d.out).toContain('✓ git, every repo');
    expect(d.out).toContain('✓ this repo: covered by the global hooks');
    expect(d.out).toContain('✓ Claude Code: skill ✓, hook ✓');
    expect(d.out).toContain('✓ Windsurf: skill ✓, hook ✓');
    expect(d.out).toContain('· Cursor: not installed');
  });

  it('changes nothing on a dry run', () => {
    const m = new Machine(['claude']);
    m.yap(['setup', '--dry-run']);
    expect(existsSync(join(m.home, '.claude', 'skills'))).toBe(false);
    expect(m.git(m.home, ['config', '--global', '--get', 'core.hooksPath']).status).not.toBe(0);
  });
});

// ─── agent hook dialects ─────────────────────────────────────────────────────

function repoWithStagedChange(): string {
  const m = new Machine();
  return m.repo();
}

const heredocCommit = (msg: string) => `git add -A && git commit -m "$(cat <<'EOF'\n${msg}\nEOF\n)"`;

describe('agent hook dialects', () => {
  const h = (cwd: string) => ({ cwd, env: {}, color: false });

  it('reads the command out of each payload shape', () => {
    expect(extractCommand({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, cwd: '/r' }, 'claude')).toEqual({ command: 'git commit -m x', cwd: '/r' });
    expect(extractCommand({ tool_name: 'run_in_terminal', tool_input: { command: 'git commit -m x', explanation: '' } }, 'claude').command).toBe('git commit -m x');
    expect(extractCommand({ command: 'git commit -m x', cwd: '/r' }, 'cursor')).toEqual({ command: 'git commit -m x', cwd: '/r' });
    expect(extractCommand({ tool_info: { command_line: 'git commit -m x', cwd: '/r' } }, 'windsurf')).toEqual({ command: 'git commit -m x', cwd: '/r' });
    expect(extractCommand({ toolCall: { name: 'run_command', args: { CommandLine: 'git commit -m x', Cwd: '/r' } } }, 'antigravity')).toEqual({ command: 'git commit -m x', cwd: '/r' });
  });

  it('Claude Code and VS Code: deny as JSON, stay silent otherwise', () => {
    const repo = repoWithStagedChange();
    for (const tool of ['Bash', 'run_in_terminal']) {
      const bad = agentHook(JSON.stringify({ tool_name: tool, tool_input: { command: heredocCommit(BAD) }, cwd: repo }), 'claude', h(repo));
      expect(JSON.parse(bad.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
      const good = agentHook(JSON.stringify({ tool_name: tool, tool_input: { command: heredocCommit(GOOD) }, cwd: repo }), 'claude', h(repo));
      expect(good).toMatchObject({ code: 0, stdout: '' });
    }
  });

  it('Windsurf: exit 2 with the reason on stderr', () => {
    const repo = repoWithStagedChange();
    const bad = agentHook(JSON.stringify({ agent_action_name: 'pre_run_command', tool_info: { command_line: heredocCommit(BAD), cwd: repo } }), 'windsurf', h(repo));
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('phantom-tests');
    const other = agentHook(JSON.stringify({ tool_info: { command_line: 'npm test', cwd: repo } }), 'windsurf', h(repo));
    expect(other).toEqual({ code: 0, stdout: '', stderr: '' });
  });

  it('Antigravity: {"decision":"deny"} with a reason, nothing otherwise', () => {
    const repo = repoWithStagedChange();
    const bad = agentHook(JSON.stringify({ toolCall: { name: 'run_command', args: { CommandLine: heredocCommit(BAD), Cwd: repo } } }), 'antigravity', h(repo));
    expect(JSON.parse(bad.stdout)).toMatchObject({ decision: 'deny' });
    expect(JSON.parse(bad.stdout).reason).toContain('phantom-tests');
    const good = agentHook(JSON.stringify({ toolCall: { name: 'run_command', args: { CommandLine: heredocCommit(GOOD), Cwd: repo } } }), 'antigravity', h(repo));
    expect(good.stdout).toBe('');
  });

  it('Cursor: always answers with JSON, since empty output would block', () => {
    const repo = repoWithStagedChange();
    expect(JSON.parse(agentHook(JSON.stringify({ command: heredocCommit(BAD), cwd: repo }), 'cursor', h(repo)).stdout).permission).toBe('deny');
    expect(JSON.parse(agentHook(JSON.stringify({ command: heredocCommit(GOOD), cwd: repo }), 'cursor', h(repo)).stdout).permission).toBe('allow');
    expect(JSON.parse(agentHook('garbage', 'cursor', h(repo)).stdout).permission).toBe('allow');
  });

  // A GUI app on macOS or Linux starts hooks through /bin/sh with a bare PATH; Windows has neither.
  it.skipIf(process.platform === 'win32')('the installed commands really run from a GUI-like environment with no PATH', () => {
    const m = new Machine(['windsurf']);
    m.yap(['setup']);
    const repo = m.repo();
    const cmd = JSON.parse(m.read('.codeium/windsurf/hooks.json')).hooks.pre_run_command[0].command as string;
    const payload = JSON.stringify({ tool_info: { command_line: heredocCommit(BAD), cwd: repo } });
    const r = spawnSync('/bin/sh', ['-c', cmd], { cwd: repo, env: { HOME: m.home, PATH: '/usr/bin:/bin' }, input: payload, encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('phantom-tests');
  });
});

describe('VS Code settings (JSON with comments)', () => {
  it('adds our keys after existing ones, keeping comments and trailing commas', () => {
    const out = addVscodeSettings('{\n  // theme\n  "a": 1,\n}\n')!;
    expect(out).toContain('// theme');
    expect(out.match(/github\.copilot\.chat\.\w+\.instructions/g)).toHaveLength(2);
    expect(JSON.parse(out.replace(/\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'))).toHaveProperty('a', 1);
  });

  it('handles an empty file and an empty object', () => {
    for (const src of ['', '{}', '{\n}\n']) {
      const out = addVscodeSettings(src)!;
      expect(Object.keys(JSON.parse(out))).toHaveLength(2);
    }
  });

  it("never overwrites the user's own instructions", () => {
    expect(addVscodeSettings('{ "github.copilot.chat.commitMessageGeneration.instructions": [], "github.copilot.chat.pullRequestDescriptionGeneration.instructions": [] }')).toBeNull();
  });

  it('removes exactly what it added', () => {
    const before = '{\n  "a": 1\n}\n';
    const removed = removeVscodeSettings(addVscodeSettings(before)!)!;
    expect(JSON.parse(removed.replace(/,(\s*[}\]])/g, '$1'))).toEqual({ a: 1 });
  });
});

describe('GitHub connector (MCP) calls', () => {
  const h = (cwd: string) => ({ cwd, env: {}, color: false });
  const BLOATED = '## Summary\n\nThis PR introduces a comprehensive retry mechanism.\n\n## Changes\n\n- Added robust retries\n\n## Testing\n\n- Added unit tests for retries\n- All tests pass';
  const GOOD_BODY = 'Stripe returns 502s during deploys and we dropped events. send() now retries 5xx up to 3 times (200/400/800ms backoff). Not tested yet.';
  const prArgs = (body: string) => ({ owner: 'acme', repo: 'api', title: 'Retry webhook sends on 5xx', body, head: 'retry', base: 'main' });

  function branchRepo(): string {
    const m = new Machine();
    const dir = m.repo();
    m.git(dir, ['commit', '-q', '-m', 'Add webhook module']);
    m.git(dir, ['checkout', '-q', '-b', 'retry']);
    writeFileSync(join(dir, 'webhook.js'), 'export const retries = 3;\nexport const backoff = 200;\nexport const max = 800;\n');
    m.git(dir, ['commit', '-qam', 'Retry webhook sends on 5xx']);
    return dir;
  }

  it('Claude Code / VS Code: blocks a bloated create_pull_request, lets a good one through', () => {
    const dir = branchRepo();
    const payload = (body: string) => JSON.stringify({ tool_name: 'mcp__github__create_pull_request', tool_input: prArgs(body), cwd: dir });
    const bad = agentHook(payload(BLOATED), 'claude', h(dir));
    expect(JSON.parse(bad.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(JSON.parse(bad.stdout).hookSpecificOutput.permissionDecisionReason).toContain('PR description');
    expect(agentHook(payload(GOOD_BODY), 'claude', h(dir)).stdout).toBe('');
  });

  it('Cursor: reads tool_input as a JSON string, even with a server launch command present', () => {
    const dir = branchRepo();
    const payload = { tool_name: 'create_pull_request', tool_input: JSON.stringify(prArgs(BLOATED)), mcp_server_name: 'github', command: 'npx -y @modelcontextprotocol/server-github', cwd: dir };
    expect(JSON.parse(agentHook(JSON.stringify(payload), 'cursor', h(dir)).stdout).permission).toBe('deny');
  });

  it('Windsurf: exit 2 on a bad pre_mcp_tool_use', () => {
    const dir = branchRepo();
    const payload = { agent_action_name: 'pre_mcp_tool_use', tool_info: { mcp_server_name: 'github', mcp_tool_name: 'create_pull_request', mcp_tool_arguments: prArgs(BLOATED) } };
    expect(agentHook(JSON.stringify(payload), 'windsurf', h(dir)).code).toBe(2);
  });

  it('Antigravity: denies a bad PR from a connector tool', () => {
    const dir = branchRepo();
    const payload = { toolCall: { name: 'github_create_pull_request', args: prArgs(BLOATED) }, workspacePaths: [dir] };
    expect(JSON.parse(agentHook(JSON.stringify(payload), 'antigravity', h(dir)).stdout).decision).toBe('deny');
  });

  it('checks commits made through push_files against the files being pushed', () => {
    const dir = branchRepo();
    const call = (message: string) =>
      JSON.stringify({ tool_name: 'mcp__github__push_files', tool_input: { owner: 'acme', repo: 'api', branch: 'retry', message, files: [{ path: 'webhook.js', content: 'a\nb\nc\n' }] }, cwd: dir });
    expect(JSON.parse(agentHook(call('Update webhook.js'), 'claude', h(dir)).stdout).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(JSON.parse(agentHook(call('Add unit tests for retries'), 'claude', h(dir)).stdout).hookSpecificOutput.permissionDecisionReason).toContain('phantom-tests');
    expect(agentHook(call('Retry webhook sends on 5xx'), 'claude', h(dir)).stdout).toBe('');
  });

  it('ignores other MCP tools and PR edits that only change the state', () => {
    const dir = branchRepo();
    for (const payload of [
      { tool_name: 'mcp__github__list_issues', tool_input: { owner: 'a', repo: 'b' }, cwd: dir },
      { tool_name: 'mcp__github__update_pull_request', tool_input: { owner: 'a', repo: 'b', pullNumber: 3, state: 'closed' }, cwd: dir },
      { tool_name: 'mcp__linear__create_issue', tool_input: { title: 'x', description: 'y' }, cwd: dir },
    ]) {
      expect(agentHook(JSON.stringify(payload), 'claude', h(dir)).stdout).toBe('');
    }
  });
});
