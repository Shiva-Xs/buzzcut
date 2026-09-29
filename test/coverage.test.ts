// The coverage advice: a description that never mentions where most of the change is.
import { describe, expect, it } from 'vitest';
import { analyze, prMessage } from '../src/analyze.js';
import { buildDiff } from '../src/diff.js';
import { finding } from './helpers.js';

const files = (...specs: string[]) =>
  buildDiff(
    specs.map((s) => {
      const [path, add = '0', del = '0'] = s.split(':');
      return { path: path!, additions: Number(add), deletions: Number(del) };
    }),
  );
const check = (title: string, body: string, d: ReturnType<typeof files>) => finding(analyze(prMessage(title, body), d), 'unmentioned-area');

// "Add AGENTS.md" on a diff that is mostly a new I2C module.
const lopsided = files('AGENTS.md:30', 'src/drivers/i2c/bus.c:210', 'src/drivers/i2c/bus.h:40', 'src/drivers/i2c/probe.c:60');

describe('unmentioned-area', () => {
  it('says so when the biggest area is never named', () => {
    const f = check('Add AGENTS.md', 'Adds AGENTS.md with the build steps and the review rules.', lopsided);
    expect(f?.severity).toBe('warn');
    expect(f?.message).toContain('src/drivers');
    expect(f?.message).toContain('91%');
  });

  it('is satisfied by the folder, a file name, or a name from that area, however loosely', () => {
    for (const body of [
      'Adds AGENTS.md, and the new i2c bus driver it describes.',
      'Adds AGENTS.md. The probe code is new too.',
      'Adds AGENTS.md; the drivers are new.',
      'Adds AGENTS.md and a `bus.h` header.',
      'Adds AGENTS.md and the buses it lists.', // "buses" ~ "bus"
    ]) {
      expect(check('Add AGENTS.md', body, lopsided), body).toBeUndefined();
    }
    const d = buildDiff([
      { path: 'AGENTS.md', additions: 30, deletions: 0 },
      { path: 'src/drivers/i2c/bus.c', additions: 300, deletions: 0, added: 'int i2c_probe_bus(void) { return 0; }', removed: '' },
    ]);
    expect(check('Add AGENTS.md', 'Adds AGENTS.md; `i2c_probe_bus()` is the entry point.', d)).toBeUndefined();
  });

  it('stays quiet for a small change, one area, a lopsided share under 40%, or only generic folder names', () => {
    expect(check('Fix typo', 'Fixes a typo.', files('src/a/x.ts:20', 'docs/y.md:10'))).toBeUndefined();
    expect(check('Big fix', 'Fixes the bug.', files('src/payments/a.ts:200', 'src/payments/b.ts:100'))).toBeUndefined();
    expect(check('Three parts', 'Does things.', files('src/a/one.ts:100', 'src/b/two.ts:100', 'src/c/three.ts:100'))).toBeUndefined();
    expect(check('Move', 'Moves it.', files('src/core/index.ts:120', 'lib/main.ts:30'))).toBeUndefined();
  });

  it('leaves tests, lockfiles and generated files out of the count', () => {
    const d = files('src/ledger/post.ts:40', 'src/queue/run.ts:30', 'tests/ledger/post.test.ts:900', 'package-lock.json:2000');
    expect(check('Post to the ledger', 'Posts entries to the ledger.', d)).toBeUndefined();
  });

  it('never blocks, and can be switched off', () => {
    const r = analyze(prMessage('Add AGENTS.md', 'Adds AGENTS.md.'), lopsided);
    expect(r.findings.find((f) => f.rule === 'unmentioned-area')?.severity).toBe('warn');
    expect(analyze(prMessage('Add AGENTS.md', 'Adds AGENTS.md.'), lopsided, { rules: { 'unmentioned-area': 'off' } }).findings.map((f) => f.rule)).not.toContain('unmentioned-area');
  });

  it('is for PRs, and quiet when the file list was cut short', () => {
    const cut = buildDiff([{ path: 'AGENTS.md', additions: 30, deletions: 0 }, { path: 'src/drivers/i2c/bus.c', additions: 300, deletions: 0 }], undefined, true);
    expect(check('Add AGENTS.md', 'Adds AGENTS.md.', cut)).toBeUndefined();
  });
});
