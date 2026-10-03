// End to end: real git repos, real `git commit` / `git push`, the built binary behind
// the hooks. Run `npm run build` first (npm test does).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { fixture } from './helpers.js';

const BIN = resolve('bundle/buzzcut.mjs');
const AGENT_VARS = /^(CLAUDECODE|CLAUDE_CODE_.*|CURSOR_AGENT|GEMINI_CLI|CODEX_.*|OPENCODE_CLIENT|AUGMENT_AGENT|WINDSURF_AGENT|CODEIUM_AGENT|COPILOT_AGENT|CLINE_AGENT|CONTINUE_AGENT|AI_AGENT|AGENT|BUZZCUT_AGENT|GIT_.*|NO_COLOR|FORCE_COLOR)$/;

const NODE_DIR = mkdtempSync(join(tmpdir(), 'buzzcut-node-'));
symlinkSync(process.execPath, join(NODE_DIR, process.platform === 'win32' ? 'node.exe' : 'node'));

function baseEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!AGENT_VARS.test(k)) env[k] = v;
  // A buzzcut installed on this machine mustn't stand in for the one under test, but the
  // folder it lives in (nvm's bin) also has node, which the hooks need.
  const PATH = [NODE_DIR, ...(env.PATH ?? '').split(delimiter).filter((d) => !['buzzcut', 'buzzcut.cmd'].some((n) => existsSync(join(d, n))))].join(delimiter);
  return { ...env, PATH, HOME: home, GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', NO_COLOR: '1' };
}

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

class Sandbox {
  readonly dir: string;
  readonly home: string;
  constructor() {
    this.home = mkdtempSync(join(tmpdir(), 'buzzcut-home-'));
    writeFileSync(join(this.home, '.gitconfig'), '[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n');
    this.dir = mkdtempSync(join(tmpdir(), 'buzzcut-e2e-'));
    this.git('init', '-q', '-b', 'main');
    mkdirSync(join(this.dir, 'node_modules', '.bin'), { recursive: true });
    // What `npm i -D buzzcut` leaves behind: node_modules/.bin/buzzcut.
    writeFileSync(join(this.dir, 'node_modules', '.bin', 'buzzcut'), `#!/bin/sh\nexec "${process.execPath}" "${BIN}" "$@"\n`, { mode: 0o755 });
    this.write('.gitignore', 'node_modules\n');
    this.write('README.md', '# demo\n');
    this.git('add', '.');
    this.git('commit', '-q', '-m', 'Start the demo project');
  }
  env(who: 'human' | 'agent', extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return { ...baseEnv(this.home), ...(who === 'agent' ? { CLAUDECODE: '1' } : {}), ...extra };
  }
  write(path: string, content: string) {
    mkdirSync(join(this.dir, path, '..'), { recursive: true });
    writeFileSync(join(this.dir, path), content);
  }
  git(...args: string[]): Run {
    return this.run('git', args, 'human');
  }
  run(cmd: string, args: string[], who: 'human' | 'agent' = 'human', extra: NodeJS.ProcessEnv = {}, input?: string): Run {
    const r = spawnSync(cmd, args, { cwd: this.dir, env: this.env(who, extra), encoding: 'utf8', input });
    return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
  }
  yap(args: string[], who: 'human' | 'agent' = 'human', input?: string, extra: NodeJS.ProcessEnv = {}): Run {
    return this.run(process.execPath, [BIN, ...args], who, extra, input);
  }
  commit(message: string, who: 'human' | 'agent', ...flags: string[]): Run {
    return this.run('git', ['commit', ...flags, '-m', message], who);
  }
  head(): string {
    return this.git('log', '-1', '--format=%s').stdout.trim();
  }
  change(path = 'src/webhook.ts', lines = 7) {
    this.write(path, Array.from({ length: lines }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n');
    this.git('add', '-A');
  }
}

const BAD = 'Added comprehensive unit tests for the robust retry logic.\n\n## Summary\n- **Retry**: added\n- **Backoff**: added';
const GOOD = 'Retry webhook sends on 5xx\n\nStripe returns 502 during deploys and we dropped the event.';

beforeAll(() => {
  if (!existsSync(BIN)) throw new Error('bundle/buzzcut.mjs is missing: run `npm run build` first');
});

describe('commit-msg hook', () => {
  it('blocks an agent, explains why, and leaves HEAD alone', () => {
    const s = new Sandbox();
    expect(s.yap(['init', '--agents', 'none']).status).toBe(0);
    s.change();
    const r = s.commit(BAD, 'agent');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('phantom-tests');
    expect(r.stderr).toContain('Commit blocked (Claude Code detected)');
    expect(s.head()).toBe('Start the demo project');
  });

  it('lets the agent through once the message passes', () => {
    const s = new Sandbox();
    s.yap(['init', '--agents', 'none']);
    s.change();
    const r = s.commit(GOOD, 'agent');
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('buzzcut ✓');
    expect(s.head()).toBe('Retry webhook sends on 5xx');
  });

  it('only warns a person', () => {
    const s = new Sandbox();
    s.yap(['init', '--agents', 'none']);
    s.change();
    const r = s.commit(BAD, 'human');
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('only warns people');
    expect(s.head()).toContain('Added comprehensive');
  });

  it('honors "block" in .buzzcut.json', () => {
    const s = new Sandbox();
    s.yap(['init', '--agents', 'none']);
    s.write('.buzzcut.json', '{ "block": "always" }');
    s.change();
    expect(s.commit(BAD, 'human').status).toBe(1);
    s.write('.buzzcut.json', '{ "block": "never" }');
    expect(s.commit(BAD, 'agent').status).toBe(0);
  });

  it('honors rule overrides', () => {
    const s = new Sandbox();
    s.yap(['init', '--agents', 'none']);
    s.write('.buzzcut.json', '{ "rules": { "phantom-tests": "off" } }');
    s.change();
    expect(s.commit('Add unit tests for the webhook retries', 'agent').status).toBe(0);
  });

  it("doesn't block on a broken config, but says so", () => {
    const s = new Sandbox();
    s.yap(['init', '--agents', 'none']);
    s.write('.buzzcut.json', '{ "rules": { "nope": "off" } }');
    s.change();
    const r = s.commit(BAD, 'agent');
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('unknown rule "nope"');
  });

  it('checks the whole amended commit, not just the new staged bits', () => {
    const s = new Sandbox();
    s.yap(['init', '--agents', 'none']);
    s.change();
    expect(s.commit(GOOD, 'agent').status).toBe(0);
    const r = s.run('git', ['commit', '--amend', '-m', 'Added unit tests for retries'], 'agent');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no test files changed');
  });

  it('skips merges and quietly skips when buzzcut isn\'t installed', () => {
    const s = new Sandbox();
    s.yap(['init', '--agents', 'none']);
    s.git('checkout', '-q', '-b', 'feature');
    s.change('src/a.ts');
    s.commit('Add the a module', 'human');
    s.git('checkout', '-q', 'main');
    s.change('src/b.ts');
    s.commit('Add the b module', 'human');
    expect(s.run('git', ['merge', '--no-ff', '--no-edit', 'feature'], 'agent').status).toBe(0);

    rmSync(join(s.dir, 'node_modules'), { recursive: true });
    s.change('src/c.ts');
    const r = s.commit(BAD, 'agent');
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('buzzcut');
  });

  it('strips git editor comments before judging', () => {
    const s = new Sandbox();
    s.yap(['init', '--agents', 'none']);
    s.change();
    s.write('msg.txt', `${GOOD}\n# Please enter the commit message for your changes. Lines starting\n# with '#' will be ignored.\n#\n# On branch main\n`);
    const r = s.run('git', ['commit', '--cleanup=strip', '-F', 'msg.txt'], 'agent');
    expect(r.status).toBe(0);
  });
});

describe('pre-push hook', () => {
  it('blocks an agent pushing a commit that skipped the hook, warns a person', () => {
    const s = new Sandbox();
    const remote = mkdtempSync(join(tmpdir(), 'buzzcut-remote-'));
    spawnSync('git', ['init', '-q', '--bare', remote], { env: s.env('human') });
    s.git('remote', 'add', 'origin', remote);
    expect(s.git('push', '-q', 'origin', 'main').status).toBe(0);
    s.yap(['init', '--agents', 'none']);
    s.change();
    expect(s.commit(BAD, 'agent', '--no-verify').status).toBe(0);

    const agent = s.run('git', ['push', 'origin', 'main'], 'agent');
    expect(agent.status).not.toBe(0);
    expect(agent.stderr).toContain('Push blocked');
    expect(agent.stderr).toContain('1 of 1 commits being pushed need work');

    const human = s.run('git', ['push', 'origin', 'main'], 'human');
    expect(human.status).toBe(0);
    expect(human.stderr).toContain('only warns people');
  });

  it('checks a new branch against what the remote already has', () => {
    const s = new Sandbox();
    const remote = mkdtempSync(join(tmpdir(), 'buzzcut-remote-'));
    spawnSync('git', ['init', '-q', '--bare', remote], { env: s.env('human') });
    s.git('remote', 'add', 'origin', remote);
    s.git('push', '-q', 'origin', 'main');
    s.yap(['init', '--agents', 'none']);
    s.git('checkout', '-q', '-b', 'retry');
    s.change();
    s.commit(GOOD, 'agent');
    const r = s.run('git', ['push', '-u', 'origin', 'retry'], 'agent');
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('buzzcut ✓ 1 commit checked');
  });
});

function claudePayload(command: string, cwd: string): string {
  return JSON.stringify({ session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd });
}

describe('agent hooks', () => {
  it('denies an agent commit written as a heredoc, before git runs', () => {
    const s = new Sandbox();
    s.change();
    const cmd = `git add -A && git commit -m "$(cat <<'EOF'\n${BAD}\nEOF\n)"`;
    const r = s.yap(['hook', 'claude'], 'agent', claudePayload(cmd, s.dir));
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('phantom-tests');
  });

  it('sends a rewrite back once when it quietly drops facts from the draft it replaces', () => {
    const s = new Sandbox();
    s.change();
    const decision = (cmd: string) => {
      const out = s.yap(['hook', 'claude'], 'agent', claudePayload(cmd, s.dir)).stdout;
      return out ? JSON.parse(out).hookSpecificOutput : null;
    };
    const facts = 'Stripe 502s hit 253 orders during deploys, see #436. Retries wait 200ms, then 400ms.';
    // 1. An invented test claim is sent back; its line's numbers aren't demanded later.
    const first = decision(`git commit -m "Retry webhook sends on 5xx" -m "${facts}" -m "Added 12 unit tests for the retry path."`);
    expect(first?.permissionDecision).toBe('deny');
    // 2. The rewrite drops the evidence along with the false claim: sent back, with the list.
    const second = decision('git commit -m "Retry webhook sends on 5xx" -m "Stripe errors during deploys dropped events, so sends now retry."');
    expect(second?.permissionDecision).toBe('deny');
    expect(second.permissionDecisionReason).toContain('dropped-facts');
    expect(second.permissionDecisionReason).toContain('253 orders');
    expect(second.permissionDecisionReason).not.toContain('12 unit tests');
    // 3. Only once: the agent may have had a reason.
    expect(decision('git commit -m "Retry webhook sends on 5xx" -m "Stripe errors during deploys dropped events, so sends now retry."')).toBeNull();
  });

  it('lets a rewrite that keeps the facts straight through', () => {
    const s = new Sandbox();
    s.change();
    const run = (cmd: string) => s.yap(['hook', 'claude'], 'agent', claudePayload(cmd, s.dir)).stdout;
    expect(run('git commit -m "Retry webhook sends on 5xx" -m "Stripe 502s hit 253 orders, see #436." -m "Added 12 unit tests for the retry path."')).toContain('deny');
    expect(run('git commit -m "Retry webhook sends on 5xx" -m "Stripe 502s hit 253 orders during deploys, see #436."')).toBe('');
  });

  it('buzzcut check warns when the same draft file loses facts between checks', () => {
    const s = new Sandbox();
    s.change();
    s.write('.git/BUZZCUT_MSG', 'Retry webhook sends on 5xx\n\nStripe 502s hit 253 orders during deploys, see #436.\n');
    expect(s.yap(['check', '.git/BUZZCUT_MSG']).stdout).not.toContain('dropped-facts');
    s.write('.git/BUZZCUT_MSG', 'Retry webhook sends on 5xx\n\nStripe errors during deploys dropped events.\n');
    const r = s.yap(['check', '.git/BUZZCUT_MSG']);
    expect(r.stdout).toContain('dropped-facts');
    expect(r.stdout).toContain('253 orders, #436');
    expect(r.status).toBe(0);
  });

  it("buzzcut check doesn't compare the next commit's message with the last one's", () => {
    const s = new Sandbox();
    s.change();
    s.write('.git/BUZZCUT_MSG', 'Retry webhook sends on 5xx\n\nStripe 502s hit 253 orders during deploys, see #436.\n');
    s.yap(['check', '.git/BUZZCUT_MSG']);
    s.git('commit', '-q', '-F', '.git/BUZZCUT_MSG');
    s.change('src/queue.ts', 12);
    s.write('.git/BUZZCUT_MSG', 'Requeue events the webhook sender gave up on\n\nThey were logged and lost after the third 5xx.\n');
    expect(s.yap(['check', '.git/BUZZCUT_MSG']).stdout).not.toContain('dropped-facts');
  });

  it("buzzcut check doesn't compare deleting binary files with the commit that added them", () => {
    // numstat shows both as "-  -  path", so only the commit underneath tells the two drafts apart
    const s = new Sandbox();
    s.write('shots/a.jpg', 'JFIF\0\x01\x02binary');
    s.git('add', 'shots');
    s.write('.git/BUZZCUT_MSG', 'Add screenshots at 1440, 1024, 768 and 375\n');
    s.yap(['check', '.git/BUZZCUT_MSG']);
    s.git('commit', '-q', '-F', '.git/BUZZCUT_MSG');
    s.git('rm', '-q', '-r', 'shots');
    s.write('.git/BUZZCUT_MSG', 'Remove the screenshots again\n');
    expect(s.yap(['check', '.git/BUZZCUT_MSG']).stdout).not.toContain('dropped-facts');
  });

  it('allows a good commit and anything unrelated with no output', () => {
    const s = new Sandbox();
    s.change();
    for (const cmd of [`git commit -m "${GOOD}"`, 'npm test', 'git status && git diff']) {
      const r = s.yap(['hook', 'claude'], 'agent', claudePayload(cmd, s.dir));
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('');
    }
  });

  it('checks gh pr create against the branch diff and the PR template', () => {
    const s = new Sandbox();
    s.git('checkout', '-q', '-b', 'retry');
    s.change();
    s.commit(GOOD, 'human');
    const bloated = `gh pr create --title "Add comprehensive retry mechanism" --body "$(cat <<'EOF'\n${fixture('bloated-pr.md')}\nEOF\n)"`;
    const r = s.yap(['hook', 'claude'], 'agent', claudePayload(bloated, s.dir));
    const reason = JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason as string;
    expect(reason).toContain('PR description');
    expect(reason).toContain('words for a 7-line diff');

    const good = `gh pr create --title "Retry webhook sends on 5xx" --body "$(cat <<'EOF'\n${fixture('good-pr.md')}\nEOF\n)"`;
    expect(s.yap(['hook', 'claude'], 'agent', claudePayload(good, s.dir)).stdout).toBe('');
  });

  it('speaks Cursor\'s hook format', () => {
    const s = new Sandbox();
    s.change();
    const deny = JSON.parse(s.yap(['hook', 'cursor'], 'agent', JSON.stringify({ command: `git commit -m "${BAD}"`, cwd: s.dir })).stdout);
    expect(deny.permission).toBe('deny');
    expect(deny.agent_message).toContain('phantom-tests');
    const allow = JSON.parse(s.yap(['hook', 'cursor'], 'agent', JSON.stringify({ command: 'ls', cwd: s.dir })).stdout);
    expect(allow).toEqual({ permission: 'allow' });
  });

  it('never breaks the agent on bad input', () => {
    const s = new Sandbox();
    expect(s.yap(['hook', 'claude'], 'agent', 'not json').status).toBe(0);
    expect(s.yap(['hook', 'claude'], 'agent', '').stdout).toBe('');
  });
});

describe('commands', () => {
  it('context tells the agent what changed and how the repo writes', () => {
    const s = new Sandbox();
    for (let i = 0; i < 12; i++) {
      s.change(`src/f${i}.ts`, 2);
      s.commit(`fix(api): handle case ${i}`, 'human');
    }
    s.change('src/webhook.ts');
    const r = s.yap(['context']);
    expect(r.stdout).toContain('Changes (staged): 1 file, +7');
    expect(r.stdout).toContain("Tests: none changed, so don't say tests were added.");
    expect(r.stdout).toContain('conventional commits');
    const json = JSON.parse(s.yap(['context', '--json']).stdout);
    expect(json.style.types).toEqual(['fix']);
  });

  it('context --kind pr maps the branch: areas, tests, generated files, renames, commits, shape and words', () => {
    const s = new Sandbox();
    s.write('.gitattributes', 'dist/*.js linguist-generated=true\n');
    s.write('src/old/name.ts', 'export const a = 1;\n');
    s.git('add', '-A');
    s.git('commit', '-q', '-m', 'Add the files to move');
    s.git('checkout', '-q', '-b', 'retry');
    s.change('src/payments/ledger.ts', 200);
    s.commit('Reject negative ledger amounts', 'human');
    s.change('test/ledger.test.ts', 60);
    s.write('dist/app.js', Array.from({ length: 900 }, (_, i) => `x${i}();`).join('\n'));
    s.git('rm', '-q', 'src/old/name.ts');
    s.write('src/new/name.ts', 'export const a = 1;\n');
    s.git('add', '-A');
    s.commit('Test the ledger and move name.ts', 'human');
    const out = s.yap(['context', '--kind', 'pr', '--base', 'main']).stdout;
    expect(out).toContain('260 changed lines (normal, 30 to 300 lines)');
    expect(out).toMatch(/src\/payments +200 lines, 1 file/);
    expect(out).toContain('Tests: test/ledger.test.ts (60).');
    expect(out).toContain('Generated or lockfiles, not counted: dist/app.js (900).');
    expect(out).toContain('Only moved or renamed: 1 file (src/new/name.ts)');
    expect(out).toContain('Commits on this branch (2), oldest first:\n  Reject negative ledger amounts\n  Test the ledger and move name.ts');
    expect(out).toContain('1. Opening, 1 or 2 sentences: what changed and why');
    expect(out).toContain('Words: up to 189 for a diff this size, a ceiling and not a target.');
    expect(out).toContain('From what you were given, not the diff: the why');
    const json = JSON.parse(s.yap(['context', '--kind', 'pr', '--base', 'main', '--json']).stdout);
    expect(json.diff.size).toBe('normal');
    expect(json.range).toEqual({ floor: 56, budget: 189 });
  });

  it('check, pr, log and --rev agree with the hooks', () => {
    const s = new Sandbox();
    s.git('checkout', '-q', '-b', 'retry');
    s.change();
    s.commit(BAD, 'human');
    s.write('body.md', fixture('good-pr.md'));
    expect(s.yap(['pr', 'body.md', '--title', 'Retry webhook sends on 5xx', '--base', 'main']).status).toBe(0);
    expect(s.yap(['check', '--rev', 'HEAD']).status).toBe(1);
    const log = JSON.parse(s.yap(['log', '-n', '2', '--json']).stdout);
    expect(log[0].rules).toContain('phantom-tests');
    expect(s.yap(['check', '-m', GOOD, '--no-diff']).status).toBe(0);
  });

  it('init --uninstall removes the hooks', () => {
    const s = new Sandbox();
    s.yap(['init', '--agents', 'none']);
    expect(s.yap(['init', '--uninstall']).status).toBe(0);
    s.change();
    expect(s.commit(BAD, 'agent').status).toBe(0);
  });

  it('prints help and version, and rejects unknown commands', () => {
    const s = new Sandbox();
    expect(s.yap(['--help']).stdout).toContain('buzzcut init');
    expect(s.yap(['--version']).stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(s.yap(['nope']).status).toBe(2);
  });
});
