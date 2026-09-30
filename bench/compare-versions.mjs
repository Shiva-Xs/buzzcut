// Scores two buzzcut builds on the same frozen inputs and prints the comparison:
//   1. honest PRs (real, from before AI coding tools): how many each build sends back
//   2. planted errors (one false statement written into each PR by another model): how many each
//      build blocks that it lets through in the honest version of the same PR
//
//   npm run build
//   OLD_BUZZCUT=/path/to/node_modules/buzzcut/dist/index.js node bench/compare-versions.mjs [--split dev|test|all]
//   (the test half also needs SEAL_OPEN=1: it is opened once, when the rules are final)
//
// "Blocked" means the build's own `passes()` says no, at the default limit. Each build gets its own
// diff: the old one line counts only, the new one the changed lines and a search of the repo
// snapshot, which is all the old one could have used.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const NEW = await import('../dist/index.js');
if (!process.env.OLD_BUZZCUT) {
  console.error('Set OLD_BUZZCUT to the older build\'s dist/index.js (npm i buzzcut@0.1.2, then node_modules/buzzcut/dist/index.js).');
  process.exit(1);
}
const OLD = await import(pathToFileURL(process.env.OLD_BUZZCUT).href);

const args = process.argv.slice(2);
const which = args.includes('--split') ? args[args.indexOf('--split') + 1] : 'dev';
if (which !== 'dev' && process.env.SEAL_OPEN !== '1') {
  console.error('The TEST half is sealed until the rules are final. Set SEAL_OPEN=1 to open it once.');
  process.exit(1);
}
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const frozen = JSON.parse(readFileSync(here('heldout.json'), 'utf8'));
const SNAP = process.env.HELDOUT_SNAPSHOTS || here('cache/snapshots');
const splitOf = (repo) => (parseInt(createHash('sha1').update(repo.toLowerCase()).digest('hex').slice(0, 8), 16) % 2 === 0 ? 'dev' : 'test');
const inSplit = (repo) => which === 'all' || splitOf(repo) === which;
const flat = (s) => s.toLowerCase().replace(/[-_.]/g, '');
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a');

const prs = frozen.prs
  .map((url) => {
    const [, owner, repo, number] = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    return { url, owner, repo, number, file: here(`cache/heldout/${owner}__${repo}__pr${number}.json`) };
  })
  .sort((a, b) => a.url.localeCompare(b.url));
const planted = new Map(readFileSync(here('eval/planted/planted.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((o) => [o.id, o]));

const searches = new Map();
const searchFor = (owner, repo) => {
  const dir = join(SNAP, `${owner}__${repo}`);
  if (!existsSync(dir)) return null;
  if (!searches.has(dir)) searches.set(dir, NEW.gitRepoSearch(dir));
  return searches.get(dir);
};

function diffFor(lib, pr, withLines) {
  const files = pr.files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions, ...(f.renamed ? { renamed: true } : {}), ...(withLines && f.patch ? { added: f.added, removed: f.removed } : {}) }));
  return lib.buildDiff(files, { additions: pr.additions, deletions: pr.deletions }, pr.files.length < pr.changedFiles);
}
const runOld = (pr, body) => OLD.analyze(OLD.prMessage(pr.title, body), diffFor(OLD, pr, false));
const runNew = (pr, body) => NEW.analyze(NEW.prMessage(pr.title, body), diffFor(NEW, pr, true), { repo: searchFor(pr.owner, pr.repo) });
const blocked = (lib, r) => !lib.passes(r, lib.DEFAULT_CONFIG.max);
const skipped = (title) => NEW.DEFAULT_CONFIG.ignore.some((re) => re.test(title));

// ─── honest PRs ──────────────────────────────────────────────────────────────

const honest = [];
prs.forEach((p, i) => {
  if (!inSplit(`${p.owner}/${p.repo}`) || !existsSync(p.file)) return;
  const pr = JSON.parse(readFileSync(p.file, 'utf8'));
  if (skipped(pr.title)) return;
  honest.push({ p, pr, old: runOld(pr, pr.body), now: runNew(pr, pr.body), id: String(i + 1).padStart(3, '0') });
});
const oldBlocked = honest.filter((h) => blocked(OLD, h.old));
const newBlocked = honest.filter((h) => blocked(NEW, h.now));
const onlyNew = newBlocked.filter((h) => !oldBlocked.includes(h));
const newRules = new Set(['unsourced-name', 'unsourced-fact', 'test-count-mismatch', 'unmentioned-area']);
const noteCount = (sev) => honest.filter((h) => h.now.findings.some((f) => newRules.has(f.rule) && f.severity === sev)).length;

console.log(`\n## Honest PRs (${which} half): ${honest.length} real PRs by people, from before AI coding tools\n`);
console.log('| | published 0.1.2 | this branch |');
console.log('|---|---|---|');
console.log(`| sent back | ${oldBlocked.length} (${pct(oldBlocked.length, honest.length)}) | ${newBlocked.length} (${pct(newBlocked.length, honest.length)}) |`);
console.log(`| sent back by a new lookup rule only | 0 | ${onlyNew.length} |`);
console.log(`| new-rule errors / warnings / notes on these PRs | n/a | ${noteCount('error')} / ${noteCount('warn')} / ${noteCount('info')} |`);
console.log(`| 'length' fires (budget shrank?) | ${honest.filter((h) => h.old.findings.some((f) => f.rule === 'length')).length} | ${honest.filter((h) => h.now.findings.some((f) => f.rule === 'length')).length} |`);
for (const h of onlyNew) console.log(`\n  newly sent back: ${h.p.owner}/${h.p.repo}#${h.p.number}: ${h.now.findings.filter((f) => f.severity === 'error').map((f) => f.message).join(' | ').slice(0, 200)}`);

// ─── planted errors ──────────────────────────────────────────────────────────

const kinds = {};
let invalid = 0;
for (const h of honest) {
  const out = planted.get(h.id);
  if (!out) continue;
  const { pr } = h;
  const d = diffFor(NEW, pr, true);
  const search = searchFor(pr.owner, pr.repo);
  const added = d.files.map((x) => x.added ?? '').join('\n');
  const removed = d.files.map((x) => x.removed ?? '').join('\n');
  const orig = (pr.body ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  let ok = typeof out.body === 'string' && out.body !== pr.body && (orig.length === 0 || orig.filter((l) => out.body.includes(l)).length / orig.length >= 0.8);
  const name = out.planted?.name;
  const path = out.planted?.path;
  const n = name ? NEW.norm(name) : '';
  // Valid by the diff and the repo alone, never by anything either build says.
  if (ok && out.kind === 'invented_name') ok = n.length >= 6 && !flat(added).includes(n) && !flat(removed).includes(n) && search?.find([name])?.has(name) === false && out.body.includes(name);
  if (ok && out.kind === 'invented_file') ok = Boolean(path) && !pr.files.some((x) => x.path === path || x.path.endsWith('/' + path)) && search?.hasFile(path) === false && out.body.includes(path);
  if (ok && out.kind === 'removal_as_addition') ok = Boolean(name) && flat(removed).includes(n) && !flat(added).includes(n) && out.body.includes(name);
  if (!ok) {
    invalid++;
    continue;
  }
  const k = (kinds[out.kind] ??= { valid: 0, oldBlocked: 0, newBlocked: 0, oldFlag: 0, newFlag: 0 });
  k.valid++;
  const po = runOld(pr, out.body);
  const pn = runNew(pr, out.body);
  // The outcome that matters: the planted version is blocked while the honest version of the same PR wasn't.
  if (blocked(OLD, po) && !blocked(OLD, h.old)) k.oldBlocked++;
  if (blocked(NEW, pn) && !blocked(NEW, h.now)) k.newBlocked++;
  const fresh = (lib, before, after) => after.findings.some((f) => !before.findings.some((b) => b.rule === f.rule && b.message === f.message));
  if (fresh(OLD, h.old, po)) k.oldFlag++;
  if (fresh(NEW, h.now, pn)) k.newFlag++;
}
console.log(`\n## Planted errors (${which} half): one false statement in each real PR, written by Gemini (${invalid} statements were invalid and are not counted)\n`);
console.log('| kind | valid | blocked by 0.1.2 | blocked by this branch | any new finding, 0.1.2 | any new finding, this branch |');
console.log('|---|---|---|---|---|---|');
let tv = 0, to = 0, tn = 0;
for (const [kind, k] of Object.entries(kinds)) {
  console.log(`| ${kind} | ${k.valid} | ${k.oldBlocked} (${pct(k.oldBlocked, k.valid)}) | ${k.newBlocked} (${pct(k.newBlocked, k.valid)}) | ${k.oldFlag} | ${k.newFlag} |`);
  tv += k.valid; to += k.oldBlocked; tn += k.newBlocked;
}
console.log(`| **all** | ${tv} | ${to} (${pct(to, tv)}) | ${tn} (${pct(tn, tv)}) | | |`);
