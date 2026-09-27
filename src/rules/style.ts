// Rules that compare a subject with how this repo already writes them.
// They only run when the repo has enough history (see style.ts) and stay low-weight:
// matching the house style is polish, not the point.
import { CONVENTIONAL, TICKET } from '../style.js';
import { subjectCore, type Rule } from './rule.js';

const pct = (x: number) => `${Math.round(x * 100)}%`;

export const styleConvention: Rule = {
  id: 'style-convention',
  kinds: ['commit', 'pr'],
  run({ msg, style }) {
    if (!style || !msg.title) return null;
    const line = msg.kind === 'commit' ? 1 : undefined;
    const conv = msg.title.match(CONVENTIONAL);
    if (!conv && style.conventional >= 0.6) {
      const types = style.types.slice(0, 4).join(', ');
      return {
        rule: 'style-convention',
        severity: msg.kind === 'commit' ? 'warn' : 'info',
        points: msg.kind === 'commit' ? 4 : 2,
        message: `This repo uses conventional commits (${pct(style.conventional)} of recent subjects) but this one has no prefix`,
        hint: `Start with a type like the rest of the history${types ? ` (${types})` : ''}, e.g. "${style.types[0] ?? 'fix'}: …".`,
        line,
      };
    }
    if (conv && style.conventional <= 0.1) {
      return {
        rule: 'style-convention',
        severity: 'info',
        points: 2,
        message: `"${conv[0].trim()}" prefix, but this repo doesn't use conventional commits (${pct(style.conventional)})`,
        hint: 'Drop the prefix to match the history.',
        line,
      };
    }
    if (conv && style.conventional >= 0.6 && style.types.length >= 3) {
      const type = conv[1]!.toLowerCase();
      if (!style.types.includes(type)) {
        return {
          rule: 'style-convention',
          severity: 'info',
          points: 2,
          message: `"${type}:" isn't a type this repo uses`,
          hint: `Use one of the types in the history: ${style.types.slice(0, 6).join(', ')}.`,
          line,
        };
      }
    }
    return null;
  },
};

export const styleCase: Rule = {
  id: 'style-case',
  kinds: ['commit'],
  run({ msg, style }) {
    if (!style) return null;
    const first = subjectCore(msg.title)[0];
    if (!first || !/\p{L}/u.test(first)) return null;
    const upper = first !== first.toLowerCase();
    if (!upper && style.capitalized >= 0.85) {
      return {
        rule: 'style-case',
        severity: 'info',
        points: 2,
        message: `Subjects here start with a capital letter (${pct(style.capitalized)}); this one doesn't`,
        hint: 'Capitalize the first word to match the history.',
        line: 1,
      };
    }
    if (upper && style.capitalized <= 0.15) {
      return {
        rule: 'style-case',
        severity: 'info',
        points: 2,
        message: `Subjects here start lowercase (${pct(1 - style.capitalized)}); this one doesn't`,
        hint: 'Lowercase the first word to match the history.',
        line: 1,
      };
    }
    return null;
  },
};

export const styleTicket: Rule = {
  id: 'style-ticket',
  kinds: ['commit'],
  run({ msg, style }) {
    if (!style || style.ticket < 0.6 || TICKET.test(msg.title) || /\b[A-Z][A-Z0-9]+-\d+\b/.test(msg.title)) return null;
    return {
      rule: 'style-ticket',
      severity: 'warn',
      points: 3,
      message: `Most subjects here start with a ticket id (${pct(style.ticket)}, e.g. ${style.ticketExample})`,
      hint: 'Add the ticket id from the task or branch name.',
      line: 1,
    };
  },
};

export const styleRules = [styleConvention, styleCase, styleTicket];
