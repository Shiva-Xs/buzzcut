import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding, Severity } from './types.js';

/** Who a failing check blocks. Agents are blocked by default; people only get a warning. */
export type Block = 'agents' | 'always' | 'never';
export type RuleSetting = 'off' | Severity;
/** How much room a description gets: the word range and the bullets allowed scale with it. */
export type Length = 'short' | 'normal' | 'detailed';

/** Each length's scale on the word range and the bullet allowance. Only `normal` is tuned on the benchmark. */
export const LENGTHS: Record<Length, number> = { short: 0.6, normal: 1, detailed: 1.6 };

export interface Config {
  max: number;
  block: Block;
  /** how long descriptions should be; `normal` unless the repo says otherwise */
  length: Length;
  rules: Record<string, RuleSetting>;
  /** subjects matching any of these are skipped entirely */
  ignore: RegExp[];
  /** file the config came from, or null for defaults */
  source: string | null;
}

/** Commits nobody writes by hand, so there's nothing to judge. */
export const DEFAULT_IGNORE: RegExp[] = [
  /^Merge (branch|pull request|remote-tracking branch|tag|commit) /,
  /^Revert "/,
  /^(fixup|squash|amend)! /,
  /^(chore\(deps(-dev)?\): )?[Bb]ump \S+ (from \S+ )?to /,
  /^v?\d+\.\d+\.\d+([-+][\w.]+)?(?:\s+(?:proposal|release|release proposal|release notes|changelog))?$/i,
  // Release PRs and commits: a changelog is the point.
  /^(?:chore\(release\):\s*|release:?\s+|releasing\s+)v?\d+\.\d+/i,
  /\bVersion \d+\.\d+\.\d+\b/,
  // "docs: Add 4.16.1 changelog", "Changelog for v2.3.0": release notes, same as a release.
  /\bv?\d+\.\d+\.\d+\S*\s+(?:changelog|release notes)\b|\b(?:changelog|release notes) (?:for )?v?\d+\.\d+\.\d+/i,
];

// A message fails on any ✗ error (a false claim, an empty or meaningless subject, a form on a
// small diff, extreme bloat) or when prose tells pile up (a score over 35). Length and shape
// warnings count for at most 20 of those points, so on their own they're advice: we cut fluff,
// never facts.
export const DEFAULTS: Config = { max: 35, block: 'agents', length: 'normal', rules: {}, ignore: DEFAULT_IGNORE, source: null };

export class ConfigError extends Error {}

const SETTINGS = new Set(['off', 'info', 'warn', 'error']);
const BLOCKS = new Set(['agents', 'always', 'never']);
const LENGTH_NAMES = Object.keys(LENGTHS);

/**
 * Validate a raw config object. `ruleIds` is the list of known rules, so a typo
 * like "legnth" is an error instead of a silently ignored setting.
 */
export function parseConfig(raw: unknown, source: string, ruleIds: string[]): Config {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ConfigError(`${source}: expected a JSON object`);
  const o = raw as Record<string, unknown>;
  const known = new Set(['$schema', 'max', 'block', 'length', 'rules', 'ignore']);
  for (const k of Object.keys(o)) if (!known.has(k)) throw new ConfigError(`${source}: unknown key "${k}" (expected max, block, length, rules, ignore)`);

  const cfg: Config = { ...DEFAULTS, rules: {}, ignore: [...DEFAULT_IGNORE], source };
  if (o.max !== undefined) {
    if (typeof o.max !== 'number' || o.max < 0 || o.max > 100) throw new ConfigError(`${source}: "max" must be a number from 0 to 100`);
    cfg.max = o.max;
  }
  if (o.block !== undefined) {
    if (typeof o.block !== 'string' || !BLOCKS.has(o.block)) throw new ConfigError(`${source}: "block" must be "agents", "always" or "never"`);
    cfg.block = o.block as Block;
  }
  if (o.length !== undefined) {
    if (typeof o.length !== 'string' || !LENGTH_NAMES.includes(o.length)) throw new ConfigError(`${source}: "length" must be "short", "normal" or "detailed"`);
    cfg.length = o.length as Length;
  }
  if (o.rules !== undefined) {
    if (!o.rules || typeof o.rules !== 'object' || Array.isArray(o.rules)) throw new ConfigError(`${source}: "rules" must be an object`);
    const ids = new Set(ruleIds);
    for (const [id, v] of Object.entries(o.rules)) {
      if (!ids.has(id)) throw new ConfigError(`${source}: unknown rule "${id}". Known rules: ${ruleIds.join(', ')}`);
      if (typeof v !== 'string' || !SETTINGS.has(v)) throw new ConfigError(`${source}: rule "${id}" must be "off", "info", "warn" or "error"`);
      cfg.rules[id] = v as RuleSetting;
    }
  }
  if (o.ignore !== undefined) {
    if (!Array.isArray(o.ignore) || o.ignore.some((p) => typeof p !== 'string')) throw new ConfigError(`${source}: "ignore" must be a list of regex strings`);
    for (const p of o.ignore as string[]) {
      try {
        cfg.ignore.push(new RegExp(p));
      } catch {
        throw new ConfigError(`${source}: "${p}" in "ignore" isn't a valid regex`);
      }
    }
  }
  return cfg;
}

/** `.buzzcut.json` at the repo root, or a "buzzcut" key in package.json. */
export function loadConfig(root: string | null, ruleIds: string[]): Config {
  if (!root) return DEFAULTS;
  const file = join(root, '.buzzcut.json');
  if (existsSync(file)) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      throw new ConfigError(`.buzzcut.json isn't valid JSON: ${(e as Error).message}`);
    }
    return parseConfig(raw, '.buzzcut.json', ruleIds);
  }
  const pkg = join(root, 'package.json');
  if (existsSync(pkg)) {
    try {
      const json = JSON.parse(readFileSync(pkg, 'utf8')) as Record<string, unknown>;
      if (json.buzzcut !== undefined) return parseConfig(json.buzzcut, 'package.json "buzzcut"', ruleIds);
    } catch (e) {
      if (e instanceof ConfigError) throw e;
      // A broken package.json is someone else's problem; fall back to defaults.
    }
  }
  return DEFAULTS;
}

export function isIgnored(subject: string, cfg: Config): boolean {
  return cfg.ignore.some((re) => re.test(subject));
}

/** Drop rules set to "off" and apply severity overrides. */
export function applyRuleSettings(findings: Finding[], rules: Record<string, RuleSetting>): Finding[] {
  const out: Finding[] = [];
  for (const f of findings) {
    const s = rules[f.rule];
    if (s === 'off') continue;
    out.push(s ? { ...f, severity: s } : f);
  }
  return out;
}
