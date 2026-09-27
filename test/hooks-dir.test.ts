import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkCommand } from '../src/hooks.js';

// regression: an agent that starts outside the repo and runs `cd repo && git commit …` was never
// checked by the agent hook, and one starting in another repo was judged by that repo's history.
describe('the agent hook checks the repo a command runs in', () => {
  const repo = mkdtempSync(join(tmpdir(), 'buzzcut-dir-'));
  const git = (...a: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'a.js'), 'x\n');
  git('add', '.');
  git('commit', '-q', '--no-verify', '-m', 'Add a.js');
  writeFileSync(join(repo, 'a.js'), 'x\ny\n');
  git('add', '.');
  const outside = mkdtempSync(join(tmpdir(), 'buzzcut-outside-'));
  // Forward slashes, quoted: what an agent's shell (Git Bash on Windows) passes through intact.
  const at = JSON.stringify(repo.replace(/\\/g, '/'));

  it.each([
    ['cd <repo> &&', `cd ${at} && git commit -m "fix bug"`],
    ['git -C <repo>', `git -C ${at} commit -m "fix bug"`],
  ])('%s from outside any repo', (_, command) => {
    const { problems } = checkCommand(command, outside);
    expect(problems.map((p) => p.report.findings.map((f) => f.rule)).flat()).toContain('subject-vague');
  });

  it('lets a good message through from outside the repo', () => {
    expect(checkCommand(`cd ${at} && git commit -m "Fall back to y when x is empty" -m "The export crashed on an empty x (#12)."`, outside).problems).toEqual([]);
  });
});
