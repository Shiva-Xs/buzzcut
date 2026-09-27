// Installs the packed tarball the way users will, then exercises it:
//   1. `npm i -D` in a JS project, `npx buzzcut init`, real commits as an agent and a person
//   2. `npm i -g` into a throwaway prefix, used from a non-JS repo
//   3. `import('buzzcut')` as a library, with its type declarations present
// Run: npm run build && node scripts/smoke-pack.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const tmp = (p) => mkdtempSync(join(tmpdir(), `buzzcut-${p}-`));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const home = tmp('home');
writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Smoke\n\temail = smoke@example.com\n');
// Also drop npm's publish-only settings: under `npm publish --dry-run`, prepublishOnly runs this with
// npm_config_dry_run=true, which would make every `npm install` below a dry run that installs nothing.
const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_.*|CURSOR_AGENT|GEMINI_CLI|CODEX_.*|AI_AGENT|AGENT|BUZZCUT_AGENT|GIT_.*|npm_command|npm_config_(?:dry_run|tag|access|otp|provenance))$/i.test(k)));
const env = { ...clean, GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', NO_COLOR: '1', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' };

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok || !detail ? '' : `\n    ${detail.trim().split('\n').join('\n    ')}`}`);
  if (!ok) failures++;
}
function run(cmd, args, cwd, extra = {}) {
  const r = spawnSync(cmd, args, { cwd, env: { ...env, ...extra }, encoding: 'utf8', shell: process.platform === 'win32' });
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}
function commitFlow(label, dir, yap, extraEnv = {}) {
  writeFileSync(join(dir, 'webhook.js'), 'export const retries = 3;\nexport const backoff = 200;\n');
  run('git', ['add', '-A'], dir);
  const bad = run('git', ['commit', '-m', 'Added comprehensive unit tests for the robust retry logic'], dir, { ...extraEnv, CLAUDECODE: '1' });
  check(`${label}: agent's bad commit is blocked`, bad.status === 1 && bad.out.includes('Commit blocked'), bad.out);
  const human = run('git', ['commit', '-m', 'Added comprehensive unit tests for the robust retry logic'], dir, { ...extraEnv, BUZZCUT_AGENT: '0' });
  check(`${label}: person's bad commit only warns`, human.status === 0 && human.out.includes('only warns'), human.out);
  run('git', ['reset', '-q', '--soft', 'HEAD~1'], dir);
  const good = run('git', ['commit', '-m', 'Retry webhook sends on 5xx', '-m', 'Customer endpoints return 502 while they restart, and we dropped the event.'], dir, { ...extraEnv, CLAUDECODE: '1' });
  check(`${label}: agent's good commit goes through`, good.status === 0, good.out);
  const log = run(yap[0], [...yap.slice(1), 'log', '-n', '3'], dir, extraEnv);
  check(`${label}: buzzcut log runs`, log.status === 0 && log.out.includes('buzzcut log'), log.out);
}

// Pack
const packDir = tmp('pack');
const packed = JSON.parse(execFileSync(npm, ['pack', '--json', '--pack-destination', packDir], { cwd: root, env, encoding: 'utf8', shell: process.platform === 'win32' }));
const tarball = join(packDir, packed[0].filename);
const files = packed[0].files.map((f) => f.path);
check(`packed ${packed[0].filename} (${(packed[0].size / 1024).toFixed(1)} kB, ${files.length} files)`, existsSync(tarball));
for (const f of ['dist/cli.js', 'dist/index.js', 'dist/index.d.ts', 'bundle/buzzcut.mjs', 'skills/buzzcut/SKILL.md', 'schema.json', 'README.md', 'LICENSE']) check(`tarball has ${f}`, files.includes(f));
for (const f of files) if (/^(src|test|bench|scripts)\//.test(f) || f === 'bundle/action.mjs') check(`tarball leaves out ${f}`, false);
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
check('package has no runtime dependencies', !pkg.dependencies || !Object.keys(pkg.dependencies).length);

// 1. Local dev dependency in a JS project
const proj = tmp('proj');
run('git', ['init', '-q', '-b', 'main'], proj);
writeFileSync(join(proj, 'package.json'), JSON.stringify({ name: 'smoke-proj', version: '1.0.0', private: true, type: 'module' }));
writeFileSync(join(proj, '.gitignore'), 'node_modules\n');
const inst = run(npm, ['install', '--save-dev', '--no-package-lock', tarball], proj);
check('npm i -D <tarball> works offline (no dependencies to fetch)', inst.status === 0, inst.out);
const ver = run(npx, ['--no-install', 'buzzcut', '--version'], proj);
check(`npx buzzcut --version prints ${pkg.version}`, ver.out.trim() === pkg.version, ver.out);
run('git', ['add', '-A'], proj);
run('git', ['commit', '-q', '-m', 'Start the project'], proj);
const init = run(npx, ['--no-install', 'buzzcut', 'init', '--agents', 'none'], proj);
check('npx buzzcut init installs the hooks', init.status === 0 && init.out.includes('commit-msg'), init.out);
commitFlow('local install', proj, [npx, '--no-install', 'buzzcut']);

// 3. Library import + types
const lib = run(process.execPath, ['-e', "import('buzzcut').then(m => { const r = m.analyze(m.prMessage('Update webhook.ts', 'This PR introduces a robust retry mechanism for webhook delivery.'), m.buildDiff([{ path: 'src/webhook.ts', additions: 7, deletions: 2 }])); console.log(r.score, m.passes(r, 35), r.findings.map(f => f.rule).join(',')); })"], proj);
check('library import works (README example scores 21 and fails)', lib.out.trim() === '21 false subject-vague,ai-opener,ai-vocab', lib.out);
check('type declarations ship', existsSync(join(proj, 'node_modules', 'buzzcut', 'dist', 'index.d.ts')));

// 2. Global install used from a non-JS repo
const prefix = tmp('global');
const g = run(npm, ['install', '-g', '--prefix', prefix, tarball], home);
check('npm i -g <tarball> works', g.status === 0, g.out);
const binDir = process.platform === 'win32' ? prefix : join(prefix, 'bin');
const gEnv = { PATH: `${binDir}${delimiter}${env.PATH}` };
const goRepo = tmp('gorepo');
run('git', ['init', '-q', '-b', 'main'], goRepo);
writeFileSync(join(goRepo, 'main.go'), 'package main\n');
run('git', ['add', '-A'], goRepo);
run('git', ['commit', '-q', '-m', 'Start the service'], goRepo);
const gInit = run('buzzcut', ['init', '--agents', 'none'], goRepo, gEnv);
check('global buzzcut init works in a non-JS repo', gInit.status === 0 && gInit.out.includes('global'), gInit.out);
commitFlow('global install', goRepo, ['buzzcut'], gEnv);

// 4. Machine-wide setup from the global install, against a throwaway HOME
const machine = tmp('machine');
for (const d of ['.claude', '.cursor', '.codeium/windsurf']) mkdirSync(join(machine, d), { recursive: true });
writeFileSync(join(machine, '.gitconfig'), '[user]\n\tname = Smoke\n\temail = smoke@example.com\n');
// GitHub's Linux runners set XDG_CONFIG_HOME; point it at the throwaway HOME too.
const mEnv = { ...gEnv, HOME: machine, GIT_CONFIG_GLOBAL: join(machine, '.gitconfig'), XDG_CONFIG_HOME: join(machine, '.config') };
const setupRun = run('buzzcut', ['setup'], machine, mEnv);
check('buzzcut setup works from a global install', setupRun.status === 0 && setupRun.out.includes('every repo'), setupRun.out);
check('setup copied its own buzzcut', existsSync(join(machine, '.config', 'buzzcut', 'buzzcut.mjs')));
const plain = tmp('plain');
run('git', ['init', '-q', '-b', 'main'], plain, mEnv);
writeFileSync(join(plain, 'a.js'), 'export const a = 1;\n');
run('git', ['add', '-A'], plain, mEnv);
const blocked = run('git', ['commit', '-m', 'Update a.js'], plain, { ...mEnv, CLAUDECODE: '1' });
check('a repo that never ran init is covered after setup', blocked.status === 1 && blocked.out.includes('Commit blocked'), blocked.out);
const doc = run('buzzcut', ['doctor'], plain, mEnv);
check('doctor reports the setup', doc.out.includes('covered by the global hooks') && doc.out.includes('Claude Code: skill ✓, hook ✓'), doc.out);
const undo = run('buzzcut', ['setup', '--uninstall'], machine, mEnv);
check('setup --uninstall cleans up', undo.status === 0 && !existsSync(join(machine, '.config', 'buzzcut')), undo.out);

console.log(failures ? `\n${failures} check${failures > 1 ? 's' : ''} failed` : '\nAll packaging checks passed.');
process.exit(failures ? 1 : 0);
