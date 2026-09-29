// A description that never mentions where most of the change is. "Add AGENTS.md" on a diff that
// is mostly a new I2C module reads tidy and misleads. Advice only, never a send-back: a change
// can be described without naming its folder, and this can't tell a passing mention from none.
// It was tried once as a rule and dropped for exactly that, so the match is loose (folder,
// file names, or a name from that area's own lines) and it needs a big, lopsided change to speak.
import { areaOf, generatedFile } from '../diff.js';
import { codeShapedNames, norm } from '../lookup.js';
import type { Rule } from './rule.js';

/** The share of the counted lines one area needs before its absence is worth saying. */
export const SHARE = 0.4;
/** A change smaller than this is described in a sentence; nobody needs a map of it. */
export const MIN_LINES = 60;

// Folder and file words that name nothing: an area called "src/core" isn't mentioned by saying "core".
const GENERIC = new Set(
  'src lib libs app apps pkg packages internal cmd core common shared util utils helper helpers index main mod test tests spec specs type types dist build config configs component components model models service services module modules public static assets scripts tools tool misc other base default'.split(' '),
);

/** One word is the other with an ending: payment/payments, bus/buses, driver/drivers, but not cat/category. */
const alike = (a: string, b: string) => {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 3 && long.startsWith(short) && short.length / long.length >= 0.6;
};

/** The words that name an area: its folders and its files, without generic ones. */
function termsOf(paths: string[]): Set<string> {
  const out = new Set<string>();
  for (const p of paths) {
    for (const seg of p.replace(/\.[A-Za-z0-9]+$/, '').split('/')) {
      for (const w of seg.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/)) {
        if (w.length >= 3 && !GENERIC.has(w)) out.add(w);
      }
    }
  }
  return out;
}

export const unmentionedArea: Rule = {
  id: 'unmentioned-area',
  kinds: ['pr'],
  needsDiff: true,
  run({ diff, msg, text }) {
    const d = diff!;
    if (d.truncated) return null;
    const isTest = new Set(d.tests.map((f) => f.path));
    // Tests and generated files are left out; docs stay in, because the small part a description
    // talks about is often a doc ("Add AGENTS.md") on a diff that is mostly something else.
    const counted = d.files.filter((f) => !generatedFile(f) && !isTest.has(f.path) && f.additions + f.deletions > 0);
    const total = counted.reduce((n, f) => n + f.additions + f.deletions, 0);
    if (total < MIN_LINES) return null;

    const by = new Map<string, typeof counted>();
    for (const f of counted) by.set(areaOf(f.path), [...(by.get(areaOf(f.path)) ?? []), f]);
    const [area, files] = [...by.entries()].sort((a, b) => b[1].reduce((n, f) => n + f.additions + f.deletions, 0) - a[1].reduce((n, f) => n + f.additions + f.deletions, 0))[0]!;
    const lines = files.reduce((n, f) => n + f.additions + f.deletions, 0);
    if (area === '(root)' || lines / total < SHARE) return null;

    const terms = termsOf(files.map((f) => f.path));
    if (!terms.size) return null; // nothing that names it: stay quiet rather than guess

    const prose = [msg.title, ...text.lines.map((l) => l.text)].join('\n');
    const said = [...new Set(prose.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3))];
    for (const t of terms) if (said.some((w) => alike(t, w))) return null;
    // …or one of its files by name, whatever the length of the stem
    const lowered = prose.toLowerCase();
    if (files.some((f) => lowered.includes(f.path.split('/').pop()!.toLowerCase()))) return null;
    // …or a name that lives in that area's own lines
    const own = norm(files.map((f) => `${f.added ?? ''}\n${f.removed ?? ''}`).join('\n'));
    if (own && codeShapedNames(prose).some((n) => own.includes(norm(n)))) return null;
    // …or the whole diff sits in this one area, so naming any of it is naming it
    if (by.size === 1) return null;

    const pct = Math.round((100 * lines) / total);
    return {
      rule: 'unmentioned-area',
      severity: 'warn',
      points: 6,
      message: `${pct}% of the changed lines (${lines} in ${files.length} file${files.length === 1 ? '' : 's'}) are in ${area}, and the description never mentions it`,
      hint: `Say what changed in ${area}, or say plainly that the branch carries it. A description of the smaller part reads as the whole change.`,
      data: { area, lines, share: pct },
    };
  },
};

export const coverageRules = [unmentionedArea];
