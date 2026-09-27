// What a description says, sentence by sentence: the facts worth keeping (numbers, code,
// errors, links, reasons) and the sentence that says why.
// The roast shows these, the same rule as everywhere else: cut fluff, never facts.
import { WHY } from './rules/grounded.js';
import { CHATBOT, CLOSER, OPENER, VOCAB } from './rules/prose.js';
import { analyzeText, countWords, SPECIFIC } from './text.js';

export interface Kept {
  sentences: string[];
  words: number;
}

interface Sentence {
  text: string;
  words: number;
  /** position in the description, for keeping the original order */
  at: number;
}

const vocab = new RegExp(VOCAB.source, 'i');
const CHECKBOX = /^\s*[-*+]\s+\[[ xX]\]/;
const MARKUP = /^\s*(?:#{1,6}\s+|>\s*|[-*+•]\s+|\d{1,2}[.)]\s+)+/;

/** Markdown links become their text and emphasis markers go; code spans stay as written. */
function plain(line: string): string {
  return line
    .replace(MARKUP, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .split(/(`[^`]*`)/)
    .map((part, i) => (i % 2 ? part : part.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(^|[\s("])[*_](?=\S)|(?<=\S)[*_](?=$|[\s).,;:!?"])/g, '$1')))
    .join('')
    .trim();
}

/**
 * The prose sentences of a description, as plain text, leaving out headings, section labels,
 * checkboxes, tables, code blocks and the repo's template boilerplate.
 */
function sentencesOf(body: string, skip?: Set<string>, min = 4): Sentence[] {
  const text = analyzeText(body, 1, skip);
  const structural = new Set([...text.headings, ...text.labels, ...text.ticked].map((l) => l.n));
  const out: Sentence[] = [];
  for (const line of text.lines) {
    if (structural.has(line.n) || CHECKBOX.test(line.text) || /^\s*\|/.test(line.text)) continue;
    for (const sentence of plain(line.text).split(/(?<=[.!?])\s+(?=[A-Z0-9`"'(])/)) {
      const words = countWords(sentence);
      if (words < min) continue;
      out.push({ text: sentence, words, at: out.length });
    }
  }
  return out;
}

const fluff = (s: string) => OPENER.test(s) || CLOSER.test(s) || CHATBOT.test(s);

/**
 * Numbers, links, issue refs and tickets are facts (2 each). A code span or a path is a
 * weaker hint (1). Naming a file from the diff is the file tour, not a fact (-2).
 */
function evidence(sentence: string, files: Set<string>): number {
  let strong = 0;
  let weak = 0;
  let tour = false;
  for (const m of sentence.matchAll(SPECIFIC)) {
    const name = m[1] ?? m[2];
    if (name === undefined) strong++;
    else if (files.has(name) || files.has(name.split('/').pop()!)) tour = true;
    else weak++;
  }
  return 2 * Math.min(2, strong) + Math.min(1, weak) - (tour ? 2 : 0);
}

function score(sentence: string, files: Set<string>): number {
  let s = evidence(sentence, files);
  if (WHY.test(sentence)) s += 2;
  if (fluff(sentence)) s -= 4;
  if (vocab.test(sentence)) s -= 2;
  if (countWords(sentence) > 50) s -= 1;
  return s;
}

const SHOW = { sentences: 3, words: 70 };

/**
 * The few sentences worth keeping, best first by evidence, shown in their original order.
 * @param budget roughly how many words a good version would have
 * @param files paths in the diff: naming one isn't a fact, the diff already shows it
 * @param skip normalized template lines to leave out
 */
export function worthKeeping(body: string, budget: number, files: Set<string> = new Set(), skip?: Set<string>): Kept {
  const candidates = sentencesOf(body, skip).map((c) => ({ ...c, score: score(c.text, files) }));
  const limit = Math.min(Math.max(budget, 30), SHOW.words);
  const picked: typeof candidates = [];
  let words = 0;
  for (const c of candidates.filter((c) => c.score >= 2).sort((a, b) => b.score - a.score || a.at - b.at)) {
    if (picked.length >= SHOW.sentences || (picked.length && words + c.words > limit)) continue;
    picked.push(c);
    words += c.words;
  }
  picked.sort((a, b) => a.at - b.at);
  return { sentences: picked.map((c) => c.text), words };
}

// ─── why ─────────────────────────────────────────────────────────────────────

// A reason, a cause or a pointer to one. The missing-why rule matches words like "error" or
// "fails" on their own, which is right for not nagging; showing a sentence as *the* why
// needs more: "handles transient failures" is a feature list, not a reason.
const REASON =
  /\b(?:because|since (?!v?\d|last\b|then\b|yesterday\b|the (?:last|first|start|beginning)\b)|so that|so (?:we|it|the|they|you|users?|callers?|reviewers?)\b|in order to|otherwise|previously|used to|(?:had|have|has) to|caus(?:e|ed|es|ing)|crash(?:es|ed|ing)?|broke|breaks|broken|regress(?:ion|ions|ed)|leak(?:s|ed|ing)?|race condition|timed out|timeouts?|deadlock(?:s|ed)?|outages?|incidents?|(?:reported|requested|asked for|needed|required) (?:by|in|on|for|from|to|so)\b|need to|unblocks?|blocked|blocks|panic(?:s|ked)?|flaky|typo|(?:was|were|is|are) (?:wrong|incorrect|missing|broken|stale|slow|stuck|lost|ignored|dropped|duplicated)|can(?:no|')t|couldn't|doesn't|didn't|wasn't|isn't|won't)\b|\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?|refs?|see)\b\s*:?\s*#\d+|(?:^|[\s(\[])#\d+\b|https?:\/\/\S*(?:issues|jira|linear|browse|sentry)/i;
// Ticket ids are case-sensitive: PAY-123 is a ticket, utf-8 is not.
const TICKET_REF = /\b[A-Z][A-Z0-9]+-\d+\b/;
const isReason = (s: string) => REASON.test(s) || TICKET_REF.test(s);
const SYMPTOM = /\b(?:fail(?:s|ed|ing|ures?)?|errors?|exceptions?|bugs?|wrong|incorrect|missing|slow(?:er)?|stuck|stale|hang(?:s|ing)?|hung|drop(?:s|ped)?|lost|loses|duplicat\w*|corrupt\w*|overflow\w*|vulnerab\w*|cve-\d+|deprecat\w*|500s?|50[234]s?|4\d\ds?)\b/i;
// Feature-speak that mentions failures without saying what went wrong.
const HANDLING = /\b(?:error|failure|exception)s? (?:handling|messages?|states?|boundar(?:y|ies))\b|\bhandl(?:e|es|ed|ing) (?:\w+ ){0,2}(?:errors?|failures?|exceptions?|edge cases)\b/i;

// "Modified webhook.ts error path…": narrating the diff, not saying what was wrong.
const NARRATES = /^\W*(?:updat(?:e|ed|es)|modif(?:y|ied|ies)|chang(?:e|ed|es)|add(?:ed|s)?|implement(?:ed|s)?|introduc(?:e|ed|es)|refactor(?:ed|s)?|creat(?:e|ed|es)|remov(?:e|ed|es)|enhanc\w*|improv\w*|leverag\w*)\b/i;

const noCode = (s: string) => s.replace(/`[^`]*`/g, ' ');

function whyScore(s: string): number {
  // A line that's mostly a command or code isn't a reason, whatever words it contains, and a
  // line labeled "What:" says what, by its own account.
  if (countWords(noCode(s)) < 4 || /^\W*what\W*:/i.test(s)) return 0;
  const reason = isReason(noCode(s));
  if (!reason && !SYMPTOM.test(noCode(s))) return 0;
  // A reason stands on its own; a symptom needs something concrete: a number, code, an error.
  let n = reason ? 3 : 2;
  if (/\d|`[^`]+`/.test(s)) n += 1;
  if (!reason && NARRATES.test(s)) n -= 3;
  if (HANDLING.test(s)) n -= 2;
  if (fluff(s)) n -= 4;
  if (vocab.test(s)) n -= 3;
  if (/^\W*why\W*:/i.test(s)) n += 1;
  return n;
}

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1).trimEnd().replace(/[,;:]$/, '') + '…' : s);

/**
 * The sentence that says why the change exists: a reason ("because", "so that", an issue link)
 * or a concrete problem ("fails 2% of the time with 502s"). The earliest strong one wins,
 * since that's where a reader looks. Null when nothing says why.
 */
export function whyOf(title: string, body: string, skip?: Set<string>): string | null {
  let best: { text: string; n: number } | null = null;
  for (const c of sentencesOf(body, skip, 3)) {
    const n = whyScore(c.text);
    if (n >= 3 && (!best || n > best.n + 1)) best = { text: c.text, n };
  }
  if (best) return clip(best.text, 140);
  // A title can carry the reason on its own ("Fix crash when the cart is empty"), but a
  // symptom in a title is usually just the what.
  return isReason(title) && whyScore(title) >= 3 ? title : null;
}
