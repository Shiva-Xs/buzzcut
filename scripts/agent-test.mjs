// Real Claude Code sessions (nothing gets installed on your machine), one per layer:
//   writer:      skill + hook loaded as a plugin; a plain "commit it". The first message should pass.
//   commit-guard: hook only (repo-level, no skill); asked for a lazy message. The hook should
//                deny it and the agent should rewrite it into one that passes.
//   pr-guard:    hook only; asked for a bloated PR. The hook should deny `gh pr create`.
// Uses your Claude login (`claude /login`), about $0.10 per scenario.
//   npm run build && node scripts/agent-test.mjs [--model sonnet] [--only writer]
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const bin = join(root, 'bundle', 'buzzcut.mjs');
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const model = arg('--model', 'sonnet');
const only = arg('--only', null);
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_ENTRYPOINT|CLAUDE_CODE_SESSION_ID)$/.test(k)));

const WHY = 'The staged change makes webhook deliveries retry on 5xx. Customer endpoints return 502s and 503s while their servers restart, and we were dropping those events.';

function makeRepo({ hookOnly }) {
  const dir = mkdtempSync(join(tmpdir(), 'buzzcut-agent-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, env, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'dev@example.com');
  git('config', 'user.name', 'Dev');
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n.claude\nsession.jsonl\n');
  writeFileSync(join(dir, 'webhook.js'), 'export async function send(url, body) {\n  return fetch(url, { method: "POST", body });\n}\n');
  git('add', '.');
  git('commit', '-q', '-m', 'Add webhook sender');
  if (hookOnly) {
    // What `npm i -D buzzcut && npx buzzcut init --agents claude` leaves in a repo.
    mkdirSync(join(dir, 'node_modules', '.bin'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', '.bin', 'buzzcut'), `#!/bin/sh\nexec "${process.execPath}" "${bin}" "$@"\n`, { mode: 0o755 });
    execFileSync(process.execPath, [bin, 'init', '--agents', 'claude', '--no-git-hooks'], { cwd: dir, env, encoding: 'utf8' });
    execFileSync('rm', ['-rf', join(dir, '.claude', 'skills')]);
  }
  git('checkout', '-q', '-b', 'retry-5xx');
  writeFileSync(
    join(dir, 'webhook.js'),
    `export async function send(url, body, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { method: "POST", body });
    if (res.status < 500) return res;
    await new Promise((r) => setTimeout(r, 2 ** i * 200));
  }
  throw new Error(\`webhook failed after \${tries} tries\`);
}
`,
  );
  git('add', '-A');
  return { dir, git };
}

function claude(dir, prompt, { plugin, tools, mcp }) {
  const args = ['-p', prompt, '--allowedTools', ...tools, '--model', model, '--output-format', 'stream-json', '--verbose'];
  if (plugin) args.push('--plugin-dir', root);
  if (mcp) args.push('--mcp-config', JSON.stringify(mcp), '--strict-mcp-config');
  const r = spawnSync('claude', args, { cwd: dir, env, encoding: 'utf8', input: '', maxBuffer: 64 * 1024 * 1024 });
  // Claude Code's own transcript starts with the user's message; the stream output doesn't, so add it for the replays below.
  writeFileSync(join(dir, 'session.jsonl'), `${JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } })}\n${r.stdout}`);
  const events = r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const results = events
    .filter((e) => e.type === 'user')
    .flatMap((e) => e.message?.content ?? [])
    .filter((c) => c.type === 'tool_result')
    .map((c) => (typeof c.content === 'string' ? c.content : JSON.stringify(c.content)));
  const calls = events
    .filter((e) => e.type === 'assistant')
    .flatMap((e) => e.message?.content ?? [])
    .filter((c) => c.type === 'tool_use')
    .map((c) => c.input?.command ?? c.input?.skill ?? (c.name?.startsWith('mcp__') ? `${c.name} ${JSON.stringify(c.input)}` : ''));
  return { result: events.find((e) => e.type === 'result'), results, calls };
}

const verdict = (dir, rev = 'HEAD') => spawnSync(process.execPath, [bin, 'check', '--rev', rev], { cwd: dir, env: { ...env, NO_COLOR: '1' }, encoding: 'utf8' });

let failures = 0;
const check = (name, ok) => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failures++;
};
const show = (label, text) => console.log(`\n  ${label}:\n${text.trim().replace(/^/gm, '      ')}\n`);

function prScenario(prompt, { mustDeny }) {
  const { dir } = makeRepo({ hookOnly: true });
  execFileSync('git', ['commit', '-q', '-m', 'Retry webhook sends on 5xx', '-m', 'Customer endpoints 502 while they restart, and we dropped those events.'], { cwd: dir, env });
  // A remote on a reserved, unreachable host: the agent goes ahead with `gh pr create`, the
  // hook runs first, and nothing can reach a real GitHub repo.
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.invalid/acme/demo.git'], { cwd: dir, env });
  const s = claude(dir, prompt, { plugin: false, tools: ['Bash(git *)', 'Bash(gh *)', 'Read'] });
  if (s.result?.is_error) return check(`Claude Code ran (${s.result.result})`, false);
  const denials = s.results.filter((t) => t.includes("buzzcut: this PR description doesn't pass"));
  const prCalls = s.calls.filter((c) => /\bgh\s+pr\s+create\b/.test(c));
  check(`the agent ran gh pr create (${prCalls.length}×)`, prCalls.length > 0);
  if (mustDeny) check(`the hook denied the first description (${denials.length}×)`, denials.length > 0);
  else console.log(`  · hook denials: ${denials.length}`);
  const last = prCalls[prCalls.length - 1] ?? '';
  const lastCheck = spawnSync(process.execPath, [bin, 'hook', 'claude'], {
    cwd: dir,
    env,
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: last }, cwd: dir, transcript_path: join(dir, 'session.jsonl') }),
    encoding: 'utf8',
  });
  // A description that passes may still come back with notes for the agent (advice, not a denial).
  check('its last gh pr create passes', !/"permissionDecision":\s*"deny"/.test(lastCheck.stdout));
  if (lastCheck.stdout.includes('additionalContext')) console.log('  · it passed with notes for the agent');
  if (denials[0]) show('what the agent was told', denials[0].slice(0, 900));
  show('last gh pr create', last.slice(0, 1400));
  return s.result;
}

const scenarios = {
  writer() {
    const { dir, git } = makeRepo({ hookOnly: false });
    const s = claude(dir, `${WHY} Commit it.`, { plugin: true, tools: ['Bash(git *)', 'Bash(npx *)', 'Read'] });
    if (s.result?.is_error) return check(`Claude Code ran (${s.result.result})`, false);
    const n = git('rev-list', '--count', 'HEAD').trim();
    const denied = s.results.filter((t) => t.includes("buzzcut: this commit message doesn't pass")).length;
    console.log(`  · skill used explicitly: ${s.calls.includes('buzzcut') || s.calls.some((c) => /buzzcut (context|check)/.test(c)) ? 'yes' : 'no (loaded by description only)'}`);
    check('it committed', n === '2');
    check(`the first message passed (hook denials: ${denied})`, denied === 0);
    check('the final message passes buzzcut', verdict(dir).status === 0);
    show('commit message', git('log', '-1', '--format=%B'));
    return s.result;
  },
  'commit-guard'() {
    const { dir, git } = makeRepo({ hookOnly: true });
    const s = claude(dir, `${WHY} Commit it with exactly the message "Update webhook.js". If a hook rejects it, write a better message yourself and commit.`, {
      plugin: false,
      tools: ['Bash(git *)', 'Read'],
    });
    if (s.result?.is_error) return check(`Claude Code ran (${s.result.result})`, false);
    const denials = s.results.filter((t) => t.includes("buzzcut: this commit message doesn't pass"));
    check(`the hook denied the lazy message (${denials.length}×)`, denials.length > 0);
    check('the agent rewrote it and committed', git('rev-list', '--count', 'HEAD').trim() === '2');
    check('the final message passes buzzcut', verdict(dir).status === 0);
    if (denials[0]) show('what the agent was told', denials[0].slice(0, 700));
    show('commit message', git('log', '-1', '--format=%B'));
    return s.result;
  },
  'pr-default'() {
    // A plain request: whatever the agent writes by default should end up passing.
    return prScenario(
      `${WHY} It's committed on this branch. Open a PR with gh pr create against main. If gh can't reach GitHub, just tell me the title and body you used.`,
      { mustDeny: false },
    );
  },
  'pr-guard'() {
    // The request that once produced invented unit tests and "manual verification".
    return prScenario(
      `${WHY} It's committed on this branch. Open a PR with gh pr create against main, with a detailed description: Summary, Changes and Testing sections, and mention the unit tests. If a hook rejects it, fix the description yourself and try again. If gh can't reach GitHub, just tell me the title and body you used.`,
      { mustDeny: true },
    );
  },
};

scenarios['pr-mcp'] = function () {
  // Same bloated-PR request, but the agent opens the PR through a GitHub MCP connector
  // (a local stand-in that records calls) instead of gh.
  const { dir } = makeRepo({ hookOnly: true });
  execFileSync('git', ['commit', '-q', '-m', 'Retry webhook sends on 5xx', '-m', 'Customer endpoints 502 while they restart, and we dropped those events.'], { cwd: dir, env });
  const calls = join(dir, 'github-calls.jsonl');
  const mcp = { mcpServers: { github: { command: process.execPath, args: [join(root, 'scripts', 'fake-github-mcp.mjs')], env: { FAKE_GITHUB_LOG: calls } } } };
  const s = claude(
    dir,
    `${WHY} It's committed on branch retry-5xx. Open a PR against main in acme/api using the GitHub tool (not gh), with a detailed description: Summary, Changes and Testing sections, and mention the unit tests. If a hook rejects it, fix the description yourself and try again.`,
    { plugin: false, tools: ['Bash(git *)', 'Read', 'mcp__github__create_pull_request'], mcp },
  );
  if (s.result?.is_error) return check(`Claude Code ran (${s.result.result})`, false);
  const denials = s.results.filter((t) => t.includes("buzzcut: this PR description doesn't pass"));
  let created = [];
  try {
    created = readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {}
  check(`the hook denied the first connector call (${denials.length}×)`, denials.length > 0);
  check(`a PR was created through the connector after the fix (${created.length})`, created.length === 1);
  const body = created[0]?.arguments?.body ?? '';
  const lastCheck = spawnSync(process.execPath, [bin, 'hook', 'claude'], {
    cwd: dir,
    env,
    input: JSON.stringify({ tool_name: 'mcp__github__create_pull_request', tool_input: created[0]?.arguments ?? {}, cwd: dir, transcript_path: join(dir, 'session.jsonl') }),
    encoding: 'utf8',
  });
  check('the PR that went through passes', created.length === 1 && !/"permissionDecision":\s*"deny"/.test(lastCheck.stdout));
  if (denials[0]) show('what the agent was told', denials[0].slice(0, 700));
  show('PR body that was created', body.slice(0, 1200));
  return s.result;
};

let cost = 0;
for (const [name, run] of Object.entries(scenarios)) {
  if (only && only !== name) continue;
  console.log(`\n${name} (Claude Code, ${model})`);
  const result = run();
  cost += result?.total_cost_usd ?? 0;
}
console.log(`\n${failures ? `${failures} check${failures > 1 ? 's' : ''} failed` : 'All agent checks passed.'} Cost: $${cost.toFixed(2)}`);
process.exit(failures ? 1 : 0);
