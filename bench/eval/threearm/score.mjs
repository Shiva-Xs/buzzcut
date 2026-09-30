// Scores the three arms' descriptions with no model: both checkers on every output, invented
// names and figures, and how many of the author's own facts each one kept.
//   npm run build && node bench/eval/threearm/score.mjs
//
// The lookups are this branch's, so arm B was steered by the same detector that measures it here.
// Compare A with C for an unsteered reading; B against A shows what steering by it did.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const NEW = await import('../../../dist/index.js');
const OLD = await import(pathToFileURL(here('old/node_modules/buzzcut/dist/index.js')).href);
const manifest = JSON.parse(readFileSync(here('manifest.json'), 'utf8'));
const words = (s) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’_.-]*/gu) ?? []).length;
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : 'n/a');

const split = (raw) => {
  const t = raw.replace(/\r\n/g, '\n');
  const nl = t.indexOf('\n');
  return { title: (nl === -1 ? t : t.slice(0, nl)).trim(), body: nl === -1 ? '' : t.slice(nl + 1).replace(/^\n+/, '') };
};
const diffOf = (lib, d, withLines) =>
  lib.buildDiff(d.files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions, ...(f.renamed ? { renamed: true } : {}), ...(withLines && f.patch ? { added: f.added, removed: f.removed } : {}) })), { additions: d.additions, deletions: d.deletions }, d.files.length < d.changedFiles);
const TESTED = /^\s*(?:[-*+]\s+)?(?:\*\*)?(?:not tested|tested|verified|test plan|testing)\b/im;
const LOOKUP = new Set(['unsourced-name', 'unsourced-fact', 'unmentioned-area']);
const SHAPE = ['template-on-tiny', 'diff-echo', 'bold-spam', 'emoji', 'ai-vocab', 'ai-opener', 'ai-closer', 'bullet-bloat', 'long-bullet', 'ticked-boxes'];

function scoreOne(arm, m) {
  const d = JSON.parse(readFileSync(here(`data/${m.id}.json`), 'utf8'));
  const notes = readFileSync(here(`prs/${m.id}/notes.md`), 'utf8');
  const raw = arm === 'orig' ? `${d.title}\n\n${notes}` : readFileSync(here(`out/${arm}/${m.id}.md`), 'utf8');
  const { title, body } = split(raw);
  const oldR = OLD.analyze(OLD.prMessage(title, body), diffOf(OLD, d, false));
  const newR = NEW.analyze(NEW.prMessage(title, body), diffOf(NEW, d, true), { repo: NEW.gitRepoSearch(d.snapshot) });
  const kept = NEW.evidenceOf(`${d.title}\n${notes}`);
  const dropped = NEW.droppedEvidence(kept, `${title}\n${body}`);
  const diffText = d.files.map((f) => `${f.added ?? ''}\n${f.removed ?? ''}`).join('\n').toLowerCase();
  const source = `${notes}\n${diffText}\n${d.title}`.toLowerCase();
  const figures = NEW.factsIn(body.split('\n').map((text, i) => ({ n: i + 1, text })));
  const badFigures = figures.filter((f) => !source.includes(f.text.toLowerCase().replace(/\s/g, '')) && !source.replace(/\s/g, '').includes(f.text.toLowerCase().replace(/\s/g, '')));
  const names = newR.findings.filter((f) => f.rule === 'unsourced-name');
  return {
    arm, id: m.id, size: m.size, words: words(body),
    oldBlocked: !OLD.passes(oldR, 35), newBlocked: !NEW.passes(newR, 35),
    oldScore: oldR.score, newScore: newR.score,
    rules: newR.findings.map((f) => `${f.rule}:${f.severity[0]}`),
    lookupNotes: newR.findings.filter((f) => LOOKUP.has(f.rule) && f.severity !== 'info').length,
    inventedNames: names.filter((f) => f.severity !== 'info').reduce((n, f) => n + Number(f.data?.count ?? 1), 0),
    nameMsgs: names.filter((f) => f.severity !== 'info').map((f) => f.message.slice(0, 140)),
    shape: newR.findings.filter((f) => SHAPE.includes(f.rule) && f.severity !== 'info').length,
    noWhy: newR.findings.some((f) => f.rule === 'missing-why'),
    thin: newR.findings.some((f) => f.rule === 'thin-description'),
    vague: newR.findings.some((f) => f.rule === 'vague-verification'),
    hasTested: TESTED.test(body),
    keptOf: kept.length, dropped: dropped.length,
    figures: figures.length, badFigures: badFigures.map((f) => f.text),
  };
}

const arms = ['orig', 'A', 'B', 'C'];
const rows = Object.fromEntries(arms.map((a) => [a, manifest.filter((m) => a === 'orig' || existsSync(here(`out/${a}/${m.id}.md`))).map((m) => scoreOne(a, m))]));
writeFileSync(here('out/scores.json'), JSON.stringify(rows, null, 1));

const label = { orig: 'the original PR text (the notes)', A: 'A: skill + published 0.1.2', B: 'B: skill + this branch', C: 'C: plain prompt' };
const cols = arms;
const line = (name, f) => `| ${name} | ${cols.map((a) => f(rows[a])).join(' | ')} |`;
console.log(`| ${cols.map((a) => label[a]).join(' | ').replace(/^/, '')} |`.replace('|', '| measure |'));
console.log(`|---|${cols.map(() => '---').join('|')}|`);
console.log(line('PRs', (r) => r.length));
console.log(line('median words', (r) => median(r.map((x) => x.words))));
console.log(line('sent back by 0.1.2 checker', (r) => `${r.filter((x) => x.oldBlocked).length} (${pct(r.filter((x) => x.oldBlocked).length, r.length)})`));
console.log(line('sent back by this branch\'s checker', (r) => `${r.filter((x) => x.newBlocked).length} (${pct(r.filter((x) => x.newBlocked).length, r.length)})`));
console.log(line('has a Tested / Not tested line', (r) => pct(r.filter((x) => x.hasTested).length, r.length)));
console.log(line('never says why', (r) => pct(r.filter((x) => x.noWhy).length, r.length)));
console.log(line('vague testing ("works locally")', (r) => r.filter((x) => x.vague).length));
console.log(line('shape problems (form, tour, bold, buzzwords)', (r) => r.filter((x) => x.shape > 0).length));
console.log(line('PRs with a name/file the diff and repo lack', (r) => `${r.filter((x) => x.inventedNames > 0).length} (${r.reduce((n, x) => n + x.inventedNames, 0)} names)`));
console.log(line('PRs with a figure not in the notes or diff', (r) => `${r.filter((x) => x.badFigures.length > 0).length} (${r.reduce((n, x) => n + x.badFigures.length, 0)} figures)`));
console.log(line('author facts kept (mean of notes\' numbers, links, refs)', (r) => pct(r.reduce((n, x) => n + (x.keptOf - x.dropped), 0), r.reduce((n, x) => n + x.keptOf, 0))));
for (const a of ['A', 'B', 'C']) {
  const bad = rows[a].filter((x) => x.inventedNames > 0 || x.badFigures.length);
  if (bad.length) console.log(`\n${label[a]}: ${bad.map((x) => `${x.id}${x.nameMsgs.length ? ' [' + x.nameMsgs.map((m) => m.match(/`[^`]+`/g)?.join(' ')).join('; ') + ']' : ''}${x.badFigures.length ? ' figures ' + x.badFigures.join(',') : ''}`).join('  |  ')}`);
}
