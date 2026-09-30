// Scores the arms' descriptions with no model: this branch's checker on every one, invented names and
// figures, testing claims the notes don't back, and how many of the author's numbers, links and refs
// each one kept.
//   node bench/eval/v3/score.mjs <set>[,<set>...] [<arm>,<arm>,...]     e.g. devR,devT D,C,B0,B
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const NEW = await import('../../../dist/index.js');
const sets = (process.argv[2] ?? 'devR,devT').split(',');
const arms = (process.argv[3] ?? 'D,C,B0,B').split(',');
const words = (s) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’_.-]*/gu) ?? []).length;
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : 'n/a');
const split = (raw) => {
  const t = raw.replace(/\r\n/g, '\n');
  const nl = t.indexOf('\n');
  return { title: (nl === -1 ? t : t.slice(0, nl)).trim(), body: nl === -1 ? '' : t.slice(nl + 1).replace(/^\n+/, '') };
};
const TESTED = /^\s*(?:[-*+]\s+)?(?:\*\*)?(?:not tested|tested|verified|test plan|testing)\b/im;
const LOOKUP = new Set(['unsourced-name', 'unsourced-fact', 'unmentioned-area']);
const SHAPE = ['template-on-tiny', 'diff-echo', 'bold-spam', 'emoji', 'ai-vocab', 'ai-opener', 'ai-closer', 'bullet-bloat', 'long-bullet', 'ticked-boxes'];
// A claim that something was tested or run. Lines that say it wasn't are skipped.
const CLAIM = /\b(?:tested|verified|all tests? (?:pass|passed)|tests? (?:pass|passed)|passes? (?:locally|ci)|ran (?:the )?(?:tests?|suite)|works? locally|confirmed (?:that|working|it))\b/i;
const NEGATED = /\b(?:not|never|untested|wasn'?t|isn'?t|haven'?t|hasn'?t|no)\b[^.\n]{0,30}\b(?:tested|run|verified|checked)\b|\buntested\b|\bnot tested\b/i;
const claimsTesting = (text) => text.split('\n').some((l) => CLAIM.test(l) && !NEGATED.test(l));

function scoreOne(set, arm, m) {
  const d = JSON.parse(readFileSync(here(`data/${set.slice(0, -1)}/${m.id}.json`), 'utf8'));
  const notes = readFileSync(here(`sets/${set}/${m.id}/notes.md`), 'utf8');
  const { title, body } = split(readFileSync(here(`out/${set}/${arm}/${m.id}.md`), 'utf8'));
  const files = d.files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions, ...(f.renamed ? { renamed: true } : {}), ...(f.patch ? { added: f.added, removed: f.removed } : {}) }));
  const diff = NEW.buildDiff(files, { additions: d.additions, deletions: d.deletions }, d.files.length < d.changedFiles);
  const r = NEW.analyze(NEW.prMessage(title, body), diff, { repo: NEW.gitRepoSearch(d.snapshot) });
  const kept = NEW.evidenceOf(notes);
  const dropped = NEW.droppedEvidence(kept, `${title}\n${body}`);
  const diffText = d.files.map((f) => `${f.added ?? ''}\n${f.removed ?? ''}`).join('\n').toLowerCase();
  const source = `${notes}\n${diffText}\n${d.title}`.toLowerCase().replace(/\s/g, '');
  const figures = NEW.factsIn(body.split('\n').map((text, i) => ({ n: i + 1, text })));
  const badFigures = figures.filter((f) => !source.includes(f.text.toLowerCase().replace(/\s/g, '')));
  const names = r.findings.filter((f) => f.rule === 'unsourced-name' && f.severity !== 'info');
  return {
    arm, id: m.id, size: m.size, words: words(body), blocked: !NEW.passes(r, 35), yap: r.score,
    lookupNotes: r.findings.filter((f) => LOOKUP.has(f.rule) && f.severity !== 'info').length,
    inventedNames: names.reduce((n, f) => n + Number(f.data?.count ?? 1), 0),
    shape: r.findings.filter((f) => SHAPE.includes(f.rule) && f.severity !== 'info').length,
    noWhy: r.findings.some((f) => f.rule === 'missing-why'),
    hasTested: TESTED.test(body),
    phantomTest: claimsTesting(`${title}\n${body}`) && !claimsTesting(notes),
    keptOf: kept.length, dropped: dropped.length, badFigures: badFigures.length,
  };
}

const all = {};
for (const set of sets) {
  const manifest = JSON.parse(readFileSync(here(`manifest-${set.slice(0, -1)}.json`), 'utf8'));
  for (const arm of arms) all[`${set}/${arm}`] = manifest.filter((m) => existsSync(here(`out/${set}/${arm}/${m.id}.md`))).map((m) => scoreOne(set, arm, m));
}
writeFileSync(here(`out/scores-${sets.join('-')}.json`), JSON.stringify(all, null, 1));
const cell = (rows, f) => f(rows);
for (const set of sets) {
  console.log(`\n### ${set}`);
  console.log(`| measure | ${arms.join(' | ')} |\n|---|${arms.map(() => '---').join('|')}|`);
  const line = (name, f) => console.log(`| ${name} | ${arms.map((a) => cell(all[`${set}/${a}`], f)).join(' | ')} |`);
  line('PRs', (r) => r.length);
  line('median words', (r) => median(r.map((x) => x.words)));
  line('mean yap score', (r) => mean(r.map((x) => x.yap)).toFixed(1));
  line('sent back by this branch', (r) => `${r.filter((x) => x.blocked).length} (${pct(r.filter((x) => x.blocked).length, r.length)})`);
  line('has a Tested / Not tested line', (r) => pct(r.filter((x) => x.hasTested).length, r.length));
  line('claims testing the notes do not', (r) => `${r.filter((x) => x.phantomTest).length} (${pct(r.filter((x) => x.phantomTest).length, r.length)})`);
  line('shape problems (form, tour, bold, buzzwords)', (r) => r.filter((x) => x.shape > 0).length);
  line('PRs with a name/file the diff and repo lack', (r) => r.filter((x) => x.inventedNames > 0).length);
  line('PRs with a figure not in notes or diff', (r) => r.filter((x) => x.badFigures > 0).length);
  line("author's numbers, links, refs kept", (r) => pct(r.reduce((n, x) => n + x.keptOf - x.dropped, 0), r.reduce((n, x) => n + x.keptOf, 0)));
}
