import { groundedRules } from './grounded.js';
import { proseRules } from './prose.js';
import { sourcedRules } from './sourced.js';
import { styleRules } from './style.js';
import { subjectRules } from './subject.js';
import type { Rule } from './rule.js';

export const RULES: Rule[] = [...groundedRules, ...sourcedRules, ...subjectRules, ...styleRules, ...proseRules];
export const RULE_IDS: string[] = RULES.map((r) => r.id);
export type { Rule, Context } from './rule.js';
