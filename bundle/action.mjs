// src/ci.ts
import { appendFileSync, existsSync as existsSync5, readFileSync as readFileSync5 } from "fs";

// src/config.ts
import { existsSync, readFileSync } from "fs";
import { join } from "path";
var LENGTHS = { short: 0.6, normal: 1, detailed: 1.6 };
var DEFAULT_IGNORE = [
  /^Merge (branch|pull request|remote-tracking branch|tag|commit) /,
  /^Revert "/,
  /^(fixup|squash|amend)! /,
  /^(chore\(deps(-dev)?\): )?[Bb]ump \S+ (from \S+ )?to /,
  /^v?\d+\.\d+\.\d+([-+][\w.]+)?(?:\s+(?:proposal|release|release proposal|release notes|changelog))?$/i,
  // Release PRs and commits: a changelog is the point.
  /^(?:chore\(release\):\s*|release:?\s+|releasing\s+)v?\d+\.\d+/i,
  /\bVersion \d+\.\d+\.\d+\b/,
  // "docs: Add 4.16.1 changelog", "Changelog for v2.3.0": release notes, same as a release.
  /\bv?\d+\.\d+\.\d+\S*\s+(?:changelog|release notes)\b|\b(?:changelog|release notes) (?:for )?v?\d+\.\d+\.\d+/i
];
var DEFAULTS = { max: 35, block: "agents", length: "normal", rules: {}, ignore: DEFAULT_IGNORE, source: null };
var ConfigError = class extends Error {
};
var SETTINGS = /* @__PURE__ */ new Set(["off", "info", "warn", "error"]);
var BLOCKS = /* @__PURE__ */ new Set(["agents", "always", "never"]);
var LENGTH_NAMES = Object.keys(LENGTHS);
function parseConfig(raw, source, ruleIds) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ConfigError(`${source}: expected a JSON object`);
  const o = raw;
  const known = /* @__PURE__ */ new Set(["$schema", "max", "block", "length", "rules", "ignore"]);
  for (const k of Object.keys(o)) if (!known.has(k)) throw new ConfigError(`${source}: unknown key "${k}" (expected max, block, length, rules, ignore)`);
  const cfg = { ...DEFAULTS, rules: {}, ignore: [...DEFAULT_IGNORE], source };
  if (o.max !== void 0) {
    if (typeof o.max !== "number" || o.max < 0 || o.max > 100) throw new ConfigError(`${source}: "max" must be a number from 0 to 100`);
    cfg.max = o.max;
  }
  if (o.block !== void 0) {
    if (typeof o.block !== "string" || !BLOCKS.has(o.block)) throw new ConfigError(`${source}: "block" must be "agents", "always" or "never"`);
    cfg.block = o.block;
  }
  if (o.length !== void 0) {
    if (typeof o.length !== "string" || !LENGTH_NAMES.includes(o.length)) throw new ConfigError(`${source}: "length" must be "short", "normal" or "detailed"`);
    cfg.length = o.length;
  }
  if (o.rules !== void 0) {
    if (!o.rules || typeof o.rules !== "object" || Array.isArray(o.rules)) throw new ConfigError(`${source}: "rules" must be an object`);
    const ids = new Set(ruleIds);
    for (const [id, v] of Object.entries(o.rules)) {
      if (!ids.has(id)) throw new ConfigError(`${source}: unknown rule "${id}". Known rules: ${ruleIds.join(", ")}`);
      if (typeof v !== "string" || !SETTINGS.has(v)) throw new ConfigError(`${source}: rule "${id}" must be "off", "info", "warn" or "error"`);
      cfg.rules[id] = v;
    }
  }
  if (o.ignore !== void 0) {
    if (!Array.isArray(o.ignore) || o.ignore.some((p) => typeof p !== "string")) throw new ConfigError(`${source}: "ignore" must be a list of regex strings`);
    for (const p of o.ignore) {
      try {
        cfg.ignore.push(new RegExp(p));
      } catch {
        throw new ConfigError(`${source}: "${p}" in "ignore" isn't a valid regex`);
      }
    }
  }
  return cfg;
}
function loadConfig(root, ruleIds) {
  if (!root) return DEFAULTS;
  const file = join(root, ".buzzcut.json");
  if (existsSync(file)) {
    let raw;
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      throw new ConfigError(`.buzzcut.json isn't valid JSON: ${e.message}`);
    }
    return parseConfig(raw, ".buzzcut.json", ruleIds);
  }
  const pkg = join(root, "package.json");
  if (existsSync(pkg)) {
    try {
      const json = JSON.parse(readFileSync(pkg, "utf8"));
      if (json.buzzcut !== void 0) return parseConfig(json.buzzcut, 'package.json "buzzcut"', ruleIds);
    } catch (e) {
      if (e instanceof ConfigError) throw e;
    }
  }
  return DEFAULTS;
}
function isIgnored(subject, cfg) {
  return cfg.ignore.some((re) => re.test(subject));
}
function applyRuleSettings(findings, rules) {
  const out = [];
  for (const f of findings) {
    const s = rules[f.rule];
    if (s === "off") continue;
    out.push(s ? { ...f, severity: s } : f);
  }
  return out;
}

// src/diff.ts
var TEST = [
  // a directory of tests anywhere in the path, hidden ones included (examples/.test/)
  /(^|\/)\.?(__tests__|__mocks__|tests?|specs?|e2e|testdata|test-data|testing|fixtures|cypress|playwright)\//i,
  // foo.test.ts, foo_spec.rb, foo-tests.js
  /[._-](test|spec)s?\.[a-z0-9]+$/i,
  // test_foo.py, testFoo.py, test-utils.js, tests.rs
  /(^|\/)tests?([A-Z_.-][^/]*)?$/,
  // TestFoo.java, FooTest.kt, FooTests.cs, FooIT.java, fooSpec.js
  /(^|\/)Test[A-Z][^/]*$|[a-z0-9](Test|Tests|IT|Spec|Specs)\.[a-z]+$/,
  // foo_test.go, foo_test.py, canvas_unittests.cc, fooUnitTest.cpp
  /_test\.[a-z]+$/i,
  // smoke-pack.mjs, smoke-test.sh: smoke tests, wherever they live
  /(^|\/)smoke[-_][^/]+$/i,
  /[._-]?unit_?tests?\.[a-z0-9]+$/i
];
var INLINE_TESTS = /\.(rs|zig|d)$/;
function hasInlineTests(path) {
  return INLINE_TESTS.test(path);
}
var DOC = /\.(md|mdx|markdown|rst|adoc|txt)$|(^|\/)(docs?|documentation)\/|(^|\/)(README|CHANGELOG|CHANGES|HISTORY|LICENSE|CONTRIBUTING|AUTHORS|NOTICE)(\.[a-z]+)?$/i;
var GENERATED = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|go\.sum|poetry\.lock|Pipfile\.lock|uv\.lock|Gemfile\.lock|composer\.lock|mix\.lock|pubspec\.lock|Podfile\.lock|packages\.lock\.json|gradle\.lockfile|flake\.lock)$|\.(min\.(js|css)|map|pb\.go)$|_pb2\.py$|\.generated\.\w+$/;
var CI = /^\.github\/workflows\/|^\.circleci\/|^\.buildkite\/|(^|\/)(Jenkinsfile|\.gitlab-ci\.ya?ml|azure-pipelines\.ya?ml|\.travis\.ya?ml|appveyor\.ya?ml|cloudbuild\.ya?ml|bitbucket-pipelines\.ya?ml)$/i;
function isCi(path) {
  return CI.test(path);
}
function isGenerated(path) {
  return GENERATED.test(path);
}
var generatedFile = (f) => f.generated === true || isGenerated(f.path);
function isTest(path) {
  return TEST.some((re) => re.test(path));
}
function isDoc(path) {
  return !isTest(path) && DOC.test(path);
}
function buildDiff(files, totals, truncated = false) {
  const additions = totals?.additions ?? files.reduce((n, f) => n + f.additions, 0);
  const deletions = totals?.deletions ?? files.reduce((n, f) => n + f.deletions, 0);
  const tests = files.filter((f) => isTest(f.path));
  const docs = files.filter((f) => isDoc(f.path));
  const source = files.filter((f) => !isTest(f.path) && !isDoc(f.path));
  const generated = files.filter(generatedFile).reduce((n, f) => n + f.additions + f.deletions, 0);
  return { files, additions, deletions, changedLines: Math.max(0, additions + deletions - generated), tests, docs, source, truncated };
}

// src/facts.ts
import { createHash } from "crypto";
import { existsSync as existsSync3, mkdirSync, readFileSync as readFileSync3, rmSync, writeFileSync } from "fs";
import { join as join3, resolve as resolve2 } from "path";

// src/git.ts
import { execFileSync } from "child_process";
import { existsSync as existsSync2, readFileSync as readFileSync2, statSync } from "fs";
import { join as join2, resolve } from "path";
function git(args, cwd) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

// src/facts.ts
var norm = (s) => s.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim().toLowerCase().replace(/[.,;:]+$/, "");
var digits = (s) => s.replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
function droppedEvidence(before, afterText) {
  const now = digits(norm(afterText.replace(/[`*_]/g, "")));
  return before.filter((f) => !now.includes(digits(f)));
}
var TTL = 60 * 60 * 1e3;

// src/template.ts
import { existsSync as existsSync4, readdirSync, readFileSync as readFileSync4, statSync as statSync2 } from "fs";
import { join as join4, relative } from "path";
function normalizeLine(s) {
  return s.replace(/^(\s*[-*+]\s+)\[[xX]\]/, "$1[ ]").replace(/\s+/g, " ").trim().replace(/:$/, "").toLowerCase();
}
function parseTemplate(texts) {
  const lines = /* @__PURE__ */ new Set();
  for (const { text } of texts) {
    const clean = text.replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?-->/g, "");
    for (const l of clean.split("\n")) {
      const n = normalizeLine(l);
      if (n && n.length > 1) lines.add(n);
    }
  }
  return lines.size ? { paths: texts.map((t) => t.path), lines } : null;
}
var TEMPLATE_PATHS = [
  ".github/pull_request_template.md",
  "pull_request_template.md",
  "docs/pull_request_template.md"
];
var TEMPLATE_DIRS = [".github/PULL_REQUEST_TEMPLATE", "PULL_REQUEST_TEMPLATE", "docs/PULL_REQUEST_TEMPLATE"];
function findCaseless(root, rel) {
  let dir = root;
  for (const part of rel.split("/")) {
    if (!existsSync4(dir) || !statSync2(dir).isDirectory()) return null;
    const hit = readdirSync(dir).find((e) => e.toLowerCase() === part.toLowerCase());
    if (!hit) return null;
    dir = join4(dir, hit);
  }
  return dir;
}
function findTemplate(root) {
  if (!root) return null;
  const texts = [];
  for (const rel of TEMPLATE_PATHS) {
    const p = findCaseless(root, rel);
    if (p && statSync2(p).isFile()) {
      texts.push({ path: relative(root, p), text: readFileSync4(p, "utf8") });
      break;
    }
  }
  for (const rel of TEMPLATE_DIRS) {
    const d = findCaseless(root, rel);
    if (!d || !statSync2(d).isDirectory()) continue;
    for (const f of readdirSync(d).filter((f2) => /\.md$/i.test(f2))) {
      texts.push({ path: relative(root, join4(d, f)), text: readFileSync4(join4(d, f), "utf8") });
    }
  }
  return parseTemplate(texts);
}

// src/text.ts
var FENCE = /^\s{0,3}(`{3,}|~{3,})/;
var META = /^\s*(?:[\w-]+-by|change-id):|^\s*(🤖\s*)?generated (with|by) /iu;
var HEADING = /^\s{0,3}#{1,6}\s+\S|^\s*(\*\*|__)[^*_\n]{1,60}(\*\*|__):?\s*$/;
var BULLET = /^\s*([-*+•]|\d{1,2}[.)])\s+\S/;
var LABEL = /^\s*(?:[-*+•]\s+)?[^\s:`][^:`]{0,48}:\s*$/;
var CHECKBOX = /^\s*[-*+]\s+\[[ xX]\]/;
var TICKED = /^\s*[-*+]\s+\[[xX]\]|^\s*(✅|✔️|✔|☑️)/u;
var BOLD = /(\*\*|__)(?=\S)[^*_\n]+?(?<=\S)\1/g;
var BOLD_LABEL = /^\s*([-*+•]|\d{1,2}[.)])\s+(\*\*|__)[^*_\n]+?(\*\*|__)\s*[:—–-]|^\s*([-*+•]|\d{1,2}[.)])\s+(\*\*|__)[^*_\n]+?:(\*\*|__)/;
var EMOJI = new RegExp("\\p{Extended_Pictographic}", "gu");
var NOT_EMOJI = /* @__PURE__ */ new Set(["\xA9", "\xAE", "\u2122", "\u2194", "\u2195", "\u21A9", "\u21AA", "\u25B6", "\u25C0"]);
var LEADING_EMOJI = new RegExp("^\\s*(#{1,6}\\s+|([-*+\u2022]|\\d{1,2}[.)])\\s+)?(\\*\\*|__)?\\p{Extended_Pictographic}", "u");
function countEmoji(s) {
  return (s.match(EMOJI) ?? []).filter((e) => !NOT_EMOJI.has(e)).length;
}
function countWords(s) {
  const t = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/`[^`]*`/g, " x ").replace(/https?:\/\/\S+/g, " x ");
  return (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’_.-]*/gu) ?? []).length;
}
function blankComments(s) {
  return s.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ""));
}
function analyzeText(body, firstLine = 1, skip) {
  const raw = blankComments(body.replace(/\r\n?/g, "\n")).split("\n");
  const lines = [];
  let fence = null;
  raw.forEach((text, i) => {
    const m = text.match(FENCE);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      return;
    }
    if (m) {
      fence = m[1];
      return;
    }
    if (META.test(text)) return;
    if (skip?.has(normalizeLine(text))) return;
    lines.push({ n: firstLine + i, text });
  });
  const facts = {
    lines,
    words: 0,
    headings: [],
    bullets: [],
    bulletWords: [],
    ticked: [],
    emojiLed: [],
    emoji: 0,
    bold: 0,
    boldLabels: 0,
    emDashes: 0,
    tables: 0,
    labels: []
  };
  const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.text;
    if (!t.trim()) continue;
    if (/^\s*\|/.test(t)) {
      if (TABLE_SEP.test(lines[i + 1]?.text ?? "")) facts.tables++;
      continue;
    }
    facts.words += countWords(t);
    const next = lines.slice(i + 1).find((l) => l.text.trim())?.text ?? "";
    if (LABEL.test(t) && countWords(t) <= 5 && (BULLET.test(next) || /^\s{2,}\S/.test(next))) facts.labels.push(line);
    const heading = HEADING.test(t);
    if (heading) facts.headings.push(line);
    if (TICKED.test(t)) facts.ticked.push(line);
    else if (BULLET.test(t) && !CHECKBOX.test(t)) {
      facts.bullets.push(line);
      let words = countWords(t);
      for (let j = i + 1; j < lines.length; j++) {
        const next2 = lines[j].text;
        if (!next2.trim() || BULLET.test(next2) || CHECKBOX.test(next2) || HEADING.test(next2) || /^\s*\|/.test(next2)) break;
        words += countWords(next2);
      }
      facts.bulletWords.push(words);
    }
    if ((heading || BULLET.test(t)) && LEADING_EMOJI.test(t)) facts.emojiLed.push(line);
    facts.emoji += countEmoji(t);
    facts.bold += (t.match(BOLD) ?? []).length;
    if (BOLD_LABEL.test(t)) facts.boldLabels++;
    facts.emDashes += (t.match(/—/g) ?? []).length;
  }
  return facts;
}
var SPECIFIC = new RegExp(
  [
    "`([^`]+)`",
    // code span
    String.raw`\b\d[\d.,]*\s?(?:%|x|×|ms|µs|us|ns|s|sec|kb|mb|gb|k|m)?(?![\w])`,
    // number
    String.raw`(?:^|\s)#\d+\b`,
    // issue ref
    String.raw`\b[A-Z][A-Z0-9]+-\d+\b`,
    // ticket
    String.raw`https?:\/\/\S+`,
    // link
    // Code named in plain text, as commit bodies do: vfs_read(), max_order_usd, EXIT_PLAN_TTL, getUserById
    String.raw`\b[A-Za-z_][\w.]*\(\)`,
    String.raw`\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b`,
    String.raw`\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b`,
    String.raw`\b[a-z]+(?:[A-Z][a-z0-9]*)+\b`,
    // A file name or path outside backticks, as commit bodies write them: worker.js, _redirects:14, /wp-admin/install.php
    String.raw`(?<![\w/.-])(\/?(?:[\w.-]+\/)*[\w-]*\.(?:js|mjs|cjs|ts|tsx|jsx|py|go|rs|java|kt|rb|php|html|css|scss|json|ya?ml|toml|md|txt|sh|sql|env|xml|lock|conf|ini)|\/[\w.-]+(?:\/[\w.*-]+)+)(?::\d+)?(?![\w/])`
  ].join("|"),
  "g"
);
function specificity(lines, words, files = /* @__PURE__ */ new Set()) {
  if (!words) return 0;
  let n = 0;
  for (const l of lines) {
    for (const m of l.text.matchAll(SPECIFIC)) {
      const name = m[1] ?? m[2];
      if (name && (files.has(name) || files.has(name.split("/").pop()))) continue;
      n++;
    }
  }
  return 100 * n / words;
}
function latinShare(s) {
  const letters = s.replace(/`[^`]*`/g, " ").replace(/https?:\/\/\S+/g, " ").match(new RegExp("\\p{L}", "gu")) ?? [];
  if (!letters.length) return 1;
  return letters.filter((c) => new RegExp("\\p{Script=Latin}", "u").test(c)).length / letters.length;
}
function quote(s, max = 60) {
  const t = s.replace(/\s+/g, " ").trim().replace(/^[-*+•>#\s]+/, "").replace(/[*_`]/g, "");
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "\u2026" : t;
}

// src/rules/rule.ts
function hits(lines, re, skip) {
  const out = [];
  for (const line of lines) {
    if (skip?.(line)) continue;
    const m = line.text.match(re);
    if (m) out.push({ line, match: m[0] });
  }
  return out;
}
function titleAndBody(ctx) {
  const title = { n: ctx.msg.kind === "commit" ? 1 : 0, text: ctx.msg.title };
  return [title, ...ctx.text.lines];
}
var lineOf = (l) => l.n > 0 ? l.n : void 0;
var CONVENTIONAL = /^(\w+)(\([^)]*\))?(!)?:\s*/;
var TICKET = /^\[?[A-Z][A-Z0-9]+-\d+\]?:?\s*/;
function conventionalType(title) {
  return title.match(CONVENTIONAL)?.[1]?.toLowerCase() ?? null;
}
function subjectCore(title) {
  return title.replace(TICKET, "").replace(CONVENTIONAL, "").replace(TICKET, "").trim();
}

// src/rules/grounded.ts
var UNCHECKED = /^\s*[-*+]\s+\[ \]/;
var NEGATED = /\b(no|not|without|todo|follow[- ]?up|later|n\/a|none|pending)\b|n't\b/i;
var MODAL = /\b(should|would|could|might|need(?:s)? to|will need|to be (?:added|written)|recommend(?:ed)?|suggest(?:ed)?|consider|please)\b/i;
var EXISTING = /\b(existing|already|pre-?existing|current(?:ly)?|previous(?:ly)?)\b/i;
var notAClaim = (text) => NEGATED.test(text) || MODAL.test(text) || EXISTING.test(text);
function claims(lines, re, skipLine) {
  const out = [];
  for (const line of lines) {
    if (skipLine?.(line)) continue;
    for (const sentence of line.text.split(/(?<=[.!?;])\s+/)) {
      const m = sentence.match(re);
      if (!m) continue;
      const at = m.index ?? 0;
      if (notAClaim(sentence.slice(Math.max(0, at - 30), at + m[0].length + 30))) continue;
      out.push({ line, match: m[0] });
      break;
    }
  }
  return out;
}
var OVERLONG = 2.5;
var length = {
  id: "length",
  kinds: ["commit", "pr"],
  run({ text, budget, diff, msg, density }) {
    const ratio = text.words / budget;
    if (msg.kind === "commit" && density >= 4 && ratio < 3) return null;
    const [flag, weight, cap] = msg.kind === "commit" ? [1.5, 8, 30] : [1.3, 12, 35];
    if (ratio <= flag) return null;
    const what = msg.kind === "commit" ? "Commit body is " : "";
    const dense = density >= 4;
    const blocks = msg.kind === "commit" ? ratio >= 8 && !dense : ratio >= 6 || !dense && ratio >= ((diff?.changedLines ?? Infinity) < 30 ? OVERLONG : 4);
    return {
      rule: "length",
      severity: blocks ? "error" : "warn",
      points: Math.min(cap, Math.round((ratio - 1) * weight / (dense ? 2 : 1))),
      message: diff ? `${what}${text.words} words for a ${diff.changedLines}-line diff (budget ${budget})` : `${what}${text.words} words (budget ${budget}, no diff to compare)`,
      hint: `Cut the padding, not the facts: drop restatements, the file-by-file tour and generic claims, and keep every number, error message, link and name the reviewer needs. Aim for ${budget} words or fewer.`,
      data: { words: text.words, lines: diff?.changedLines ?? 0, budget, ratio: ratio.toFixed(1) }
    };
  }
};
var PURE_FORM = /^(?:(?:pr |pull request )?(?:summary|overview|description|tl;?dr|details)|(?:key |main |code |proposed )?changes?(?: made| summary| overview| in this pr| proposed)?|what(?:'s| has| was)? changed|what (?:this pr|it) does|changes? (?:description|details)|checklist|pre-?launch checklist|screenshots?(?: (?:\/|and|&) (?:videos?|recordings?))?|demo|preview|notes?|additional (?:notes|information|info|context)|impact|benefits|technical (?:details|notes)|implementation(?: details| notes)?|files? (?:changed|modified)|related(?: issues?| prs?| links)?|type of change|dependencies|documentation|future (?:work|improvements)|next steps|references?)$/i;
var CONTENT_FORM = /^(?:motivation(?: (?:and|&) context)?|context|background|why|breaking changes?|risks?(?: (?:and|&) mitigations?)?|rollback(?: plan)?|deployment(?: notes)?|security(?: considerations)?|performance(?: impact)?|approach|solution|problem|fix|issue|result|outcome|scope)$/i;
var VERIFY_FORM = /^(?:tested|not tested|(?:test(?:ing)?|tests?|test plan|how to test|how (?:was|is) (?:this|it) tested|how did you test(?: (?:this|it))?(?: change)?\??|how to verify|verification|validation|qa)(?: (?:plan|steps|instructions|done|performed|notes|results))?)$/i;
var headingText = (line) => line.replace(/^\s{0,3}#{1,6}\s+/, "").replace(/\*\*|__/g, "").replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "").replace(/[:.\s]+$/, "").trim();
function isFormHeading(line) {
  const t = headingText(line);
  return PURE_FORM.test(t) || CONTENT_FORM.test(t) || VERIFY_FORM.test(t);
}
var templateOnTiny = {
  id: "template-on-tiny",
  kinds: ["pr"],
  needsDiff: true,
  run({ text, diff }) {
    const n = diff.changedLines;
    const allowed = n < 30 ? 1 : n < 100 ? 2 : n < 300 ? 3 : 6;
    const form = text.headings.filter((h) => isFormHeading(h.text));
    const counted = form.filter((h) => !VERIFY_FORM.test(headingText(h.text)));
    const excess = counted.length - allowed;
    const pure = form.filter((h) => PURE_FORM.test(headingText(h.text))).length;
    const emojiLed = form.filter((h) => text.emojiLed.includes(h)).length;
    const blocks = form.length - allowed >= 3 && (pure >= 3 || emojiLed >= 3);
    if (excess <= 0 && !blocks) return null;
    return {
      rule: "template-on-tiny",
      severity: blocks ? "error" : "warn",
      points: Math.min(20, 4 + 3 * Math.max(excess, 1)),
      message: `${form.length} template sections on a ${n}-line diff`,
      hint: n < 30 ? "Drop the section headers. On a diff this size, one or two sentences on what changed and why, then a Tested line, say it all." : "Drop the section headers: an opening on what changed and why, a few bullets a reviewer would ask about, and a Tested line. Keep every fact that was under them.",
      line: form[0].n,
      data: { headers: form.length, lines: n }
    };
  }
};
var TEST_NOUN = String.raw`(?<![\w/.-])(?:tests?(?: cases?| coverage| suites?)?|specs?)(?![\w/-]|\.\w)`;
var AUTHOR = String.raw`\b(?:add|adds|added|wr(?:ite|ites|ote|itten)|creat(?:e|es|ed)|introduc(?:e|es|ed)|implement(?:s|ed)?)(?:\/[a-z]+)?`;
var QUALIFIER = String.raw`(?:a|an|the|some|more|several|extra|additional|new|missing|dedicated|focused|basic|initial|proper|comprehensive|a few|a couple of|\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|regression|unit|integration|e2e|end-to-end|smoke|snapshot|property(?:-based)?|fuzz|component|functional|acceptance|api|ui|browser|golden|parameteri[sz]ed|table-driven|and|or)`;
var AUTHORED = new RegExp(String.raw`${AUTHOR}\s+(?:${QUALIFIER}\s+){0,5}(?:[\w-]+\s+){0,2}?(${TEST_NOUN})`, "gi");
var TEST_VERB = String.raw`(?:asserts?|covers?|checks?|verif(?:y|ies)|ensures?|exercises?|reproduces?|confirms?|pins?|guards?|locks?|catch(?:es)?|demonstrates?|proves?)`;
var INTRODUCED = new RegExp(
  String.raw`(?:\b(?:a|an)\s+(?:new\s+)?|\b(?:(?:the|\d+|two|three|four|five|several|some)\s+)?new\s+)(?:${QUALIFIER}\s+){0,2}(?:[\w-]+\s+){0,1}?(${TEST_NOUN})\s+${TEST_VERB}\b`,
  "gi"
);
var LEAD_NEW = new RegExp(String.raw`^\s*(?:[-*+]\s+)?new\s+(?:${QUALIFIER}\s+){0,2}(?:[\w-]+\s+){0,1}?(${TEST_NOUN})`, "gi");
var NOUN_ENDS = /^(?:\s*$|\s*[.,;:!?)(\]—–]|\s+-\s|\s+(?:for|to|that|which|and|or|in|on|around|of|with|under|against|so|as|plus|including|where|when|using|at|across|per|alongside|too|also|now|here|from|by|into|this|these|the|it|we|were|was|are|is|pass|passes|passed|[a-z]+ing)\b)/i;
var BOX = /^\s*(?:[-*+]|\d+[.)])?\s*\[[ xX]\]/;
var SHA_LED = /^\s*(?:[-*+]\s+)?[0-9a-f]{7,40}\b/;
var STRUCK = /~~[^~]*~~/g;
var QUESTION = /\?[\s*_]*$/;
var INSTRUCTION = /\b(?:please|make sure|be sure|remember to|don't forget|do not forget|if (?:you|applicable|needed|relevant|necessary)|when (?:you|applicable))\b/i;
var CODE_SPAN = /`[^`]*`/g;
function authoredTests(text) {
  if (BOX.test(text) || SHA_LED.test(text)) return null;
  const clean = text.replace(STRUCK, " ").replace(CODE_SPAN, "code").replace(/\*\*|__/g, "");
  for (const sentence of clean.split(/(?<=[.!?;])\s+/)) {
    if (QUESTION.test(sentence)) continue;
    for (const re of [AUTHORED, INTRODUCED, LEAD_NEW]) {
      for (const m of sentence.matchAll(re)) {
        const noun = m[1];
        const at = m.index ?? 0;
        const end = at + m[0].length;
        if (/^Spec/.test(noun)) continue;
        if (re !== INTRODUCED && !NOUN_ENDS.test(sentence.slice(end))) continue;
        const near = sentence.slice(Math.max(0, at - 30), end + 30);
        if (NEGATED.test(near) || MODAL.test(near) || INSTRUCTION.test(sentence)) continue;
        return m[0];
      }
    }
  }
  return null;
}
var phantomTests = {
  id: "phantom-tests",
  kinds: ["commit", "pr"],
  needsDiff: true,
  run(ctx) {
    const diff = ctx.diff;
    if (!diff.files.length || diff.tests.length || diff.truncated) return null;
    if (diff.files.some((f) => hasInlineTests(f.path))) return null;
    if (diff.files.every((f) => isCi(f.path))) return null;
    let quoted = false;
    for (const line of titleAndBody(ctx)) {
      if (SHA_LED.test(line.text)) quoted = true;
      else if (line.text.trim() && !/^\s/.test(line.text)) quoted = false;
      if (quoted) continue;
      const match = authoredTests(line.text);
      if (!match) continue;
      const q = quote(match);
      return {
        rule: "phantom-tests",
        severity: "error",
        points: 25,
        message: `Says "${q}" but no test files changed`,
        hint: "Remove the claim or add the tests. If existing tests cover this, name the test and the command you ran.",
        line: lineOf(line),
        quote: q
      };
    }
    return null;
  }
};
var CONCRETE = /`[^`]+`|\b\d+\s*(?:tests?|specs?|passed|passing|failures?|ok)\b|\b(?:all|\d+) of \d+\b/i;
var COMMAND = /\b(?:(?:npm|pnpm|yarn|bun|npx|pnpx|deno)\s+(?:run\s+)?[\w:.-]+|python3?\s+-m\s+\w+|pytest|go (?:test|vet|build)|cargo (?:test|check|build|clippy)|mvn\s+\w+|\.?\/?gradlew?\s+\w+|make\s+\w+|tox|jest|vitest|rspec|phpunit|dotnet (?:test|build)|swift (?:test|build)|xcodebuild|ctest|bazel (?:test|build)|mix test|bundle exec \w+|rake \w+|flutter test|dart test|ruff|mypy|tsc|eslint)\b|\b[\w./-]+[._](?:spec|test)\.\w+\b|\btest_\w+\.py\b/i;
var RESULT = /\b\d+\s*(?:tests?|specs?|cases?|checks?)\b[^.\n]{0,24}?\b(?:pass\w*|green|ok|succeed\w*)\b|\b\d+\s+(?:passed|passing|failures?|failed)\b|\b(?:all|\d+) of \d+\b/i;
var backed = (t) => CONCRETE.test(t) || COMMAND.test(t);
var tickedBoxes = {
  id: "ticked-boxes",
  kinds: ["commit", "pr"],
  run({ text }) {
    const bare = text.ticked.filter((l) => !backed(l.text));
    const c = bare.length;
    if (c < 2) return null;
    return {
      rule: "ticked-boxes",
      severity: "warn",
      points: Math.min(16, 4 + 2 * c),
      message: `${c} pre-ticked checkboxes`,
      hint: "Replace the checklist with what you actually ran and what happened, e.g. `npm test` (212 passed).",
      line: bare[0].n,
      data: { count: c }
    };
  }
};
var VAGUE_VERIFY = /\b(?:all |existing |the )?tests? (?:are |were |still |continue to )?(?:pass(?:es|ed|ing)?|green)\b|\bcontinue to pass\b|\bstill pass(?:es)?\b|\btested (?:locally|thoroughly|manually|extensively|and (?:verified|working))\b|\bverified (?:that )?(?:everything|it|the changes?) works?\b|\bworks as expected\b|\beverything works\b/i;
var vagueVerification = {
  id: "vague-verification",
  kinds: ["commit", "pr"],
  run({ text }) {
    if (text.lines.some((l) => COMMAND.test(l.text) || RESULT.test(l.text))) return null;
    const found = claims(text.lines, VAGUE_VERIFY, (l) => CONCRETE.test(l.text))[0];
    if (!found) return null;
    const q = quote(found.match);
    return {
      rule: "vague-verification",
      severity: "warn",
      points: 6,
      message: `"${q}", but tested how?`,
      hint: "Name the command or steps you ran and the result, e.g. `go test ./billing/...` passes, or the manual steps you took.",
      line: found.line.n,
      quote: q
    };
  }
};
var RAN_CLAIM = /\b(?:tests?|specs?|suite)\b[^.\n]{0,40}?\b(?:pass(?:es|ed|ing)?|green|cover(?:s|ed)?|confirm(?:s|ed)?|verif(?:y|ies|ied))\b|\b(?:verified|tested|confirmed|reproduced)\b|\bmanual(?:ly)? (?:verif|test)\w*|\bran (?:the )?(?:tests?|suite|it)\b|^\s*(?:[-*+]\s+\[[xX]\]|✅)/im;
var unverifiedInSession = {
  id: "unverified-in-session",
  kinds: ["commit", "pr"],
  run(ctx) {
    const s = ctx.session;
    if (!s || s.tests.length) return null;
    const found = claims(titleAndBody(ctx), RAN_CLAIM, (l) => UNCHECKED.test(l.text))[0];
    if (!found) return null;
    const q = quote(found.line.text);
    const ranSomething = s.exercised.length > 0;
    return {
      rule: "unverified-in-session",
      severity: ranSomething ? "warn" : "error",
      points: ranSomething ? 10 : 25,
      message: ranSomething ? `Says "${q}", but no test command ran in this session` : `Says "${q}", but nothing was run or tried in this session`,
      hint: 'Only report what actually happened: run the tests and quote the result, or write "Not tested" / "Tests not run".',
      line: lineOf(found.line),
      quote: q
    };
  }
};
function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
var diffEcho = {
  id: "diff-echo",
  kinds: ["commit", "pr"],
  needsDiff: true,
  run({ text, diff }) {
    const names = /* @__PURE__ */ new Set();
    for (const f of diff.files.slice(0, 300)) {
      names.add(f.path);
      const base = f.path.split("/").pop();
      if (base.length >= 5) names.add(base);
    }
    if (!names.size) return null;
    const alt = [...names].sort((a, b) => b.length - a.length).map(escape).join("|");
    const re = new RegExp(`(?<![\\w/.-])(?:${alt})(?![\\w-])`);
    const heads = new Set(text.headings);
    const bullet = /^\s*([-*+•]|\d{1,2}[.)])\s+/;
    const lead = (t) => t.replace(/^\s*([-*+•]|\d{1,2}[.)])?\s*(\*\*|__)?/, "").slice(0, 40);
    const verbFirst = new RegExp(`^(?:updated?|modif(?:y|ied)|chang(?:e|ed|es)|edit(?:ed|s)?|add(?:ed|s)?|remov(?:e|ed|es)|delet(?:e|ed|es)|renam(?:e|ed|es)|refactor(?:ed|s)?|creat(?:e|ed|es)|introduc(?:e|ed|es)|tweak(?:ed|s)?)\\b.{0,25}?(?<![\\w/.-])(?:${alt})(?![\\w-])`, "i");
    const labelFirst = new RegExp(`^\`?(?:${alt})\`?\\s*(?::|\u2014|\u2013|-\\s)`);
    const echoes = text.lines.filter((l) => {
      if (heads.has(l)) return false;
      const t = l.text.trim();
      if (bullet.test(l.text)) return re.test(lead(l.text));
      return verbFirst.test(t) || labelFirst.test(t);
    });
    const k = echoes.length;
    if (k < 3 || k < 5 && k < 0.3 * Math.max(1, text.bullets.length)) return null;
    return {
      rule: "diff-echo",
      severity: "warn",
      points: Math.min(20, 3 * k),
      message: `${k} lines walk through files the reviewer can already see in the diff`,
      hint: "GitHub already lists the files. Group the changes by area instead: one bullet per change a reviewer would ask about, saying where to look (function, setting, file:line) and the values.",
      line: echoes[0].n,
      data: { count: k }
    };
  }
};
var CLAIMS = [
  /\b(?:improv|boost|enhanc|optimi[sz]|increas)\w*\b[^.\n]{0,30}?\b(?:performance|speed|efficiency|throughput|latency)\b/i,
  /\b(?:significantly |much |dramatically )?(?:faster|quicker|more performant|more efficient)\b(?! (?:merge|review|turnaround|iteration|feedback|release|landing|approval)s?\b)/i,
  /\b(?:improv|enhanc|harden|strengthen|bolster)\w*\b[^.\n]{0,30}?\bsecurity\b|\bmore secure\b/i,
  /\b(?:improv|enhanc|better|increas)\w*\b[^.\n]{0,30}?\b(?:maintainability|readability|code quality|developer experience|user experience|reliability|robustness|scalability|stability|resilience)\b/i,
  /\b(?:production[- ]ready|battle[- ]tested|enterprise[- ]grade|future[- ]proof)\b/i,
  /\b(?:fully|100%) backwards?[- ]compatible\b/i
];
var EVIDENCE = /\d+(?:\.\d+)?\s?(?:%|x|×|ms|µs|us|ns|s|sec|secs|seconds|mb|kb|gb|rps|qps|req\/s)\b|\bbenchmark|\bp(?:50|90|95|99)\b|→|->|\bfrom \d/i;
var unbackedClaim = {
  id: "unbacked-claim",
  kinds: ["commit", "pr"],
  run(ctx) {
    const found = [];
    const lines = titleAndBody(ctx);
    const prose = lines.filter((l) => l.text.trim());
    for (const line of lines) {
      const at = prose.indexOf(line);
      const near = at === -1 ? [line] : prose.slice(at, at + 3);
      if (near.some((l) => EVIDENCE.test(l.text))) continue;
      for (const re of CLAIMS) {
        const m = line.text.match(re);
        if (m) found.push({ n: lineOf(line), q: quote(m[0]) });
      }
    }
    if (!found.length) return null;
    const first = found[0];
    return {
      rule: "unbacked-claim",
      severity: "warn",
      points: Math.min(20, 5 * found.length),
      message: found.length > 1 ? `${found.length} claims with no evidence, e.g. "${first.q}"` : `"${first.q}" with no evidence`,
      hint: "Back it with a measurement (before \u2192 after, with numbers) or delete it.",
      line: first.n,
      quote: first.q,
      data: { count: found.length }
    };
  }
};
var WHY = /\b(?:because|since|so that|so we|in order to|otherwise|previously|used to|caus(?:e|ed|es|ing)|crash\w*|errors?|exceptions?|bugs?|regressions?|broke|breaks|broken|fail\w*|leak\w*|races?|timeouts?|deadlock\w*|report(?:ed|s)?|requested|needed|need to|required|requirement|blocks|blocked|unblock\w*|incidents?|outages?|panic\w*|flak\w*|slow|wrong|incorrect|missing|typo|dropp?ed|drops|lost|loses|down|stuck|stale|hang(?:s|ing)?|hung|duplicat\w*|corrupt\w*|overflow\w*|vulnerab\w*|cve|deprecat\w*|can't|cannot|couldn't|doesn't|didn't|wasn't|isn't)\b|\bto (?:fix|avoid|prevent|allow|support|enable|let|keep|stop|reduce|handle|match|unblock|make)\b|\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?|refs?)\b\s*:?\s*#?\d+|#\d+|https?:\/\/\S*(?:issues|jira|linear|browse|sentry)|\bproblems?\b|\bdegrad\w*|\bno (?:way|visibility)\b|\bhard to\b|\bconfus\w*|\b(?:did|does|do) nothing\b|\bsilent(?:ly)?\b|\bnever (?:\w+ )?(?:work|fire|run|load|open|show|appear|arrive)\w*|^\W*why\W*:|\bso (?:the |that |this |these |it |they |we |our |users? |tests? |reviewers? |agents? |\w+ )?(?:is|are|can|could|will|won't|get|gets|stay|stays|keep|keeps|work|works|run|runs|show|shows|pass|passes|resolve|resolves)\b|\btrapped\b|\bun(?:readable|usable|reachable|able)\b|\b(?:forced|had|having|have) to\b|\bto (?:provide|ensure)\b/im;
var NEED = /(?:^|[.!?]\s+)(?:[A-Z][\w-]*)(?: [\w-]+)? needs? (?!to be\b)[a-z]/m;
var TICKET_ID = /\b[A-Z][A-Z0-9]+-\d+\b/;
var missingWhy = {
  id: "missing-why",
  kinds: ["commit", "pr"],
  run({ msg, text, diff }) {
    const n = diff?.changedLines;
    const all = [msg.title, ...text.lines.map((l) => l.text)].join("\n");
    if (WHY.test(all) || NEED.test(all) || TICKET_ID.test(all)) return null;
    if (latinShare(all) < 0.5) return null;
    if (msg.kind === "pr") {
      if (n != null && n <= 20) return null;
      const empty = text.words === 0;
      if (empty && n != null && n >= BIG) return null;
      return {
        rule: "missing-why",
        severity: "warn",
        points: 8,
        message: empty ? `No description${n != null ? ` for a ${n}-line diff` : ""}` : "Explains what changed, never why",
        hint: "Add one sentence on why, from what you know: the bug it fixes, who asked for it, or the issue link. If nobody said why, leave it out rather than guess."
      };
    }
    if (n == null || n <= 150 || text.words > 0) return null;
    return {
      rule: "missing-why",
      severity: "info",
      points: 4,
      message: `${n}-line commit with no body saying why`,
      hint: "Add a short body: what was wrong before, or what this unblocks."
    };
  }
};
var BIG = 300;
var VERIFIED = /\b(?:tested|untested|testing|verif(?:y|ied|ication)|validat(?:ed|ion)|reproduced|smoke[- ]test\w*|test plan|ran|(?:not|never) run|checked|confirmed|tried)\b|^\s*[-*+]\s+\[[xX ]\]|✅/im;
var thinDescription = {
  id: "thin-description",
  kinds: ["pr"],
  needsDiff: true,
  run({ text, diff, msg }) {
    const n = diff.changedLines;
    const prose = text.lines.filter((l) => l.text.trim() && !text.headings.includes(l));
    if (n >= BIG && prose.length <= 1 && text.words < 30) {
      return {
        rule: "thin-description",
        severity: "warn",
        points: 12,
        message: text.words ? `A one-line description for a ${n}-line diff` : `No description for a ${n}-line diff`,
        hint: "Give the reviewer a map: what changed and why (the bug, the request, the issue), the few behavior changes worth a real look and where they are, what's mechanical and roughly how much of the diff it is, and a Tested line with what you ran.",
        data: { lines: n, words: text.words }
      };
    }
    if (n < 30 || !text.words || !diff.source.length && !diff.tests.length) return null;
    const all = [msg.title, ...prose.map((l) => l.text)].join("\n");
    if (VERIFIED.test(all) || /\bCI\b/.test(all) || prose.some((l) => COMMAND.test(l.text) || RESULT.test(l.text))) return null;
    return {
      rule: "thin-description",
      severity: "warn",
      points: 4,
      message: "Doesn't say how it was tested",
      hint: 'End with a Tested line: the commands you ran in this session and what they returned (`npm test`, 212 passed). If nothing ran, write "Not tested" and what should be checked.',
      data: { lines: n, words: text.words }
    };
  }
};
var typeMismatch = {
  id: "type-mismatch",
  kinds: ["commit", "pr"],
  needsDiff: true,
  run({ msg, diff }) {
    const type = conventionalType(msg.title);
    const d = diff;
    if (!type || !d.files.length) return null;
    const line = msg.kind === "commit" ? 1 : void 0;
    if (["feat", "fix", "perf", "refactor"].includes(type) && !d.source.length && !d.tests.length) {
      return {
        rule: "type-mismatch",
        severity: "warn",
        points: 6,
        message: `"${type}:" on a diff that only touches docs`,
        hint: 'Use "docs:" or say which code change this belongs to.',
        line
      };
    }
    if (type === "docs" && d.source.length) {
      return {
        rule: "type-mismatch",
        severity: "warn",
        points: 6,
        message: `"docs:" but ${d.source.length} non-doc file${d.source.length > 1 ? "s" : ""} changed`,
        hint: "Pick the type that matches the code change, or split the docs into their own commit.",
        line
      };
    }
    return null;
  }
};
var droppedFacts = {
  id: "dropped-facts",
  kinds: ["commit", "pr"],
  run({ msg, previous }) {
    if (!previous?.evidence.length) return null;
    const lost = droppedEvidence(previous.evidence, `${msg.title}
${msg.body}`);
    if (!lost.length) return null;
    const shown = lost.slice(0, 8).join(", ") + (lost.length > 8 ? ", \u2026" : "");
    return {
      rule: "dropped-facts",
      severity: previous.strict ? "error" : "warn",
      points: previous.strict ? 10 : 2,
      message: `${lost.length} fact${lost.length > 1 ? "s" : ""} from the last draft ${lost.length > 1 ? "are" : "is"} gone: ${shown}`,
      hint: "Short means no padding, not fewer facts. Put these back unless they were wrong.",
      data: { count: lost.length }
    };
  }
};
var groundedRules = [
  length,
  phantomTests,
  unverifiedInSession,
  templateOnTiny,
  diffEcho,
  tickedBoxes,
  vagueVerification,
  unbackedClaim,
  missingWhy,
  thinDescription,
  typeMismatch,
  droppedFacts
];

// src/rules/prose.ts
var VOCAB = new RegExp(
  "\\b(?:" + [
    "comprehensive",
    "robust(?:ness)?",
    "seamless(?:ly)?",
    "leverag(?:e|es|ed|ing)",
    "utiliz(?:e|es|ed|ing|ation)",
    "delv(?:e|es|ing)",
    "streamlin(?:e|es|ed|ing)",
    "facilitat(?:e|es|ed|ing)",
    "pivotal",
    "crucial",
    "meticulous(?:ly)?",
    "holistic",
    "cutting-edge",
    "state-of-the-art",
    "game-chang(?:er|ing)",
    "elevat(?:e|es|ed|ing)",
    "empower(?:s|ed|ing)?",
    "bolster(?:s|ed|ing)?",
    "underscor(?:e|es|ed|ing)",
    "showcas(?:e|es|ed|ing)",
    "intricate",
    "tapestry",
    "realm",
    "paramount",
    "noteworthy",
    "furthermore",
    "moreover",
    "additionally",
    "enhanc(?:e|es|ed|ing|ement|ements)",
    "effortless(?:ly)?",
    "synerg(?:y|ies)",
    "revolutioni[sz](?:e|es|ed|ing)",
    "unparalleled",
    "invaluable",
    "foster(?:s|ed|ing)?",
    "best practices",
    "a wide range of",
    "it(?:'|\u2019)?s worth noting",
    "it is (?:important|worth) (?:to note|noting)",
    "plays? a (?:crucial|key|vital|pivotal) role",
    "key (?:improvements|changes|features|benefits)"
  ].join("|") + ")\\b",
  "gi"
);
var aiVocab = {
  id: "ai-vocab",
  kinds: ["commit", "pr"],
  run(ctx) {
    const seen = /* @__PURE__ */ new Map();
    let total = 0;
    let firstLine;
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
    const shown = uniq.slice(0, 4).map((w) => `"${w}"`).join(", ");
    return {
      rule: "ai-vocab",
      severity: points >= 6 ? "warn" : "info",
      points,
      message: `AI vocabulary: ${shown}${uniq.length > 4 ? ` +${uniq.length - 4} more` : ""}`,
      hint: 'Use the plain word ("use", not "leverage"), or say the specific thing instead.',
      line: firstLine,
      data: { words: uniq.slice(0, 3).join(", "), count: total }
    };
  }
};
var OPENER = /^\s*(?:this (?:pr|pull request|commit|change|changeset|mr|merge request) (?:introduces|adds|implements|refactors|updates|improves|enhances|addresses|aims|provides|includes|makes|delivers|brings)\b|in this (?:pr|pull request|commit)\b)/i;
var aiOpener = {
  id: "ai-opener",
  kinds: ["commit", "pr"],
  run({ text }) {
    const h = hits(text.lines.slice(0, 12), OPENER)[0];
    if (!h) return null;
    const q = quote(h.match);
    return {
      rule: "ai-opener",
      severity: "warn",
      points: 6,
      message: `Opens with "${q}\u2026"`,
      hint: 'Start with the change itself: "Retry webhook sends on 5xx so \u2026".',
      line: h.line.n,
      quote: q
    };
  }
};
var CLOSER = /^\s*(?:overall,|in summary|in conclusion|to summarize|to sum up|these changes (?:improve|enhance|ensure|make|provide|help|should|will)|this (?:change|pr|update|commit) (?:ensures|improves|enhances|makes|provides|helps|should)|(?:please )?let me know if|feel free to|happy to (?:address|make|adjust|discuss))/i;
var aiCloser = {
  id: "ai-closer",
  kinds: ["commit", "pr"],
  run({ text }) {
    const first = text.lines.find((l) => l.text.trim() && !text.headings.includes(l));
    const h = hits(text.lines, CLOSER, (l) => l === first)[0];
    if (!h) return null;
    const q = quote(h.match);
    return {
      rule: "ai-closer",
      severity: "warn",
      points: 6,
      message: `Wrap-up sentence: "${q}\u2026"`,
      hint: "Delete the conclusion. The reader just read the description.",
      line: h.line.n,
      quote: q
    };
  }
};
var CHATBOT = /\b(?:i hope this helps|as an ai\b|as a (?:large )?language model|great question|here(?:'s| is) (?:a|the|your) (?:summary|pr description|pull request description|commit message)|certainly[!,]|absolutely[!,]|i've (?:made|implemented) the (?:following )?changes)/i;
var chatbotLeftovers = {
  id: "chatbot-leftovers",
  kinds: ["commit", "pr"],
  run(ctx) {
    const h = hits(titleAndBody(ctx), CHATBOT)[0];
    if (!h) return null;
    const q = quote(h.match);
    return {
      rule: "chatbot-leftovers",
      severity: "error",
      points: 15,
      message: `Chatbot voice left in: "${q}"`,
      hint: "Delete it. That line was written to you, not to the reviewer.",
      line: lineOf(h.line),
      quote: q
    };
  }
};
var emoji = {
  id: "emoji",
  kinds: ["commit", "pr"],
  run({ text }) {
    const led = text.emojiLed.length;
    if (led) {
      return {
        rule: "emoji",
        severity: "warn",
        points: Math.min(14, 4 + 2 * led),
        message: `${led} header${led > 1 ? "s" : ""} or bullet${led > 1 ? "s" : ""} led by an emoji`,
        hint: "Drop the decorative emoji. \u2728 and \u{1F680} add nothing a reviewer can use.",
        line: text.emojiLed[0].n,
        data: { count: led }
      };
    }
    if (text.emoji < 4) return null;
    return {
      rule: "emoji",
      severity: "info",
      points: 4,
      message: `${text.emoji} emoji`,
      hint: "Drop the decorative emoji.",
      data: { count: text.emoji }
    };
  }
};
var boldSpam = {
  id: "bold-spam",
  kinds: ["pr"],
  run({ text }) {
    if (text.boldLabels < 3 && text.bold < 6) return null;
    return {
      rule: "bold-spam",
      severity: "warn",
      points: Math.min(12, 3 + text.boldLabels + Math.floor(text.bold / 2)),
      message: text.boldLabels >= 3 ? `${text.boldLabels} "**Label**: \u2026" bullets` : `${text.bold} bold phrases`,
      hint: "When everything is bold, nothing is. Bold one thing at most: the part the reviewer must not miss.",
      data: { count: Math.max(text.bold, text.boldLabels) }
    };
  }
};
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
var bulletBloat = {
  id: "bullet-bloat",
  kinds: ["commit", "pr"],
  run({ msg, text, diff, length: length2 }) {
    const b = text.bullets.length;
    const n = diff?.changedLines;
    const base = msg.kind === "pr" ? n != null ? clamp(Math.round(2 + Math.sqrt(n) / 1.5), 5, 15) : 8 : n != null ? clamp(Math.round(1 + Math.sqrt(n) / 3), 2, 8) : 5;
    const allowed = Math.max(2, Math.round(base * LENGTHS[length2]));
    if (b <= allowed) return null;
    return {
      rule: "bullet-bloat",
      severity: "warn",
      points: Math.min(20, 2 * (b - allowed)),
      message: n != null ? `${b} bullet points for a ${n}-line diff (max ${allowed})` : `${b} bullet points (max ${allowed})`,
      hint: msg.kind === "pr" ? `Keep the bullets a reviewer would ask about (${allowed} at most here): each a behavior change, where to look, and the values. Group the rest by area or drop it; the diff lists the files.` : "Keep the bullets for the parts of the change a reviewer would ask about; git log reads the rest better as a sentence or two.",
      line: text.bullets[0].n,
      data: { count: b, allowed, lines: n ?? 0 }
    };
  }
};
var LONG_BULLET = 40;
var longBullet = {
  id: "long-bullet",
  kinds: ["commit", "pr"],
  run({ text }) {
    const long = text.bullets.map((line, i) => ({ line, words: text.bulletWords[i] })).filter((b) => b.words > LONG_BULLET);
    if (!long.length) return null;
    const longest = Math.max(...long.map((b) => b.words));
    return {
      rule: "long-bullet",
      severity: "info",
      points: Math.min(6, 2 * long.length),
      message: long.length === 1 ? `A ${longest}-word bullet` : `${long.length} bullets over ${LONG_BULLET} words (longest ${longest})`,
      hint: "One change per bullet, about 25 words: what changed, where, and the values. Split a bullet that holds two changes, and move the reasoning into the opening.",
      line: long[0].line.n,
      data: { count: long.length, longest }
    };
  }
};
var emDash = {
  id: "em-dash",
  kinds: ["commit", "pr"],
  run({ msg, text }) {
    const min = msg.kind === "commit" ? 2 : 3;
    if (text.emDashes < min) return null;
    if (latinShare(text.lines.map((l) => l.text).join("\n")) < 0.5) return null;
    return {
      rule: "em-dash",
      severity: "info",
      points: 3,
      message: `${text.emDashes} em dashes`,
      hint: "Use a period or a comma. Stacked em dashes are a well-known generated-text tell.",
      data: { count: text.emDashes }
    };
  }
};
var proseRules = [chatbotLeftovers, aiOpener, aiCloser, aiVocab, bulletBloat, longBullet, emoji, boldSpam, emDash];

// src/vague.ts
var VAGUE = /^(?:updates?|fix(?:es|ed)?|changes?|wip|misc|stuff|cleanup|clean ?up|refactor(?:ing)?|improvements?|tweaks?|minor(?: fix(?:es)?| changes?| updates?| tweaks?)?|small (?:fix(?:es)?|changes?)|(?:various|several|some) (?:fix(?:es)?|changes|improvements|updates)|update (?:the )?(?:files?|code|stuff|things|project|app)|fix(?:ed|es)? (?:the |a |some |all )?(?:bugs?|issues?|stuff|things?|problems?|errors?|it|this|that)|bug ?fix(?:es)?|quick ?fix|hot ?fix|final changes?|more changes|code changes|done|save|commit|summary|changes made|tests?|testing|temp|tmp|asdf|x+|\.+)\.?$/i;
var FILE_ONLY = /^(?:update[sd]?|chang(?:e|es|ed)|modif(?:y|ies|ied)|edit(?:s|ed)?|touch(?:es|ed)?|fix(?:es|ed)?|tweak(?:s|ed)?)\s+[\w./-]+\.[A-Za-z0-9]{1,6}\.?$/i;
function isVague(core2) {
  const s = core2.trim();
  return VAGUE.test(s) || FILE_ONLY.test(s);
}

// src/verbs.ts
var BASE = [
  "add",
  "fix",
  "update",
  "remove",
  "implement",
  "refactor",
  "improve",
  "create",
  "delete",
  "rename",
  "move",
  "bump",
  "upgrade",
  "introduce",
  "enhance",
  "support",
  "handle",
  "use",
  "make",
  "allow",
  "prevent",
  "replace",
  "clean",
  "revert",
  "optimize",
  "simplify",
  "extract",
  "migrate",
  "document",
  "enable",
  "disable",
  "adjust",
  "correct",
  "drop",
  "ensure",
  "convert",
  "integrate",
  "expose",
  "avoid",
  "restore",
  "reduce",
  "increase",
  "switch",
  "wrap",
  "skip",
  "keep",
  "show",
  "hide",
  "validate",
  "parse",
  "build",
  "write",
  "resolve",
  "address",
  "tweak",
  "polish",
  "deprecate",
  "unify",
  "consolidate",
  "streamline",
  "modify",
  "initialize",
  "configure",
  "install",
  "generate",
  "render",
  "fetch",
  "stop",
  "limit",
  "wire",
  "inline",
  "reorder",
  "rework",
  "rewrite",
  "clarify",
  "change",
  "merge",
  "bind",
  "catch",
  "throw",
  "split",
  "set",
  "enforce",
  "harden",
  "tighten",
  "register"
];
var DOUBLE = /* @__PURE__ */ new Set(["stop", "drop", "wrap", "skip", "strip", "swap", "trim", "ship", "plan"]);
var IRREGULAR = {
  make: ["made"],
  keep: ["kept"],
  build: ["built"],
  write: ["wrote", "written"],
  bind: ["bound"],
  catch: ["caught"],
  throw: ["threw", "thrown"],
  show: ["shown"],
  hide: ["hid", "hidden"]
};
function inflect(v) {
  const forms = [];
  const consonantY = /[^aeiou]y$/.test(v);
  forms.push(/(s|x|z|ch|sh)$/.test(v) ? v + "es" : consonantY ? v.slice(0, -1) + "ies" : v + "s");
  if (v.endsWith("e")) forms.push(v + "d");
  else if (consonantY) forms.push(v.slice(0, -1) + "ied");
  else if (DOUBLE.has(v)) forms.push(v + v.at(-1) + "ed");
  else if (!["set", "split"].includes(v)) forms.push(v + "ed");
  if (v.endsWith("e") && !v.endsWith("ee")) forms.push(v.slice(0, -1) + "ing");
  else if (DOUBLE.has(v)) forms.push(v + v.at(-1) + "ing");
  else forms.push(v + "ing");
  return [...forms, ...IRREGULAR[v] ?? []];
}
function pastForms(v) {
  const consonantY = /[^aeiou]y$/.test(v);
  const regular = v.endsWith("e") ? v + "d" : consonantY ? v.slice(0, -1) + "ied" : DOUBLE.has(v) ? v + v.at(-1) + "ed" : v + "ed";
  return [...["set", "split"].includes(v) ? [] : [regular], ...IRREGULAR[v] ?? []];
}
var OWN_VERB = /* @__PURE__ */ new Set(["bound"]);
var TO_BASE = /* @__PURE__ */ new Map();
var PAST = /* @__PURE__ */ new Set();
for (const v of BASE) {
  for (const f of inflect(v)) if (f !== v && !OWN_VERB.has(f)) TO_BASE.set(f, v);
  for (const f of pastForms(v)) if (!OWN_VERB.has(f)) PAST.add(f);
}
var BASE_SET = new Set(BASE);
function verbForm(word) {
  const w = word.toLowerCase();
  if (BASE_SET.has(w)) return "imperative";
  if (PAST.has(w)) return "past";
  return TO_BASE.has(w) ? "other" : null;
}
function imperativeOf(word) {
  const base = TO_BASE.get(word.toLowerCase());
  if (!base) return null;
  return word[0] === word[0].toUpperCase() ? base[0].toUpperCase() + base.slice(1) : base;
}
var SIMPLE_PAST = { make: "made", keep: "kept", build: "built", write: "wrote", bind: "bound", catch: "caught", throw: "threw", hide: "hid" };
function pastOf(word) {
  const w = word.toLowerCase();
  const past = BASE_SET.has(w) ? SIMPLE_PAST[w] ?? pastForms(w)[0] ?? w : w;
  return word[0] === word[0].toUpperCase() ? past[0].toUpperCase() + past.slice(1) : past;
}

// src/style.ts
var CONVENTIONAL2 = /^(\w+)(\([^)]*\))?!?:\s/;
var TICKET2 = /^\[?([A-Z][A-Z0-9]+-\d+)\]?/;
var MIN_SAMPLE = 10;
function percentile(xs, p) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
}
function core(subject) {
  return subject.replace(TICKET2, "").replace(/^:?\s*/, "").replace(CONVENTIONAL2, "").replace(TICKET2, "").replace(/^:?\s*/, "");
}
function profileFrom(commits) {
  const own = commits.filter((c) => c.subject && !DEFAULT_IGNORE.some((re) => re.test(c.subject)));
  if (own.length < MIN_SAMPLE) return null;
  const n = own.length;
  const types = /* @__PURE__ */ new Map();
  let conventional = 0;
  let ticket = 0;
  let ticketExample = null;
  let letters = 0;
  let upper = 0;
  let body = 0;
  const moods = { imperative: 0, past: 0, other: 0 };
  for (const c of own) {
    const conv = c.subject.match(CONVENTIONAL2);
    if (conv) {
      conventional++;
      const t = conv[1].toLowerCase();
      types.set(t, (types.get(t) ?? 0) + 1);
    }
    const tk = c.subject.match(TICKET2);
    if (tk) {
      ticket++;
      ticketExample ??= tk[1];
    }
    const first = core(c.subject)[0];
    if (first && new RegExp("\\p{L}", "u").test(first)) {
      letters++;
      if (first !== first.toLowerCase()) upper++;
    }
    if (c.body.trim()) body++;
    const verb = core(c.subject).match(/^[A-Za-z]+/)?.[0];
    const form = verb ? verbForm(verb) : null;
    if (form) moods[form]++;
  }
  const verbLed = moods.imperative + moods.past + moods.other;
  const mood = verbLed < 5 ? null : moods.past / verbLed >= 0.6 ? "past" : moods.imperative / verbLed >= 0.6 ? "imperative" : null;
  const lengths = own.map((c) => [...c.subject].length);
  return {
    sample: n,
    conventional: conventional / n,
    types: [...types.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t),
    ticket: ticket / n,
    ticketExample,
    capitalized: letters ? upper / letters : 0.5,
    subjectP50: percentile(lengths, 0.5),
    subjectP90: percentile(lengths, 0.9),
    body: body / n,
    mood,
    // Only subjects worth imitating: a history full of "wip" shouldn't teach an agent "wip".
    examples: own.filter((c) => [...c.subject].length <= 72 && !isVague(core(c.subject))).slice(0, 5).map((c) => c.subject)
  };
}
function repoStyle(cwd) {
  const out = git(["log", "-n", "200", "--no-merges", "--format=%s%x1f%b%x1e"], cwd);
  if (!out) return null;
  const commits = out.split("").map((r) => r.replace(/^\n/, "")).filter(Boolean).map((r) => {
    const [subject = "", body = ""] = r.split("");
    return { subject: subject.trim(), body };
  });
  return profileFrom(commits);
}

// src/rules/style.ts
var pct = (x) => `${Math.round(x * 100)}%`;
var styleConvention = {
  id: "style-convention",
  kinds: ["commit", "pr"],
  run({ msg, style }) {
    if (!style || !msg.title) return null;
    const line = msg.kind === "commit" ? 1 : void 0;
    const conv = msg.title.match(CONVENTIONAL2);
    if (!conv && style.conventional >= 0.6) {
      const types = style.types.slice(0, 4).join(", ");
      return {
        rule: "style-convention",
        severity: msg.kind === "commit" ? "warn" : "info",
        points: msg.kind === "commit" ? 4 : 2,
        message: `This repo uses conventional commits (${pct(style.conventional)} of recent subjects) but this one has no prefix`,
        hint: `Start with a type like the rest of the history${types ? ` (${types})` : ""}, e.g. "${style.types[0] ?? "fix"}: \u2026".`,
        line
      };
    }
    if (conv && style.conventional <= 0.1) {
      return {
        rule: "style-convention",
        severity: "info",
        points: 2,
        message: `"${conv[0].trim()}" prefix, but this repo doesn't use conventional commits (${pct(style.conventional)})`,
        hint: "Drop the prefix to match the history.",
        line
      };
    }
    if (conv && style.conventional >= 0.6 && style.types.length >= 3) {
      const type = conv[1].toLowerCase();
      if (!style.types.includes(type)) {
        return {
          rule: "style-convention",
          severity: "info",
          points: 2,
          message: `"${type}:" isn't a type this repo uses`,
          hint: `Use one of the types in the history: ${style.types.slice(0, 6).join(", ")}.`,
          line
        };
      }
    }
    return null;
  }
};
var styleCase = {
  id: "style-case",
  kinds: ["commit"],
  run({ msg, style }) {
    if (!style) return null;
    const first = subjectCore(msg.title)[0];
    if (!first || !new RegExp("\\p{L}", "u").test(first)) return null;
    const upper = first !== first.toLowerCase();
    if (!upper && style.capitalized >= 0.85) {
      return {
        rule: "style-case",
        severity: "info",
        points: 2,
        message: `Subjects here start with a capital letter (${pct(style.capitalized)}); this one doesn't`,
        hint: "Capitalize the first word to match the history.",
        line: 1
      };
    }
    if (upper && style.capitalized <= 0.15) {
      return {
        rule: "style-case",
        severity: "info",
        points: 2,
        message: `Subjects here start lowercase (${pct(1 - style.capitalized)}); this one doesn't`,
        hint: "Lowercase the first word to match the history.",
        line: 1
      };
    }
    return null;
  }
};
var styleTicket = {
  id: "style-ticket",
  kinds: ["commit"],
  run({ msg, style }) {
    if (!style || style.ticket < 0.6 || TICKET2.test(msg.title) || /\b[A-Z][A-Z0-9]+-\d+\b/.test(msg.title)) return null;
    return {
      rule: "style-ticket",
      severity: "warn",
      points: 3,
      message: `Most subjects here start with a ticket id (${pct(style.ticket)}, e.g. ${style.ticketExample})`,
      hint: "Add the ticket id from the task or branch name.",
      line: 1
    };
  }
};
var styleRules = [styleConvention, styleCase, styleTicket];

// src/rules/subject.ts
var titleLine = (kind) => kind === "commit" ? 1 : void 0;
var subjectLength = {
  id: "subject-length",
  kinds: ["commit", "pr"],
  run({ msg, style }) {
    const len = [...msg.title].length;
    const house = style ? Math.min(100, style.subjectP90) : 0;
    const [warn, error] = msg.kind === "commit" ? [Math.max(72, house), 150] : [Math.max(80, house), 150];
    if (len <= warn) return null;
    return {
      rule: "subject-length",
      severity: len > error ? "error" : "warn",
      points: len > error ? 8 : 4,
      message: `${msg.kind === "commit" ? "Subject" : "Title"} is ${len} characters (max ${warn})`,
      hint: "Keep the subject to the change itself. Reasons and details go in the body.",
      line: titleLine(msg.kind)
    };
  }
};
var emptySubject = {
  id: "empty-subject",
  // PR titles can't be empty on GitHub, and `check --kind pr` may be run on a body alone.
  kinds: ["commit"],
  run({ msg }) {
    if (msg.title.trim()) return null;
    return {
      rule: "empty-subject",
      severity: "error",
      points: 20,
      message: msg.kind === "commit" ? "Empty commit subject" : "Empty PR title",
      hint: 'Write a one-line summary of the change, in the imperative: "Retry webhook sends on 5xx".',
      line: titleLine(msg.kind)
    };
  }
};
var subjectMood = {
  id: "subject-mood",
  kinds: ["commit", "pr"],
  run({ msg, style }) {
    const word = subjectCore(msg.title).match(/^[A-Za-z]+/)?.[0];
    if (!word) return null;
    if (style?.mood === "past") {
      const base = verbForm(word) === "imperative" ? word : null;
      if (!base || msg.kind !== "commit") return null;
      const past = pastOf(base);
      return {
        rule: "subject-mood",
        severity: "info",
        points: 1,
        message: `Subjects here are in the past tense ("${past} \u2026")`,
        hint: `Match the history: "${past} \u2026".`,
        line: 1,
        quote: word
      };
    }
    const fixed = imperativeOf(word);
    if (!fixed) return null;
    return {
      rule: "subject-mood",
      severity: "info",
      points: 1,
      message: `"${word}" \u2192 "${fixed}"`,
      hint: `git's convention: the subject finishes "If applied, this commit will \u2026", so "${fixed} \u2026", the way git itself writes "Merge branch" and "Revert".`,
      line: titleLine(msg.kind),
      quote: word
    };
  }
};
var subjectPeriod = {
  id: "subject-period",
  kinds: ["commit"],
  run({ msg }) {
    if (!/[^.]\.$/.test(msg.title.trim())) return null;
    return {
      rule: "subject-period",
      severity: "info",
      points: 2,
      message: "Subject ends with a period",
      hint: "Drop the trailing period. The subject is a title, not a sentence.",
      line: 1
    };
  }
};
var subjectVague = {
  id: "subject-vague",
  kinds: ["commit", "pr"],
  run({ msg }) {
    const core2 = subjectCore(msg.title);
    if (!core2 || !isVague(core2)) return null;
    return {
      rule: "subject-vague",
      severity: "error",
      points: 12,
      message: `"${quote(msg.title)}" doesn't say what changed`,
      hint: 'Say what changed and why it matters: "Fix null deref in invoice export", not "fix bug" or "Update export.ts".',
      line: titleLine(msg.kind),
      quote: quote(msg.title)
    };
  }
};
var blankLine = {
  id: "blank-line",
  kinds: ["commit"],
  run({ msg }) {
    const first = msg.body.split("\n")[0] ?? "";
    if (!first.trim()) return null;
    return {
      rule: "blank-line",
      severity: "warn",
      points: 4,
      message: "No blank line after the subject",
      hint: "Leave line 2 empty. Without it, git and GitHub treat the body as part of the subject.",
      line: 2
    };
  }
};
var markdownInCommit = {
  id: "markdown-in-commit",
  kinds: ["commit"],
  run({ msg, text }) {
    const inSubject = /^#{1,6}\s|\*\*|__\w/.test(msg.title);
    const n = text.headings.length + text.emojiLed.length + (text.boldLabels >= 2 ? text.boldLabels : 0) + (inSubject ? 2 : 0);
    if (!n) return null;
    const first = inSubject ? { n: 1 } : text.headings[0] ?? text.emojiLed[0];
    return {
      rule: "markdown-in-commit",
      severity: "warn",
      points: Math.min(12, 4 + 2 * n),
      message: inSubject ? "Markdown in the subject line" : "Markdown headers or bold labels in a commit message",
      hint: 'git log shows raw text, so "## Summary" and **bold** show up as literal symbols. Use plain sentences.',
      line: first?.n
    };
  }
};
var clamp2 = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
function narrates(line) {
  const t = line.replace(/^\s*(?:[-*+•]|\d{1,2}[.)])\s+/, "");
  if (/^(\*\*|__)[^*_]+?(\*\*|__)\s*[:—–-]|^(\*\*|__)[^*_]+?:(\*\*|__)/.test(t)) return true;
  const word = t.match(/^[A-Za-z]+/)?.[0];
  return Boolean(word && verbForm(word));
}
var commitChangelog = {
  id: "commit-changelog",
  kinds: ["commit"],
  run({ text, diff }) {
    const n = diff?.changedLines;
    const allowed = n != null ? clamp2(Math.round(1 + Math.sqrt(n) / 3), 2, 8) : 5;
    const b = text.bullets.filter((l) => narrates(l.text)).length;
    const labels = text.labels.length;
    if (!(b > Math.max(8, 2 * allowed) || labels >= 3 && b >= 6)) return null;
    return {
      rule: "commit-changelog",
      severity: "error",
      points: 15,
      message: `Commit body is a changelog: ${b} bullets narrating changes${labels ? ` under ${labels} section label${labels === 1 ? "" : "s"}` : ""}`,
      hint: 'Rewrite it the way git log reads best: 1 to 3 lines on what was wrong or needed, then a few plain "- " bullets for the decisions a reviewer would question (with the numbers), and how it was verified. Keep the facts, drop the list of every class; the diff has that.',
      line: (text.labels[0] ?? text.bullets[0])?.n,
      data: { bullets: b, labels }
    };
  }
};
var subjectRules = [commitChangelog, emptySubject, subjectVague, subjectLength, subjectMood, subjectPeriod, blankLine, markdownInCommit];

// src/rules/index.ts
var RULES = [...groundedRules, ...subjectRules, ...styleRules, ...proseRules];
var RULE_IDS = RULES.map((r) => r.id);

// src/analyze.ts
var clamp3 = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
function wordRange(kind, diff, length2 = "normal") {
  const k = LENGTHS[length2];
  const scaled = (r) => ({ floor: Math.round(r.floor * k), budget: Math.round(r.budget * k) });
  if (!diff) return scaled(kind === "pr" ? { floor: 20, budget: 250 } : { floor: 0, budget: 80 });
  const root = Math.sqrt(diff.changedLines);
  if (kind === "commit") return scaled({ floor: 0, budget: clamp3(Math.round(25 + 4 * root), 30, 250) });
  return scaled({ floor: clamp3(Math.round(8 + 3 * root), 15, 120), budget: clamp3(Math.round(60 + 8 * root), 80, 500) });
}
function wordBudget(kind, diff, length2 = "normal") {
  return wordRange(kind, diff, length2).budget;
}
function specificityBonus(density) {
  return clamp3(1 + (density - 3) / 5, 1, 2.5);
}
var GRADES = [
  [10, "A", "Says less. Ships more."],
  [25, "B", "Mostly signal."],
  [45, "C", "Starting to yap."],
  [65, "D", "Yapping."],
  [Infinity, "F", "Certified yapper."]
];
function gradeOf(score) {
  const [, grade, verdict] = GRADES.find(([max]) => score <= max);
  return { grade, verdict };
}
var EDITOR_TEMPLATE = /^# (Please enter the commit message|On branch |Changes to be committed|-+ >8 -+$)/;
function parseCommit(raw) {
  let lines = raw.replace(/\r\n?/g, "\n").split("\n");
  if (lines.some((l) => EDITOR_TEMPLATE.test(l))) {
    const scissors = lines.findIndex((l) => /^# -+ >8 -+$/.test(l));
    if (scissors !== -1) lines = lines.slice(0, scissors);
    lines = lines.filter((l) => !l.startsWith("#"));
  }
  while (lines.length && !lines[0].trim()) lines.shift();
  const title = (lines[0] ?? "").trim();
  const body = lines.slice(1).join("\n").replace(/\s+$/, "");
  return { kind: "commit", title, body, bodyLine: 2 };
}
function prMessage(title, body) {
  return { kind: "pr", title: title.trim(), body: body ?? "", bodyLine: 1 };
}
var SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };
var YAP_RULES = /* @__PURE__ */ new Set([
  "ai-vocab",
  "ai-opener",
  "ai-closer",
  "chatbot-leftovers",
  "emoji",
  "bold-spam",
  "template-on-tiny",
  "diff-echo",
  "ticked-boxes",
  "vague-verification",
  "unbacked-claim",
  "markdown-in-commit"
]);
var SHAPE_CAP = 20;
var ADVICE_ONLY = /* @__PURE__ */ new Set(["thin-description", "long-bullet"]);
function blockingScore(r) {
  const fired = new Set(r.findings.map((f) => f.rule));
  const longList = fired.has("length") && fired.has("bullet-bloat");
  let full = 0;
  let shape = 0;
  for (const f of r.findings) {
    const wall = f.rule === "bullet-bloat" && (Number(f.data?.count) > 2 * Number(f.data?.allowed) || longList);
    const overlong = f.rule === "length" && (Number(f.data?.ratio) >= OVERLONG || longList);
    if (f.severity === "error" || YAP_RULES.has(f.rule) || wall || overlong) full += f.points;
    else if (ADVICE_ONLY.has(f.rule)) continue;
    else shape += f.points;
  }
  return Math.min(r.score, full + Math.min(SHAPE_CAP, shape));
}
function passes(r, max) {
  return blockingScore(r) <= max && !r.findings.some((f) => f.severity === "error");
}
function analyze(msg, diff, opts = {}) {
  const skip = msg.kind === "pr" ? opts.template?.lines : void 0;
  const text = analyzeText(msg.body, msg.bodyLine, skip);
  const files = new Set(diff?.files.flatMap((f) => [f.path, f.path.split("/").pop()]) ?? []);
  const density = specificity(text.lines, text.words, files);
  const length2 = opts.length ?? "normal";
  const budget = Math.round(wordBudget(msg.kind, diff, length2) * specificityBonus(density));
  const ctx = { msg, diff, text, budget, density, length: length2, style: opts.style ?? null, session: opts.session ?? null, previous: opts.previous ?? null };
  let findings = [];
  for (const rule of RULES) {
    if (!rule.kinds.includes(msg.kind) || rule.needsDiff && !diff) continue;
    const out = rule.run(ctx);
    if (out) findings.push(...Array.isArray(out) ? out : [out]);
  }
  if (opts.rules) findings = applyRuleSettings(findings, opts.rules);
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.points - a.points);
  const score = Math.min(100, findings.reduce((n, f) => n + f.points, 0));
  return { kind: msg.kind, title: msg.title, score, ...gradeOf(score), words: text.words, budget, density: Math.round(density * 10) / 10, diff, findings };
}

// src/github.ts
var GitHubError = class extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
  status;
};
function createClient(opts) {
  const doFetch = opts.fetch ?? fetch;
  const baseUrl = (opts.baseUrl ?? "https://api.github.com").replace(/\/$/, "");
  const headers = () => {
    const h = {
      Accept: "application/vnd.github+json",
      "User-Agent": "buzzcut",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    if (opts.token) h.Authorization = `Bearer ${opts.token}`;
    return h;
  };
  const handle = async (res, path) => {
    if (res.ok) return res.status === 204 ? void 0 : await res.json();
    if (res.status === 404) {
      throw new GitHubError(opts.token ? `Not found: ${path}` : "Not found. If the repo is private, set GITHUB_TOKEN or log in with `gh auth login`.", 404);
    }
    if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
      throw new GitHubError(
        opts.token ? "GitHub rate limit hit. Try again in a few minutes." : "GitHub rate limit hit (60/hour without a token). Set GITHUB_TOKEN or run `gh auth login`.",
        res.status
      );
    }
    throw new GitHubError(`GitHub API returned ${res.status} for ${path}`, res.status);
  };
  return {
    authenticated: Boolean(opts.token),
    async get(path) {
      return handle(await doFetch(`${baseUrl}${path}`, { headers: headers() }), path);
    },
    async send(method, path, body) {
      const res = await doFetch(`${baseUrl}${path}`, {
        method,
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      return handle(res, path);
    }
  };
}
var MAX_FILE_PAGES = 3;
var CODING_AGENTS = /^(?:copilot|copilot-swe-agent|devin-ai-integration|google-labs-jules|jules|cursor|cursoragent|claude|anthropic-claude|chatgpt-codex-connector|codex|openhands(?:-agent)?|sweep-ai|amazon-q-developer|factory-droid|codegen-sh|codeflash-ai)(?:\[bot\])?$/i;
function isCodingAgent(user) {
  return CODING_AGENTS.test(user?.login ?? "");
}
function isBot(user) {
  if (isCodingAgent(user)) return false;
  return user?.type === "Bot" || /\[bot\]$/.test(user?.login ?? "");
}
async function fetchPrFiles(client, ref, changedFiles) {
  const base = `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`;
  const files = [];
  for (let page = 1; page <= MAX_FILE_PAGES && files.length < changedFiles; page++) {
    const batch = await client.get(`${base}/files?per_page=100&page=${page}`);
    files.push(...batch.map((f) => ({ path: f.filename, additions: f.additions, deletions: f.deletions })));
    if (batch.length < 100) break;
  }
  return files;
}
async function fetchTemplate(client, owner, repo, ref) {
  for (const path of [TEMPLATE_PATHS[0], ".github/PULL_REQUEST_TEMPLATE.md"]) {
    try {
      const f = await client.get(
        `/repos/${owner}/${repo}/contents/${path}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`
      );
      if (f.content && f.encoding === "base64") return parseTemplate([{ path, text: Buffer.from(f.content, "base64").toString("utf8") }]);
    } catch (e) {
      if (!(e instanceof GitHubError && e.status === 404)) throw e;
    }
  }
  return null;
}

// src/ci.ts
var MARKER = "<!-- buzzcut -->";
var MAX_COMMITS = 30;
var DOCS = "https://github.com/Shiva-Xs/buzzcut#how-the-score-works";
function input(env, name, fallback) {
  const v = env[`INPUT_${name.toUpperCase()}`] ?? env[`INPUT_${name.toUpperCase().replace(/-/g, "_")}`];
  return v === void 0 || v === "" ? fallback : v.trim();
}
var cell = (s) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
var ICON = { error: "\u2717", warn: "!", info: "\xB7" };
function renderMarkdown(pr, commits, max, checkedCommits) {
  const prOk = passes(pr, max);
  const bad = commits.filter((c) => !passes(c.report, max));
  const out = [MARKER];
  if (prOk && !bad.length) {
    out.push(`### buzzcut: yap score ${pr.score}/100 (${pr.grade}) \u2713`, "");
    const passed = checkedCommits ? `The description and ${checkedCommits} commit message${checkedCommits > 1 ? "s" : ""} pass.` : "The description passes.";
    const advice = pr.findings.filter((f) => f.severity === "warn");
    if (pr.grade === "A" || pr.grade === "B" || !advice.length) {
      out.push(`Short and specific. ${passed}`);
      return out.join("\n");
    }
    out.push(`${passed} No \u2717 errors; the notes below are advice.`, "", "| | Finding | How to fix |", "|---|---|---|");
    for (const f of advice) out.push(`| ${ICON[f.severity]} | ${cell(f.message)} | ${cell(f.hint)} |`);
    return out.join("\n");
  }
  out.push(`### buzzcut: yap score ${pr.score}/100 (${pr.grade})`, "");
  if (pr.diff) out.push(`The description is **${pr.words} words for a ${pr.diff.changedLines}-line diff** (budget ${pr.budget}).`, "");
  if (!prOk) {
    out.push("| | Finding | How to fix |", "|---|---|---|");
    for (const f of pr.findings) out.push(`| ${ICON[f.severity]} | ${cell(f.message)} | ${cell(f.hint)} |`);
    out.push("");
  } else {
    out.push("The description passes.", "");
  }
  if (bad.length) {
    out.push(`**Commit messages:** ${bad.length} of ${checkedCommits} need work.`, "");
    out.push("| Commit | Score | Top finding |", "|---|---|---|");
    for (const { sha, report: r } of bad) {
      const f = r.findings[0];
      out.push(`| \`${sha.slice(0, 7)}\` ${cell(r.title.slice(0, 60))} | ${r.score} (${r.grade}) | ${f ? cell(`${f.rule}: ${f.message}`) : ""} |`);
    }
    out.push("");
  }
  out.push(
    `<sub>Passes with no \u2717 errors and a score of ${max} or less; warnings about length and shape count for 20 at most. Check locally with \`npx buzzcut check --kind pr --title "\u2026" body.md\`, or have your coding agent fix it: \`npx skills add Shiva-Xs/buzzcut\`. [How scoring works](${DOCS})</sub>`
  );
  return out.join("\n");
}
async function checkCommit(client, owner, repo, sha, message, parents, opts) {
  const msg = parseCommit(message);
  if (parents != null && parents > 1) return null;
  if (!msg.title || isIgnored(msg.title, opts.config)) return null;
  const detail = await client.get(`/repos/${owner}/${repo}/commits/${sha}`);
  if ((detail.parents?.length ?? 1) > 1) return null;
  const diff = buildDiff((detail.files ?? []).map((f) => ({ path: f.filename, additions: f.additions, deletions: f.deletions })));
  return { sha, report: analyze(msg, diff, { style: opts.style, rules: opts.config.rules, length: opts.config.length }) };
}
function renderPushMarkdown(commits, max) {
  const bad = commits.filter((c) => !passes(c.report, max));
  const n = commits.length;
  if (!bad.length) return `### buzzcut: ${n} commit message${n === 1 ? "" : "s"} checked \u2713

Each one says what changed, with nothing to cut.`;
  const out = [`### buzzcut: ${bad.length} of ${n} commit message${n === 1 ? "" : "s"} need work`, "", "| Commit | Score | Top finding |", "|---|---|---|"];
  for (const { sha, report: r } of bad) {
    const f = r.findings[0];
    out.push(`| \`${sha.slice(0, 7)}\` ${cell(r.title.slice(0, 60))} | ${r.score} (${r.grade}) | ${f ? cell(`${f.rule}: ${f.message}`) : ""} |`);
  }
  out.push("", `<sub>Passes with no \u2717 errors and a score of ${max} or less; warnings about length and shape count for 20 at most. Check one locally with \`npx buzzcut check --rev <sha>\`. [How scoring works](${DOCS})</sub>`);
  return out.join("\n");
}
async function findComment(client, owner, repo, n) {
  for (let page = 1; page <= 5; page++) {
    const batch = await client.get(`/repos/${owner}/${repo}/issues/${n}/comments?per_page=100&page=${page}`);
    const hit = batch.find((c) => c.body?.includes(MARKER));
    if (hit) return hit;
    if (batch.length < 100) return null;
  }
  return null;
}
function setup(run) {
  const { env, log } = run;
  const [owner = "", repo = ""] = (env.GITHUB_REPOSITORY ?? "").split("/");
  const workspace = env.GITHUB_WORKSPACE || run.cwd;
  let config = DEFAULTS;
  try {
    config = loadConfig(existsSync5(workspace) ? workspace : null, RULE_IDS);
  } catch (e) {
    log(`::warning::buzzcut: ${e.message} (using defaults)`);
  }
  const max = Number(input(env, "max", String(config.max)));
  const token = input(env, "github-token", env.GITHUB_TOKEN ?? "") || null;
  const client = createClient({ token, fetch: run.fetch, baseUrl: env.GITHUB_API_URL });
  const style = existsSync5(workspace) ? repoStyle(workspace) : null;
  return { owner, repo, workspace, config, max, client, style };
}
async function runPush(run) {
  const { env, log } = run;
  const event = JSON.parse(readFileSync5(env.GITHUB_EVENT_PATH ?? "", "utf8"));
  const pushed = (event.commits ?? []).filter((c) => c.distinct !== false).slice(-MAX_COMMITS);
  if (event.deleted || !pushed.length) {
    log("buzzcut: no new commits in this push.");
    return 0;
  }
  const { owner, repo, config, max, client, style } = setup(run);
  const commits = [];
  for (const c of pushed) {
    const r = await checkCommit(client, owner, repo, c.id, c.message, null, { style, config });
    if (r) commits.push(r);
  }
  const allPass = commits.every((c) => passes(c.report, max));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, renderPushMarkdown(commits, max) + "\n");
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `pass=${allPass}
`);
  log(`buzzcut: ${commits.length} commit${commits.length === 1 ? "" : "s"} checked; ${allPass ? "all pass" : "some need work"}.`);
  if (!allPass && input(env, "fail", "true") !== "false") {
    log(`::error::buzzcut: a commit message in this push doesn't pass (max ${max}, no \u2717 errors). See the job summary.`);
    return 1;
  }
  return 0;
}
async function runCi(run) {
  const { env, log } = run;
  const eventName = env.GITHUB_EVENT_NAME ?? "";
  if (eventName === "push") return runPush(run);
  if (!/^pull_request/.test(eventName)) {
    log(`buzzcut: "${eventName || "unknown"}" isn't a pull_request or push event, so there's nothing to check.`);
    return 0;
  }
  const event = JSON.parse(readFileSync5(env.GITHUB_EVENT_PATH ?? "", "utf8"));
  const pull = event.pull_request;
  if (!pull) {
    log("buzzcut: the event has no pull_request payload.");
    return 0;
  }
  if (isBot(pull.user)) {
    log(`buzzcut: #${pull.number} was opened by a bot (${pull.user?.login}), skipping.`);
    return 0;
  }
  const { owner, repo, workspace, config, max, client, style } = setup(run);
  const ref = { owner, repo, number: pull.number };
  const files = await fetchPrFiles(client, ref, pull.changed_files);
  const diff = buildDiff(files, { additions: pull.additions, deletions: pull.deletions }, files.length < pull.changed_files);
  const template = findTemplate(existsSync5(workspace) ? workspace : null) ?? await fetchTemplate(client, owner, repo, pull.base.sha).catch(() => null);
  const opts = { style, template, rules: config.rules, length: config.length };
  const prReport = analyze(prMessage(pull.title, pull.body ?? ""), diff, opts);
  const commits = [];
  let checked = 0;
  if (input(env, "commits", "true") !== "false") {
    const list = await client.get(`/repos/${owner}/${repo}/pulls/${pull.number}/commits?per_page=100`);
    for (const c of list) {
      if (checked >= MAX_COMMITS) break;
      const r = await checkCommit(client, owner, repo, c.sha, c.commit.message, c.parents.length, { style, config });
      if (!r) continue;
      commits.push(r);
      checked++;
    }
  }
  const allPass = passes(prReport, max) && commits.every((c) => passes(c.report, max));
  const markdown = renderMarkdown(prReport, commits, max, checked);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, markdown.replace(MARKER + "\n", "") + "\n");
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `score=${prReport.score}
grade=${prReport.grade}
pass=${allPass}
`);
  if (input(env, "comment", "true") !== "false") {
    try {
      const existing = await findComment(client, owner, repo, pull.number);
      if (existing) {
        await client.send("PATCH", `/repos/${owner}/${repo}/issues/comments/${existing.id}`, { body: markdown });
        log(`buzzcut: updated comment ${existing.id}`);
      } else if (!allPass) {
        await client.send("POST", `/repos/${owner}/${repo}/issues/${pull.number}/comments`, { body: markdown });
        log("buzzcut: posted a comment");
      }
    } catch (e) {
      const status = e instanceof GitHubError ? e.status : 0;
      log(
        `::warning::buzzcut couldn't comment${status === 403 ? " (the token is read-only: add `permissions: pull-requests: write`, or this is a fork PR)" : ""}: ${e.message}`
      );
    }
  }
  log(`buzzcut: PR yap score ${prReport.score}/100 (${prReport.grade}); ${checked} commit${checked === 1 ? "" : "s"} checked; ${allPass ? "passes" : "needs work"}.`);
  if (!allPass && input(env, "fail", "true") !== "false") {
    log(`::error::buzzcut: the PR description or a commit message doesn't pass (max ${max}, no \u2717 errors). See the job summary.`);
    return 1;
  }
  return 0;
}

// src/action.ts
runCi({ env: process.env, fetch, cwd: process.cwd(), log: (l) => console.log(l) }).then(
  (code) => process.exit(code),
  (err) => {
    console.log(`::warning::buzzcut hit an internal error and skipped this run: ${err?.message ?? err}`);
    process.exit(0);
  }
);
