// Prose tells: vocabulary and formatting habits of generated text.
// These overlap with every "humanizer" out there, so they're deliberately light.
// Several patterns follow Wikipedia's "Signs of AI writing" field guide.
import { LENGTHS } from '../config.js';
import { latinShare, quote } from '../text.js';
import { hits, lineOf, titleAndBody, type Rule } from './rule.js';

export const VOCAB = new RegExp(
  '\\b(?:' +
    [
      'comprehensive', 'robust(?:ness)?', 'seamless(?:ly)?', 'leverag(?:e|es|ed|ing)', 'utiliz(?:e|es|ed|ing|ation)',
      'delv(?:e|es|ing)', 'streamlin(?:e|es|ed|ing)', 'facilitat(?:e|es|ed|ing)', 'pivotal', 'crucial',
      'meticulous(?:ly)?', 'holistic', 'cutting-edge', 'state-of-the-art', 'game-chang(?:er|ing)',
      'elevat(?:e|es|ed|ing)', 'empower(?:s|ed|ing)?', 'bolster(?:s|ed|ing)?', 'underscor(?:e|es|ed|ing)',
      'showcas(?:e|es|ed|ing)', 'intricate', 'tapestry', 'realm', 'paramount', 'noteworthy', 'furthermore',
      'moreover', 'additionally', 'enhanc(?:e|es|ed|ing|ement|ements)', 'effortless(?:ly)?', 'synerg(?:y|ies)',
      'revolutioni[sz](?:e|es|ed|ing)', 'unparalleled', 'invaluable', 'foster(?:s|ed|ing)?',
      'best practices', 'a wide range of', "it(?:'|’)?s worth noting", 'it is (?:important|worth) (?:to note|noting)',
      'plays? a (?:crucial|key|vital|pivotal) role', 'key (?:improvements|changes|features|benefits)',
    ].join('|') +
    ')\\b',
  'gi',
);

export const aiVocab: Rule = {
  id: 'ai-vocab',
  kinds: ['commit', 'pr'],
  run(ctx) {
    const seen = new Map<string, number>();
    let total = 0;
    let firstLine: number | undefined;
    for (const line of titleAndBody(ctx)) {
      for (const m of line.text.matchAll(VOCAB)) {
        const w = m[0].toLowerCase();
        seen.set(w, (seen.get(w) ?? 0) + 1);
        total++;
        firstLine ??= lineOf(line);
      }
    }
    if (!total) return null;
    const uniq = [...seen.keys()];
    const points = Math.min(24, 3 * uniq.length + (total - uniq.length));
    const shown = uniq.slice(0, 4).map((w) => `"${w}"`).join(', ');
    return {
      rule: 'ai-vocab',
      severity: points >= 6 ? 'warn' : 'info',
      points,
      message: `AI vocabulary: ${shown}${uniq.length > 4 ? ` +${uniq.length - 4} more` : ''}`,
      hint: 'Use the plain word ("use", not "leverage"), or say the specific thing instead.',
      line: firstLine,
      data: { words: uniq.slice(0, 3).join(', '), count: total },
    };
  },
};

export const OPENER =
  /^\s*(?:this (?:pr|pull request|commit|change|changeset|mr|merge request) (?:introduces|adds|implements|refactors|updates|improves|enhances|addresses|aims|provides|includes|makes|delivers|brings)\b|in this (?:pr|pull request|commit)\b)/i;

export const aiOpener: Rule = {
  id: 'ai-opener',
  kinds: ['commit', 'pr'],
  run({ text }) {
    const h = hits(text.lines.slice(0, 12), OPENER)[0];
    if (!h) return null;
    const q = quote(h.match);
    return {
      rule: 'ai-opener',
      severity: 'warn',
      points: 6,
      message: `Opens with "${q}…"`,
      hint: 'Start with the change itself: "Retry webhook sends on 5xx so …".',
      line: h.line.n,
      quote: q,
    };
  },
};

export const CLOSER =
  /^\s*(?:overall,|in summary|in conclusion|to summarize|to sum up|these changes (?:improve|enhance|ensure|make|provide|help|should|will)|this (?:change|pr|update|commit) (?:ensures|improves|enhances|makes|provides|helps|should)|(?:please )?let me know if|feel free to|happy to (?:address|make|adjust|discuss))/i;

export const aiCloser: Rule = {
  id: 'ai-closer',
  kinds: ['commit', 'pr'],
  run({ text }) {
    // The first sentence opens the description; it can't also be the wrap-up ("This PR ensures…").
    const first = text.lines.find((l) => l.text.trim() && !text.headings.includes(l));
    const h = hits(text.lines, CLOSER, (l) => l === first)[0];
    if (!h) return null;
    const q = quote(h.match);
    return {
      rule: 'ai-closer',
      severity: 'warn',
      points: 6,
      message: `Wrap-up sentence: "${q}…"`,
      hint: 'Delete the conclusion. The reader just read the description.',
      line: h.line.n,
      quote: q,
    };
  },
};

export const CHATBOT =
  /\b(?:i hope this helps|as an ai\b|as a (?:large )?language model|great question|here(?:'s| is) (?:a|the|your) (?:summary|pr description|pull request description|commit message)|certainly[!,]|absolutely[!,]|i've (?:made|implemented) the (?:following )?changes)/i;

export const chatbotLeftovers: Rule = {
  id: 'chatbot-leftovers',
  kinds: ['commit', 'pr'],
  run(ctx) {
    const h = hits(titleAndBody(ctx), CHATBOT)[0];
    if (!h) return null;
    const q = quote(h.match);
    return {
      rule: 'chatbot-leftovers',
      severity: 'error',
      points: 15,
      message: `Chatbot voice left in: "${q}"`,
      hint: 'Delete it. That line was written to you, not to the reviewer.',
      line: lineOf(h.line),
      quote: q,
    };
  },
};

export const emoji: Rule = {
  id: 'emoji',
  kinds: ['commit', 'pr'],
  run({ text }) {
    const led = text.emojiLed.length;
    if (led) {
      return {
        rule: 'emoji',
        severity: 'warn',
        points: Math.min(14, 4 + 2 * led),
        message: `${led} header${led > 1 ? 's' : ''} or bullet${led > 1 ? 's' : ''} led by an emoji`,
        hint: 'Drop the decorative emoji. ✨ and 🚀 add nothing a reviewer can use.',
        line: text.emojiLed[0]!.n,
        data: { count: led },
      };
    }
    if (text.emoji < 4) return null;
    return {
      rule: 'emoji',
      severity: 'info',
      points: 4,
      message: `${text.emoji} emoji`,
      hint: 'Drop the decorative emoji.',
      data: { count: text.emoji },
    };
  },
};

export const boldSpam: Rule = {
  id: 'bold-spam',
  kinds: ['pr'],
  run({ text }) {
    if (text.boldLabels < 3 && text.bold < 6) return null;
    return {
      rule: 'bold-spam',
      severity: 'warn',
      points: Math.min(12, 3 + text.boldLabels + Math.floor(text.bold / 2)),
      message:
        text.boldLabels >= 3 ? `${text.boldLabels} "**Label**: …" bullets` : `${text.bold} bold phrases`,
      hint: 'When everything is bold, nothing is. Bold one thing at most: the part the reviewer must not miss.',
      data: { count: Math.max(text.bold, text.boldLabels) },
    };
  },
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export const bulletBloat: Rule = {
  id: 'bullet-bloat',
  kinds: ['commit', 'pr'],
  run({ msg, text, diff, length }) {
    const b = text.bullets.length;
    const n = diff?.changedLines;
    // Any PR may have five: the changes a reviewer would ask about, one per bullet.
    const base =
      msg.kind === 'pr'
        ? n != null ? clamp(Math.round(2 + Math.sqrt(n) / 1.5), 5, 15) : 8
        : n != null ? clamp(Math.round(1 + Math.sqrt(n) / 3), 2, 8) : 5;
    const allowed = Math.max(2, Math.round(base * LENGTHS[length]));
    if (b <= allowed) return null;
    return {
      rule: 'bullet-bloat',
      severity: 'warn',
      points: Math.min(20, 2 * (b - allowed)),
      message: n != null ? `${b} bullet points for a ${n}-line diff (max ${allowed})` : `${b} bullet points (max ${allowed})`,
      hint:
        msg.kind === 'pr'
          ? `Keep the bullets a reviewer would ask about (${allowed} at most here): each a behavior change, where to look, and the values. Group the rest by area or drop it; the diff lists the files.`
          : 'Keep the bullets for the parts of the change a reviewer would ask about; git log reads the rest better as a sentence or two.',
      line: text.bullets[0]!.n,
      data: { count: b, allowed, lines: n ?? 0 },
    };
  },
};

// A bullet is one change: what, where, and the values, in about 25 words. Past 40 it's a
// paragraph with a dash in front, usually two changes and the reasoning run together.
const LONG_BULLET = 40;

export const longBullet: Rule = {
  id: 'long-bullet',
  kinds: ['commit', 'pr'],
  run({ text }) {
    const long = text.bullets.map((line, i) => ({ line, words: text.bulletWords[i]! })).filter((b) => b.words > LONG_BULLET);
    if (!long.length) return null;
    const longest = Math.max(...long.map((b) => b.words));
    return {
      rule: 'long-bullet',
      severity: 'info',
      points: Math.min(6, 2 * long.length),
      message: long.length === 1 ? `A ${longest}-word bullet` : `${long.length} bullets over ${LONG_BULLET} words (longest ${longest})`,
      hint: 'One change per bullet, about 25 words: what changed, where, and the values. Split a bullet that holds two changes, and move the reasoning into the opening.',
      line: long[0]!.line.n,
      data: { count: long.length, longest },
    };
  },
};

export const emDash: Rule = {
  id: 'em-dash',
  kinds: ['commit', 'pr'],
  run({ msg, text }) {
    const min = msg.kind === 'commit' ? 2 : 3;
    if (text.emDashes < min) return null;
    // Em dashes are ordinary punctuation in Russian and other languages.
    if (latinShare(text.lines.map((l) => l.text).join('\n')) < 0.5) return null;
    return {
      rule: 'em-dash',
      severity: 'info',
      points: 3,
      message: `${text.emDashes} em dashes`,
      hint: 'Use a period or a comma. Stacked em dashes are a well-known generated-text tell.',
      data: { count: text.emDashes },
    };
  },
};

export const proseRules = [chatbotLeftovers, aiOpener, aiCloser, aiVocab, bulletBloat, longBullet, emoji, boldSpam, emDash];
