// Every PR and commit in bench/cache that the old phantom-tests rule fired on (40, all blocking),
// scored the way bench/score.mjs scores them. Four say they wrote tests the diff doesn't have; the
// other 36 were false alarms, each tagged with why the rule must stay quiet.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyze, buildDiff, historyMessage, parseTemplate, prMessage } from '../src/index.js';

interface Cached {
  url: string;
  kind: 'pr' | 'commit';
  title?: string;
  body?: string;
  message?: string;
  template?: { path: string; text: string };
  files: { path: string; additions: number; deletions: number }[];
  additions: number;
  deletions: number;
  changedFiles?: number;
}

function phantom(file: string) {
  const it = JSON.parse(readFileSync(new URL(`../bench/cache/${file}`, import.meta.url), 'utf8')) as Cached;
  const truncated = it.kind === 'pr' && it.changedFiles != null && it.files.length < it.changedFiles;
  const diff = buildDiff(it.files, { additions: it.additions, deletions: it.deletions }, truncated);
  const msg = it.kind === 'pr' ? prMessage(it.title ?? '', it.body ?? '') : historyMessage(it.message ?? '');
  const r = analyze(msg, diff, { template: it.template ? parseTemplate([it.template]) : null });
  return r.findings.find((f) => f.rule === 'phantom-tests');
}

describe('phantom-tests on the corpus', () => {
  it.each([
    ['Rahulvijayan123__workout__pr2.json', '"Added regression tests for HTTP failure behavior"'],
    ['ottojung__volodyslav__pr1172.json', '"Added/updated regression tests for legacy compatibility…"'],
    ['milindkumar1694-bot__ArthaLens__0e9de41e0cea.json', 'the subject "Add tests and docs for Angel One TOTP…"'],
    ['rails__rails__pr58852.json', '"A regression test asserts that compute_class is only called once"'],
  ])('fires on %s: %s, with no test file in the diff', (file) => {
    const f = phantom(file);
    expect(f?.severity).toBe('error');
  });

  it.each([
    // running tests, not writing them (unverified-in-session covers these)
    ['Albert-lane-org__SimCity__f9cbde4217bc.json', 'a run: "96/96 total agent suite tests verified"'],
    ['Cannibusny__warden-engine__pr1.json', 'a run: "8 spec tests (T1–T8) verified passing"'],
    ['aledotsoftware__Tudex-Live-Chat__pr3.json', 'a run: "Ran unit tests and a custom verify script"'],
    ['bjohnson1279__gql-ddd-inventory__pr346.json', 'an instruction to run the tests to verify'],
    ['buildkite__test-collector-javascript__pr152.json', 'a suite that passes, "including the mocha and cypress e2e tests"'],
    ['mehmetg06__Praeventus__pr114.json', 'a run: "test output confirms"'],
    ['wnj00524__MedWNetworkSim__pr279.json', 'a run: "Full test suite verified passing"'],
    // checkboxes, struck-through boxes, questions, template instructions
    ['flutter__flutter__6109354d8366.json', 'a ticked template box: "- [x] I added new tests…"'],
    ['trpc__trpc__pr7557.json', 'a ticked box, and examples/.test/ is a test folder'],
    ['sinhar17__Throttle-Tribe__pr1.json', 'a ticked box: "Test plan - [x] Verified"'],
    ['traefik__traefik__pr13952.json', 'a struck-through box: "~~[ ] Added/updated tests~~"'],
    ['traefik__traefik__pr8146.json', 'a struck-through box: "~~- [ ] Added/updated tests~~"'],
    ['webpack__webpack__pr22292.json', 'a question: "Did you add tests for your changes?"'],
    ['webpack__webpack__pr22299.json', 'a question: "Did you add tests for your changes?"'],
    ['sqlalchemy__sqlalchemy__pr13287.json', 'a template instruction: "please include tests"'],
    ['sqlalchemy__sqlalchemy__pr13349.json', 'a template instruction: "please include tests"'],
    ['sqlalchemy__sqlalchemy__pr13450.json', 'a template instruction: "please include tests"'],
    ['sqlalchemy__sqlalchemy__pr13463.json', 'a template instruction: "please include tests"'],
    // "test" as part of something else, and CI workflows
    ['MarsBoundJ__dnd-trends-index__pr32.json', 'a test harness'],
    ['TeachificApp__ultrasound-app__pr2.json', 'a test behavior caveat'],
    ['etcd-io__etcd__pr13045.json', 'test parameters'],
    ['ipruning__skills__pr4.json', 'a test zip'],
    ['jennareddell__optum__pr1.json', 'a test toolchain'],
    ['pydantic__pydantic__pr13820.json', 'a test target in CI'],
    ['rh-ecosystem-edge__neuron-ci__pr19.json', 'a test step'],
    ['containerd__containerd__pr5544.json', 'CI jobs: "Update Windows periodic tests" on a workflow-only diff'],
    // docs describing test commands or conventions
    ['LiquidAIty__main__pr1.json', 'AGENTS.md: "common run/build/test commands"'],
    ['chrisatcursor__spring-petclinic__pr10.json', 'AGENTS.md: "Commands for running the app, tests, and lint checks"'],
    ['danieltovbin-coder__chocolate-store__pr4.json', 'AGENTS.md: "Commands reference for lint, test, and health check"'],
    ['fklausnir__goreportcard__pr7.json', 'AGENTS.md: "canonical build/lint/test/run commands"'],
    ['microbiomedata__nmdc-client__pr192.json', 'a conventions doc: "Writing new tests — file/function naming…"'],
    // counts of tests nobody claims to have written in this change
    ['Hack23__homepage__pr1211.json', 'a product card: "1 130+ unit tests"'],
    ['wuzbak__Unitary-Manifold-__pr250.json', 'a version history: "63 new tests (141 total…)"'],
    // code spans, paths, product names, quoted commits
    ['blindxx__PacketForge__pr27.json', 'a path: engine-test/page.tsx'],
    ['braiinz94__braiinz-education__pr1.json', 'a product name: "GitHub Spec Kit"'],
    ['Aeolun__solid-jsx-oxc__pr1.json', 'a release PR quoting old commits: "- <sha>: ❓ add tests" and their bodies'],
  ])('stays quiet on %s: %s', (file) => {
    expect(phantom(file)).toBeUndefined();
  });
});
