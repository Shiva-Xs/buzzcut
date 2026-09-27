// Verbs that commonly open commit subjects. Nouns that double as verbs ("test",
// "log", "release") are left out so "Tests for the parser" isn't flagged.
const BASE = [
  'add', 'fix', 'update', 'remove', 'implement', 'refactor', 'improve', 'create', 'delete', 'rename',
  'move', 'bump', 'upgrade', 'introduce', 'enhance', 'support', 'handle', 'use', 'make', 'allow',
  'prevent', 'replace', 'clean', 'revert', 'optimize', 'simplify', 'extract', 'migrate', 'document',
  'enable', 'disable', 'adjust', 'correct', 'drop', 'ensure', 'convert', 'integrate', 'expose',
  'avoid', 'restore', 'reduce', 'increase', 'switch', 'wrap', 'skip', 'keep', 'show', 'hide',
  'validate', 'parse', 'build', 'write', 'resolve', 'address', 'tweak', 'polish', 'deprecate',
  'unify', 'consolidate', 'streamline', 'modify', 'initialize', 'configure', 'install', 'generate',
  'render', 'fetch', 'stop', 'limit', 'wire', 'inline', 'reorder', 'rework', 'rewrite', 'clarify',
  'change', 'merge', 'bind', 'catch', 'throw', 'split', 'set', 'enforce', 'harden', 'tighten', 'register',
];

const DOUBLE = new Set(['stop', 'drop', 'wrap', 'skip', 'strip', 'swap', 'trim', 'ship', 'plan']);
const IRREGULAR: Record<string, string[]> = {
  make: ['made'],
  keep: ['kept'],
  build: ['built'],
  write: ['wrote', 'written'],
  bind: ['bound'],
  catch: ['caught'],
  throw: ['threw', 'thrown'],
  show: ['shown'],
  hide: ['hid', 'hidden'],
};

function inflect(v: string): string[] {
  const forms: string[] = [];
  const consonantY = /[^aeiou]y$/.test(v);
  // third person
  forms.push(/(s|x|z|ch|sh)$/.test(v) ? v + 'es' : consonantY ? v.slice(0, -1) + 'ies' : v + 's');
  // past
  if (v.endsWith('e')) forms.push(v + 'd');
  else if (consonantY) forms.push(v.slice(0, -1) + 'ied');
  else if (DOUBLE.has(v)) forms.push(v + v.at(-1) + 'ed');
  else if (!['set', 'split'].includes(v)) forms.push(v + 'ed');
  // gerund
  if (v.endsWith('e') && !v.endsWith('ee')) forms.push(v.slice(0, -1) + 'ing');
  else if (DOUBLE.has(v)) forms.push(v + v.at(-1) + 'ing');
  else forms.push(v + 'ing');
  return [...forms, ...(IRREGULAR[v] ?? [])];
}

function pastForms(v: string): string[] {
  const consonantY = /[^aeiou]y$/.test(v);
  const regular = v.endsWith('e') ? v + 'd' : consonantY ? v.slice(0, -1) + 'ied' : DOUBLE.has(v) ? v + v.at(-1) + 'ed' : v + 'ed';
  return [...(['set', 'split'].includes(v) ? [] : [regular]), ...(IRREGULAR[v] ?? [])];
}

// Past forms that are verbs of their own: "Bound retries to 3" means limit, not "bind".
const OWN_VERB = new Set(['bound']);

const TO_BASE = new Map<string, string>();
const PAST = new Set<string>();
for (const v of BASE) {
  for (const f of inflect(v)) if (f !== v && !OWN_VERB.has(f)) TO_BASE.set(f, v);
  for (const f of pastForms(v)) if (!OWN_VERB.has(f)) PAST.add(f);
}
const BASE_SET = new Set(BASE);

/** How a subject's first word is conjugated, or null when it isn't a known verb. */
export function verbForm(word: string): 'imperative' | 'past' | 'other' | null {
  const w = word.toLowerCase();
  if (BASE_SET.has(w)) return 'imperative';
  if (PAST.has(w)) return 'past';
  return TO_BASE.has(w) ? 'other' : null;
}

/** "Added" → "Add", "fixes" → "fix". Returns null when the word is already imperative or unknown. */
export function imperativeOf(word: string): string | null {
  const base = TO_BASE.get(word.toLowerCase());
  if (!base) return null;
  return word[0] === word[0]!.toUpperCase() ? base[0]!.toUpperCase() + base.slice(1) : base;
}

const SIMPLE_PAST: Record<string, string> = { make: 'made', keep: 'kept', build: 'built', write: 'wrote', bind: 'bound', catch: 'caught', throw: 'threw', hide: 'hid' };

/** "Add" → "Added", keeping the capital. */
export function pastOf(word: string): string {
  const w = word.toLowerCase();
  const past = BASE_SET.has(w) ? (SIMPLE_PAST[w] ?? pastForms(w)[0] ?? w) : w;
  return word[0] === word[0]!.toUpperCase() ? past[0]!.toUpperCase() + past.slice(1) : past;
}
