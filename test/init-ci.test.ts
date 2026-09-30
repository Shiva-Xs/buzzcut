import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MARKER, runCi } from '../src/ci.js';
import { BEGIN, init, insertBlock, stripBlock, hookBlock, type InitOptions } from '../src/init.js';
import { mergeClaudeSettings, mergeCursorHooks, CURSOR_MATCHER, MCP_TOOLS } from '../src/targets.js';
import { fixture } from './helpers.js';

const SKILL = fileURLToPath(new URL('../skills/buzzcut/SKILL.md', import.meta.url));

const EMPTY_CONFIG = join(mkdtempSync(join(tmpdir(), 'buzzcut-gitcfg-')), 'config');
writeFileSync(EMPTY_CONFIG, '');
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: EMPTY_CONFIG, GIT_CONFIG_NOSYSTEM: '1' };

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'buzzcut-init-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env: GIT_ENV });
  // Pretend buzzcut is installed locally, as `npm i -D buzzcut` would.
  mkdirSync(join(dir, 'node_modules', '.bin'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', '.bin', 'buzzcut'), '#!/bin/sh\n', { mode: 0o755 });
  return dir;
}

const opts = (cwd: string, o: Partial<InitOptions> = {}): InitOptions => ({
  cwd,
  gitHooks: true,
  uninstall: false,
  dryRun: false,
  env: { PATH: '' },
  agents: 'none',
  ...o,
});

// regression: on a machine where `buzzcut setup` set a global core.hooksPath, `init` in a repo
// followed it and overwrote the machine-wide hooks with the repo-level ones.
describe('init with a global core.hooksPath', () => {
  const withGlobalHooks = (chains: boolean, fn: (dir: string, globalDir: string, before: string) => void) => {
    const globalDir = mkdtempSync(join(tmpdir(), 'buzzcut-global-hooks-'));
    const before = chains ? '#!/bin/sh\nbuzzcut_local="$(git rev-parse --git-common-dir)/hooks/commit-msg"\n' : '#!/bin/sh\necho my own hook\n';
    writeFileSync(join(globalDir, 'commit-msg'), before, { mode: 0o755 });
    const cfg = join(mkdtempSync(join(tmpdir(), 'buzzcut-gitcfg-')), 'config');
    // Forward slashes: a backslash is an escape character in a git config file (Windows paths).
    writeFileSync(cfg, `[core]\n\thooksPath = ${globalDir.replace(/\\/g, '/')}\n`);
    const saved = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = cfg;
    try {
      fn(repo(), globalDir, before);
    } finally {
      if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = saved;
    }
  };

  it("writes the repo's hooks into .git/hooks and leaves buzzcut's global ones alone", () => {
    withGlobalHooks(true, (dir, globalDir, before) => {
      const r = init(opts(dir));
      expect(r.ok).toBe(true);
      expect(readFileSync(join(globalDir, 'commit-msg'), 'utf8')).toBe(before);
      expect(readFileSync(join(dir, '.git', 'hooks', 'commit-msg'), 'utf8')).toContain(BEGIN);
      expect(r.notes.join('\n')).not.toContain("won't run");
    });
  });

  it("never writes into someone else's global hooks folder, and says the repo hooks won't run", () => {
    withGlobalHooks(false, (dir, globalDir, before) => {
      const r = init(opts(dir));
      expect(readFileSync(join(globalDir, 'commit-msg'), 'utf8')).toBe(before);
      expect(r.notes.join('\n')).toContain("won't run");
    });
  });
});

describe('hook script blocks', () => {
  it('inserts after the shebang so an early exit 0 cannot skip it', () => {
    const out = insertBlock('#!/bin/bash\nnpm test\nexit 0\n', hookBlock('commit-msg'));
    expect(out.startsWith('#!/bin/bash\n' + BEGIN)).toBe(true);
    expect(out).toContain('npm test\nexit 0\n');
  });

  it('replaces its own block instead of stacking copies', () => {
    const once = insertBlock(null, hookBlock('commit-msg'));
    const twice = insertBlock(once, hookBlock('commit-msg'));
    expect(twice).toBe(once);
    expect(stripBlock(twice)).toBe('#!/bin/sh\n');
  });

  it('writes valid POSIX sh', () => {
    for (const hook of ['commit-msg', 'pre-push'] as const) {
      const dir = mkdtempSync(join(tmpdir(), 'buzzcut-sh-'));
      const path = join(dir, hook);
      writeFileSync(path, insertBlock(null, hookBlock(hook)));
      expect(() => execFileSync('sh', ['-n', path])).not.toThrow();
    }
  });
});

describe('init', () => {
  it('installs commit-msg and pre-push hooks and is idempotent', () => {
    const dir = repo();
    const first = init(opts(dir));
    expect(first.ok).toBe(true);
    const hook = join(dir, '.git', 'hooks', 'commit-msg');
    expect(readFileSync(hook, 'utf8')).toContain('hook commit-msg "$1"');
    if (process.platform !== 'win32') expect(statSync(hook).mode & 0o111).toBeTruthy();
    expect(existsSync(join(dir, '.git', 'hooks', 'pre-push'))).toBe(true);
    init(opts(dir));
    expect(readFileSync(hook, 'utf8').split(BEGIN).length).toBe(2);
  });

  it('keeps an existing hook and removes only its own block on uninstall', () => {
    const dir = repo();
    const hook = join(dir, '.git', 'hooks', 'commit-msg');
    writeFileSync(hook, '#!/bin/sh\necho existing\n', { mode: 0o755 });
    init(opts(dir));
    expect(readFileSync(hook, 'utf8')).toContain('echo existing');
    init(opts(dir, { uninstall: true }));
    expect(readFileSync(hook, 'utf8')).toBe('#!/bin/sh\necho existing\n');
    expect(existsSync(join(dir, '.git', 'hooks', 'pre-push'))).toBe(false);
  });

  it('writes into .husky/ when husky owns core.hooksPath', () => {
    const dir = repo();
    mkdirSync(join(dir, '.husky', '_'), { recursive: true });
    execFileSync('git', ['config', 'core.hooksPath', '.husky/_'], { cwd: dir, env: GIT_ENV });
    const res = init(opts(dir));
    expect(existsSync(join(dir, '.husky', 'commit-msg'))).toBe(true);
    expect(res.notes.join()).toContain('husky');
  });

  it('respects a custom core.hooksPath', () => {
    const dir = repo();
    execFileSync('git', ['config', 'core.hooksPath', 'tools/hooks'], { cwd: dir, env: GIT_ENV });
    init(opts(dir));
    expect(existsSync(join(dir, 'tools', 'hooks', 'commit-msg'))).toBe(true);
  });

  it('refuses to install without a durable buzzcut, and says how to fix it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'buzzcut-init-'));
    execFileSync('git', ['init', '-q'], { cwd: dir, env: GIT_ENV });
    const res = init(opts(dir));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('npm i -D buzzcut');
  });

  it('adds each agent\'s hook and the skill next to existing settings', () => {
    const dir = repo();
    mkdirSync(join(dir, '.claude'));
    writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(npm test)'] } }));
    mkdirSync(join(dir, '.cursor'));
    mkdirSync(join(dir, '.windsurf'));
    const res = init(opts(dir, { skillSource: SKILL, agents: undefined }));
    expect(res.ok).toBe(true);
    const claude = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'));
    expect(claude.permissions.allow).toEqual(['Bash(npm test)']);
    expect(claude.hooks.PreToolUse[0].hooks[0].command).toContain('hook claude');
    expect(JSON.parse(readFileSync(join(dir, '.cursor', 'hooks.json'), 'utf8')).hooks.beforeShellExecution[0].command).toContain('hook cursor');
    expect(JSON.parse(readFileSync(join(dir, '.windsurf', 'hooks.json'), 'utf8')).hooks.pre_run_command[0].command).toContain('hook windsurf');
    for (const d of ['.claude/skills', '.agents/skills', '.windsurf/skills']) expect(existsSync(join(dir, d, 'buzzcut', 'SKILL.md'))).toBe(true);

    init(opts(dir, { uninstall: true }));
    expect(JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'))).toEqual({ permissions: { allow: ['Bash(npm test)'] } });
    expect(existsSync(join(dir, '.agents', 'skills', 'buzzcut', 'SKILL.md'))).toBe(false);
  });

  it('sets up exactly the agents asked for, and rejects unknown ones', () => {
    const dir = repo();
    init(opts(dir, { agents: ['antigravity', 'copilot'], skillSource: SKILL }));
    const ag = JSON.parse(readFileSync(join(dir, '.agents', 'hooks.json'), 'utf8'));
    expect(ag.buzzcut.PreToolUse[0].matcher).toMatch(/^run_command\|/);
    expect(ag.buzzcut.PreToolUse[0].hooks[0].command).toContain('hook antigravity');
    expect(JSON.parse(readFileSync(join(dir, '.github', 'hooks', 'buzzcut.json'), 'utf8')).hooks.PreToolUse[0].command).toContain('hook copilot');
    expect(existsSync(join(dir, '.claude'))).toBe(false);
    expect(init(opts(dir, { agents: ['vim'] })).error).toContain('unknown agent "vim"');
  });

  it('changes nothing on a dry run', () => {
    const dir = repo();
    const res = init(opts(dir, { dryRun: true }));
    expect(res.done.length).toBeGreaterThan(0);
    expect(existsSync(join(dir, '.git', 'hooks', 'commit-msg'))).toBe(false);
  });
});

describe('settings merges', () => {
  it('keeps other PreToolUse hooks and never duplicates ours', () => {
    const other = { matcher: 'Bash', hooks: [{ type: 'command', command: './lint.sh' }] };
    let s = mergeClaudeSettings({ hooks: { PreToolUse: [other] } }, 'buzzcut hook claude');
    s = mergeClaudeSettings(s, 'buzzcut hook claude');
    const pre = (s.hooks as { PreToolUse: unknown[] }).PreToolUse;
    expect(pre).toHaveLength(2);
    expect(mergeClaudeSettings(s, null)).toEqual({ hooks: { PreToolUse: [other] } });
  });

  it('builds a valid Cursor hooks.json', () => {
    expect(mergeCursorHooks({}, 'buzzcut hook cursor')).toEqual({
      version: 1,
      hooks: {
        beforeShellExecution: [{ command: 'buzzcut hook cursor', matcher: CURSOR_MATCHER }],
        beforeMCPExecution: [{ command: 'buzzcut hook cursor', matcher: MCP_TOOLS }],
      },
    });
  });
});

// ─── GitHub Action ───────────────────────────────────────────────────────────

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

function fakeGitHub(routes: Record<string, unknown>, calls: Call[]): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push({ method, url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const hit = Object.entries(routes).find(([k]) => {
      const [m, path] = k.split(' ');
      return m === method && u.includes(path!);
    })?.[1];
    if (hit === undefined) return new Response('{"message":"Not Found"}', { status: 404 });
    return new Response(JSON.stringify(hit), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

const AGENT = { login: 'copilot-swe-agent[bot]', type: 'Bot' };

function ciEnv(body: string, extra: Record<string, string> = {}, user: { login: string; type: string } = { login: 'dev', type: 'User' }) {
  const dir = mkdtempSync(join(tmpdir(), 'buzzcut-ci-'));
  const event = join(dir, 'event.json');
  writeFileSync(
    event,
    JSON.stringify({
      pull_request: {
        number: 7,
        html_url: 'https://github.com/acme/api/pull/7',
        title: 'Add comprehensive retry mechanism',
        body,
        additions: 7,
        deletions: 2,
        changed_files: 1,
        user,
        base: { sha: 'base', ref: 'main' },
      },
    }),
  );
  const summary = join(dir, 'summary.md');
  const output = join(dir, 'output.txt');
  writeFileSync(summary, '');
  writeFileSync(output, '');
  return {
    dir,
    summary,
    output,
    env: {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: event,
      GITHUB_REPOSITORY: 'acme/api',
      GITHUB_STEP_SUMMARY: summary,
      GITHUB_OUTPUT: output,
      GITHUB_WORKSPACE: join(dir, 'nope'),
      'INPUT_GITHUB-TOKEN': 'tok',
      ...extra,
    } as NodeJS.ProcessEnv,
  };
}

const ROUTES = {
  'GET /pulls/7/files': [{ filename: 'src/webhook.ts', additions: 7, deletions: 2 }],
  'GET /pulls/7/commits': [
    { sha: 'aaaaaaa1', commit: { message: 'Added comprehensive retries.' }, parents: [{ sha: 'p' }] },
    { sha: 'bbbbbbb2', commit: { message: 'Merge branch main into retry' }, parents: [{ sha: 'p' }, { sha: 'q' }] },
  ],
  'GET /commits/aaaaaaa1': { files: [{ filename: 'src/webhook.ts', additions: 7, deletions: 2 }] },
  'GET /issues/7/comments': [],
  'POST /issues/7/comments': { id: 99 },
};

describe('GitHub Action', () => {
  it("fails a coding agent's bloated PR, comments once, and writes the summary and outputs", async () => {
    const c = ciEnv(fixture('bloated-pr.md'), {}, AGENT);
    const calls: Call[] = [];
    const lines: string[] = [];
    const code = await runCi({ env: c.env, fetch: fakeGitHub(ROUTES, calls), cwd: c.dir, log: (l) => lines.push(l) });
    expect(code).toBe(1);
    const post = calls.find((x) => x.method === 'POST');
    expect((post?.body as { body: string }).body).toContain(MARKER);
    expect((post?.body as { body: string }).body).toContain('template sections on a 9-line diff');
    expect(readFileSync(c.summary, 'utf8')).toContain('yap score 100/100 (F)');
    expect(readFileSync(c.output, 'utf8')).toContain('pass=false');
    expect(calls.some((x) => x.url.includes('/commits/bbbbbbb2'))).toBe(false); // merge commit skipped
    expect(lines.join('\n')).toContain('::error::');
  });

  it("warns, comments and reports pass=false for a person's bloated PR, but does not fail the job", async () => {
    const c = ciEnv(fixture('bloated-pr.md'));
    const calls: Call[] = [];
    const lines: string[] = [];
    const code = await runCi({ env: c.env, fetch: fakeGitHub(ROUTES, calls), cwd: c.dir, log: (l) => lines.push(l) });
    expect(code).toBe(0);
    expect(calls.some((x) => x.method === 'POST')).toBe(true);
    expect(readFileSync(c.output, 'utf8')).toContain('pass=false');
    expect(lines.join('\n')).toContain('::warning::buzzcut: the PR description');
    expect(lines.join('\n')).not.toContain('::error::');
  });

  it('fails a person too when the repo blocks always, or the action says fail: always', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'buzzcut-ws-'));
    writeFileSync(join(dir, '.buzzcut.json'), JSON.stringify({ block: 'always' }));
    const a = ciEnv(fixture('bloated-pr.md'), { GITHUB_WORKSPACE: dir });
    expect(await runCi({ env: a.env, fetch: fakeGitHub(ROUTES, []), cwd: a.dir, log: () => {} })).toBe(1);
    const b = ciEnv(fixture('bloated-pr.md'), { INPUT_FAIL: 'always' });
    expect(await runCi({ env: b.env, fetch: fakeGitHub(ROUTES, []), cwd: b.dir, log: () => {} })).toBe(1);
    const never = ciEnv(fixture('bloated-pr.md'), { GITHUB_WORKSPACE: dir, INPUT_FAIL: 'false' });
    expect(await runCi({ env: never.env, fetch: fakeGitHub(ROUTES, []), cwd: never.dir, log: () => {} })).toBe(0);
  });

  it("treats a PR from a person's account as an agent's when the text carries an agent footer", async () => {
    const withFooter = fixture('bloated-pr.md') + '\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n';
    const c = ciEnv(withFooter);
    expect(await runCi({ env: c.env, fetch: fakeGitHub(ROUTES, []), cwd: c.dir, log: () => {} })).toBe(1);
    const routes = { ...ROUTES, 'GET /pulls/7/commits': [{ sha: 'aaaaaaa1', commit: { message: 'Added comprehensive retries.\n\nCo-Authored-By: Claude <noreply@anthropic.com>' }, parents: [{ sha: 'p' }] }] };
    const d = ciEnv(fixture('bloated-pr.md'));
    expect(await runCi({ env: d.env, fetch: fakeGitHub(routes, []), cwd: d.dir, log: () => {} })).toBe(1);
  });

  it('passes a good PR without commenting', async () => {
    const c = ciEnv(fixture('good-pr.md'));
    const calls: Call[] = [];
    const routes = { ...ROUTES, 'GET /pulls/7/commits': [{ sha: 'ccccccc3', commit: { message: 'Retry webhook sends on 5xx' }, parents: [{ sha: 'p' }] }], 'GET /commits/ccccccc3': ROUTES['GET /commits/aaaaaaa1'] };
    const code = await runCi({ env: c.env, fetch: fakeGitHub(routes, calls), cwd: c.dir, log: () => {} });
    expect(code).toBe(0);
    expect(calls.some((x) => x.method === 'POST')).toBe(false);
    expect(readFileSync(c.output, 'utf8')).toContain('pass=true');
  });

  it('updates its existing comment instead of posting another', async () => {
    const c = ciEnv(fixture('good-pr.md'));
    const calls: Call[] = [];
    const routes = { ...ROUTES, 'GET /issues/7/comments': [{ id: 5, body: `${MARKER}\nold` }], 'PATCH /issues/comments/5': {}, 'GET /pulls/7/commits': [] };
    await runCi({ env: c.env, fetch: fakeGitHub(routes, calls), cwd: c.dir, log: () => {} });
    const patch = calls.find((x) => x.method === 'PATCH');
    expect(patch?.url).toContain('/issues/comments/5');
    expect((patch?.body as { body: string }).body).toContain('✓');
  });

  it('respects fail: false and commits: false', async () => {
    const c = ciEnv(fixture('bloated-pr.md'), { INPUT_FAIL: 'false', INPUT_COMMITS: 'false', INPUT_COMMENT: 'false' });
    const calls: Call[] = [];
    const code = await runCi({ env: c.env, fetch: fakeGitHub(ROUTES, calls), cwd: c.dir, log: () => {} });
    expect(code).toBe(0);
    expect(calls.some((x) => x.url.includes('/commits'))).toBe(false);
    expect(calls.some((x) => x.method !== 'GET')).toBe(false);
  });

  it('warns instead of crashing when it may not comment (fork PRs)', async () => {
    const c = ciEnv(fixture('bloated-pr.md'), { INPUT_COMMITS: 'false' }, AGENT);
    const lines: string[] = [];
    const routes = { ...ROUTES };
    delete (routes as Record<string, unknown>)['POST /issues/7/comments'];
    const code = await runCi({ env: c.env, fetch: fakeGitHub(routes, []), cwd: c.dir, log: (l) => lines.push(l) });
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain("::warning::buzzcut couldn't comment");
  });

  it('checks the commits in a push, with no comment to post', async () => {
    const c = ciEnv('x', { GITHUB_EVENT_NAME: 'push' });
    const push = (commits: { id: string; message: string }[]) => writeFileSync(c.env.GITHUB_EVENT_PATH!, JSON.stringify({ commits }));
    const routes = {
      'GET /commits/aaaaaaa1': { files: [{ filename: 'src/webhook.ts', additions: 7, deletions: 2 }], parents: [{ sha: 'p' }] },
      'GET /commits/ccccccc3': { files: [{ filename: 'src/webhook.ts', additions: 7, deletions: 2 }], parents: [{ sha: 'p' }] },
    };
    const calls: Call[] = [];
    push([{ id: 'ccccccc3', message: 'Retry webhook sends on 5xx\n\nStripe returns 502 during deploys and we dropped the event.' }]);
    expect(await runCi({ env: c.env, fetch: fakeGitHub(routes, calls), cwd: c.dir, log: () => {} })).toBe(0);
    expect(readFileSync(c.summary, 'utf8')).toContain('1 commit message checked ✓');
    push([{ id: 'aaaaaaa1', message: 'fix bug' }]);
    const lines: string[] = [];
    expect(await runCi({ env: c.env, fetch: fakeGitHub(routes, calls), cwd: c.dir, log: (l) => lines.push(l) })).toBe(0);
    expect(lines.join('\n')).toContain('::warning::');
    expect(readFileSync(c.summary, 'utf8')).toContain('1 of 1 commit message need work');
    push([{ id: 'aaaaaaa1', message: 'fix bug\n\nCo-Authored-By: Claude <noreply@anthropic.com>' }]);
    expect(await runCi({ env: c.env, fetch: fakeGitHub(routes, calls), cwd: c.dir, log: () => {} })).toBe(1);
    expect(calls.some((x) => x.method !== 'GET')).toBe(false);
  });

  it('shows a lookup note on a PR that passes, and comments on it', async () => {
    const body = 'Retries `send()` on a 5xx, and adds an `X-Retry-Budget` header so receivers can see the attempts left.\n\nTested: not run.';
    const c = ciEnv(body, { GITHUB_WORKSPACE: mkdtempSync(join(tmpdir(), 'buzzcut-ws-')) });
    const routes = { ...ROUTES, 'GET /pulls/7/files': [{ filename: 'src/webhook.ts', additions: 3, deletions: 1, patch: '@@ -1 +1,3 @@\n-a\n+export function send(url, tries = 3) {}\n+const x = 1;' }], 'GET /pulls/7/commits': [] };
    const calls: Call[] = [];
    const code = await runCi({ env: c.env, fetch: fakeGitHub(routes, calls), cwd: c.dir, log: () => {} });
    // no checkout in the test workspace, so no repo search: the note needs one; with none it stays silent
    expect(code).toBe(0);
    expect(calls.some((x) => x.method === 'POST')).toBe(false);
  });

  describe('the optional AI check', () => {
    const PATCH = '@@ -1 +1,2 @@\n-  return res.ok;\n+  if (res.status < 500) return res.ok;\n+  await sleep(200 * 2 ** i);';
    const aiRoutes = (reply: unknown) => ({
      ...ROUTES,
      'GET /pulls/7/files': [{ filename: 'src/webhook.ts', additions: 2, deletions: 1, patch: PATCH }],
      'GET /pulls/7/commits': [],
      'POST /v1/messages': { content: [{ type: 'text', text: JSON.stringify(reply) }] },
    });
    const GOOD = 'Webhook sends now retry when the server answers 5xx, waiting 200ms and doubling it each attempt.\n\nTested: not run.';
    const supported = [{ n: 1, verdict: 'supported', quote: 'if (res.status < 500) return res.ok;' }, { n: 2, verdict: 'unsupported', quote: '' }];

    it('is off unless asked for: nothing is sent to a provider', async () => {
      const c = ciEnv(GOOD);
      const calls: Call[] = [];
      await runCi({ env: c.env, fetch: fakeGitHub(aiRoutes(supported), calls), cwd: c.dir, log: () => {} });
      expect(calls.some((x) => x.url.includes('anthropic.com'))).toBe(false);
    });

    it('adds a collapsed advice section to the summary, and never changes the exit code', async () => {
      const c = ciEnv(GOOD, { INPUT_AI: 'true', 'INPUT_AI-API-KEY': 'sk-test' });
      const calls: Call[] = [];
      const code = await runCi({ env: c.env, fetch: fakeGitHub(aiRoutes(supported), calls), cwd: c.dir, log: () => {} });
      expect(code).toBe(0);
      const summary = readFileSync(c.summary, 'utf8');
      expect(summary).toContain('AI check, advice only');
      expect(summary).toContain('| ✓ |');
      expect(readFileSync(c.output, 'utf8')).toContain('pass=true');
      expect(calls.some((x) => x.url.includes('api.anthropic.com/v1/messages'))).toBe(true);
    });

    it('posts a comment for a sentence the diff does not support even when the PR passes', async () => {
      const c = ciEnv(GOOD, { INPUT_AI: 'true', 'INPUT_AI-API-KEY': 'sk-test' });
      const calls: Call[] = [];
      await runCi({ env: c.env, fetch: fakeGitHub(aiRoutes(supported), calls), cwd: c.dir, log: () => {} });
      const post = calls.find((x) => x.method === 'POST' && x.url.includes('/issues/7/comments'));
      expect((post?.body as { body: string }).body).toContain('1 not supported by the diff');
    });

    it('is skipped with a notice when there is no key, as on a fork PR, and with a warning for an unknown provider', async () => {
      const lines: string[] = [];
      const c = ciEnv(GOOD, { INPUT_AI: 'true' });
      const calls: Call[] = [];
      expect(await runCi({ env: c.env, fetch: fakeGitHub(aiRoutes(supported), calls), cwd: c.dir, log: (l) => lines.push(l) })).toBe(0);
      expect(lines.join('\n')).toContain('there is no ai-api-key');
      expect(calls.some((x) => x.url.includes('anthropic.com'))).toBe(false);
      const d = ciEnv(GOOD, { INPUT_AI: 'true', 'INPUT_AI-API-KEY': 'k', 'INPUT_AI-PROVIDER': 'openai' });
      const more: string[] = [];
      await runCi({ env: d.env, fetch: fakeGitHub(aiRoutes(supported), []), cwd: d.dir, log: (l) => more.push(l) });
      expect(more.join('\n')).toContain('ai-provider must be');
    });

    it('reports a provider failure as a warning and carries on', async () => {
      const c = ciEnv(GOOD, { INPUT_AI: 'true', 'INPUT_AI-API-KEY': 'bad' });
      const routes = { ...aiRoutes(supported) } as Record<string, unknown>;
      delete routes['POST /v1/messages']; // the fake answers 404
      const lines: string[] = [];
      const code = await runCi({ env: c.env, fetch: fakeGitHub(routes, []), cwd: c.dir, log: (l) => lines.push(l) });
      expect(code).toBe(0);
      expect(lines.join('\n')).toContain('::warning::buzzcut: the AI check failed and was skipped');
      expect(readFileSync(c.summary, 'utf8')).not.toContain('AI check');
    });
  });

  it('skips other events and bot PRs', async () => {
    const c = ciEnv('x', { GITHUB_EVENT_NAME: 'release' });
    expect(await runCi({ env: c.env, fetch: fakeGitHub({}, []), cwd: c.dir, log: () => {} })).toBe(0);
    const b = ciEnv('x');
    const ev = JSON.parse(readFileSync(b.env.GITHUB_EVENT_PATH!, 'utf8'));
    ev.pull_request.user = { login: 'dependabot[bot]', type: 'Bot' };
    writeFileSync(b.env.GITHUB_EVENT_PATH!, JSON.stringify(ev));
    const calls: Call[] = [];
    expect(await runCi({ env: b.env, fetch: fakeGitHub(ROUTES, calls), cwd: b.dir, log: () => {} })).toBe(0);
    expect(calls).toEqual([]);
  });
});

describe('repo hook commands', () => {
  it("find buzzcut from any folder inside the repo (Antigravity runs hooks from .agents/)", () => {
    const dir = repo();
    writeFileSync(join(dir, 'node_modules', '.bin', 'buzzcut'), '#!/bin/sh\necho "ran $*"\n', { mode: 0o755 });
    init(opts(dir, { agents: ['antigravity', 'windsurf', 'cursor'], skillSource: SKILL }));
    const commands = [
      JSON.parse(readFileSync(join(dir, '.agents', 'hooks.json'), 'utf8')).buzzcut.PreToolUse[0].hooks[0].command,
      JSON.parse(readFileSync(join(dir, '.windsurf', 'hooks.json'), 'utf8')).hooks.pre_run_command[0].command,
      JSON.parse(readFileSync(join(dir, '.cursor', 'hooks.json'), 'utf8')).hooks.beforeShellExecution[0].command,
    ];
    for (const cmd of commands) {
      const out = execFileSync('sh', ['-c', cmd], { cwd: join(dir, '.agents'), env: GIT_ENV, encoding: 'utf8', input: '{}' });
      expect(out).toMatch(/^ran hook (antigravity|windsurf|cursor)/);
    }
  });
});
