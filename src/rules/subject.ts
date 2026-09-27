// Git conventions for the commit subject / PR title, plus commit-only formatting.
import { quote } from '../text.js';
import { isVague } from '../vague.js';
import { imperativeOf, pastOf, verbForm } from '../verbs.js';
import { subjectCore, type Rule } from './rule.js';

const titleLine = (kind: string) => (kind === 'commit' ? 1 : undefined);

export const subjectLength: Rule = {
  id: 'subject-length',
  kinds: ['commit', 'pr'],
  run({ msg, style }) {
    const len = [...msg.title].length;
    // A repo whose subjects routinely run long has decided that's fine.
    const house = style ? Math.min(100, style.subjectP90) : 0;
    // Long is a warning; only a subject that's clearly broken (a paragraph pasted in) blocks.
    const [warn, error] = msg.kind === 'commit' ? [Math.max(72, house), 150] : [Math.max(80, house), 150];
    if (len <= warn) return null;
    return {
      rule: 'subject-length',
      severity: len > error ? 'error' : 'warn',
      points: len > error ? 8 : 4,
      message: `${msg.kind === 'commit' ? 'Subject' : 'Title'} is ${len} characters (max ${warn})`,
      hint: 'Keep the subject to the change itself. Reasons and details go in the body.',
      line: titleLine(msg.kind),
    };
  },
};

export const emptySubject: Rule = {
  id: 'empty-subject',
  // PR titles can't be empty on GitHub, and `check --kind pr` may be run on a body alone.
  kinds: ['commit'],
  run({ msg }) {
    if (msg.title.trim()) return null;
    return {
      rule: 'empty-subject',
      severity: 'error',
      points: 20,
      message: msg.kind === 'commit' ? 'Empty commit subject' : 'Empty PR title',
      hint: 'Write a one-line summary of the change, in the imperative: "Retry webhook sends on 5xx".',
      line: titleLine(msg.kind),
    };
  },
};

export const subjectMood: Rule = {
  id: 'subject-mood',
  kinds: ['commit', 'pr'],
  run({ msg, style }) {
    const word = subjectCore(msg.title).match(/^[A-Za-z]+/)?.[0];
    if (!word) return null;
    // Imperative is git's convention, but a repo that writes "Added …" has made its choice.
    if (style?.mood === 'past') {
      const base = verbForm(word) === 'imperative' ? word : null;
      if (!base || msg.kind !== 'commit') return null;
      const past = pastOf(base);
      return {
        rule: 'subject-mood',
        severity: 'info',
        points: 1,
        message: `Subjects here are in the past tense ("${past} …")`,
        hint: `Match the history: "${past} …".`,
        line: 1,
        quote: word,
      };
    }
    const fixed = imperativeOf(word);
    if (!fixed) return null;
    // A convention, not a readability problem: "Added retry" reads as well as "Add retry",
    // so it's a quiet note and never costs more than a point.
    return {
      rule: 'subject-mood',
      severity: 'info',
      points: 1,
      message: `"${word}" → "${fixed}"`,
      hint: `git's convention: the subject finishes "If applied, this commit will …", so "${fixed} …", the way git itself writes "Merge branch" and "Revert".`,
      line: titleLine(msg.kind),
      quote: word,
    };
  },
};

export const subjectPeriod: Rule = {
  id: 'subject-period',
  kinds: ['commit'],
  run({ msg }) {
    if (!/[^.]\.$/.test(msg.title.trim())) return null;
    return {
      rule: 'subject-period',
      severity: 'info',
      points: 2,
      message: 'Subject ends with a period',
      hint: 'Drop the trailing period. The subject is a title, not a sentence.',
      line: 1,
    };
  },
};

export const subjectVague: Rule = {
  id: 'subject-vague',
  kinds: ['commit', 'pr'],
  run({ msg }) {
    const core = subjectCore(msg.title);
    if (!core || !isVague(core)) return null;
    // An error, so an agent can't pass by writing less than nothing.
    return {
      rule: 'subject-vague',
      severity: 'error',
      points: 12,
      message: `"${quote(msg.title)}" doesn't say what changed`,
      hint: 'Say what changed and why it matters: "Fix null deref in invoice export", not "fix bug" or "Update export.ts".',
      line: titleLine(msg.kind),
      quote: quote(msg.title),
    };
  },
};

export const blankLine: Rule = {
  id: 'blank-line',
  kinds: ['commit'],
  run({ msg }) {
    const first = msg.body.split('\n')[0] ?? '';
    if (!first.trim()) return null;
    return {
      rule: 'blank-line',
      severity: 'warn',
      points: 4,
      message: 'No blank line after the subject',
      hint: 'Leave line 2 empty. Without it, git and GitHub treat the body as part of the subject.',
      line: 2,
    };
  },
};

export const markdownInCommit: Rule = {
  id: 'markdown-in-commit',
  kinds: ['commit'],
  run({ msg, text }) {
    const inSubject = /^#{1,6}\s|\*\*|__\w/.test(msg.title);
    const n = text.headings.length + text.emojiLed.length + (text.boldLabels >= 2 ? text.boldLabels : 0) + (inSubject ? 2 : 0);
    if (!n) return null;
    const first = inSubject ? { n: 1 } : (text.headings[0] ?? text.emojiLed[0]);
    return {
      rule: 'markdown-in-commit',
      severity: 'warn',
      points: Math.min(12, 4 + 2 * n),
      message: inSubject ? 'Markdown in the subject line' : 'Markdown headers or bold labels in a commit message',
      hint: 'git log shows raw text, so "## Summary" and **bold** show up as literal symbols. Use plain sentences.',
      line: first?.n,
    };
  },
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * A commit is not a changelog. git log is read for why; a list of every class touched is
 * the diff read back as bullets, however accurate. A few bullets ("Also: …") are fine.
 */
/** "- Added X", "- **Retry logic**: …": a bullet that narrates a change rather than stating a fact. */
function narrates(line: string): boolean {
  const t = line.replace(/^\s*(?:[-*+•]|\d{1,2}[.)])\s+/, '');
  if (/^(\*\*|__)[^*_]+?(\*\*|__)\s*[:—–-]|^(\*\*|__)[^*_]+?:(\*\*|__)/.test(t)) return true;
  const word = t.match(/^[A-Za-z]+/)?.[0];
  return Boolean(word && verbForm(word));
}

export const commitChangelog: Rule = {
  id: 'commit-changelog',
  kinds: ['commit'],
  run({ text, diff }) {
    const n = diff?.changedLines;
    const allowed = n != null ? clamp(Math.round(1 + Math.sqrt(n) / 3), 2, 8) : 5;
    // A list of facts (settings and the versions they apply to, files translated) is fine;
    // a list narrating every change ("Added X", "Updated Y") is the diff read back.
    const b = text.bullets.filter((l) => narrates(l.text)).length;
    const labels = text.labels.length;
    if (!(b > Math.max(8, 2 * allowed) || (labels >= 3 && b >= 6))) return null;
    return {
      rule: 'commit-changelog',
      severity: 'error',
      points: 15,
      message: `Commit body is a changelog: ${b} bullets narrating changes${labels ? ` under ${labels} section label${labels === 1 ? '' : 's'}` : ''}`,
      hint: 'Rewrite it the way git log reads best: 1 to 3 lines on what was wrong or needed, then a few plain "- " bullets for the decisions a reviewer would question (with the numbers), and how it was verified. Keep the facts, drop the list of every class; the diff has that.',
      line: (text.labels[0] ?? text.bullets[0])?.n,
      data: { bullets: b, labels },
    };
  },
};

export const subjectRules = [commitChangelog, emptySubject, subjectVague, subjectLength, subjectMood, subjectPeriod, blankLine, markdownInCommit];
