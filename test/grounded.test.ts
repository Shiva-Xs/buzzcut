import { describe, expect, it } from 'vitest';
import { passes } from '../src/analyze.js';
import { commit, diff, finding, fixture, pr, rules } from './helpers.js';

const small = diff('src/webhook.ts:7:2');

describe('the two example PRs', () => {
  it('fails the bloated one on the diff-grounded rules', () => {
    const r = pr(fixture('bloated-pr.md'), small, 'Add comprehensive retry mechanism');
    expect(r.grade).toBe('F');
    expect(rules(r)).toEqual(
      expect.arrayContaining(['length', 'template-on-tiny', 'diff-echo', 'ticked-boxes', 'unbacked-claim']),
    );
    // "- [x] Added comprehensive unit tests" is a ticked box: ticked-boxes' job, not phantom-tests'
    expect(rules(r)).not.toContain('phantom-tests');
  });

  it('passes the short one with no findings', () => {
    const r = pr(fixture('good-pr.md'), small);
    expect(r.findings).toEqual([]);
    expect(r.grade).toBe('A');
  });
});

describe('length', () => {
  it('scales the budget with the diff', () => {
    const words = Array(150).fill('word').join(' ') + ' because it broke.';
    expect(finding(pr(words, diff('a.ts:5:5')), 'length')).toBeDefined();
    expect(finding(pr(words, diff('a.ts:500:500')), 'length')).toBeUndefined();
  });

  it('gives specific writing more room than vague writing', () => {
    const vague = Array(20).fill('This improves the flow and makes things nicer overall.').join(' ');
    const specific = Array(20).fill('p99 went from 840ns to 8ns in `pipeTo` (#66052).').join(' ');
    const d = diff('lib/stream.js:40:20');
    const v = pr(vague, d);
    const s = pr(specific, d);
    expect(s.budget).toBeGreaterThan(v.budget);
  });

  it("doesn't count code blocks, tables of links or trailers as prose", () => {
    const body = 'Fixes the crash.\n\n```\n' + 'stack frame\n'.repeat(200) + '```\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)';
    expect(pr(body, small).words).toBe(3);
  });
});

describe('phantom-tests', () => {
  const claim = 'Retries 5xx because Stripe 502s during deploys.\n\nAdded unit tests for the retry loop.';

  it('fires when the text claims tests and no test file changed', () => {
    const f = finding(pr(claim, small), 'phantom-tests');
    expect(f?.severity).toBe('error');
    expect(f?.quote).toMatch(/Added unit tests/);
  });

  it.each([
    'test/webhook.test.ts',
    'src/__tests__/webhook.ts',
    'pkg/webhook_test.go',
    'tests/test_webhook.py',
    'External/ChemDraw/Wrap/testChemDraw.py', // regression: rdkit/rdkit#9597
    'src/test/java/WebhookTest.java',
    'spec/webhook_spec.rb',
    'Tests/WebhookTests.swift',
    'examples/.test/internal-types-export/src/factory.ts',
    'packages/app/__tests__/retry.ts',
    'spec/support/stripe_helpers.rb',
  ])('stays quiet when %s changed', (path) => {
    expect(finding(pr(claim, diff('src/webhook.ts:7:2', `${path}:20`)), 'phantom-tests')).toBeUndefined();
  });

  it('stays quiet for languages with inline tests', () => {
    expect(finding(pr(claim, diff('src/retry.rs:40:2')), 'phantom-tests')).toBeUndefined();
  });

  it('ignores negated claims and unchecked TODO boxes', () => {
    expect(finding(pr('No new tests: covered by the existing suite.', small), 'phantom-tests')).toBeUndefined();
    expect(finding(pr('- [ ] Add tests for the backoff', small), 'phantom-tests')).toBeUndefined();
  });

  it('checks commit subjects too', () => {
    expect(finding(commit('Add unit tests for webhook retries', small), 'phantom-tests')).toBeDefined();
  });

  it('reads "new" as a claim only when it is about the tests', () => {
    expect(finding(commit('Add new unit tests for webhook retries', small), 'phantom-tests')).toBeDefined();
    expect(finding(commit('Check the new README library example in the pack test', small), 'phantom-tests')).toBeUndefined();
  });

  it('needs a diff', () => {
    expect(finding(pr(claim, null), 'phantom-tests')).toBeUndefined();
  });

  // False alarms from the manual read of the corpus (bench/eval/README.md).
  it.each([
    ['running tests', '✅ Verification: Ran unit tests and a custom verify script that confirmed the failure response.'],
    ['an instruction', '✅ **Verification:** Run `pnpm test` to verify that all operations still work.'],
    ['a path', '- Updated `apps/web/src/app/engine-test/page.tsx` to keep engine output newlines.'],
    ['a product name', '- Adds GitHub Spec Kit (buildermethods/spec-kit) for spec-driven development'],
    ['a reported run', 'Full test suite verified passing on the live deployment.'],
    ['a suite that passes', '- Full `jest` suite passes: 64 tests, including the `cypress` e2e tests that exercise this dependency.'],
    ['commands', '- Commands reference for lint, test, and health check'],
    ['a modifier', 'Add a debug Python test target to the build.'],
    ['another modifier', '- Updated test behavior caveat with the Cloud VM hang and its workaround'],
    ['a question', '**Did you add tests for your changes?**'],
    ['a template instruction', '- please include tests. one line code fixes without tests will not be accepted.'],
    ['a struck-out box', '- ~~[ ] Added/updated tests~~'],
    ['a quoted commit', '- e2ba32502af7b2b503431135e8eae960d83d9cc0: add tests'],
    ['a count after a colon', '- EP-MCP card updated: 62 tools, 1130+ unit tests'],
  ])('stays quiet on %s', (_, body) => {
    expect(finding(pr(body, small), 'phantom-tests')).toBeUndefined();
  });

  it.each([
    ['running tests', 'Run `pnpm test` to verify the retry path.'],
    ['a suite verified passing', 'Suite verified passing on CI.'],
    ['an empty box', '- [ ] Add tests for the backoff'],
    ['a ticked box', '- [x] Added unit tests for the retry loop'],
    ['a template instruction', 'Please add tests for any new behavior.'],
    ['an HTML comment', '<!-- Added tests? Describe them here. -->\nRetries 5xx.'],
    ['a test step', 'Added a smoke test step to the release job.'],
    ['a test toolchain', 'Added the Spock test toolchain to the build.'],
    ['a code span', 'Added `npm run test:e2e` to the README.'],
    ['a conventions doc', '- **Writing new tests**: name files `*_test.py` and mock HTTP.'],
    ['a count nobody claims', '- Card updated with 63 new tests (141 total).'],
    ['a script that runs tests', 'Added a script to run tests in parallel.'],
    ['"unit tests cover…" with no claim of writing them', 'Unit tests cover the 5xx path.'],
  ])('stays quiet on %s', (_, body) => {
    expect(finding(pr(body, small), 'phantom-tests')).toBeUndefined();
  });

  it.each([
    'Add tests for the retry loop.',
    'Added regression tests for HTTP failure behavior.',
    'Wrote 12 new tests for the parser.',
    'A new test asserts that sends stop after 3 tries.',
    'The new tests confirm the backoff.',
    'A spec verifies retries stop at 3.',
    '- New regression tests for the 5xx path',
    'Added webhook retry tests.',
  ])('fires on "%s"', (body) => {
    expect(finding(pr(body, small), 'phantom-tests')?.severity).toBe('error');
  });

  it('still catches the claims next to them', () => {
    expect(finding(pr('Added a regression test for the 5xx path.', small), 'phantom-tests')).toBeDefined();
    expect(finding(pr('- Added regression tests for HTTP failure behavior.', small), 'phantom-tests')).toBeDefined();
    expect(finding(pr('The new test reproduces the 502 loop.', small), 'phantom-tests')).toBeDefined();
    expect(finding(pr('A regression test asserts that `compute_class` runs once.', small), 'phantom-tests')).toBeDefined();
  });

  it('counts hidden test directories as tests', () => {
    // regression: trpc/trpc#7557 added examples/.test/internal-types-export/
    const d = diff('packages/server/src/index.ts:4', 'examples/.test/internal-types-export/src/factory.ts:20');
    expect(finding(pr('- [x] I have added or updated tests related to the changes.', d), 'phantom-tests')).toBeUndefined();
  });

  it('reads "tests" in a CI-only diff as CI jobs', () => {
    expect(finding(pr('', diff('.github/workflows/windows-periodic.yml:2:1'), 'Update Windows periodic tests'), 'phantom-tests')).toBeUndefined();
  });
});

describe('template-on-tiny', () => {
  const body = '## Summary\nRetries 5xx.\n\n## Changes\nA loop.\n\n## Testing\nRan it.';

  it('flags section headers on a small diff', () => {
    expect(finding(pr(body, small), 'template-on-tiny')?.data?.headers).toBe(3);
  });

  it('allows headers on a large diff', () => {
    expect(finding(pr(body, diff('src/a.ts:400:200')), 'template-on-tiny')).toBeUndefined();
  });

  it('never counts the target shape: an opening, bullets and a Tested line', () => {
    const shape = 'Retries 5xx because Stripe 502s during deploys.\n\n- 5xx retries 3 times\n- 4xx returns at once\n\nTested: `npm test`, 84 passed.';
    expect(finding(pr(shape, small), 'template-on-tiny')).toBeUndefined();
    expect(finding(pr('Retries 5xx because Stripe 502s.\n\n**Tested**\n\n- `npm test`: 84 passed', small), 'template-on-tiny')).toBeUndefined();
  });

  it('allows short plain headers on a big diff', () => {
    const big = '## Behavior changes\n\n- a\n\n## What\'s mechanical\n\nMoves.\n\n## How to review\n\nLedger first.\n\n## Risk\n\nRefunds.';
    expect(finding(pr(big, diff('src/a.ts:900:400')), 'template-on-tiny')).toBeUndefined();
  });

  it('advises, but never blocks, content sections on a small fix', () => {
    // regression: 0xf4b1/hearthstone-linux#111, Problem / Fix / Result / Testing with facts
    const body = '## Problem\n\nkeg fetched 21,951 files one at a time.\n\n## Fix\n\n8 workers.\n\n## Result\n\n4 h → 35 min.\n\n## Testing\n\nRan a full install.';
    expect(finding(pr(body, diff('keg:1:1')), 'template-on-tiny')?.severity).toBe('warn');
  });

  it('still blocks the full form on a small diff', () => {
    expect(finding(pr(fixture('slop-pr.md'), small), 'template-on-tiny')?.severity).toBe('error');
  });
});

describe('diff-echo', () => {
  const d = diff('src/api/users.ts:10', 'src/api/orders.ts:10', 'src/db/schema.ts:10');

  it('flags a file-by-file tour', () => {
    const body = '- `src/api/users.ts`: updated handler\n- `src/api/orders.ts`: updated handler\n- Updated schema.ts with new column';
    expect(finding(pr(body, d), 'diff-echo')?.data?.count).toBe(3);
  });

  it('allows naming a file mid-explanation', () => {
    // regression: rdkit/rdkit#9597 explained its changes and named files along the way
    const body = [
      'The ctest entry runs the file directly, but `users.ts` never exported the handler, so nothing ran.',
      'Orders were written before the migration finished; the fix in `orders.ts` waits for it.',
      'The new column is nullable because old rows in `schema.ts` predate it.',
    ].join('\n');
    expect(finding(pr(body, d), 'diff-echo')).toBeUndefined();
  });
});

describe('verification', () => {
  it('flags pre-ticked checklists', () => {
    const body = '- [x] Tests pass\n- [x] Lint passes\n- [x] Docs updated';
    expect(finding(pr(body, small), 'ticked-boxes')?.data?.count).toBe(3);
  });

  it('flags "tested locally" but not a named command', () => {
    expect(finding(pr('Tested locally.', small), 'vague-verification')).toBeDefined();
    expect(finding(pr('All tests pass with `npm test`.', small), 'vague-verification')).toBeUndefined();
    expect(finding(pr('All 212 tests pass.', small), 'vague-verification')).toBeUndefined();
  });

  it('reads commands without backticks and results elsewhere in the text', () => {
    // regression: anhanga-tech/AV-SITE#418, ATherkel/budget#45
    expect(finding(pr('- Regression tests passed (pnpm test:regression)', small), 'vague-verification')).toBeUndefined();
    const body = 'The implementation and tests pass its lint and complexity gates.\n\n- Ruff, ty and complexipy pass; 23 tests pass through pytest.';
    expect(finding(pr(body, small), 'vague-verification')).toBeUndefined();
  });

  it("doesn't count ticked boxes that name the command or the result", () => {
    // regression: Better-Machine/a2a-gateway#1, aaif/community-events#53
    const body = '- [x] `npm test`: 244 tests pass, 0 failures\n- [x] `npx tsc --noEmit`: no new errors\n- [x] Build ok (pnpm build and typecheck passed)';
    expect(finding(pr(body, small), 'ticked-boxes')).toBeUndefined();
    expect(finding(pr('- [x] Tested locally\n- [x] No breaking changes\n- [x] `npm test`: 84 passed', small), 'ticked-boxes')?.data?.count).toBe(2);
  });
});

describe('unbacked-claim', () => {
  it('flags claims with no numbers', () => {
    expect(finding(pr('This significantly improves performance.', small), 'unbacked-claim')).toBeDefined();
    expect(finding(pr('Improves readability and maintainability.', small), 'unbacked-claim')).toBeDefined();
  });

  it('accepts claims backed by a measurement', () => {
    expect(finding(pr('Improves performance: p99 drops from 120ms to 40ms.', small), 'unbacked-claim')).toBeUndefined();
    expect(finding(pr('About 3x faster on the benchmark.', small), 'unbacked-claim')).toBeUndefined();
  });

  it('accepts a measurement on the next line', () => {
    // regression: adasima/hoi4maptools#14
    const body = 'Why: to improve rendering performance.\n\nMeasured with `cargo bench`: ~117ns per hex before, ~31ns after.';
    expect(finding(pr(body, small), 'unbacked-claim')).toBeUndefined();
  });

  it('leaves a faster merge alone', () => {
    // regression: ArduPilot/ardupilot#33155
    expect(finding(pr('Extracted from #33147 as a faster merge.', small), 'unbacked-claim')).toBeUndefined();
  });
});

describe('missing-why', () => {
  const d = diff('src/a.ts:40:10');

  it('flags a PR that only says what', () => {
    expect(finding(pr('Adds a retry loop to the webhook sender and a tries parameter.', d), 'missing-why')).toBeDefined();
  });

  it.each([
    'Retries because Stripe returns 502 during deploys.',
    'Fixes #4312.',
    'Closes PAY-881.',
    'Webhook events were dropped when the endpoint was down.',
  ])('accepts: %s', (body) => {
    expect(finding(pr(body, d), 'missing-why')).toBeUndefined();
  });

  it.each([
    ['a "Why:" label', '* 🎯 Why: the nested use case fetched and saved each entity per item.'],
    ['a problem', 'This removes an N+1 query problem when receiving purchase orders.'],
    ['a button that did nothing', 'The Send Feedback button did nothing in Comfy windows: the panel is built lazily.'],
  ])('accepts %s', (_, body) => {
    // regression: bjohnson1279/php-ddd-inventory#462
    expect(finding(pr(body, d), 'missing-why')).toBeUndefined();
  });

  // regressions from the 30-PR held-out run: each of these openings states a reason
  it.each([
    ['a purpose without "that" (hiyouga/LlamaFactory#10445)', 'Add "xpu" to runs_on markers across the data and eval suites so tests are picked up on Intel XPU CI targets.'],
    ['users stuck (fderuiter/DuckDeploy#94)', 'Keyboard users were trapped in the sidebar after selecting a link, having to re-tab through the menu on every page.'],
    ['a need (NousResearch/hermes-agent#28636)', 'Agents need durable, auditable memory across sessions. This adds the git-as-memory skill.'],
    ['text nobody can read (SPFXUNLIMITED/GHOST_LASER_FRONTEND#433)', 'Inputs and cards became unreadable after the bg-zinc-950 sweep. This restores bg-white on them.'],
    ['a stated purpose (zterefe/PageAura#22)', 'Adds three archetype fixtures to provide repeatable manual QA for DOM snapshots.'],
  ])('accepts %s', (_, body) => {
    expect(finding(pr(body, d), 'missing-why')).toBeUndefined();
  });

  it("doesn't read a need in the middle of a sentence as a reason", () => {
    expect(finding(pr('Checks if elements need runtime access and only generates the ones that do.', d), 'missing-why')).toBeDefined();
  });

  it("doesn't read utf-8 or a UUID as a ticket", () => {
    // regression: block/coplan#167, where an Amp thread link counted as the why
    expect(finding(pr('Amp-Thread: https://ampcode.com/threads/T-019fa9fa-a0a9-7607-b551-df57797d3054', d), 'missing-why')).toBeDefined();
    expect(finding(pr('Reads the file as utf-8 and writes it back.', d), 'missing-why')).toBeDefined();
  });

  it('gives no verdict on a description in another script', () => {
    // regression: BEDOLAGA-DEV/remnawave-bedolaga-telegram-bot#2947
    const body = 'Добавлена кнопка оплаты в меню подписки, пользователи просили оплату прямо из бота.';
    expect(finding(pr(body, d), 'missing-why')).toBeUndefined();
  });

  it('flags an empty body on a normal diff, not a tiny one', () => {
    expect(finding(pr('', diff('src/a.ts:100')), 'missing-why')?.message).toMatch(/No description/);
    expect(finding(pr('', diff('src/a.ts:3')), 'missing-why')).toBeUndefined();
  });

  it('leaves an empty body on a big diff to thin-description', () => {
    expect(finding(pr('', diff('src/a.ts:300')), 'missing-why')).toBeUndefined();
    expect(finding(pr('', diff('src/a.ts:300')), 'thin-description')?.message).toBe('No description for a 300-line diff');
  });
});

describe('type-mismatch', () => {
  it('flags feat: on a docs-only diff', () => {
    expect(finding(commit('feat: explain retries', diff('README.md:10')), 'type-mismatch')).toBeDefined();
  });

  it('flags docs: that touches code', () => {
    expect(finding(commit('docs: explain retries', diff('README.md:10', 'src/a.ts:3')), 'type-mismatch')).toBeDefined();
  });

  it('accepts matching types', () => {
    expect(finding(commit('docs: explain retries', diff('README.md:10')), 'type-mismatch')).toBeUndefined();
  });
});

describe('commit length', () => {
  it('gives a why-explaining commit body far more slack than a PR', () => {
    const d = diff('src/retry.ts:3:3'); // budgets: commit 35, PR 80
    const words = (n: number) => 'The delay was computed before the counter moved because '.repeat(n).trim();
    // A long prose commit body is how the best projects write; it only blocks when absurd.
    expect(finding(commit(`Back off between webhook retries\n\n${words(18)}`, d), 'length')?.severity).toBe('warn');
    expect(finding(commit(`Back off between webhook retries\n\n${words(40)}`, d), 'length')?.severity).toBe('error');
    expect(finding(pr(words(36), d), 'length')?.severity).toBe('error');
  });

  it('never blocks a long description that is dense with detail short of 6×', () => {
    const dense = 'The `retry()` loop in `send()` waited 200 ms, 400 ms and 800 ms (see #412, `MAX_TRIES=3`). '.repeat(18);
    const f = finding(pr(dense, diff('src/retry.ts:3:3')), 'length');
    expect(f?.severity).toBe('warn');
  });
});

describe('thin-description', () => {
  it('flags a one-line body on a big diff', () => {
    // regression: awest813/SpockD3D9#1, "Pull request created by AI Agent" on 756 lines
    const f = finding(pr('Pull request created by AI Agent', diff('src/a.ts:500:256')), 'thin-description');
    expect(f?.message).toBe('A one-line description for a 756-line diff');
    expect(f?.severity).toBe('warn');
  });

  it("asks for a Tested line on a normal diff that doesn't say how it was checked", () => {
    const body = 'Webhook sends to Stripe fail with 502s during their deploys, so 5xx responses now retry 3 times.';
    expect(finding(pr(body, diff('src/webhook.ts:40:10')), 'thin-description')?.message).toMatch(/how it was tested/);
    expect(finding(pr(`${body}\n\nTested: \`npm test\`, 84 passed.`, diff('src/webhook.ts:40:10')), 'thin-description')).toBeUndefined();
    expect(finding(pr(`${body}\n\nNot tested: no Stripe sandbox here.`, diff('src/webhook.ts:40:10')), 'thin-description')).toBeUndefined();
  });

  it('leaves tiny and docs-only diffs alone', () => {
    const body = 'Webhook sends to Stripe fail with 502s during deploys, so 5xx responses retry.';
    expect(finding(pr(body, small), 'thin-description')).toBeUndefined();
    expect(finding(pr(body, diff('docs/webhooks.md:80')), 'thin-description')).toBeUndefined();
  });
});

describe('what sends a PR back', () => {
  it('never sends back on warnings alone at the default max', () => {
    // regression: Better-Machine/a2a-gateway#1, a readable chore PR sent back on stacked warnings
    const body = [
      '- **CI fix**: the workflow targets `main` instead of `master`',
      '- **License**: MIT, plus `license` and `engines` in package.json',
      '- **Changelog**: first entry for v1.0.1',
      '- **QA report**: 244 tests passing, 13 transitive vulns, 0 direct',
      '- **Contributing**: branch names and the PR process',
      '- **Ignore**: `*.local.json` so peer config stays local',
      '',
      '- [x] Tested locally',
      '- [x] Docs updated',
      '- [x] Lint clean',
    ].join('\n');
    const r = pr(body, diff('src/a.ts:30', 'README.md:40'), 'chore: MVP hardening');
    expect(r.findings.every((f) => f.severity !== 'error')).toBe(true);
    expect(passes(r, 35)).toBe(true);
    expect(passes(r, 10)).toBe(false);
  });

  it('counts a wall of bullets in full, and a long list only up to the cap', () => {
    // regression: romainejg/sixsigma#1, 62 bullets for 1,502 lines
    const list = (n: number) => Array.from({ length: n }, (_, i) => `- \`Mode${i}\` switches the board to layout ${i}`).join('\n');
    const body = (n: number) =>
      `This PR introduces a comprehensive, robust board shared by every mode, because players lost their place when layouts swapped.\n\n${list(n)}\n\n- **Grid**: one\n- **Modes**: two\n- **Layout**: three\n\nTested: \`dotnet test\`, 48 passed.`;
    const d = diff('src/Board.cs:600:215');
    expect(passes(pr(body(16), d), 35)).toBe(true);
    expect(passes(pr(body(40), d), 35)).toBe(false);
  });

  it('counts length in full from 2.5× the budget, and with bullet-bloat in full', () => {
    // regression: AbramNel/MultiChart#1, 965 words and 22 bullets for 815 lines, score 49
    const d = diff('src/Board.cs:600:215');
    const bullets = (n: number) => Array.from({ length: n }, (_, i) => `- \`Cell${i}\` gets a state flag`).join('\n');
    const prose = (n: number) => Array(n).fill('The grid now stays in place while each game mode only changes the state of its cells.').join(' ');
    const body = (sentences: number, list: number) => `${prose(sentences)} Players lost their place when layouts swapped.\n\n${bullets(list)}\n\nTested: \`dotnet test\`, 48 passed.`;
    const longList = pr(body(50, 22), d);
    expect(rules(longList)).toEqual(expect.arrayContaining(['length', 'bullet-bloat']));
    expect(longList.findings.every((f) => f.severity !== 'error')).toBe(true);
    expect(passes(longList, 35)).toBe(false);
    // the same length with a short list is advice: long isn't yap on its own
    expect(passes(pr(body(50, 5), d), 35)).toBe(true);
  });

  it('sends back thin padding on a tiny diff from 2.5× the budget, but not a long explanation of a real change', () => {
    const s = 'The webhook sender now retries when the receiver answers with a server error, because we saw events get dropped during their deploys and the team asked for it to be handled in the sender itself rather than in each caller. ';
    expect(passes(pr(s.repeat(5), small), 35)).toBe(true); // 200 words, 2.4×: a note
    expect(finding(pr(s.repeat(6), small), 'length')?.severity).toBe('error'); // 240 words, 2.9×
    // hashicorp/terraform#28781, from before AI: 600 words of plain prose on 254 lines, 3.2×
    expect(passes(pr(s.repeat(15), diff('internal/initwd/module_install.go:200:54')), 35)).toBe(true);
  });

  it('still sends back the yappy sample', () => {
    const r = pr(fixture('slop-pr.md'), small, 'Add comprehensive retry mechanism');
    expect(passes(r, 35)).toBe(false);
    expect(r.grade).toBe('F');
  });
});
