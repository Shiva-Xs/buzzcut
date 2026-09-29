// Scores the source lookups on the frozen held-out set (bench/heldout.json), offline:
//   1. false alarms: the checks on real PRs written by people before AI coding tools existed
//   2. planted errors: the same PRs with one false statement written into each by another model
//
// The 27 repos are split in two by a hash of their name. While the rules are being adjusted, only
// the DEV half can be scored; the TEST half is opened once, when the rules are final:
//
//   npm run build && node bench/lookup-bench.mjs                  # dev half, false alarms
//   node bench/lookup-bench.mjs --planted                         # dev half, planted errors
//   SEAL_OPEN=1 node bench/lookup-bench.mjs --split test --planted   # the report
//
// Needs bench/cache/heldout/ and the repo snapshots (node bench/fetch-heldout.mjs).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, buildDiff, DEFAULT_CONFIG, gitRepoSearch, norm, passes, prMessage } from '../dist/index.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const value = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const which = value('split', 'dev');
if (which === 'test' && process.env.SEAL_OPEN !== '1') {
  console.error('The TEST half is sealed until the rules are final. Set SEAL_OPEN=1 to open it once.');
  process.exit(1);
}

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const frozen = JSON.parse(readFileSync(here('heldout.json'), 'utf8'));
const SNAP = process.env.HELDOUT_SNAPSHOTS || here('cache/snapshots');
const splitOf = (repo) => (parseInt(createHash('sha1').update(repo.toLowerCase()).digest('hex').slice(0, 8), 16) % 2 === 0 ? 'dev' : 'test');
const inSplit = (repo) => which === 'all' || splitOf(repo) === which;

const NEW_RULES = ['unsourced-name', 'unsourced-fact', 'test-count-mismatch', 'unmentioned-area'];
const ignored = (title) => DEFAULT_CONFIG.ignore.some((re) => re.test(title));

const key = (o, r, n) => `${o}__${r}__pr${n}`;
const prs = frozen.prs
  .map((url) => {
    const [, owner, repo, number] = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    return { url, owner, repo, number, file: here(`cache/heldout/${key(owner, repo, number)}.json`) };
  })
  .sort((a, b) => a.url.localeCompare(b.url));

const searches = new Map();
const searchFor = (owner, repo) => {
  const dir = join(SNAP, `${owner}__${repo}`);
  if (!existsSync(dir)) return null;
  if (!searches.has(dir)) searches.set(dir, gitRepoSearch(dir));
  return searches.get(dir);
};

/** The PR's diff with its changed lines, or without them (which is what the checks looked like before). */
function diffOf(pr, withLines) {
  const files = pr.files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions, ...(f.renamed ? { renamed: true } : {}), ...(withLines && f.patch ? { added: f.added, removed: f.removed } : {}) }));
  return buildDiff(files, { additions: pr.additions, deletions: pr.deletions }, pr.files.length < pr.changedFiles);
}

const run = (pr, body, withLines = true) => analyze(prMessage(pr.title, body), diffOf(pr, withLines), { repo: withLines ? searchFor(pr.owner, pr.repo) : null });
const newFindings = (r) => r.findings.filter((f) => NEW_RULES.includes(f.rule));
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a');

// ─── false alarms ────────────────────────────────────────────────────────────

function falseAlarms() {
  const rows = [];
  for (const p of prs) {
    if (!inSplit(p.owner + '/' + p.repo) || !existsSync(p.file)) continue;
    const pr = JSON.parse(readFileSync(p.file, 'utf8'));
    if (ignored(pr.title)) continue;
    const before = run(pr, pr.body, false); // what buzzcut said before the lookups
    const after = run(pr, pr.body, true);
    rows.push({ pr, before, after, searchable: diffOf(pr, true).searchable });
  }
  const n = rows.length;
  const searchable = rows.filter((r) => r.searchable);
  const sentBefore = rows.filter((r) => !passes(r.before, DEFAULT_CONFIG.max));
  const sentAfter = rows.filter((r) => !passes(r.after, DEFAULT_CONFIG.max));
  const newlySent = sentAfter.filter((r) => !sentBefore.includes(r));
  console.log(`\nFALSE ALARMS: ${which} half, ${n} PRs by people from before AI coding tools (${searchable.length} with a searchable diff)`);
  console.log(`  sent back before the lookups: ${sentBefore.length} (${pct(sentBefore.length, n)})   after: ${sentAfter.length} (${pct(sentAfter.length, n)})   newly sent back: ${newlySent.length}`);
  const by = {};
  for (const r of rows) for (const f of newFindings(r.after)) (by[`${f.rule} ${f.severity}`] ??= new Set()).add(r);
  for (const [k, set] of Object.entries(by).sort()) console.log(`  ${k.padEnd(28)} ${String(set.size).padStart(3)} PRs  ${pct(set.size, n)} of all, ${pct(set.size, searchable.length)} of searchable`);
  if (flag('why')) for (const r of sentBefore) console.log(`   sent back before: ${r.pr.owner}/${r.pr.repo}#${r.pr.number} ${r.before.findings.filter((f) => f.severity === 'error' || f.points >= 6).map((f) => f.rule + ':' + f.severity[0]).join(' ')}`);
  const lengthNew = rows.filter((r) => r.after.findings.some((f) => f.rule === 'length') && !r.before.findings.some((f) => f.rule === 'length'));
  console.log(`  'length' newly fires (smaller budget): ${lengthNew.length}`);
  if (flag('show') || which === 'dev') {
    console.log('\n  flagged (errors and warnings):');
    for (const r of rows) {
      for (const f of newFindings(r.after).filter((f) => f.severity !== 'info')) console.log(`   ${f.severity === 'error' ? '✗' : '!'} ${r.pr.owner}/${r.pr.repo}#${r.pr.number}  ${f.message.slice(0, 150)}`);
    }
  }
  return { n, sentBefore: sentBefore.length, sentAfter: sentAfter.length, newlySent: newlySent.length, by: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.size])) };
}

// ─── planted errors ──────────────────────────────────────────────────────────

function planted() {
  // The frozen set (eval/planted/freeze.mjs); its hash is in eval/planted/planted.sha256.
  const frozenPlanted = new Map(readFileSync(here('eval/planted/planted.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((o) => [o.id, o]));
  const kinds = {};
  const missed = [];
  let invalid = 0;
  prs.forEach((p, i) => {
    if (!inSplit(p.owner + '/' + p.repo)) return;
    const id = String(i + 1).padStart(3, '0');
    const out = frozenPlanted.get(id);
    if (!out || !existsSync(p.file)) return;
    const pr = JSON.parse(readFileSync(p.file, 'utf8'));
    const kind = out.kind;
    const k = (kinds[kind] ??= { valid: 0, caught: 0, sentBack: 0, invalid: 0 });
    // Validity, decided from the diff and the repo and not from anything the checks say.
    const d = diffOf(pr, true);
    const search = searchFor(pr.owner, pr.repo);
    const added = d.files.map((x) => x.added ?? '').join('\n');
    const removed = d.files.map((x) => x.removed ?? '').join('\n');
    const flat = (s) => s.toLowerCase().replace(/[-_.]/g, '');
    const original = (pr.body ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
    const kept = original.filter((l) => out.body?.includes(l)).length;
    let ok = typeof out.body === 'string' && out.body !== pr.body && (original.length === 0 || kept / original.length >= 0.8);
    const name = out.planted?.name;
    const path = out.planted?.path;
    if (ok && kind === 'invented_name') ok = Boolean(name) && norm(name).length >= 6 && !flat(added).includes(norm(name)) && !flat(removed).includes(norm(name)) && search?.find([name])?.has(name) === false && out.body.includes(name);
    if (ok && kind === 'invented_file') ok = Boolean(path) && !pr.files.some((x) => x.path === path || x.path.endsWith('/' + path)) && search?.hasFile(path) === false && out.body.includes(path);
    if (ok && kind === 'removal_as_addition') ok = Boolean(name) && flat(removed).includes(norm(name)) && !flat(added).includes(norm(name)) && out.body.includes(name);
    if (!ok) {
      k.invalid++;
      invalid++;
      return;
    }
    k.valid++;
    const before = newFindings(run(pr, pr.body));
    const after = newFindings(run(pr, out.body));
    const fresh = after.filter((a) => !before.some((b) => b.message === a.message));
    const target = name ?? path;
    const hit = target ? fresh.filter((a) => norm(a.message + ' ' + (a.data?.names ?? '')).includes(norm(target))) : fresh;
    if (hit.length) {
      k.caught++;
      if (hit.some((a) => a.severity === 'error')) k.sentBack++;
    } else missed.push(`${kind} ${p.owner}/${p.repo}#${p.number}: ${(target ?? out.planted?.claim ?? out.planted?.number ?? '').toString().slice(0, 70)}`);
  });
  console.log(`\nPLANTED ERRORS: ${which} half (${invalid} written statements were invalid and are not counted)`);
  console.log('  kind                  valid  caught  sent back');
  for (const [kind, k] of Object.entries(kinds)) console.log(`  ${kind.padEnd(20)} ${String(k.valid).padStart(6)}  ${String(k.caught).padStart(6)}  ${String(k.sentBack).padStart(9)}   (${pct(k.caught, k.valid)} caught, ${pct(k.sentBack, k.valid)} sent back)`);
  if (flag('misses') || which === 'dev') {
    console.log('\n  not caught:');
    for (const m of missed.slice(0, 60)) console.log(`   ${m}`);
  }
  return kinds;
}

const result = { split: which, falseAlarms: flag('planted-only') ? null : falseAlarms(), planted: flag('planted') || flag('planted-only') ? planted() : null };
if (flag('json')) console.log(JSON.stringify(result, null, 2));
