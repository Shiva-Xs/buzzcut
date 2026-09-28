#!/usr/bin/env node

// src/cli.ts
import { execFileSync as execFileSync4 } from "child_process";
import { readFileSync as readFileSync10 } from "fs";
import { homedir as homedir2 } from "os";
import { basename, resolve as resolve7 } from "path";

// package.json
var package_default = {
  name: "buzzcut",
  version: "0.1.2",
  description: "Makes coding agents write commits and PRs a reviewer can read: what changed and why, checked against the actual diff. No API key, no LLM.",
  type: "module",
  bin: {
    buzzcut: "dist/cli.js"
  },
  main: "dist/index.js",
  types: "dist/index.d.ts",
  exports: {
    ".": {
      types: "./dist/index.d.ts",
      import: "./dist/index.js"
    }
  },
  files: [
    "dist",
    "bundle/buzzcut.mjs",
    "skills",
    "schema.json"
  ],
  engines: {
    node: ">=20"
  },
  scripts: {
    build: "tsup",
    "build:site": "node scripts/build-site.mjs",
    test: "tsup && vitest run",
    "test:unit": "vitest run --exclude test/e2e.test.ts",
    "test:pack": "node scripts/smoke-pack.mjs",
    typecheck: "tsc --noEmit",
    hero: "node scripts/hero.mjs",
    "bench:fetch": "node bench/fetch.mjs",
    bench: "node bench/score.mjs",
    prepublishOnly: "npm run typecheck && npm test && npm run test:pack"
  },
  keywords: [
    "git",
    "commit",
    "commit-message",
    "pull-request",
    "pr-description",
    "linter",
    "ai",
    "slop",
    "claude-code",
    "cursor",
    "codex",
    "agent-skills"
  ],
  author: "Shivateja Janjirala <shivateja.janjirala@gmail.com> (https://shivateja.dev)",
  license: "MIT",
  repository: {
    type: "git",
    url: "git+https://github.com/Shiva-Xs/buzzcut.git"
  },
  homepage: "https://github.com/Shiva-Xs/buzzcut#readme",
  bugs: "https://github.com/Shiva-Xs/buzzcut/issues",
  devDependencies: {
    "@types/node": "^20.14.0",
    esbuild: "^0.27.7",
    tsup: "^8.3.0",
    typescript: "^5.6.0",
    vitest: "^2.1.0"
  }
};

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
  const additions = totals?.additions ?? files.reduce((n3, f) => n3 + f.additions, 0);
  const deletions = totals?.deletions ?? files.reduce((n3, f) => n3 + f.deletions, 0);
  const tests = files.filter((f) => isTest(f.path));
  const docs = files.filter((f) => isDoc(f.path));
  const source = files.filter((f) => !isTest(f.path) && !isDoc(f.path));
  const generated = files.filter(generatedFile).reduce((n3, f) => n3 + f.additions + f.deletions, 0);
  return { files, additions, deletions, changedLines: Math.max(0, additions + deletions - generated), tests, docs, source, truncated };
}
function diffSignature(d) {
  return d.files.map((f) => `${f.path}:${f.additions}:${f.deletions}`).sort().join("|");
}
function renamedPath(p) {
  if (p.includes("{") && p.includes(" => ")) {
    return p.replace(/\{([^}]*) => ([^}]*)\}/, "$2").replace(/\/\/+/g, "/");
  }
  const arrow = p.indexOf(" => ");
  return arrow === -1 ? p : p.slice(arrow + 4);
}
function parseNumstat(out) {
  const files = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^(-|\d+)\t(-|\d+)\t(.+)$/);
    if (!m) continue;
    files.push({
      path: renamedPath(m[3]),
      additions: m[1] === "-" ? 0 : Number(m[1]),
      deletions: m[2] === "-" ? 0 : Number(m[2]),
      ...m[3].includes(" => ") ? { renamed: true } : {}
    });
  }
  return files;
}
function areasOf(files, max = 6) {
  const by = /* @__PURE__ */ new Map();
  for (const f of files) {
    if (generatedFile(f)) continue;
    const parts = f.path.split("/");
    const deep = parts.length > 2 && /^(src|lib|packages|apps|crates|pkg|internal|cmd|app|services)$/.test(parts[0]);
    const area = parts.length === 1 ? "(root)" : deep ? `${parts[0]}/${parts[1]}` : parts[0];
    const a = by.get(area) ?? { lines: 0, files: 0 };
    a.lines += f.additions + f.deletions;
    a.files++;
    by.set(area, a);
  }
  return [...by.entries()].map(([area, a]) => ({ area, ...a })).sort((x, y) => y.lines - x.lines).slice(0, max);
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
function inRepo(cwd) {
  return git(["rev-parse", "--is-inside-work-tree"], cwd)?.trim() === "true";
}
function markGenerated(files, cwd) {
  if (!files.length) return files;
  let out = null;
  try {
    out = execFileSync("git", ["check-attr", "-z", "--stdin", "linguist-generated"], {
      cwd,
      encoding: "utf8",
      input: files.map((f) => f.path).join("\0"),
      stdio: ["pipe", "pipe", "ignore"]
    });
  } catch {
    return files;
  }
  const parts = out.split("\0");
  const marked = /* @__PURE__ */ new Set();
  for (let i = 0; i + 2 < parts.length; i += 3) if (parts[i + 2] === "true" || parts[i + 2] === "set") marked.add(parts[i]);
  return marked.size ? files.map((f) => marked.has(f.path) ? { ...f, generated: true } : f) : files;
}
var diffOf = (out, cwd) => buildDiff(markGenerated(parseNumstat(out), cwd));
function stagedDiff(cwd) {
  const out = git(["diff", "--cached", "--numstat", "-M"], cwd);
  if (!out?.trim()) return null;
  return diffOf(out, cwd);
}
function commitDiff(rev, cwd) {
  const out = git(["show", "--numstat", "--format=", "-M", rev], cwd);
  if (out == null) return null;
  return diffOf(out, cwd);
}
function commitMessage(rev, cwd) {
  return git(["log", "-1", "--format=%B", rev], cwd);
}
function recentCommits(n3, cwd) {
  return (git(["log", `-${n3}`, "--no-merges", "--format=%H"], cwd) ?? "").split("\n").filter(Boolean);
}
function defaultBase(cwd) {
  const head = git(["rev-parse", "--abbrev-ref", "origin/HEAD"], cwd)?.trim();
  if (head && head !== "origin/HEAD") return head;
  for (const ref of ["origin/main", "origin/master", "main", "master"]) {
    if (git(["rev-parse", "--verify", "--quiet", ref], cwd)) return ref;
  }
  return null;
}
function branchCommits(base, cwd, max = 30) {
  const out = git(["log", "--no-merges", "--reverse", "--format=%s", `${base}..HEAD`], cwd);
  const all = (out ?? "").split("\n").filter(Boolean);
  return all.length > max ? all.slice(-max) : all;
}
function branchDiff(base, cwd, head = "HEAD") {
  const out = git(["diff", "--numstat", "-M", `${base}...${head}`], cwd);
  if (out == null) return null;
  return diffOf(out, cwd);
}
var EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
function amendDiff(cwd) {
  if (git(["rev-parse", "--verify", "-q", "HEAD"], cwd) == null) return stagedDiff(cwd);
  const parent = git(["rev-parse", "--verify", "-q", "HEAD^"], cwd)?.trim() || EMPTY_TREE;
  const out = git(["diff", "--cached", "--numstat", "-M", parent], cwd);
  return out?.trim() ? diffOf(out, cwd) : null;
}
function lineCount(path) {
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size > 2 * 1024 * 1024) return 0;
    const buf = readFileSync2(path);
    if (buf.includes(0)) return 0;
    let n3 = 0;
    for (const b of buf) if (b === 10) n3++;
    return n3 + (buf.length && buf[buf.length - 1] !== 10 ? 1 : 0);
  } catch {
    return 0;
  }
}
function worktreeDiff(cwd, opts = { untracked: true }) {
  const root = git(["rev-parse", "--show-toplevel"], cwd)?.trim();
  if (!root) return null;
  const hasHead = git(["rev-parse", "--verify", "-q", "HEAD"], root) != null;
  const files = parseNumstat((hasHead ? git(["diff", "HEAD", "--numstat", "-M"], root) : git(["diff", "--cached", "--numstat"], root)) ?? "");
  if (opts.untracked) {
    const others = (git(["ls-files", "--others", "--exclude-standard", "-z"], root) ?? "").split("\0").filter(Boolean);
    for (const p of others.slice(0, 1e3)) files.push({ path: p, additions: lineCount(join2(root, p)), deletions: 0 });
  }
  return files.length ? buildDiff(markGenerated(files, root)) : null;
}
function gitPath(name, cwd) {
  const p = git(["rev-parse", "--git-path", name], cwd)?.trim();
  return p ? resolve(cwd ?? process.cwd(), p) : null;
}
function operationInProgress(cwd) {
  return ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"].some((n3) => {
    const p = gitPath(n3, cwd);
    return p != null && existsSync2(p);
  });
}

// src/facts.ts
var EVIDENCE = /https?:\/\/[^\s)>\]]+|(?<![\w/])#\d+\b|\b[A-Z][A-Z0-9]+-\d+\b|\b[\w./-]+\.[A-Za-z]+:\d+\b|\$\d+(?:[.,]\d+)*\b|\b\d+(?:[.,]\d+)*\s?(?:%|ms|µs|us|ns|s|sec|seconds?|min|minutes?|h|hours?|x|×|kb|mb|gb|tb|px|rps|qps|rows?|tests?|files?|lines?|calls?|requests?|errors?|users?|orders?|items?|bytes?)(?![\w])|\b(?:\d{1,3}(?:,\d{3})+|\d{3,})(?:[.,]\d+)*\b|\bv?\d+\.\d+(?:\.\d+)*\b/g;
var NOISE = /localhost|127\.0\.0\.1|claude\.(?:com\/claude-code|ai\/code)|chatgpt\.com\/codex|cursor\.com\/(?:assets|agents|background|artifacts|cn)|app\.devin\.ai|shields\.io|user-attachments|\.(?:png|jpe?g|gif|svg|webp|mp4|mov)\b/i;
var norm = (s) => s.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim().toLowerCase().replace(/[.,;:]+$/, "");
function evidenceOf(text) {
  const prose = text.replace(/```[\s\S]*?```/g, " ").replace(/<!--[\s\S]*?-->/g, " ").split("\n").filter((l) => !/^\s*([\w-]+-by|change-id):/i.test(l)).join("\n");
  const out = /* @__PURE__ */ new Set();
  for (const m of prose.matchAll(EVIDENCE)) {
    if (NOISE.test(m[0])) continue;
    const f = norm(m[0]);
    if (/^(19|20)\d\d$/.test(f)) continue;
    out.add(f);
  }
  for (const line of prose.split("\n")) {
    const parts = line.split("`");
    for (let i = 1; i < parts.length - 1; i += 2) {
      const span = parts[i].trim();
      if (span.length > 2 && /[\s:=]/.test(span)) out.add(norm(span));
    }
  }
  for (const m of prose.matchAll(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,64}\b/g)) out.add(m[0]);
  for (const m of prose.matchAll(/["“]([^"”]*)["”]/g)) {
    const q2 = m[1].replace(/\s+/g, " ").trim();
    if (q2.length >= 12 && q2.length <= 160 && q2.split(" ").length >= 3) out.add(norm(q2));
  }
  return [...out];
}
var digits = (s) => s.replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
function droppedEvidence(before, afterText) {
  const now = digits(norm(afterText.replace(/[`*_]/g, "")));
  return before.filter((f) => !now.includes(digits(f)));
}
var TTL = 60 * 60 * 1e3;
function draftFile(key, cwd) {
  const common = git(["rev-parse", "--git-common-dir"], cwd)?.trim();
  if (!common) return null;
  const id = createHash("sha1").update(key).digest("hex").slice(0, 12);
  return join3(resolve2(cwd, common), "buzzcut-drafts", `${id}.json`);
}
function readDraft(key, cwd, now = Date.now()) {
  try {
    const f = draftFile(key, cwd);
    if (!f || !existsSync3(f)) return null;
    const d = JSON.parse(readFileSync3(f, "utf8"));
    return now - d.at < TTL && Array.isArray(d.evidence) ? d : null;
  } catch {
    return null;
  }
}
function saveDraft(key, cwd, draft) {
  try {
    const f = draftFile(key, cwd);
    if (!f) return;
    mkdirSync(join3(f, ".."), { recursive: true });
    writeFileSync(f, JSON.stringify(draft));
  } catch {
  }
}
function clearDraft(key, cwd) {
  try {
    const f = draftFile(key, cwd);
    if (f) rmSync(f, { force: true });
  } catch {
  }
}

// src/template.ts
import { existsSync as existsSync4, readdirSync, readFileSync as readFileSync4, statSync as statSync2 } from "fs";
import { join as join4, relative } from "path";
function normalizeLine(s) {
  return s.replace(/^(\s*[-*+]\s+)\[[xX]\]/, "$1[ ]").replace(/\s+/g, " ").trim().replace(/:$/, "").toLowerCase();
}
function parseTemplate(texts) {
  const lines2 = /* @__PURE__ */ new Set();
  for (const { text } of texts) {
    const clean = text.replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?-->/g, "");
    for (const l of clean.split("\n")) {
      const n3 = normalizeLine(l);
      if (n3 && n3.length > 1) lines2.add(n3);
    }
  }
  return lines2.size ? { paths: texts.map((t) => t.path), lines: lines2 } : null;
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
  const lines2 = [];
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
    lines2.push({ n: firstLine + i, text });
  });
  const facts = {
    lines: lines2,
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
  for (let i = 0; i < lines2.length; i++) {
    const line = lines2[i];
    const t = line.text;
    if (!t.trim()) continue;
    if (/^\s*\|/.test(t)) {
      if (TABLE_SEP.test(lines2[i + 1]?.text ?? "")) facts.tables++;
      continue;
    }
    facts.words += countWords(t);
    const next = lines2.slice(i + 1).find((l) => l.text.trim())?.text ?? "";
    if (LABEL.test(t) && countWords(t) <= 5 && (BULLET.test(next) || /^\s{2,}\S/.test(next))) facts.labels.push(line);
    const heading = HEADING.test(t);
    if (heading) facts.headings.push(line);
    if (TICKED.test(t)) facts.ticked.push(line);
    else if (BULLET.test(t) && !CHECKBOX.test(t)) {
      facts.bullets.push(line);
      let words = countWords(t);
      for (let j = i + 1; j < lines2.length; j++) {
        const next2 = lines2[j].text;
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
function specificity(lines2, words, files = /* @__PURE__ */ new Set()) {
  if (!words) return 0;
  let n3 = 0;
  for (const l of lines2) {
    for (const m of l.text.matchAll(SPECIFIC)) {
      const name = m[1] ?? m[2];
      if (name && (files.has(name) || files.has(name.split("/").pop()))) continue;
      n3++;
    }
  }
  return 100 * n3 / words;
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
function hits(lines2, re, skip) {
  const out = [];
  for (const line of lines2) {
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
function claims(lines2, re, skipLine) {
  const out = [];
  for (const line of lines2) {
    if (skipLine?.(line)) continue;
    for (const sentence2 of line.text.split(/(?<=[.!?;])\s+/)) {
      const m = sentence2.match(re);
      if (!m) continue;
      const at = m.index ?? 0;
      if (notAClaim(sentence2.slice(Math.max(0, at - 30), at + m[0].length + 30))) continue;
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
    const n3 = diff.changedLines;
    const allowed = n3 < 30 ? 1 : n3 < 100 ? 2 : n3 < 300 ? 3 : 6;
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
      message: `${form.length} template sections on a ${n3}-line diff`,
      hint: n3 < 30 ? "Drop the section headers. On a diff this size, one or two sentences on what changed and why, then a Tested line, say it all." : "Drop the section headers: an opening on what changed and why, a few bullets a reviewer would ask about, and a Tested line. Keep every fact that was under them.",
      line: form[0].n,
      data: { headers: form.length, lines: n3 }
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
  for (const sentence2 of clean.split(/(?<=[.!?;])\s+/)) {
    if (QUESTION.test(sentence2)) continue;
    for (const re of [AUTHORED, INTRODUCED, LEAD_NEW]) {
      for (const m of sentence2.matchAll(re)) {
        const noun = m[1];
        const at = m.index ?? 0;
        const end = at + m[0].length;
        if (/^Spec/.test(noun)) continue;
        if (re !== INTRODUCED && !NOUN_ENDS.test(sentence2.slice(end))) continue;
        const near = sentence2.slice(Math.max(0, at - 30), end + 30);
        if (NEGATED.test(near) || MODAL.test(near) || INSTRUCTION.test(sentence2)) continue;
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
      const q2 = quote(match);
      return {
        rule: "phantom-tests",
        severity: "error",
        points: 25,
        message: `Says "${q2}" but no test files changed`,
        hint: "Remove the claim or add the tests. If existing tests cover this, name the test and the command you ran.",
        line: lineOf(line),
        quote: q2
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
    const q2 = quote(found.match);
    return {
      rule: "vague-verification",
      severity: "warn",
      points: 6,
      message: `"${q2}", but tested how?`,
      hint: "Name the command or steps you ran and the result, e.g. `go test ./billing/...` passes, or the manual steps you took.",
      line: found.line.n,
      quote: q2
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
    const q2 = quote(found.line.text);
    const ranSomething = s.exercised.length > 0;
    return {
      rule: "unverified-in-session",
      severity: ranSomething ? "warn" : "error",
      points: ranSomething ? 10 : 25,
      message: ranSomething ? `Says "${q2}", but no test command ran in this session` : `Says "${q2}", but nothing was run or tried in this session`,
      hint: 'Only report what actually happened: run the tests and quote the result, or write "Not tested" / "Tests not run".',
      line: lineOf(found.line),
      quote: q2
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
    const heads2 = new Set(text.headings);
    const bullet = /^\s*([-*+•]|\d{1,2}[.)])\s+/;
    const lead = (t) => t.replace(/^\s*([-*+•]|\d{1,2}[.)])?\s*(\*\*|__)?/, "").slice(0, 40);
    const verbFirst = new RegExp(`^(?:updated?|modif(?:y|ied)|chang(?:e|ed|es)|edit(?:ed|s)?|add(?:ed|s)?|remov(?:e|ed|es)|delet(?:e|ed|es)|renam(?:e|ed|es)|refactor(?:ed|s)?|creat(?:e|ed|es)|introduc(?:e|ed|es)|tweak(?:ed|s)?)\\b.{0,25}?(?<![\\w/.-])(?:${alt})(?![\\w-])`, "i");
    const labelFirst = new RegExp(`^\`?(?:${alt})\`?\\s*(?::|\u2014|\u2013|-\\s)`);
    const echoes = text.lines.filter((l) => {
      if (heads2.has(l)) return false;
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
var EVIDENCE2 = /\d+(?:\.\d+)?\s?(?:%|x|×|ms|µs|us|ns|s|sec|secs|seconds|mb|kb|gb|rps|qps|req\/s)\b|\bbenchmark|\bp(?:50|90|95|99)\b|→|->|\bfrom \d/i;
var unbackedClaim = {
  id: "unbacked-claim",
  kinds: ["commit", "pr"],
  run(ctx) {
    const found = [];
    const lines2 = titleAndBody(ctx);
    const prose = lines2.filter((l) => l.text.trim());
    for (const line of lines2) {
      const at = prose.indexOf(line);
      const near = at === -1 ? [line] : prose.slice(at, at + 3);
      if (near.some((l) => EVIDENCE2.test(l.text))) continue;
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
    const n3 = diff?.changedLines;
    const all = [msg.title, ...text.lines.map((l) => l.text)].join("\n");
    if (WHY.test(all) || NEED.test(all) || TICKET_ID.test(all)) return null;
    if (latinShare(all) < 0.5) return null;
    if (msg.kind === "pr") {
      if (n3 != null && n3 <= 20) return null;
      const empty = text.words === 0;
      if (empty && n3 != null && n3 >= BIG) return null;
      return {
        rule: "missing-why",
        severity: "warn",
        points: 8,
        message: empty ? `No description${n3 != null ? ` for a ${n3}-line diff` : ""}` : "Explains what changed, never why",
        hint: "Add one sentence on why, from what you know: the bug it fixes, who asked for it, or the issue link. If nobody said why, leave it out rather than guess."
      };
    }
    if (n3 == null || n3 <= 150 || text.words > 0) return null;
    return {
      rule: "missing-why",
      severity: "info",
      points: 4,
      message: `${n3}-line commit with no body saying why`,
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
    const n3 = diff.changedLines;
    const prose = text.lines.filter((l) => l.text.trim() && !text.headings.includes(l));
    if (n3 >= BIG && prose.length <= 1 && text.words < 30) {
      return {
        rule: "thin-description",
        severity: "warn",
        points: 12,
        message: text.words ? `A one-line description for a ${n3}-line diff` : `No description for a ${n3}-line diff`,
        hint: "Give the reviewer a map: what changed and why (the bug, the request, the issue), the few behavior changes worth a real look and where they are, what's mechanical and roughly how much of the diff it is, and a Tested line with what you ran.",
        data: { lines: n3, words: text.words }
      };
    }
    if (n3 < 30 || !text.words || !diff.source.length && !diff.tests.length) return null;
    const all = [msg.title, ...prose.map((l) => l.text)].join("\n");
    if (VERIFIED.test(all) || /\bCI\b/.test(all) || prose.some((l) => COMMAND.test(l.text) || RESULT.test(l.text))) return null;
    return {
      rule: "thin-description",
      severity: "warn",
      points: 4,
      message: "Doesn't say how it was tested",
      hint: 'End with a Tested line: the commands you ran in this session and what they returned (`npm test`, 212 passed). If nothing ran, write "Not tested" and what should be checked.',
      data: { lines: n3, words: text.words }
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
    const q2 = quote(h.match);
    return {
      rule: "ai-opener",
      severity: "warn",
      points: 6,
      message: `Opens with "${q2}\u2026"`,
      hint: 'Start with the change itself: "Retry webhook sends on 5xx so \u2026".',
      line: h.line.n,
      quote: q2
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
    const q2 = quote(h.match);
    return {
      rule: "ai-closer",
      severity: "warn",
      points: 6,
      message: `Wrap-up sentence: "${q2}\u2026"`,
      hint: "Delete the conclusion. The reader just read the description.",
      line: h.line.n,
      quote: q2
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
    const q2 = quote(h.match);
    return {
      rule: "chatbot-leftovers",
      severity: "error",
      points: 15,
      message: `Chatbot voice left in: "${q2}"`,
      hint: "Delete it. That line was written to you, not to the reviewer.",
      line: lineOf(h.line),
      quote: q2
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
function clamp(n3, lo, hi) {
  return Math.max(lo, Math.min(hi, n3));
}
var bulletBloat = {
  id: "bullet-bloat",
  kinds: ["commit", "pr"],
  run({ msg, text, diff, length: length2 }) {
    const b = text.bullets.length;
    const n3 = diff?.changedLines;
    const base = msg.kind === "pr" ? n3 != null ? clamp(Math.round(2 + Math.sqrt(n3) / 1.5), 5, 15) : 8 : n3 != null ? clamp(Math.round(1 + Math.sqrt(n3) / 3), 2, 8) : 5;
    const allowed = Math.max(2, Math.round(base * LENGTHS[length2]));
    if (b <= allowed) return null;
    return {
      rule: "bullet-bloat",
      severity: "warn",
      points: Math.min(20, 2 * (b - allowed)),
      message: n3 != null ? `${b} bullet points for a ${n3}-line diff (max ${allowed})` : `${b} bullet points (max ${allowed})`,
      hint: msg.kind === "pr" ? `Keep the bullets a reviewer would ask about (${allowed} at most here): each a behavior change, where to look, and the values. Group the rest by area or drop it; the diff lists the files.` : "Keep the bullets for the parts of the change a reviewer would ask about; git log reads the rest better as a sentence or two.",
      line: text.bullets[0].n,
      data: { count: b, allowed, lines: n3 ?? 0 }
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
  const n3 = own.length;
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
    sample: n3,
    conventional: conventional / n3,
    types: [...types.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t),
    ticket: ticket / n3,
    ticketExample,
    capitalized: letters ? upper / letters : 0.5,
    subjectP50: percentile(lengths, 0.5),
    subjectP90: percentile(lengths, 0.9),
    body: body / n3,
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
    const n3 = text.headings.length + text.emojiLed.length + (text.boldLabels >= 2 ? text.boldLabels : 0) + (inSubject ? 2 : 0);
    if (!n3) return null;
    const first = inSubject ? { n: 1 } : text.headings[0] ?? text.emojiLed[0];
    return {
      rule: "markdown-in-commit",
      severity: "warn",
      points: Math.min(12, 4 + 2 * n3),
      message: inSubject ? "Markdown in the subject line" : "Markdown headers or bold labels in a commit message",
      hint: 'git log shows raw text, so "## Summary" and **bold** show up as literal symbols. Use plain sentences.',
      line: first?.n
    };
  }
};
var clamp2 = (n3, lo, hi) => Math.max(lo, Math.min(hi, n3));
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
    const n3 = diff?.changedLines;
    const allowed = n3 != null ? clamp2(Math.round(1 + Math.sqrt(n3) / 3), 2, 8) : 5;
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
var clamp3 = (n3, lo, hi) => Math.max(lo, Math.min(hi, n3));
function sizeOf(diff) {
  return diff.changedLines < 30 ? "tiny" : diff.changedLines < 300 ? "normal" : "big";
}
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
function gradeOf(score2) {
  const [, grade, verdict] = GRADES.find(([max]) => score2 <= max);
  return { grade, verdict };
}
var EDITOR_TEMPLATE = /^# (Please enter the commit message|On branch |Changes to be committed|-+ >8 -+$)/;
function parseCommit(raw) {
  let lines2 = raw.replace(/\r\n?/g, "\n").split("\n");
  if (lines2.some((l) => EDITOR_TEMPLATE.test(l))) {
    const scissors = lines2.findIndex((l) => /^# -+ >8 -+$/.test(l));
    if (scissors !== -1) lines2 = lines2.slice(0, scissors);
    lines2 = lines2.filter((l) => !l.startsWith("#"));
  }
  while (lines2.length && !lines2[0].trim()) lines2.shift();
  const title = (lines2[0] ?? "").trim();
  const body = lines2.slice(1).join("\n").replace(/\s+$/, "");
  return { kind: "commit", title, body, bodyLine: 2 };
}
function historyMessage(raw) {
  const msg = parseCommit(raw);
  return /\(#\d+\)$/.test(msg.title) ? prMessage(msg.title, msg.body) : msg;
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
  const score2 = Math.min(100, findings.reduce((n3, f) => n3 + f.points, 0));
  return { kind: msg.kind, title: msg.title, score: score2, ...gradeOf(score2), words: text.words, budget, density: Math.round(density * 10) / 10, diff, findings };
}
var CLAIMS2 = /* @__PURE__ */ new Set(["phantom-tests", "unverified-in-session", "vague-verification", "ticked-boxes", "unbacked-claim"]);
function keepableEvidence(msg, r) {
  const flagged = new Set(r.findings.filter((f) => CLAIMS2.has(f.rule) && f.line).map((f) => f.line));
  const lines2 = msg.body.split("\n").filter((_, i) => !flagged.has(msg.bodyLine + i));
  return evidenceOf([msg.title, ...lines2].join("\n"));
}

// src/repo.ts
function repoRoot(cwd) {
  return git(["rev-parse", "--show-toplevel"], cwd)?.trim() || null;
}
function loadRepo(cwd) {
  const root = repoRoot(cwd);
  if (!root) return { root: null, config: DEFAULTS, style: null, template: null };
  return { root, config: loadConfig(root, RULE_IDS), style: repoStyle(root), template: findTemplate(root) };
}

// src/context.ts
var linesOf = (f) => f.additions + f.deletions;
var byLines = (files) => [...files].sort((a, b) => linesOf(b) - linesOf(a)).map((f) => ({ path: f.path, lines: linesOf(f) }));
function shapeFor(kind, size) {
  if (kind === "commit") {
    return [
      "Subject: what changed, 72 characters or fewer, plain text, in this repo's style.",
      `Body only if the why isn't obvious: 1 to 3 lines on why, plus a few plain "- " bullets if the change has several parts.`
    ];
  }
  const opening = 'Opening, 1 or 2 sentences: what changed and why, in plain words (no "What:" or "Why:" labels).';
  const tested = 'Tested: the commands you ran and what they returned. If nothing ran, "Not tested:" and what should be checked.';
  const risk = "Optional, one line: a risk, breaking change, migration or follow-up.";
  if (size === "tiny") return [opening, "Bullets only if there are 2 or more separate behavior changes.", risk, tested];
  const bullets = size === "big" ? "2 to 5 bullets, more on a diff this big: the changes a reviewer would ask about, one per bullet in about 25 words, each with where to look and the values (old \u2192 new, limits, defaults). More bullets, not longer ones. Group by area, never file by file. Say which part is mechanical and roughly how much of the diff it is." : "2 to 5 bullets: the changes a reviewer would ask about, one per bullet in about 25 words, each with where to look (function, setting, endpoint) and the values (old \u2192 new, limits, defaults). Group by area, never file by file.";
  return [opening, bullets, risk, tested];
}
var LENGTH_NOTE = {
  short: "Fewer, tighter bullets and no extra background; still say what changed and why, keep every fact, and keep the Tested line.",
  detailed: "More room for reasoning: the design choices, what was ruled out and why, and the risks, still grouped by area, never file by file."
};
function buildContext(kind, cwd, base) {
  const repo = loadRepo(cwd);
  let diff = null;
  let source = "none";
  let usedBase = null;
  let commits = null;
  if (repo.root) {
    if (kind === "commit") {
      diff = stagedDiff(cwd);
      source = "staged";
      if (!diff) {
        diff = worktreeDiff(cwd);
        source = diff ? "working tree" : "none";
      }
    } else {
      usedBase = base ?? defaultBase(cwd);
      diff = usedBase ? branchDiff(usedBase, cwd) : null;
      source = diff ? "branch" : "none";
      commits = usedBase ? branchCommits(usedBase, cwd) : null;
    }
  }
  return contextOf(kind, diff, { source, base: usedBase, commits, style: repo.style, template: kind === "pr" ? repo.template?.paths ?? null : null, length: repo.config.length });
}
function contextOf(kind, diff, opts = {}) {
  const { source = diff ? "branch" : "none", base = null, commits = null, style: s = null, template = null, length: length2 = "normal" } = opts;
  const range = wordRange(kind, diff, length2);
  const areas = diff ? areasOf(diff.files, Infinity) : [];
  const AREAS = 8;
  return {
    kind,
    source,
    base,
    diff: diff && {
      files: diff.files.length,
      additions: diff.additions,
      deletions: diff.deletions,
      changedLines: diff.changedLines,
      size: sizeOf(diff),
      // Biggest changes first: that's what the description should be about.
      paths: byLines(diff.files).slice(0, 12).map((f) => f.path),
      testFiles: diff.tests.length,
      docFiles: diff.docs.length,
      large: diff.changedLines >= 500 || diff.files.length >= 25,
      areas: areas.slice(0, AREAS),
      moreAreas: Math.max(0, areas.length - AREAS),
      tests: byLines(diff.tests),
      docs: byLines(diff.docs),
      generated: byLines(diff.files.filter(generatedFile)),
      renames: diff.files.filter((f) => f.renamed && linesOf(f) === 0).map((f) => f.path),
      pureRenames: diff.files.filter((f) => f.renamed && linesOf(f) === 0).length
    },
    commits,
    length: length2,
    range,
    budget: range.budget,
    shape: shapeFor(kind, diff ? sizeOf(diff) : null),
    style: s && {
      sample: s.sample,
      conventional: s.conventional,
      types: s.types.slice(0, 6),
      capitalized: s.capitalized,
      ticket: s.ticket,
      ticketExample: s.ticketExample,
      subjectP50: s.subjectP50,
      body: s.body,
      mood: s.mood,
      examples: s.examples
    },
    template
  };
}
var pct2 = (x) => `${Math.round(x * 100)}%`;
var n = (x) => x.toLocaleString("en-US");
var plural = (k, one, many = `${one}s`) => `${n(k)} ${k === 1 ? one : many}`;
function list(files, max = 6) {
  const shown = files.slice(0, max).map((f) => `${f.path} (${n(f.lines)})`);
  return shown.join(", ") + (files.length > max ? `, +${files.length - max} more` : "");
}
var SIZE = { tiny: "tiny, under 30 lines", normal: "normal, 30 to 300 lines", big: "big, 300+ lines" };
function renderContext(c) {
  const out = [`buzzcut context \xB7 ${c.kind === "commit" ? "commit message" : "PR description"}`, ""];
  if (c.diff) {
    const d = c.diff;
    out.push(`Changes (${c.source}${c.base ? ` vs ${c.base}` : ""}): ${plural(d.files, "file")}, +${n(d.additions)} \u2212${n(d.deletions)}, ${n(d.changedLines)} changed lines (${SIZE[d.size]}).`);
    if (c.kind === "pr" || d.large || d.areas.length > 1) {
      out.push("By area, biggest first:");
      const w = Math.max(...d.areas.map((a) => a.area.length));
      for (const a of d.areas) out.push(`  ${a.area.padEnd(w)}  ${plural(a.lines, "line")}, ${plural(a.files, "file")}`);
      if (d.moreAreas) out.push(`  +${plural(d.moreAreas, "more area")}`);
    } else {
      out.push(`Files: ${d.paths.join(", ")}${d.files > d.paths.length ? `, +${d.files - d.paths.length} more` : ""}`);
    }
    out.push(d.tests.length ? `Tests: ${list(d.tests)}.` : "Tests: none changed, so don't say tests were added.");
    if (d.docs.length) out.push(`Docs: ${list(d.docs)}.`);
    if (d.generated.length) out.push(`Generated or lockfiles, not counted: ${list(d.generated, 4)}.`);
    if (d.renames.length) {
      const shown = d.renames.slice(0, 4).join(", ") + (d.renames.length > 4 ? `, +${d.renames.length - 4} more` : "");
      out.push(`Only moved or renamed: ${plural(d.renames.length, "file")} (${shown}). That part is mechanical.`);
    }
  } else {
    out.push("No diff found (nothing staged or changed), so only the wording can be checked.");
  }
  if (c.commits?.length) {
    out.push("", `Commits on this branch (${c.commits.length}), oldest first:`);
    for (const s of c.commits.slice(-12)) out.push(`  ${s}`);
    if (c.commits.length > 12) out.push(`  (${c.commits.length - 12} older not shown)`);
  }
  out.push("", `Shape${c.diff ? ` for a ${c.diff.size} ${c.kind === "commit" ? "change" : "diff"}` : ""}:`);
  if (c.kind === "pr") {
    const prefixed = c.style && c.style.conventional >= 0.6 && c.style.types.length;
    out.push(`  Title: what changed, specific, 72 characters or fewer${prefixed ? `, with a prefix like this repo's commits (${c.style.types.slice(0, 3).map((t) => `${t}:`).join(", ")})` : ""}.`);
  }
  c.shape.forEach((line, i) => out.push(c.kind === "pr" ? `  ${i + 1}. ${line}` : `  ${line}`));
  if (c.kind === "pr" && c.diff?.size === "big") out.push("  A few short plain headers are fine on a diff this big: Behavior changes / What's mechanical / How to review / Risk.");
  if (c.length !== "normal") out.push(`Length: ${c.length}, set in this repo's buzzcut config. ${LENGTH_NOTE[c.length]}`);
  if (c.kind === "pr") {
    out.push(`Words: about ${n(c.range.floor)} to ${n(c.range.budget)}. Text dense with numbers, code and links gets up to 2.5\xD7 the top; padding doesn't.`);
    out.push(
      "",
      "From your session, not the diff: the why (the bug, the error message quoted, the issue link, who asked) and the Tested line (the commands you ran in this session and what they returned)."
    );
  } else {
    out.push(`Body words: ${n(c.range.budget)} at most, up to 2.5\xD7 more if it's dense with specifics (numbers, code references, links). A body is optional.`);
  }
  if (c.style) {
    const s = c.style;
    const parts = [];
    if (s.conventional >= 0.6) parts.push(`conventional commits (${pct2(s.conventional)}; types: ${s.types.join(", ")})`);
    else if (s.conventional <= 0.1) parts.push("no conventional prefixes");
    if (s.ticket >= 0.6) parts.push(`subjects start with a ticket id like ${s.ticketExample}`);
    if (s.mood === "past") parts.push('subjects are in the past tense ("Added \u2026", not "Add \u2026"), so write yours that way');
    else if (s.mood === "imperative") parts.push('subjects are imperative ("Add \u2026")');
    if (s.capitalized >= 0.85) parts.push("subjects start with a capital letter");
    else if (s.capitalized <= 0.15) parts.push("subjects start lowercase");
    parts.push(`median subject ${s.subjectP50} characters`);
    parts.push(`${pct2(s.body)} of commits have a body`);
    out.push("", `Repo style (last ${s.sample} commits): ${parts.join("; ")}.`);
    if (c.kind === "commit" && s.examples.length) {
      out.push("Recent subjects:");
      for (const e of s.examples) out.push(`  ${e}`);
    }
  }
  if (c.template?.length) out.push("", `PR template: ${c.template.join(", ")}. Fill it in briefly in this shape; its boilerplate isn't counted.`);
  out.push(
    "",
    c.kind === "commit" ? "Next: write the message to .git/BUZZCUT_MSG and run `buzzcut check .git/BUZZCUT_MSG`." : 'Next: write the body to a file and run `buzzcut pr <file> --title "<title>"`.'
  );
  return out.join("\n");
}

// src/format.ts
function palette(enabled) {
  const wrap2 = (open, close) => (s) => enabled ? `\x1B[${open}m${s}\x1B[${close}m` : s;
  return {
    bold: wrap2(1, 22),
    dim: wrap2(2, 22),
    red: wrap2(31, 39),
    green: wrap2(32, 39),
    yellow: wrap2(33, 39),
    cyan: wrap2(36, 39),
    inverse: wrap2(7, 27)
  };
}
function useColor(stream = process.stdout) {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") return true;
  return Boolean(stream.isTTY);
}
var ICON = { error: "\u2717", warn: "!", info: "\xB7" };
function severityPaint(p, s) {
  return s === "error" ? p.red : s === "warn" ? p.yellow : p.dim;
}
function gradePaint(p, g) {
  return g === "A" || g === "B" ? p.green : g === "C" ? p.yellow : p.red;
}
function diffSummary(r) {
  if (!r.diff) return "no diff";
  const d = r.diff;
  return `${d.files.length} file${d.files.length === 1 ? "" : "s"}, +${d.additions} \u2212${d.deletions}`;
}
function scoreLine(r, p) {
  const g = gradePaint(p, r.grade);
  return `${p.bold("YAP SCORE")}  ${g(p.bold(`${r.score}/100`))}  ${g(p.inverse(` ${r.grade} `))}  ${r.verdict}`;
}
function tally(findings) {
  const count = (s) => findings.filter((f) => f.severity === s).length;
  const parts = [];
  const e = count("error");
  const w = count("warn");
  const i = count("info");
  if (e) parts.push(`${e} error${e > 1 ? "s" : ""}`);
  if (w) parts.push(`${w} warning${w > 1 ? "s" : ""}`);
  if (i) parts.push(`${i} note${i > 1 ? "s" : ""}`);
  return parts.join(" \xB7 ");
}
function wrap(text, width) {
  const lines2 = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + 1 + word.length > width) {
      lines2.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines2.push(line);
  return lines2;
}
function renderReport(r, opts) {
  const p = palette(opts.color);
  const out = [];
  out.push("");
  out.push(`  ${p.bold("buzzcut")} ${p.dim(`\xB7 ${opts.label ?? r.kind} \xB7 ${diffSummary(r)} \xB7 ${r.words} words (budget ${r.budget})`)}`);
  out.push("");
  out.push(`  ${scoreLine(r, p)}`);
  out.push("");
  if (!r.findings.length) {
    out.push(`  ${p.green("\u2713")} Nothing to cut.`);
    out.push("");
    return out.join("\n");
  }
  const width = Math.max(...r.findings.map((f) => f.rule.length)) + 2;
  const cols = Math.min(opts.width ?? 100, 100);
  const indent = " ".repeat(4 + width);
  for (const f of r.findings) {
    const paint = severityPaint(p, f.severity);
    const where = f.line ? p.dim(`  L${f.line}`) : "";
    out.push(`  ${paint(ICON[f.severity])} ${paint(f.rule.padEnd(width))}${f.message}${where}`);
    for (const l of wrap("\u2192 " + f.hint, Math.max(30, cols - indent.length))) out.push(indent + p.dim(l));
  }
  out.push("");
  const errors = r.findings.some((f) => f.severity === "error");
  const verdict = passes(r, opts.max) ? p.green(r.score > opts.max ? `passes (max ${opts.max}; length and shape warnings count for ${SHAPE_CAP} at most)` : `passes (max ${opts.max})`) : p.red(errors ? "fails: fix the \u2717 errors" : `fails (max ${opts.max})`);
  out.push(`  ${tally(r.findings)}  ${p.dim("\xB7")}  ${verdict}`);
  out.push("");
  return out.join("\n");
}
function toJson(r, max, extra = {}) {
  const { diff, ...rest } = r;
  return JSON.stringify(
    {
      ...extra,
      ...rest,
      pass: passes(r, max),
      max,
      diff: diff && {
        files: diff.files.length,
        additions: diff.additions,
        deletions: diff.deletions,
        changedLines: diff.changedLines,
        testFiles: diff.tests.length,
        docFiles: diff.docs.length,
        truncated: diff.truncated
      }
    },
    null,
    2
  );
}

// src/github.ts
function parsePrRef(input) {
  const s = input.trim();
  const url = s.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/pulls?\/(\d+)/i);
  const short = s.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/);
  const m = url ?? short;
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, ""), number: Number(m[3]) };
}
function parseRepoRef(input) {
  const s = input.trim().replace(/\/+$/, "");
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i) ?? s.match(/^([\w.-]+)\/([\w.-]+)$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}
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
function toPullRequest(ref, pr2, files) {
  return {
    ...ref,
    url: pr2.html_url,
    author: pr2.user?.login ?? "ghost",
    bot: isBot(pr2.user),
    title: pr2.title,
    body: pr2.body ?? "",
    diff: buildDiff(files, { additions: pr2.additions, deletions: pr2.deletions }, files.length < pr2.changed_files),
    baseSha: pr2.base?.sha
  };
}
async function fetchPr(ref, client) {
  const pr2 = await client.get(`/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`);
  return toPullRequest(ref, pr2, await fetchPrFiles(client, ref, pr2.changed_files));
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
async function fetchRecentPrs(client, ref, count) {
  const list2 = await client.get(`/repos/${ref.owner}/${ref.repo}/pulls?state=closed&sort=updated&direction=desc&per_page=50`);
  const picked = list2.filter((p) => p.merged_at && !isBot(p.user)).slice(0, count);
  const out = [];
  for (const p of picked) {
    const pr2 = { ...ref, number: p.number };
    const files = await fetchPrFiles(client, pr2, 100);
    const additions = files.reduce((t, f) => t + f.additions, 0);
    const deletions = files.reduce((t, f) => t + f.deletions, 0);
    out.push(toPullRequest(pr2, { ...p, additions, deletions, changed_files: files.length }, files));
  }
  return out;
}

// src/token.ts
import { execFileSync as execFileSync2 } from "child_process";
function localToken(env = process.env) {
  const t = env.GITHUB_TOKEN || env.GH_TOKEN;
  if (t) return t;
  try {
    return execFileSync2("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3e3 }).trim() || null;
  } catch {
    return null;
  }
}

// src/hooks.ts
import { readFileSync as readFileSync7 } from "fs";
import { resolve as resolve4 } from "path";

// src/agent.ts
var AGENT_VARS = [
  ["CLAUDECODE", "Claude Code"],
  ["CURSOR_AGENT", "Cursor"],
  ["GEMINI_CLI", "Gemini CLI"],
  ["CODEX_SANDBOX", "Codex"],
  ["CODEX_SANDBOX_NETWORK_DISABLED", "Codex"],
  ["OPENCODE_CLIENT", "OpenCode"],
  ["AUGMENT_AGENT", "Augment"],
  ["WINDSURF_AGENT", "Windsurf"],
  ["CODEIUM_AGENT", "Windsurf"],
  ["COPILOT_AGENT", "GitHub Copilot"],
  ["CLINE_AGENT", "Cline"],
  ["CONTINUE_AGENT", "Continue"]
];
var GENERIC_VARS = ["AI_AGENT", "AGENT"];
var set = (v) => v !== void 0 && v !== "" && v !== "0" && v.toLowerCase() !== "false";
function detectAgent(env = process.env) {
  const override = env.BUZZCUT_AGENT;
  if (override !== void 0 && override !== "") {
    if (!set(override)) return null;
    return override === "1" || override.toLowerCase() === "true" ? "agent" : override;
  }
  for (const [name, label] of AGENT_VARS) if (set(env[name])) return label;
  for (const name of GENERIC_VARS) {
    const v = env[name];
    if (set(v)) return v === "1" || v.toLowerCase() === "true" ? "agent" : v;
  }
  return null;
}

// src/seen.ts
import { createHash as createHash2 } from "crypto";
import { appendFileSync, existsSync as existsSync5, mkdirSync as mkdirSync2, readFileSync as readFileSync5, writeFileSync as writeFileSync2 } from "fs";
import { join as join5, resolve as resolve3 } from "path";
var TRAILER = /^\s*([\w-]+-by|change-id):/i;
var MAX = 2e3;
function fingerprint(message) {
  const lines2 = message.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() && !l.startsWith("#") && !TRAILER.test(l));
  return createHash2("sha1").update(lines2.join("\n")).digest("hex").slice(0, 16);
}
function seenFile(cwd) {
  const common = git(["rev-parse", "--git-common-dir"], cwd)?.trim();
  return common ? join5(resolve3(cwd, common), "buzzcut-seen") : null;
}
function readSeen(cwd) {
  const file = seenFile(cwd);
  if (!file || !existsSync5(file)) return null;
  try {
    const [head = "", ...rest] = readFileSync5(file, "utf8").split("\n");
    const since = Number(head.match(/^since (\d+)$/)?.[1]);
    if (!Number.isFinite(since)) return null;
    return { since, prints: new Set(rest.filter(Boolean)) };
  } catch {
    return null;
  }
}
function markInstalled(cwd, now = Math.floor(Date.now() / 1e3)) {
  try {
    const file = seenFile(cwd);
    if (file && !existsSync5(file)) writeFileSync2(file, `since ${now}
`);
  } catch {
  }
}
function recordSeen(message, cwd, now = Math.floor(Date.now() / 1e3)) {
  try {
    const file = seenFile(cwd);
    if (!file) return;
    const print = fingerprint(message);
    if (!existsSync5(file)) {
      mkdirSync2(join5(file, ".."), { recursive: true });
      writeFileSync2(file, `since ${now}
${print}
`);
      return;
    }
    const text = readFileSync5(file, "utf8");
    const lines2 = text.split("\n").filter(Boolean);
    if (lines2.includes(print)) return;
    if (lines2.length > MAX) writeFileSync2(file, [lines2[0], ...lines2.slice(-(MAX / 2)), print].join("\n") + "\n");
    else appendFileSync(file, print + "\n");
  } catch {
  }
}

// src/session.ts
import { readFileSync as readFileSync6, statSync as statSync3 } from "fs";

// src/shell.ts
var newSeg = () => ({ words: [], stdin: null, out: null });
function substitution(src, i) {
  const m = /^\$\(\s*cat\s*<<(-?)\s*(['"]?)([A-Za-z_][\w.-]*)\2[ \t]*\n/.exec(src.slice(i));
  if (m) {
    const strip = m[1] === "-";
    const delim = m[3];
    let pos = i + m[0].length;
    const body = [];
    while (pos <= src.length) {
      const nl = src.indexOf("\n", pos);
      const line = src.slice(pos, nl === -1 ? src.length : nl);
      const cmp = strip ? line.replace(/^\t+/, "") : line;
      if (cmp.trim() === delim) {
        pos = nl === -1 ? src.length : nl;
        break;
      }
      body.push(line);
      if (nl === -1) {
        pos = src.length;
        break;
      }
      pos = nl + 1;
    }
    const close = src.indexOf(")", pos);
    return { value: body.join("\n").replace(/\n+$/, ""), end: close === -1 ? src.length : close + 1 };
  }
  let depth = 0;
  let j = i + 1;
  let quote2 = null;
  for (; j < src.length; j++) {
    const c = src[j];
    if (quote2) {
      if (c === "\\" && quote2 === '"') j++;
      else if (c === quote2) quote2 = null;
    } else if (c === "'" || c === '"') quote2 = c;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) break;
  }
  return { value: src.slice(i, j + 1), end: j + 1 };
}
function ansiC(src, i) {
  let out = "";
  let j = i + 2;
  const esc = { n: "\n", t: "	", r: "\r", "\\": "\\", "'": "'", '"': '"', a: "\x07", e: "\x1B", "0": "\0" };
  for (; j < src.length && src[j] !== "'"; j++) {
    if (src[j] === "\\" && j + 1 < src.length) {
      j++;
      out += esc[src[j]] ?? "\\" + src[j];
    } else out += src[j];
  }
  return { value: out, end: j + 1 };
}
function segments(src) {
  const segs = [];
  let seg = newSeg();
  let word = null;
  let redirect = null;
  const pending = [];
  const push = () => {
    if (word === null) return;
    if (redirect === "out") seg.out = word;
    else if (redirect === "herestring") seg.stdin = word + "\n";
    else if (redirect !== "in") seg.words.push(word);
    redirect = null;
    word = null;
  };
  const end = () => {
    push();
    if (seg.words.length) segs.push(seg);
    seg = newSeg();
  };
  const readHeredocs = (i2) => {
    for (const h of pending) {
      const body = [];
      while (i2 < src.length) {
        const nl = src.indexOf("\n", i2);
        const line = src.slice(i2, nl === -1 ? src.length : nl);
        i2 = nl === -1 ? src.length : nl + 1;
        if ((h.strip ? line.replace(/^\t+/, "") : line) === h.delim) break;
        body.push(h.strip ? line.replace(/^\t+/, "") : line);
      }
      h.seg.stdin = body.length ? body.join("\n") + "\n" : "";
    }
    pending.length = 0;
    return i2;
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      if (src[i + 1] === "\n") i += 2;
      else {
        word = (word ?? "") + (src[i + 1] ?? "");
        i += 2;
      }
      continue;
    }
    if (c === "'") {
      const j = src.indexOf("'", i + 1);
      const stop = j === -1 ? src.length : j;
      word = (word ?? "") + src.slice(i + 1, stop);
      i = stop + 1;
      continue;
    }
    if (c === "$" && src[i + 1] === "'") {
      const r = ansiC(src, i);
      word = (word ?? "") + r.value;
      i = r.end;
      continue;
    }
    if (c === '"') {
      let buf = "";
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\" && '"\\$`\n'.includes(src[i + 1] ?? "")) {
          if (src[i + 1] !== "\n") buf += src[i + 1];
          i += 2;
        } else if (src[i] === "$" && src[i + 1] === "(") {
          const r = substitution(src, i);
          buf += r.value;
          i = r.end;
        } else buf += src[i++];
      }
      i++;
      word = (word ?? "") + buf;
      continue;
    }
    if (c === "$" && src[i + 1] === "(") {
      const r = substitution(src, i);
      word = (word ?? "") + r.value;
      i = r.end;
      continue;
    }
    if (c === "\n") {
      end();
      i++;
      if (pending.length) i = readHeredocs(i);
      continue;
    }
    if (c === " " || c === "	") {
      push();
      i++;
      continue;
    }
    if (c === "#" && word === null) {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl;
      continue;
    }
    if (c === ";" || c === "(" || c === ")" || c === "{" || c === "}") {
      if ((c === "{" || c === "}") && word !== null) {
        word += c;
        i++;
        continue;
      }
      end();
      i++;
      continue;
    }
    if (c === "&" || c === "|") {
      if (c === "&" && src[i + 1] === ">") {
        push();
        i += 2;
        redirect = "out";
        continue;
      }
      end();
      i += src[i + 1] === c ? 2 : 1;
      continue;
    }
    if (c === "<" && src[i + 1] === "<" && src[i + 2] === "<") {
      push();
      i += 3;
      redirect = "herestring";
      continue;
    }
    if (c === "<" && src[i + 1] === "<") {
      push();
      i += 2;
      let strip = false;
      if (src[i] === "-") {
        strip = true;
        i++;
      }
      while (src[i] === " " || src[i] === "	") i++;
      const m = /^(['"]?)([A-Za-z_][\w.-]*)\1/.exec(src.slice(i));
      if (m) {
        pending.push({ delim: m[2], strip, seg });
        i += m[0].length;
      }
      continue;
    }
    if (c === ">") {
      if (word !== null && /^\d$/.test(word)) word = null;
      push();
      i += src[i + 1] === ">" ? 2 : 1;
      if (src[i] === "&") {
        i++;
        while (/\d|-/.test(src[i] ?? "")) i++;
        continue;
      }
      redirect = "out";
      continue;
    }
    if (c === "<") {
      push();
      i++;
      redirect = "in";
      continue;
    }
    word = (word ?? "") + c;
    i++;
  }
  end();
  if (pending.length) readHeredocs(src.length);
  return segs;
}
var WRAPPERS = /* @__PURE__ */ new Set(["command", "builtin", "exec", "time", "nohup", "env"]);
function program(words) {
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    if (/^[A-Za-z_]\w*=/.test(w) || WRAPPERS.has(w) || words[i - 1] === "env" && w.startsWith("-")) i++;
    else break;
  }
  return words.slice(i);
}
function echoed(words) {
  const args = words.slice(1).filter((w, k) => !(k === 0 && /^-[neE]+$/.test(w)));
  return args.join(" ") + "\n";
}
function printed(words) {
  const [fmt = "", ...args] = words.slice(1);
  if (/^%s(\\n)?$/.test(fmt)) return args.join(fmt.endsWith("\\n") ? "\n" : "") + (fmt.endsWith("\\n") ? "\n" : "");
  return fmt.replace(/\\n/g, "\n").replace(/\\t/g, "	");
}
function parseCommit2(args, seg, files, stagesFirst, dir) {
  const msgs = [];
  let file = null;
  let all = false;
  let amend = false;
  let reuse = false;
  for (let j = 0; j < args.length; j++) {
    const a = args[j];
    if (a === "--") break;
    if (a === "-m" || a === "--message") msgs.push(args[++j] ?? "");
    else if (a.startsWith("--message=")) msgs.push(a.slice(10));
    else if (a === "-F" || a === "--file") file = args[++j] ?? null;
    else if (a.startsWith("--file=")) file = a.slice(7);
    else if (a === "--all") all = true;
    else if (a === "--amend") amend = true;
    else if (/^--(reuse|reedit)-message/.test(a) || a === "--fixup" || a.startsWith("--fixup=") || a === "--squash" || a.startsWith("--squash=")) reuse = true;
    else if (/^-[A-Za-z]+/.test(a) && !a.startsWith("--")) {
      for (let k = 1; k < a.length; k++) {
        const f = a[k];
        if (f === "a") all = true;
        else if (f === "m" || f === "F") {
          const rest = a.slice(k + 1);
          const v = rest || (args[++j] ?? "");
          if (f === "m") msgs.push(v);
          else file = v;
          break;
        } else if (f === "C" || f === "c") {
          reuse = true;
          if (!a.slice(k + 1)) j++;
          break;
        }
      }
    }
  }
  if (reuse && !msgs.length && !file) return null;
  let message = msgs.length ? msgs.join("\n\n") : null;
  if (message === null && file !== null) {
    if (file === "-") message = seg.stdin;
    else if (files.has(file)) message = files.get(file);
    if (message !== null) file = null;
  }
  return { tool: "git-commit", message, file, all, amend, stagesFirst, dir };
}
function parsePr(args, seg, files, dir) {
  const action = args[0] === "create" || args[0] === "new" ? "create" : args[0] === "edit" ? "edit" : null;
  if (!action) return null;
  let title = null;
  let body = null;
  let file = null;
  let base = null;
  let generated = false;
  const value = (a, long, short, j) => {
    if (a === long || a === short) return [args[j + 1] ?? "", j + 1];
    if (a.startsWith(long + "=")) return [a.slice(long.length + 1), j];
    if (short && a.startsWith(short) && a.length > 2 && !a.startsWith("--")) return [a.slice(2), j];
    return [null, j];
  };
  for (let j = 1; j < args.length; j++) {
    const a = args[j];
    let v;
    [v, j] = value(a, "--title", "-t", j);
    if (v !== null) {
      title = v;
      continue;
    }
    [v, j] = value(a, "--body-file", "-F", j);
    if (v !== null) {
      file = v;
      continue;
    }
    [v, j] = value(a, "--body", "-b", j);
    if (v !== null) {
      body = v;
      continue;
    }
    [v, j] = value(a, "--base", "-B", j);
    if (v !== null) {
      base = v;
      continue;
    }
    if (/^(--fill(-first|-verbose)?|-f|--web|-w)$/.test(a)) generated = true;
  }
  if (body === null && file !== null) {
    if (file === "-") body = seg.stdin;
    else if (files.has(file)) body = files.get(file);
    if (body !== null) file = null;
  }
  return { tool: "gh-pr", action, title, body, file, base, generated, dir };
}
function findCalls(command) {
  const calls = [];
  const files = /* @__PURE__ */ new Map();
  let stagesFirst = false;
  let dir = null;
  for (const seg of segments(command)) {
    const w = program(seg.words);
    const cmd = w[0];
    if (!cmd) continue;
    if (cmd === "cd") {
      dir = w[1] ?? null;
      continue;
    }
    if (seg.out && (cmd === "cat" || cmd === "tee") && seg.stdin !== null) files.set(seg.out, seg.stdin);
    else if (seg.out && cmd === "echo") files.set(seg.out, echoed(w));
    else if (seg.out && cmd === "printf") files.set(seg.out, printed(w));
    if (cmd === "tee" && seg.stdin !== null && w[1]) files.set(w[w.length - 1], seg.stdin);
    if (cmd === "git") {
      let k = 1;
      let gitDir = dir;
      while (k < w.length && w[k].startsWith("-")) {
        if (w[k] === "-C") {
          gitDir = w[k + 1] ?? gitDir;
          k += 2;
        } else if (w[k] === "-c") k += 2;
        else k++;
      }
      const sub = w[k];
      if (sub === "add" || sub === "rm" || sub === "mv" || sub === "stage") stagesFirst = true;
      if (sub === "commit") {
        const call = parseCommit2(w.slice(k + 1), seg, files, stagesFirst, gitDir);
        if (call) calls.push(call);
      }
    } else if (cmd === "gh" && w[1] === "pr") {
      const call = parsePr(w.slice(2), seg, files, dir);
      if (call) calls.push(call);
    }
  }
  return calls;
}
function mightMatter(command) {
  return /\bgit\b[\s\S]*\bcommit\b|\bgh\b[\s\S]*\bpr\b/.test(command);
}

// src/session.ts
var TEST_CMD = /^(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|npx\s+(?:vitest|jest|mocha|playwright|ava|tap)\b|vitest\b|jest\b|mocha\b|pytest\b|python3?\s+-m\s+(?:pytest|unittest)\b|go\s+test\b|cargo\s+(?:test|nextest)\b|mvnw?\b.*\b(?:test|verify)\b|gradlew?\b.*\btest\b|dotnet\s+test\b|phpunit\b|rspec\b|rake\s+test\b|mix\s+test\b|deno\s+test\b|make\s+(?:test|check)\b|ctest\b|tox\b|nox\b|swift\s+test\b|(?:flutter|dart)\s+test\b|bats\b)/i;
function heads(cmd) {
  return segments(cmd).map(
    (seg) => seg.words.filter((w, i, all) => !(/^[A-Za-z_]\w*=/.test(w) && all.slice(0, i).every((x) => /^[A-Za-z_]\w*=/.test(x)))).slice(0, 5).map((w, i) => i === 0 ? w.replace(/^.*\//, "") : w).join(" ")
  );
}
var INERT = /^(?:git|gh|ls|cat|head|tail|grep|rg|ag|find|fd|echo|printf|sed|awk|wc|pwd|cd|which|type|stat|file|diff|tree|less|more|mkdir|touch|cp|mv|rm|chmod|open|code|cursor|clear|true|false|sleep|export|set|source|\.|buzzcut)$/;
var MAX_BYTES = 50 * 1024 * 1024;
var KEYS = /* @__PURE__ */ new Set(["command", "CommandLine", "commandLine", "command_line", "cmd"]);
function collect(v, out, depth = 0) {
  if (depth > 12 || !v || typeof v !== "object") return;
  if (Array.isArray(v)) {
    for (const x of v) collect(x, out, depth + 1);
    return;
  }
  for (const [k, x] of Object.entries(v)) {
    if (KEYS.has(k) && typeof x === "string" && /\s|^\w+$/.test(x.trim()) && !x.startsWith("/")) out.push(x);
    else collect(x, out, depth + 1);
  }
}
function transcriptCommands(text) {
  const out = [];
  const lines2 = text.split("\n");
  let parsedAny = false;
  for (const line of lines2) {
    const t = line.trim();
    if (!t.startsWith("{") && !t.startsWith("[")) continue;
    try {
      collect(JSON.parse(t), out);
      parsedAny = true;
    } catch {
    }
  }
  if (!parsedAny) {
    try {
      collect(JSON.parse(text), out);
    } catch {
    }
  }
  return out;
}
function programs(cmd) {
  return segments(cmd).map((seg) => seg.words.find((w) => !/^[A-Za-z_]\w*=/.test(w)) ?? "").map((p) => p.replace(/^.*\//, "")).filter((p) => /^[\w.+-]+$/.test(p));
}
function sessionFacts(commands) {
  const isTest2 = (c) => heads(c).some((h) => TEST_CMD.test(h));
  const tests = commands.filter(isTest2);
  const exercised = commands.filter((c) => isTest2(c) || programs(c).some((p) => !INERT.test(p)));
  return { tests, exercised };
}
function readSession(path) {
  try {
    if (statSync3(path).size > MAX_BYTES) return null;
    return sessionFacts(transcriptCommands(readFileSync6(path, "utf8")));
  } catch {
    return null;
  }
}

// src/hooks.ts
var ok = (stderr = "") => ({ code: 0, stdout: "", stderr });
function shouldBlock(block, agent) {
  return block === "always" || block === "agents" && agent !== null;
}
function readSafe(path) {
  try {
    return readFileSync7(path, "utf8");
  } catch {
    return null;
  }
}
function agentFeedback(what, r, max) {
  const errors = r.findings.filter((f) => f.severity === "error").length;
  const lines2 = [
    `buzzcut: this ${what} doesn't pass (yap score ${r.score}/100, ${r.grade}${errors ? `, ${errors} error${errors > 1 ? "s" : ""}` : ""}; it needs ${max} or less and no errors). Fix these, then run the same command again:`
  ];
  for (const f of r.findings.slice(0, 10)) lines2.push(`${ICON[f.severity]} ${f.rule}: ${f.message}${/[.?!]$/.test(f.message) ? "" : "."} ${f.hint}`);
  if (r.findings.length > 10) lines2.push(`\u2026 and ${r.findings.length - 10} smaller notes.`);
  lines2.push("Cut the padding, not the facts: keep the why (from the conversation), every number, error message, link and name the reviewer needs, and only the commands you actually ran. Rewrite it yourself and run the command again; there's no need to ask the user unless they asked for this exact wording.");
  return lines2.join("\n");
}
function commitMsgHook(file, h) {
  const repo = loadRepo(h.cwd);
  const raw = readSafe(resolve4(h.cwd, file));
  if (raw == null) return ok();
  const msg = parseCommit(raw);
  const through = (r) => {
    if (msg.title) recordSeen(`${msg.title}
${msg.body}`, h.cwd);
    return r;
  };
  if (!msg.title || isIgnored(msg.title, repo.config) || operationInProgress(h.cwd)) return through(ok());
  const diff = stagedDiff(h.cwd) ?? amendDiff(h.cwd);
  const report2 = analyze(msg, diff, { style: repo.style, rules: repo.config.rules, length: repo.config.length });
  const max = repo.config.max;
  const p = palette(h.color);
  if (passes(report2, max)) return through(ok(p.dim(`buzzcut \u2713 yap score ${report2.score} (${report2.grade})`) + "\n"));
  const agent = detectAgent(h.env);
  const block = shouldBlock(repo.config.block, agent);
  let out = renderReport(report2, { color: h.color, max, label: "commit message" });
  if (block) {
    out += agent ? `
  ${p.red("Commit blocked")} (${agent} detected). Rewrite the message and commit again.
` : `
  ${p.red("Commit blocked")} ("block": "always" in the buzzcut config). Rewrite the message and commit again.
`;
  } else {
    out += `
  ${p.dim("buzzcut only warns people, so the commit went through.")}
`;
    out += `  ${p.yellow("If you are a coding agent:")} rewrite this message to fix the lines above and amend it with \`git commit --amend -F <file>\`. Only amend a commit you just made.
`;
  }
  return block ? { code: 1, stdout: "", stderr: out } : through({ code: 0, stdout: "", stderr: out });
}
var ZERO = /^0+$/;
var MAX_PUSH_COMMITS = 50;
function prePushHook(remote, stdin, h, installedAt2 = null) {
  const repo = loadRepo(h.cwd);
  const shas = [];
  for (const line of stdin.split("\n")) {
    const [, local, , remoteSha] = line.trim().split(/\s+/);
    if (!local || ZERO.test(local)) continue;
    const range = remoteSha && !ZERO.test(remoteSha) && git(["cat-file", "-e", `${remoteSha}^{commit}`], h.cwd) != null ? [`${remoteSha}..${local}`] : [local, "--not", `--remotes=${remote}`];
    const out = git(["rev-list", "--no-merges", "-n", String(MAX_PUSH_COMMITS + 1), ...range], h.cwd) ?? "";
    for (const sha of out.split("\n").filter(Boolean)) if (!shas.includes(sha)) shas.push(sha);
  }
  if (!shas.length) return ok();
  const seen = readSeen(h.cwd);
  const starts = [seen?.since, installedAt2 ?? void 0].filter((n3) => typeof n3 === "number" && Number.isFinite(n3));
  const since = starts.length ? Math.min(...starts) : null;
  const failing2 = [];
  for (const sha of shas.slice(0, MAX_PUSH_COMMITS)) {
    const raw = commitMessage(sha, h.cwd) ?? "";
    const msg = parseCommit(raw);
    if (!msg.title || isIgnored(msg.title, repo.config)) continue;
    const report2 = analyze(msg, commitDiff(sha, h.cwd), { style: repo.style, rules: repo.config.rules, length: repo.config.length });
    if (passes(report2, repo.config.max)) continue;
    const authored = Number(git(["log", "-1", "--format=%at", sha], h.cwd)?.trim());
    const excuse = since == null || !(authored >= since) ? "before buzzcut" : seen?.prints.has(fingerprint(`${msg.title}
${msg.body}`)) ? "kept after a warning" : null;
    failing2.push({ sha, report: report2, excuse });
  }
  const p = palette(h.color);
  const checked = Math.min(shas.length, MAX_PUSH_COMMITS);
  if (!failing2.length) return ok(p.dim(`buzzcut \u2713 ${checked} commit${checked > 1 ? "s" : ""} checked`) + "\n");
  const agent = detectAgent(h.env);
  const unchecked = failing2.filter((f) => !f.excuse);
  const block = shouldBlock(repo.config.block, agent) && unchecked.length > 0;
  const lines2 = ["", `  ${p.bold("buzzcut")} ${p.dim(`\xB7 ${failing2.length} of ${checked} commits being pushed need work`)}`, ""];
  for (const { sha, report: r, excuse } of failing2) {
    const subject = r.title.length > 50 ? r.title.slice(0, 49) + "\u2026" : r.title;
    const icon = excuse ? p.yellow(ICON.warn) : p.red(ICON.error);
    lines2.push(`  ${icon} ${p.dim(sha.slice(0, 7))}  ${String(r.score).padStart(3)} ${r.grade}  ${subject}${excuse ? p.dim(`  (${excuse})`) : ""}`);
    for (const f of r.findings.slice(0, 3)) lines2.push(`      ${p.dim(`${f.rule}: ${f.message}`)}`);
  }
  lines2.push("");
  lines2.push(`  ${p.dim("See the details with")} buzzcut check --rev <sha>`);
  if (block) {
    const n3 = unchecked.length;
    lines2.push(`  ${p.red("Push blocked")}${agent ? ` (${agent} detected)` : ""}: ${n3} commit${n3 > 1 ? "s" : ""} skipped the commit check (--no-verify?).`);
    lines2.push(`  Reword ${n3 > 1 ? "them" : "it"}: \`git commit --amend\` for the latest, or squash your own commits into one`);
    lines2.push(`  well-written commit. Only rewrite commits you made; if one isn't yours, tell the user instead.`);
  } else if (agent && unchecked.length === 0) {
    lines2.push(`  ${p.dim("Not blocking: these were kept by a person or made before buzzcut was set up. Don't rewrite them.")}`);
  } else {
    lines2.push(`  ${p.dim("buzzcut only warns people, so the push went through.")}`);
    lines2.push(`  ${p.yellow("If you are a coding agent:")} tell the user about these commits; don't rewrite or force-push history that's already pushed.`);
  }
  lines2.push("");
  return { code: block ? 1 : 0, stdout: "", stderr: lines2.join("\n") };
}
function judge(key, dir, msg, max, run) {
  const prev = readDraft(key, dir);
  const report2 = run(prev && !prev.warned ? { evidence: prev.evidence, strict: true } : null);
  if (passes(report2, max)) {
    clearDraft(key, dir);
    return null;
  }
  const warned = Boolean(prev?.warned) || report2.findings.some((f) => f.rule === "dropped-facts");
  const evidence2 = [.../* @__PURE__ */ new Set([...prev?.evidence ?? [], ...keepableEvidence(msg, report2)])];
  saveDraft(key, dir, { evidence: evidence2, at: Date.now(), warned });
  return report2;
}
var branchKey = (dir) => `hook:pr:${git(["rev-parse", "--abbrev-ref", "HEAD"], dir)?.trim() ?? ""}`;
function checkCommit(call, dir, repo, session) {
  const text = call.message ?? (call.file ? readSafe(resolve4(dir, call.file)) : null);
  if (text == null) return null;
  const msg = parseCommit(text);
  if (!msg.title || isIgnored(msg.title, repo.config)) return null;
  const diff = call.stagesFirst ? worktreeDiff(dir) : call.all ? worktreeDiff(dir, { untracked: false }) : call.amend ? amendDiff(dir) : stagedDiff(dir);
  const report2 = judge("hook:commit", dir, msg, repo.config.max, (previous) => analyze(msg, diff, { style: repo.style, rules: repo.config.rules, length: repo.config.length, session, previous }));
  return report2 ? { what: "commit message", report: report2 } : null;
}
function checkPr(call, dir, repo, session) {
  if (call.generated) return null;
  const body = call.body ?? (call.file ? readSafe(resolve4(dir, call.file)) : null);
  if (body == null && (call.action === "edit" || call.title == null)) return null;
  const base = call.base ?? defaultBase(dir);
  const diff = base ? branchDiff(base, dir) : null;
  const msg = prMessage(call.title ?? "", body ?? "");
  const report2 = judge(
    branchKey(dir),
    dir,
    msg,
    repo.config.max,
    (previous) => analyze(msg, diff, { style: repo.style, template: repo.template, rules: repo.config.rules, length: repo.config.length, session, previous })
  );
  return report2 ? { what: "PR description", report: report2 } : null;
}
function checkCommand(command, cwd, transcript) {
  if (!mightMatter(command)) return { problems: [], repo: null };
  const calls = findCalls(command);
  if (!calls.length) return { problems: [], repo: null };
  const problems = [];
  const session = transcript ? readSession(transcript) : null;
  let first = null;
  for (const call of calls) {
    const dir = call.dir ? resolve4(cwd, call.dir) : cwd;
    const repo = loadRepo(dir);
    first ??= repo;
    if (!repo.root) continue;
    const p = call.tool === "git-commit" ? checkCommit(call, dir, repo, session) : checkPr(call, dir, repo, session);
    if (p) problems.push(p);
  }
  return { problems, repo: first };
}
var obj = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : {};
var str = (...vs) => vs.find((v) => typeof v === "string" && v !== "");
function extractCommand(input, flavor) {
  switch (flavor) {
    case "claude": {
      const ti = obj(input.tool_input);
      return { command: str(ti.command), cwd: str(input.cwd, ti.cwd) };
    }
    case "cursor":
      return { command: str(input.command), cwd: str(input.cwd, input.workspace_roots?.[0]) };
    case "windsurf": {
      const ti = obj(input.tool_info);
      return { command: str(ti.command_line), cwd: str(ti.cwd) };
    }
    case "antigravity": {
      const args = obj(obj(input.toolCall).args);
      return {
        command: str(args.CommandLine, args.commandLine, args.command),
        cwd: str(args.Cwd, args.cwd, input.workspacePaths?.[0])
      };
    }
  }
}
function pass(flavor) {
  return flavor === "cursor" ? { code: 0, stdout: JSON.stringify({ permission: "allow" }), stderr: "" } : ok();
}
function deny(flavor, reason, summary) {
  switch (flavor) {
    case "claude":
      return {
        code: 0,
        stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }),
        stderr: ""
      };
    case "cursor":
      return { code: 0, stdout: JSON.stringify({ permission: "deny", user_message: `buzzcut blocked this: ${summary}`, agent_message: reason }), stderr: "" };
    case "windsurf":
      return { code: 2, stdout: "", stderr: reason + "\n" };
    case "antigravity":
      return { code: 0, stdout: JSON.stringify({ decision: "deny", reason }), stderr: "" };
  }
}
function advise(flavor, reason) {
  if (flavor === "claude") return { code: 0, stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: reason } }), stderr: "" };
  if (flavor === "cursor") return { code: 0, stdout: JSON.stringify({ permission: "allow", agent_message: reason }), stderr: "" };
  return pass(flavor);
}
var PR_TOOL = /(?:^|[^a-z])(create|update)_?pull_?request(?:$|[^a-z])/i;
var COMMIT_TOOL = /(?:^|[^a-z])(push_files|create_or_update_file)(?:$|[^a-z])/i;
function parseArgs(v) {
  if (typeof v === "string") {
    try {
      return obj(JSON.parse(v));
    } catch {
      return {};
    }
  }
  return obj(v);
}
function extractMcp(input, flavor) {
  switch (flavor) {
    case "claude": {
      const tool = str(input.tool_name);
      return tool && !obj(input.tool_input).command ? { tool, args: obj(input.tool_input) } : null;
    }
    case "cursor": {
      const tool = str(input.tool_name);
      return tool ? { tool, args: parseArgs(input.tool_input) } : null;
    }
    case "windsurf": {
      const ti = obj(input.tool_info);
      const tool = str(ti.mcp_tool_name);
      return tool ? { tool, args: parseArgs(ti.mcp_tool_arguments) } : null;
    }
    case "antigravity": {
      const tc = obj(input.toolCall);
      const tool = str(tc.name);
      return tool && tool !== "run_command" ? { tool, args: parseArgs(tc.args) } : null;
    }
  }
}
function lineCount2(text) {
  return text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0;
}
function checkMcp(call, cwd, transcript) {
  const isPr = PR_TOOL.test(call.tool);
  const isCommit = COMMIT_TOOL.test(call.tool);
  if (!isPr && !isCommit) return { problems: [], repo: null };
  const repo = loadRepo(cwd);
  const session = transcript ? readSession(transcript) : null;
  const a = call.args;
  const opts = { style: repo.style, template: repo.template, rules: repo.config.rules, length: repo.config.length, session };
  if (isPr) {
    const title = str(a.title) ?? null;
    const body = str(a.body) ?? null;
    if (body == null && (/update/i.test(call.tool) || title == null)) return { problems: [], repo };
    const base = str(a.base) ?? (repo.root ? defaultBase(cwd) : null);
    const head = str(a.head);
    const localHead = head && repo.root && git(["rev-parse", "--verify", "-q", head], cwd) ? head : "HEAD";
    const diff = base && repo.root ? branchDiff(base, cwd, localHead) : null;
    const msg2 = prMessage(title ?? "", body ?? "");
    let failing2;
    if (repo.root) failing2 = judge(branchKey(cwd), cwd, msg2, repo.config.max, (previous) => analyze(msg2, diff, { ...opts, previous }));
    else {
      const report3 = analyze(msg2, diff, opts);
      failing2 = passes(report3, repo.config.max) ? null : report3;
    }
    return { problems: failing2 ? [{ what: "PR description", report: failing2 }] : [], repo };
  }
  const message = str(a.message);
  if (!message) return { problems: [], repo };
  const files = Array.isArray(a.files) ? a.files.map((f) => obj(f)).map((f) => ({ path: str(f.path) ?? "file", additions: lineCount2(str(f.content) ?? ""), deletions: 0 })) : str(a.path) ? [{ path: str(a.path), additions: lineCount2(str(a.content) ?? ""), deletions: 0 }] : [];
  const msg = parseCommit(message);
  if (!msg.title || isIgnored(msg.title, repo.config)) return { problems: [], repo };
  const report2 = analyze(msg, files.length ? buildDiff(files) : null, opts);
  return { problems: passes(report2, repo.config.max) ? [] : [{ what: "commit message", report: report2 }], repo };
}
function agentHook(payload, flavor, h) {
  let input;
  try {
    input = obj(JSON.parse(payload));
  } catch {
    return pass(flavor);
  }
  const transcript = str(input.transcript_path, input.transcriptPath);
  const mcp = extractMcp(input, flavor);
  const { command, cwd = h.cwd } = mcp ? { command: void 0, cwd: str(input.cwd, input.workspace_roots?.[0], input.workspacePaths?.[0]) } : extractCommand(input, flavor);
  if (!mcp && !command) return pass(flavor);
  try {
    const { problems, repo } = mcp ? checkMcp(mcp, cwd ?? h.cwd, transcript) : checkCommand(command, cwd ?? h.cwd, transcript);
    if (!problems.length || !repo) return pass(flavor);
    const reason = problems.map((p) => agentFeedback(p.what, p.report, repo.config.max)).join("\n\n");
    if (repo.config.block === "never") return advise(flavor, reason);
    const summary = problems.map((p) => `${p.what}: yap score ${p.report.score} (${p.report.grade})`).join("; ");
    return deny(flavor, reason, summary);
  } catch (e) {
    return { ...pass(flavor), stderr: `buzzcut hook error (let the command run): ${e.message}
` };
  }
}

// src/init.ts
import { chmodSync, existsSync as existsSync7, mkdirSync as mkdirSync3, readFileSync as readFileSync8, unlinkSync, writeFileSync as writeFileSync3 } from "fs";
import { delimiter, dirname, join as join7, relative as relative2, resolve as resolve5 } from "path";

// src/targets.ts
import { existsSync as existsSync6 } from "fs";
import { homedir } from "os";
import { join as join6 } from "path";
var OURS = /buzzcut\S*"?\s+hook\s+(claude|copilot|cursor|windsurf|antigravity)\b/;
var isOurs = (cmd) => typeof cmd === "string" && OURS.test(cmd);
var CURSOR_MATCHER = String.raw`\bgit\b.*\bcommit\b|\bgh\b.*\bpr\b`;
var MCP_TOOLS = String.raw`pull_request|push_files|create_or_update_file`;
var CLAUDE_MATCHER = "Bash|mcp__.*";
function mergeClaudeSettings(settings, command) {
  const hooks = { ...settings.hooks ?? {} };
  const pre = (hooks.PreToolUse ?? []).map((e) => ({ ...e, hooks: (e.hooks ?? []).filter((h) => !isOurs(h.command)) })).filter((e) => e.hooks.length);
  if (command) pre.push({ matcher: CLAUDE_MATCHER, hooks: [{ type: "command", command, timeout: 30 }] });
  if (pre.length) hooks.PreToolUse = pre;
  else delete hooks.PreToolUse;
  const out = { ...settings };
  if (Object.keys(hooks).length) out.hooks = hooks;
  else delete out.hooks;
  return out;
}
function mergeCopilotHooks(_config, command) {
  return command ? { hooks: { PreToolUse: [{ type: "command", command, timeout: 30 }] } } : {};
}
function mergeCursorHooks(config, command) {
  const hooks = { ...config.hooks ?? {} };
  for (const [event, matcher] of [["beforeShellExecution", CURSOR_MATCHER], ["beforeMCPExecution", MCP_TOOLS]]) {
    const list2 = (hooks[event] ?? []).filter((h) => !isOurs(h.command));
    if (command) list2.push({ command, matcher });
    if (list2.length) hooks[event] = list2;
    else delete hooks[event];
  }
  return { version: 1, ...config, hooks };
}
function mergeWindsurfHooks(config, command) {
  const hooks = { ...config.hooks ?? {} };
  for (const event of ["pre_run_command", "pre_mcp_tool_use"]) {
    const list2 = (hooks[event] ?? []).filter((h) => !isOurs(h.command));
    if (command) list2.push({ command, show_output: true });
    if (list2.length) hooks[event] = list2;
    else delete hooks[event];
  }
  return { ...config, hooks };
}
function mergeAntigravityHooks(config, command) {
  const out = { ...config };
  delete out.buzzcut;
  if (command) {
    out.buzzcut = { PreToolUse: [{ matcher: `run_command|.*(${MCP_TOOLS}).*`, hooks: [{ type: "command", command, timeout: 30 }] }] };
  }
  return out;
}
var claudeHome = (home) => process.env.CLAUDE_CONFIG_DIR || join6(home, ".claude");
var codexHome = (home) => process.env.CODEX_HOME || join6(home, ".codex");
var TARGETS = [
  {
    id: "claude",
    name: "Claude Code",
    detect: (home) => existsSync6(claudeHome(home)),
    userSkillsDir: (home) => join6(claudeHome(home), "skills"),
    repoSkillsDir: ".claude/skills",
    hook: {
      flavor: "claude",
      userFile: (home) => join6(claudeHome(home), "settings.json"),
      repoFile: (root) => join6(root, ".claude", "settings.json"),
      merge: mergeClaudeSettings
    }
  },
  {
    id: "copilot",
    name: "VS Code (Copilot agent)",
    detect: (home) => existsSync6(join6(home, ".copilot")) || vscodeUserDirs(home).some((d) => existsSync6(d)),
    userSkillsDir: (home) => join6(home, ".copilot", "skills"),
    repoSkillsDir: ".agents/skills",
    hook: {
      flavor: "claude",
      userFile: (home) => join6(home, ".copilot", "hooks", "buzzcut.json"),
      repoFile: (root) => join6(root, ".github", "hooks", "buzzcut.json"),
      merge: mergeCopilotHooks
    }
  },
  {
    id: "cursor",
    name: "Cursor",
    detect: (home) => existsSync6(join6(home, ".cursor")),
    userSkillsDir: (home) => join6(home, ".cursor", "skills"),
    repoSkillsDir: ".agents/skills",
    hook: {
      flavor: "cursor",
      userFile: (home) => join6(home, ".cursor", "hooks.json"),
      repoFile: (root) => join6(root, ".cursor", "hooks.json"),
      merge: mergeCursorHooks
    }
  },
  {
    id: "windsurf",
    name: "Windsurf",
    detect: (home) => existsSync6(join6(home, ".codeium", "windsurf")),
    userSkillsDir: (home) => join6(home, ".codeium", "windsurf", "skills"),
    repoSkillsDir: ".windsurf/skills",
    hook: {
      flavor: "windsurf",
      userFile: (home) => join6(home, ".codeium", "windsurf", "hooks.json"),
      // Devin-era builds read .devin/hooks.json and fall back to .windsurf/hooks.json.
      repoFile: (root) => existsSync6(join6(root, ".devin", "hooks.json")) ? join6(root, ".devin", "hooks.json") : join6(root, ".windsurf", "hooks.json"),
      merge: mergeWindsurfHooks
    }
  },
  {
    id: "antigravity",
    name: "Antigravity",
    detect: (home) => ["antigravity", "antigravity-ide", "antigravity-cli"].some((d) => existsSync6(join6(home, ".gemini", d))),
    // Antigravity 2.x discovers global customizations in ~/.gemini/config/; older builds
    // read ~/.gemini/antigravity/skills.
    userSkillsDir: (home) => existsSync6(join6(home, ".gemini", "config")) ? join6(home, ".gemini", "config", "skills") : join6(home, ".gemini", "antigravity", "skills"),
    repoSkillsDir: ".agents/skills",
    hook: {
      flavor: "antigravity",
      userFile: (home) => join6(home, ".gemini", "config", "hooks.json"),
      repoFile: (root) => join6(root, ".agents", "hooks.json"),
      merge: mergeAntigravityHooks
    }
  },
  {
    id: "codex",
    name: "Codex",
    detect: (home) => existsSync6(codexHome(home)),
    userSkillsDir: (home) => join6(codexHome(home), "skills"),
    repoSkillsDir: ".agents/skills"
  },
  {
    id: "agents",
    name: "Other agents (~/.agents)",
    detect: (home) => existsSync6(join6(home, ".agents")),
    userSkillsDir: (home) => join6(home, ".agents", "skills"),
    repoSkillsDir: ".agents/skills"
  }
];
function vscodeUserDirs(home = homedir()) {
  const names = ["Code", "Code - Insiders"];
  if (process.platform === "darwin") return names.map((n3) => join6(home, "Library", "Application Support", n3, "User"));
  if (process.platform === "win32") return names.map((n3) => join6(process.env.APPDATA ?? join6(home, "AppData", "Roaming"), n3, "User"));
  return names.map((n3) => join6(process.env.XDG_CONFIG_HOME ?? join6(home, ".config"), n3, "User"));
}

// src/init.ts
var BEGIN = "# >>> buzzcut >>>";
var END = "# <<< buzzcut <<<";
var FIND_BIN = [
  'buzzcut_bin="$(git rev-parse --show-toplevel)/node_modules/.bin/buzzcut"',
  '[ -x "$buzzcut_bin" ] || buzzcut_bin="$(command -v buzzcut 2>/dev/null)"'
];
function hookBlock(hook2) {
  const lines2 = hook2 === "commit-msg" ? [
    BEGIN,
    "# Checks the commit message against the staged diff: blocks coding agents, warns people.",
    "# https://github.com/Shiva-Xs/buzzcut  \xB7  remove with: buzzcut init --uninstall",
    ...FIND_BIN,
    'if [ -n "$buzzcut_bin" ]; then',
    '  "$buzzcut_bin" hook commit-msg "$1" || exit $?',
    "fi",
    END
  ] : [
    BEGIN,
    "# Re-checks the commits being pushed (catches an agent's --no-verify commits).",
    "# https://github.com/Shiva-Xs/buzzcut  \xB7  remove with: buzzcut init --uninstall",
    ...FIND_BIN,
    "# Read the ref list once and hand it back to the rest of this hook afterwards.",
    'buzzcut_refs="$(cat)"',
    'if [ -n "$buzzcut_bin" ]; then',
    `  printf '%s\\n' "$buzzcut_refs" | "$buzzcut_bin" hook pre-push "$@" || exit $?`,
    "fi",
    "exec <<BUZZCUT_REFS",
    "$buzzcut_refs",
    "BUZZCUT_REFS",
    END
  ];
  return lines2.join("\n") + "\n";
}
function stripBlock(content) {
  const start = content.indexOf(BEGIN);
  if (start === -1) return content;
  const stop = content.indexOf(END, start);
  if (stop === -1) return content;
  let after = stop + END.length;
  if (content[after] === "\n") after++;
  return content.slice(0, start) + content.slice(after);
}
function insertBlock(content, block) {
  const base = content == null || !content.trim() ? "#!/bin/sh\n" : stripBlock(content);
  if (base.startsWith("#!")) {
    const nl = base.indexOf("\n");
    const head = nl === -1 ? base + "\n" : base.slice(0, nl + 1);
    return head + block + (nl === -1 ? "" : base.slice(nl + 1));
  }
  return block + base;
}
function hooksDir(root) {
  const configured = git(["config", "--local", "--get", "core.hooksPath"], root)?.trim();
  if (configured) {
    const abs = resolve5(root, configured);
    if (/(^|[\\/])\.husky[\\/]_$/.test(configured)) return { dir: dirname(abs), husky: true };
    return { dir: abs, husky: /(^|[\\/])\.husky$/.test(configured) };
  }
  const common = git(["rev-parse", "--git-common-dir"], root)?.trim();
  const dir = resolve5(root, common || ".git", "hooks");
  const shared = git(["config", "--get", "core.hooksPath"], root)?.trim();
  if (shared) {
    const hook2 = join7(resolve5(root, shared), "commit-msg");
    const chains = existsSync7(hook2) && readFileSync8(hook2, "utf8").includes("--git-common-dir");
    if (!chains) return { dir, husky: false, shadowed: resolve5(root, shared) };
  }
  return { dir, husky: false };
}
function globalBin(env) {
  const names = process.platform === "win32" ? ["buzzcut.cmd", "buzzcut.exe", "buzzcut"] : ["buzzcut"];
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir || /[\\/]_npx[\\/]/.test(dir)) continue;
    for (const n3 of names) if (existsSync7(join7(dir, n3))) return join7(dir, n3);
  }
  return null;
}
function detectRunner(root, env) {
  if (existsSync7(join7(root, "node_modules", ".bin", "buzzcut"))) return "local";
  if (globalBin(env)) return "global";
  return null;
}
function repoCommand(runner2, t) {
  const flavor = t.id === "copilot" ? "copilot" : t.hook.flavor;
  const bin = runner2 === "local" ? t.id === "claude" ? '"$CLAUDE_PROJECT_DIR/node_modules/.bin/buzzcut"' : '"$(git rev-parse --show-toplevel)/node_modules/.bin/buzzcut"' : "buzzcut";
  const have = runner2 === "local" ? `[ -x ${bin} ]` : "command -v buzzcut >/dev/null 2>&1";
  if (flavor === "cursor") return `${bin} hook cursor`;
  if (flavor === "windsurf") return `${have} || exit 0; ${bin} hook windsurf`;
  return `${have} && ${bin} hook ${flavor} || true`;
}
function repoAgents(root, env) {
  const has = (p) => existsSync7(join7(root, p));
  const ids = [];
  if (has(".claude") || env.CLAUDECODE) ids.push("claude");
  if (has(".cursor")) ids.push("cursor");
  if (has(".windsurf") || has(".devin")) ids.push("windsurf");
  if (has(".agents/hooks.json")) ids.push("antigravity");
  if (has(".github/hooks")) ids.push("copilot");
  return ids;
}
function readJson(path) {
  if (!existsSync7(path)) return {};
  const text = readFileSync8(path, "utf8");
  if (!text.trim()) return {};
  const v = JSON.parse(text);
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("isn't a JSON object");
  return v;
}
var isOurSkill = (path) => existsSync7(path) && /^name:\s*buzzcut\s*$/m.test(readFileSync8(path, "utf8"));
function init(o) {
  const res = { ok: true, done: [], notes: [] };
  const root = git(["rev-parse", "--show-toplevel"], o.cwd)?.trim();
  if (!root) return { ...res, ok: false, error: "not inside a git repository" };
  const rel = (p) => relative2(o.cwd, p) || ".";
  const write = (path, content, mode) => {
    if (o.dryRun) return;
    mkdirSync3(dirname(path), { recursive: true });
    writeFileSync3(path, content);
    if (mode) chmodSync(path, mode);
  };
  const runner2 = detectRunner(root, o.env);
  if (!o.uninstall && !runner2) {
    return {
      ...res,
      ok: false,
      error: "install buzzcut first, so the hooks run offline and fast:\n  npm i -D buzzcut     (JavaScript/TypeScript repos)\n  npm i -g buzzcut     (any other repo)\nthen run `buzzcut init` again."
    };
  }
  if (o.gitHooks) {
    const { dir, husky, shadowed } = hooksDir(root);
    if (shadowed && !o.uninstall) res.notes.push(`git runs the hooks in ${shadowed} for every repo (core.hooksPath), so the ones in ${rel(dir)} won't run. Run \`buzzcut setup\`, which checks every repo and still runs each repo's own hooks, or add \`buzzcut hook commit-msg "$1"\` to that folder's commit-msg.`);
    for (const hook2 of ["commit-msg", "pre-push"]) {
      const path = join7(dir, hook2);
      const before = existsSync7(path) ? readFileSync8(path, "utf8") : null;
      if (o.uninstall) {
        if (before == null || !before.includes(BEGIN)) continue;
        const after = stripBlock(before);
        if (!o.dryRun) {
          if (/^(#![^\n]*\n?)?\s*$/.test(after)) unlinkSync(path);
          else writeFileSync3(path, after);
        }
        res.done.push(`removed the ${hook2} hook block from ${rel(path)}`);
      } else {
        write(path, insertBlock(before, hookBlock(hook2)), 493);
        res.done.push(`${before?.includes(BEGIN) ? "updated" : before ? "added to" : "created"} ${rel(path)}`);
      }
    }
    if (!o.uninstall && !o.dryRun) markInstalled(root);
    if (husky && !o.uninstall) res.notes.push("husky detected: the hooks went into .husky/, so commit them to share with your team.");
    for (const f of ["lefthook.yml", "lefthook.yaml", ".lefthook.yml", ".pre-commit-config.yaml"]) {
      if (existsSync7(join7(root, f)) && !o.uninstall) {
        res.notes.push(`${f} found: that tool may overwrite git hooks. Add \`buzzcut hook commit-msg {1}\` as a commit-msg command there too.`);
      }
    }
  }
  const wanted = o.agents === "all" ? TARGETS.map((t) => t.id) : o.agents === "none" ? [] : o.agents ?? repoAgents(root, o.env);
  const unknown = Array.isArray(wanted) ? wanted.filter((id) => !TARGETS.some((t) => t.id === id)) : [];
  if (unknown.length) return { ...res, ok: false, error: `unknown agent "${unknown[0]}". Choose from: ${TARGETS.map((t) => t.id).join(", ")}` };
  const skillDirs = /* @__PURE__ */ new Set();
  for (const t of TARGETS) {
    const selected = wanted.includes(t.id);
    if (!selected && !o.uninstall) continue;
    if (t.hook) {
      const path = t.hook.repoFile(root);
      try {
        const before = readJson(path);
        const after = t.hook.merge(before, o.uninstall ? null : repoCommand(runner2 ?? "global", t));
        if (JSON.stringify(before) !== JSON.stringify(after) && !(o.uninstall && !existsSync7(path))) {
          if (o.uninstall && !Object.keys(after).length) {
            if (!o.dryRun) unlinkSync(path);
          } else write(path, JSON.stringify(after, null, 2) + "\n");
          res.done.push(`${t.name}: ${o.uninstall ? "removed the hook from" : "added a hook to"} ${rel(path)}`);
        }
      } catch (e) {
        res.notes.push(`${t.name}: skipped ${rel(path)} (${e.message})`);
      }
    }
    if (selected || o.uninstall) skillDirs.add(t.repoSkillsDir);
  }
  for (const d of skillDirs) {
    const path = join7(root, d, "buzzcut", "SKILL.md");
    if (o.uninstall) {
      if (isOurSkill(path)) {
        if (!o.dryRun) unlinkSync(path);
        res.done.push(`removed the skill from ${rel(path)}`);
      }
    } else if (o.skillSource && (!existsSync7(path) || isOurSkill(path))) {
      write(path, readFileSync8(o.skillSource, "utf8"));
      res.done.push(`added the skill to ${rel(path)}`);
    }
  }
  if (!o.uninstall && runner2 === "global") {
    res.notes.push("using the global buzzcut: teammates need `npm i -g buzzcut` too, or the hooks quietly skip.");
  }
  return res;
}

// src/setup.ts
import { execFileSync as execFileSync3 } from "child_process";
import { chmodSync as chmodSync2, copyFileSync, existsSync as existsSync8, mkdirSync as mkdirSync4, readFileSync as readFileSync9, rmSync as rmSync2, writeFileSync as writeFileSync4 } from "fs";
import { dirname as dirname2, join as join8, resolve as resolve6 } from "path";
import { fileURLToPath } from "url";
function configDir(home, env) {
  return env.XDG_CONFIG_HOME ? join8(env.XDG_CONFIG_HOME, "buzzcut") : join8(home, ".config", "buzzcut");
}
var q = (p) => `"${p}"`;
function hookCommand(node, bundle, flavor) {
  return `${q(node)} ${q(bundle)} hook ${flavor}`;
}
function runGit(args, env) {
  try {
    return execFileSync3("git", args, { env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}
var PASS_THROUGH = [
  "applypatch-msg",
  "pre-applypatch",
  "post-applypatch",
  "pre-commit",
  "pre-merge-commit",
  "prepare-commit-msg",
  "post-commit",
  "pre-rebase",
  "post-checkout",
  "post-merge",
  "post-rewrite",
  "push-to-checkout",
  "pre-auto-gc",
  "sendemail-validate"
];
var LOCAL = (name) => `buzzcut_local="$(git rev-parse --git-common-dir 2>/dev/null)/hooks/${name}"`;
function passThroughScript(name) {
  return [
    "#!/bin/sh",
    "# Installed by `buzzcut setup`. A global core.hooksPath hides each repo's own",
    `# .git/hooks, so this hands ${name} on to the repo's copy when there is one.`,
    LOCAL(name),
    'if [ -x "$buzzcut_local" ]; then exec "$buzzcut_local" "$@"; fi',
    "exit 0",
    ""
  ].join("\n");
}
function runner(node, bundle) {
  return [`buzzcut_node=${q(node)}`, '[ -x "$buzzcut_node" ] || buzzcut_node="$(command -v node 2>/dev/null)"', `buzzcut_js=${q(bundle)}`];
}
function globalBlock(hook2, node, bundle) {
  const lines2 = hook2 === "commit-msg" ? [
    BEGIN,
    "# Checks the commit message against the staged diff: blocks coding agents, warns people.",
    "# Installed by `buzzcut setup`; remove with `buzzcut setup --uninstall`.",
    ...runner(node, bundle),
    'if [ -n "$buzzcut_node" ] && [ -f "$buzzcut_js" ]; then',
    '  "$buzzcut_node" "$buzzcut_js" hook commit-msg "$1" || exit $?',
    "fi",
    "# A repo-level buzzcut hook further down the line needn't check again.",
    "BUZZCUT_CHECKED=1; export BUZZCUT_CHECKED",
    END
  ] : [
    BEGIN,
    "# Re-checks the commits being pushed (catches an agent's --no-verify commits).",
    "# Installed by `buzzcut setup`; remove with `buzzcut setup --uninstall`.",
    ...runner(node, bundle),
    'buzzcut_refs="$(cat)"',
    'if [ -n "$buzzcut_node" ] && [ -f "$buzzcut_js" ]; then',
    `  printf '%s\\n' "$buzzcut_refs" | "$buzzcut_node" "$buzzcut_js" hook pre-push "$@" || exit $?`,
    "fi",
    "BUZZCUT_CHECKED=1; export BUZZCUT_CHECKED",
    "exec <<BUZZCUT_REFS",
    "$buzzcut_refs",
    "BUZZCUT_REFS",
    END
  ];
  return lines2.join("\n") + "\n";
}
function ownHookScript(hook2, node, bundle) {
  return ["#!/bin/sh", globalBlock(hook2, node, bundle).trimEnd(), LOCAL(hook2), 'if [ -x "$buzzcut_local" ]; then exec "$buzzcut_local" "$@"; fi', "exit 0", ""].join("\n");
}
var VSCODE_MARK = "(buzzcut)";
var VSCODE_SETTINGS = {
  "github.copilot.chat.commitMessageGeneration.instructions": `${VSCODE_MARK} Subject: imperative, 72 characters or fewer, no trailing period; match the repo's existing style (past tense if its history uses it, conventional prefixes only if the repo uses them). Add a body only when the why isn't obvious: 1 to 3 lines on why (what was broken, who needed it), plus a few plain "- " bullets if the change has several parts. Plain text, no markdown headers, bold or emoji. Never claim tests were added unless test files changed, and never claim something is faster or safer without a number.`,
  "github.copilot.chat.pullRequestDescriptionGeneration.instructions": `${VSCODE_MARK} Open with one or two sentences: what changed and why (the bug, the error message, the issue link, who asked), in plain words with no "What:" or "Why:" labels. Then 2 to 5 bullets with the changes a reviewer would ask about, each saying where to look (function, setting, endpoint) and the concrete values (old \u2192 new, limits, defaults); group by area, never file by file. A tiny change needs no bullets. Add one line for a risk, breaking change or migration if there is one. End with "Tested:" and only commands that were actually run, with their results, or "Not tested:" and what should be checked. Short plain headers only for very large PRs. No emoji headers, bold labels, or words like comprehensive, robust, seamless, leverage. Never claim tests were added unless test files changed.`
};
function significant(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
      out.push(i);
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
    } else if (c && !/\s/.test(c)) out.push(i);
  }
  return out;
}
var keyRe = (key) => new RegExp(`"${key.replace(/[.]/g, "\\.")}"\\s*:`);
function addVscodeSettings(text) {
  const add = Object.entries(VSCODE_SETTINGS).filter(([k]) => !keyRe(k).test(text));
  if (!add.length) return null;
  const src = text.trim() ? text : "{\n}\n";
  const pos = significant(src);
  const close = pos[pos.length - 1];
  if (close === void 0 || src[close] !== "}") return null;
  const prev = pos[pos.length - 2];
  const needComma = prev !== void 0 && src[prev] !== "{" && src[prev] !== ",";
  const lines2 = add.map(([k, v]) => `    ${JSON.stringify(k)}: [{ "text": ${JSON.stringify(v)} }]`);
  const insert = (needComma ? "," : "") + "\n" + lines2.join(",\n") + "\n";
  const before = src.slice(0, prev === void 0 ? close : prev + 1);
  return before + insert + src.slice(close);
}
function removeVscodeSettings(text) {
  const lines2 = text.split("\n");
  const kept = lines2.filter((l) => !(l.includes(VSCODE_MARK) && Object.keys(VSCODE_SETTINGS).some((k) => l.includes(JSON.stringify(k)))));
  if (kept.length === lines2.length) return null;
  return kept.join("\n");
}
function readJson2(path) {
  if (!existsSync8(path)) return {};
  const text = readFileSync9(path, "utf8");
  if (!text.trim()) return {};
  const v = JSON.parse(text);
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("isn't a JSON object");
  return v;
}
var isOurSkill2 = (path) => existsSync8(path) && /^name:\s*buzzcut\s*$/m.test(readFileSync9(path, "utf8"));
function setup(o) {
  const res = { ok: true, done: [], notes: [] };
  const dir = configDir(o.home, o.env);
  const bundle = join8(dir, "buzzcut.mjs");
  const statePath = join8(dir, "state.json");
  const tilde = (p) => p.startsWith(o.home) ? "~" + p.slice(o.home.length) : p;
  const write = (path, content, mode) => {
    if (o.dryRun) return;
    mkdirSync4(dirname2(path), { recursive: true });
    writeFileSync4(path, content);
    if (mode) chmodSync2(path, mode);
  };
  let state = null;
  try {
    state = existsSync8(statePath) ? JSON.parse(readFileSync9(statePath, "utf8")) : null;
  } catch {
    state = null;
  }
  if (!o.uninstall) {
    if (!existsSync8(o.bundleSource)) return { ...res, ok: false, error: `can't find the buzzcut build at ${o.bundleSource}` };
    if (!o.dryRun) {
      mkdirSync4(dir, { recursive: true });
      copyFileSync(o.bundleSource, bundle);
    }
    res.done.push(`copied buzzcut ${o.version} to ${tilde(bundle)} (hooks run it with ${tilde(o.node)})`);
  }
  if (o.gitHooks) {
    const gitEnv = { ...o.env, HOME: o.home };
    const current = runGit(["config", "--global", "--get", "core.hooksPath"], gitEnv)?.trim() || null;
    const ownDir = join8(dir, "git-hooks");
    if (o.uninstall) {
      const g = state?.git;
      if (g?.own) {
        if (current && resolve6(current) === resolve6(g.dir) && !o.dryRun) runGit(["config", "--global", "--unset", "core.hooksPath"], gitEnv);
        if (!o.dryRun) rmSync2(g.dir, { recursive: true, force: true });
        res.done.push("removed the global git hooks and unset core.hooksPath");
      } else if (g) {
        for (const hook2 of ["commit-msg", "pre-push"]) {
          const p = join8(g.dir, hook2);
          if (existsSync8(p) && readFileSync9(p, "utf8").includes(BEGIN)) {
            if (!o.dryRun) writeFileSync4(p, stripBlock(readFileSync9(p, "utf8")));
            res.done.push(`removed the buzzcut block from ${tilde(p)}`);
          }
        }
      }
    } else if (current && resolve6(current.replace(/^~/, o.home)) !== resolve6(ownDir)) {
      const target = resolve6(current.replace(/^~/, o.home));
      for (const hook2 of ["commit-msg", "pre-push"]) {
        const p = join8(target, hook2);
        write(p, insertBlock(existsSync8(p) ? readFileSync9(p, "utf8") : null, globalBlock(hook2, o.node, bundle)), 493);
      }
      state = { ...state ?? {}, git: { dir: target, own: false } };
      res.done.push(`added commit-msg and pre-push checks to your global hooks folder ${tilde(target)}`);
    } else {
      for (const name of PASS_THROUGH) write(join8(ownDir, name), passThroughScript(name), 493);
      for (const hook2 of ["commit-msg", "pre-push"]) write(join8(ownDir, hook2), ownHookScript(hook2, o.node, bundle), 493);
      if (!o.dryRun) runGit(["config", "--global", "core.hooksPath", ownDir], gitEnv);
      state = { ...state ?? {}, git: { dir: ownDir, own: true } };
      res.done.push(`git: every repo now checks commits and pushes (core.hooksPath \u2192 ${tilde(ownDir)}); each repo's own hooks still run`);
      res.notes.push("Repos that set their own hooks path (husky) keep using theirs; run `buzzcut init` inside those once.");
    }
  }
  if (o.agents) {
    const skill = o.uninstall ? "" : readFileSync9(o.skillSource, "utf8");
    for (const t of TARGETS) {
      if (!t.detect(o.home)) continue;
      const did = [];
      const skillPath = join8(t.userSkillsDir(o.home), "buzzcut", "SKILL.md");
      if (o.uninstall) {
        if (isOurSkill2(skillPath)) {
          if (!o.dryRun) rmSync2(dirname2(skillPath), { recursive: true, force: true });
          did.push("skill");
        }
      } else if (!existsSync8(skillPath) || isOurSkill2(skillPath)) {
        write(skillPath, skill);
        did.push("skill");
      } else {
        res.notes.push(`${t.name}: ${tilde(skillPath)} belongs to something else, left alone`);
      }
      if (t.hook) {
        const path = t.hook.userFile(o.home);
        try {
          const before = readJson2(path);
          const after = t.hook.merge(before, o.uninstall ? null : hookCommand(o.node, bundle, t.hook.flavor));
          if (JSON.stringify(before) !== JSON.stringify(after) && !(o.uninstall && !existsSync8(path))) {
            if (o.uninstall && !Object.keys(after).length) {
              if (!o.dryRun) rmSync2(path, { force: true });
            } else write(path, JSON.stringify(after, null, 2) + "\n");
            did.push("hook");
          }
        } catch (e) {
          res.notes.push(`${t.name}: skipped ${tilde(path)} (${e.message})`);
        }
      }
      if (did.length) res.done.push(`${t.name}: ${o.uninstall ? "removed" : "installed"} the ${did.join(" and ")}`);
    }
  }
  if (o.vscode) {
    for (const d of vscodeUserDirs(o.home)) {
      if (!existsSync8(d)) continue;
      const p = join8(d, "settings.json");
      const text = existsSync8(p) ? readFileSync9(p, "utf8") : "";
      const next = o.uninstall ? removeVscodeSettings(text) : addVscodeSettings(text);
      if (next === null) {
        if (!o.uninstall && Object.keys(VSCODE_SETTINGS).some((k) => keyRe(k).test(text) && !text.includes(VSCODE_MARK))) {
          res.notes.push(`VS Code: ${tilde(p)} already has its own commit/PR instructions, left alone`);
        }
        continue;
      }
      write(p, next);
      res.done.push(`VS Code: ${o.uninstall ? "removed" : "pointed"} the \u2728 commit message and PR description buttons ${o.uninstall ? "from" : "at"} buzzcut's rules (${tilde(p)})`);
    }
  }
  if (o.uninstall) {
    if (!o.dryRun) rmSync2(dir, { recursive: true, force: true });
    res.done.push(`removed ${tilde(dir)}`);
  } else if (!o.dryRun) {
    const installedAt2 = state?.installedAt ?? Math.floor(Date.now() / 1e3);
    writeFileSync4(statePath, JSON.stringify({ ...state, version: o.version, node: o.node, bundle, installedAt: installedAt2 }, null, 2) + "\n");
  }
  return res;
}
var semver = (v) => (v.match(/^(\d+)\.(\d+)\.(\d+)/)?.slice(1) ?? []).map(Number);
function newerVersion(a, b) {
  const [x, y] = [semver(a), semver(b)];
  if (x.length !== 3 || y.length !== 3) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
function refreshInstall(o) {
  const statePath = join8(configDir(o.home, o.env), "state.json");
  let state;
  try {
    state = JSON.parse(readFileSync9(statePath, "utf8"));
  } catch {
    return null;
  }
  if (!state.bundle || !newerVersion(o.version, state.version) || !existsSync8(o.bundleSource) || !existsSync8(o.skillSource)) return null;
  copyFileSync(o.bundleSource, state.bundle);
  const skill = readFileSync9(o.skillSource, "utf8");
  for (const t of TARGETS) {
    const p = join8(t.userSkillsDir(o.home), "buzzcut", "SKILL.md");
    if (isOurSkill2(p)) writeFileSync4(p, skill);
  }
  writeFileSync4(statePath, JSON.stringify({ ...state, version: o.version }, null, 2) + "\n");
  const nodeGone = state.node && !existsSync8(state.node) ? " The node it ran with is gone: run `buzzcut setup` again." : "";
  return `updated this machine's hooks and skills from buzzcut ${state.version} to ${o.version}.${nodeGone}`;
}
function installedAt(home, env) {
  try {
    const state = JSON.parse(readFileSync9(join8(configDir(home, env), "state.json"), "utf8"));
    return typeof state.installedAt === "number" ? state.installedAt : null;
  } catch {
    return null;
  }
}
function doctor(home, env, cwd) {
  const out = [];
  const dir = configDir(home, env);
  const tilde = (p) => p.startsWith(home) ? "~" + p.slice(home.length) : p;
  let state = null;
  try {
    state = JSON.parse(readFileSync9(join8(dir, "state.json"), "utf8"));
  } catch {
    state = null;
  }
  if (!state) {
    out.push({ ok: false, text: "machine setup: not installed (run `buzzcut setup`)" });
  } else {
    const nodeOk = existsSync8(state.node);
    const bundleOk = existsSync8(state.bundle);
    out.push({ ok: nodeOk && bundleOk, text: `buzzcut ${state.version} at ${tilde(state.bundle)}, run by ${tilde(state.node)}${nodeOk ? "" : " (that node is gone: run `buzzcut setup` again)"}` });
  }
  const gitEnv = { ...env, HOME: home };
  const global = runGit(["config", "--global", "--get", "core.hooksPath"], gitEnv)?.trim();
  const globalHook = global ? join8(resolve6(global.replace(/^~/, home)), "commit-msg") : null;
  const globalOk = Boolean(globalHook && existsSync8(globalHook) && readFileSync9(globalHook, "utf8").includes(BEGIN));
  out.push({ ok: globalOk, text: `git, every repo: ${globalOk ? `commit-msg and pre-push checks in ${tilde(global)}` : "no global buzzcut hooks"}` });
  const local = runGit(["-C", cwd, "config", "--local", "--get", "core.hooksPath"], gitEnv)?.trim();
  const inRepo2 = runGit(["-C", cwd, "rev-parse", "--is-inside-work-tree"], gitEnv)?.trim() === "true";
  if (inRepo2) {
    const common = runGit(["-C", cwd, "rev-parse", "--git-common-dir"], gitEnv)?.trim();
    const hooksDir2 = common ? join8(common, "hooks") : null;
    const repoHook = local ? join8(resolve6(cwd, local.replace(/(^|[\\/])\.husky[\\/]_$/, "$1.husky")), "commit-msg") : hooksDir2 ? join8(resolve6(cwd, hooksDir2), "commit-msg") : null;
    const repoOk = Boolean(repoHook && existsSync8(repoHook) && readFileSync9(repoHook, "utf8").includes(BEGIN));
    if (local) {
      out.push({ ok: repoOk, text: `this repo: uses its own hooks path (${local}), so ${repoOk ? "its buzzcut hook runs" : "global hooks are skipped here: run `buzzcut init`"}` });
    } else {
      out.push({ ok: repoOk || globalOk, text: `this repo: ${repoOk ? "has its own buzzcut hooks" : globalOk ? "covered by the global hooks" : "not covered"}` });
    }
  }
  for (const t of TARGETS) {
    if (!t.detect(home)) {
      out.push({ ok: null, text: `${t.name}: not installed on this machine` });
      continue;
    }
    const skillOk = isOurSkill2(join8(t.userSkillsDir(home), "buzzcut", "SKILL.md"));
    let hookOk = null;
    if (t.hook) {
      const p = t.hook.userFile(home);
      hookOk = existsSync8(p) && /buzzcut\S*"?\s+hook\s/.test(readFileSync9(p, "utf8"));
    }
    const parts = [`skill ${skillOk ? "\u2713" : "\u2717"}`];
    if (hookOk !== null) parts.push(`hook ${hookOk ? "\u2713" : "\u2717"}`);
    out.push({ ok: skillOk && hookOk !== false, text: `${t.name}: ${parts.join(", ")}` });
  }
  for (const d of vscodeUserDirs(home)) {
    if (!existsSync8(d)) continue;
    const p = join8(d, "settings.json");
    const ok2 = existsSync8(p) && readFileSync9(p, "utf8").includes(VSCODE_MARK);
    out.push({ ok: ok2, text: `VS Code \u2728 buttons (${tilde(d)}): ${ok2 ? "use buzzcut rules" : "not configured"}` });
  }
  return out;
}
function packageFiles(moduleUrl) {
  const here = dirname2(fileURLToPath(moduleUrl));
  const root = [resolve6(here, ".."), here].find((d) => existsSync8(join8(d, "skills", "buzzcut", "SKILL.md"))) ?? resolve6(here, "..");
  return { bundle: join8(root, "bundle", "buzzcut.mjs"), skill: join8(root, "skills", "buzzcut", "SKILL.md") };
}

// src/keep.ts
var vocab = new RegExp(VOCAB.source, "i");
var CHECKBOX2 = /^\s*[-*+]\s+\[[ xX]\]/;
var MARKUP = /^\s*(?:#{1,6}\s+|>\s*|[-*+•]\s+|\d{1,2}[.)]\s+)+/;
function plain(line) {
  return line.replace(MARKUP, "").replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1").split(/(`[^`]*`)/).map((part, i) => i % 2 ? part : part.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/(\*\*|__)(.+?)\1/g, "$2").replace(/(^|[\s("])[*_](?=\S)|(?<=\S)[*_](?=$|[\s).,;:!?"])/g, "$1")).join("").trim();
}
function sentencesOf(body, skip, min = 4) {
  const text = analyzeText(body, 1, skip);
  const structural = new Set([...text.headings, ...text.labels, ...text.ticked].map((l) => l.n));
  const out = [];
  for (const line of text.lines) {
    if (structural.has(line.n) || CHECKBOX2.test(line.text) || /^\s*\|/.test(line.text)) continue;
    for (const sentence2 of plain(line.text).split(/(?<=[.!?])\s+(?=[A-Z0-9`"'(])/)) {
      const words = countWords(sentence2);
      if (words < min) continue;
      out.push({ text: sentence2, words, at: out.length });
    }
  }
  return out;
}
var fluff = (s) => OPENER.test(s) || CLOSER.test(s) || CHATBOT.test(s);
function evidence(sentence2, files) {
  let strong = 0;
  let weak = 0;
  let tour = false;
  for (const m of sentence2.matchAll(SPECIFIC)) {
    const name = m[1] ?? m[2];
    if (name === void 0) strong++;
    else if (files.has(name) || files.has(name.split("/").pop())) tour = true;
    else weak++;
  }
  return 2 * Math.min(2, strong) + Math.min(1, weak) - (tour ? 2 : 0);
}
function score(sentence2, files) {
  let s = evidence(sentence2, files);
  if (WHY.test(sentence2)) s += 2;
  if (fluff(sentence2)) s -= 4;
  if (vocab.test(sentence2)) s -= 2;
  if (countWords(sentence2) > 50) s -= 1;
  return s;
}
var SHOW = { sentences: 3, words: 70 };
function worthKeeping(body, budget, files = /* @__PURE__ */ new Set(), skip) {
  const candidates = sentencesOf(body, skip).map((c) => ({ ...c, score: score(c.text, files) }));
  const limit = Math.min(Math.max(budget, 30), SHOW.words);
  const picked = [];
  let words = 0;
  for (const c of candidates.filter((c2) => c2.score >= 2).sort((a, b) => b.score - a.score || a.at - b.at)) {
    if (picked.length >= SHOW.sentences || picked.length && words + c.words > limit) continue;
    picked.push(c);
    words += c.words;
  }
  picked.sort((a, b) => a.at - b.at);
  return { sentences: picked.map((c) => c.text), words };
}
var REASON = /\b(?:because|since (?!v?\d|last\b|then\b|yesterday\b|the (?:last|first|start|beginning)\b)|so that|so (?:we|it|the|they|you|users?|callers?|reviewers?)\b|in order to|otherwise|previously|used to|(?:had|have|has) to|caus(?:e|ed|es|ing)|crash(?:es|ed|ing)?|broke|breaks|broken|regress(?:ion|ions|ed)|leak(?:s|ed|ing)?|race condition|timed out|timeouts?|deadlock(?:s|ed)?|outages?|incidents?|(?:reported|requested|asked for|needed|required) (?:by|in|on|for|from|to|so)\b|need to|unblocks?|blocked|blocks|panic(?:s|ked)?|flaky|typo|(?:was|were|is|are) (?:wrong|incorrect|missing|broken|stale|slow|stuck|lost|ignored|dropped|duplicated)|can(?:no|')t|couldn't|doesn't|didn't|wasn't|isn't|won't)\b|\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?|refs?|see)\b\s*:?\s*#\d+|(?:^|[\s(\[])#\d+\b|https?:\/\/\S*(?:issues|jira|linear|browse|sentry)/i;
var TICKET_REF = /\b[A-Z][A-Z0-9]+-\d+\b/;
var isReason = (s) => REASON.test(s) || TICKET_REF.test(s);
var SYMPTOM = /\b(?:fail(?:s|ed|ing|ures?)?|errors?|exceptions?|bugs?|wrong|incorrect|missing|slow(?:er)?|stuck|stale|hang(?:s|ing)?|hung|drop(?:s|ped)?|lost|loses|duplicat\w*|corrupt\w*|overflow\w*|vulnerab\w*|cve-\d+|deprecat\w*|500s?|50[234]s?|4\d\ds?)\b/i;
var HANDLING = /\b(?:error|failure|exception)s? (?:handling|messages?|states?|boundar(?:y|ies))\b|\bhandl(?:e|es|ed|ing) (?:\w+ ){0,2}(?:errors?|failures?|exceptions?|edge cases)\b/i;
var NARRATES = /^\W*(?:updat(?:e|ed|es)|modif(?:y|ied|ies)|chang(?:e|ed|es)|add(?:ed|s)?|implement(?:ed|s)?|introduc(?:e|ed|es)|refactor(?:ed|s)?|creat(?:e|ed|es)|remov(?:e|ed|es)|enhanc\w*|improv\w*|leverag\w*)\b/i;
var noCode = (s) => s.replace(/`[^`]*`/g, " ");
function whyScore(s) {
  if (countWords(noCode(s)) < 4 || /^\W*what\W*:/i.test(s)) return 0;
  const reason = isReason(noCode(s));
  if (!reason && !SYMPTOM.test(noCode(s))) return 0;
  let n3 = reason ? 3 : 2;
  if (/\d|`[^`]+`/.test(s)) n3 += 1;
  if (!reason && NARRATES.test(s)) n3 -= 3;
  if (HANDLING.test(s)) n3 -= 2;
  if (fluff(s)) n3 -= 4;
  if (vocab.test(s)) n3 -= 3;
  if (/^\W*why\W*:/i.test(s)) n3 += 1;
  return n3;
}
var clip = (s, max) => s.length > max ? s.slice(0, max - 1).trimEnd().replace(/[,;:]$/, "") + "\u2026" : s;
function whyOf(title, body, skip) {
  let best = null;
  for (const c of sentencesOf(body, skip, 3)) {
    const n3 = whyScore(c.text);
    if (n3 >= 3 && (!best || n3 > best.n + 1)) best = { text: c.text, n: n3 };
  }
  if (best) return clip(best.text, 140);
  return isReason(title) && whyScore(title) >= 3 ? title : null;
}

// src/roast.ts
var ROASTS = {
  length: [
    (f, s) => s.lines > 0 && s.words > s.lines ? `${s.words} words for ${changed(s.lines)}. The description is longer than the code.` : `${s.words} words where ${s.budget} would do.`,
    (f) => `${f.data?.ratio}\xD7 over the word budget. A blog post with a diff attached.`,
    (f, s) => `Could have been ${s.budget} words. It's ${s.words}.`
  ],
  "template-on-tiny": [
    (f) => `${f.data?.headers} section headers for ${f.data?.lines} lines of code. It's a PR, not a tax form.`,
    (f) => `A ${f.data?.headers}-section document for a ${f.data?.lines}-line change.`,
    (f) => `Filled out the whole form for a ${f.data?.lines}-line diff.`
  ],
  "diff-echo": [
    (f) => `${f.data?.count} lines reading the file list out loud. GitHub already shows it.`,
    (f) => `A guided tour of ${f.data?.count} files the reviewer can already see.`,
    () => "Narrates the diff, file by file. The diff was right there."
  ],
  "phantom-tests": [(f) => `Says "${f.quote}". Test files changed: 0.`, () => "Mentions tests. The diff has none. Schr\xF6dinger's test suite."],
  "unverified-in-session": [(f) => `"${f.quote}". Nothing was run. We checked.`],
  "ticked-boxes": [(f) => `${f.data?.count} boxes ticked. Commands shown: none.`, (f) => `Checklist theater: ${f.data?.count} ticked boxes and no evidence.`],
  "vague-verification": [(f) => `"${f.quote}". Tested how, exactly?`],
  "unbacked-claim": [(f) => `"${f.quote}". No number, no benchmark, just vibes.`, (f) => `Claims "${f.quote}". Source: trust me.`],
  "type-mismatch": [(f) => `${f.message}. The prefix and the diff disagree.`],
  "ai-vocab": [
    (f) => `Buzzword bingo: ${f.data?.words}.`,
    (f) => `Vocabulary straight from a press release: ${f.data?.words}.`,
    (f) => `${f.data?.words}. The LinkedIn post writes itself.`
  ],
  "ai-opener": [(f) => `Opens with "${f.quote}\u2026". Classic.`, (f) => `"${f.quote}\u2026": the opening line of every generated PR.`],
  "ai-closer": [(f) => `Ends with "${f.quote}\u2026". Nobody asked for a conclusion.`, (f) => `Signs off with "${f.quote}\u2026". It's a PR, not an essay.`],
  "chatbot-leftovers": [(f) => `The chatbot is still talking: "${f.quote}".`],
  emoji: [(f) => `${f.data?.count} emoji-led headers. This is a diff, not a launch party. \u{1F680}`],
  "bold-spam": [(f) => `${f.data?.count} bold phrases. When everything is bold, nothing is.`],
  "bullet-bloat": [(f) => `${f.data?.count} bullet points for ${f.data?.lines} lines of code.`, (f) => `${f.data?.count} bullets. It reads like a slide deck.`],
  "thin-description": [
    (f) => /tested/.test(f.message) ? "Says what it does. Not whether anyone ran it." : `${f.data?.words} words for ${changed(Number(f.data?.lines))}. A caption, not a description.`
  ],
  "long-bullet": [(f) => `A ${f.data?.longest}-word bullet. That's a paragraph wearing a hyphen.`],
  "em-dash": [(f) => `${f.data?.count} em dashes. The telltale kind.`],
  "subject-length": [() => "A title so long it needs its own summary."],
  "commit-changelog": [(f) => `A ${f.data?.bullets}-bullet changelog in a commit message. git log is not a release note.`],
  "markdown-in-commit": [() => "Markdown in a commit message. git log shows every ** and ## as is."]
};
var NITS = {
  length: (f, s) => `A little long: ${s.words} words where about ${s.budget} would do.`,
  "template-on-tiny": (f) => `${f.data?.headers} section headers for a ${f.data?.lines}-line change. An opening and a Tested line would do.`,
  "diff-echo": (f) => `Walks through ${f.data?.count} files the diff already shows.`,
  "unbacked-claim": (f) => `"${f.quote}" could use a number.`,
  "ticked-boxes": (f) => `${f.data?.count} ticked boxes. Name the command instead.`,
  "vague-verification": (f) => `"${f.quote}". Say which command.`,
  "ai-vocab": (f) => `A buzzword or two: ${f.data?.words}.`,
  "ai-opener": (f) => `Opens with "${f.quote}\u2026". Start with the change.`,
  "ai-closer": () => "The closing summary can go.",
  emoji: () => "The emoji headers can go.",
  "bold-spam": (f) => `${f.data?.count} bold phrases. Bold one thing, at most.`,
  "bullet-bloat": (f) => `${f.data?.count} bullets. Keep the ones a reviewer would ask about.`,
  "thin-description": (f) => /tested/.test(f.message) ? "Add a Tested line: what ran, and what it returned." : `${f.data?.words} words for ${changed(Number(f.data?.lines))}. The reviewer needs a map.`,
  "long-bullet": (f) => `A ${f.data?.longest}-word bullet. One change per bullet, about 25 words.`,
  "subject-length": () => "The title could be shorter.",
  "commit-changelog": (f) => `${f.data?.bullets} bullets in a commit body. git log reads better as prose.`,
  "markdown-in-commit": () => "Markdown in a commit message shows up as raw symbols in git log."
};
var SKIP = /* @__PURE__ */ new Set(["subject-mood", "subject-period", "blank-line", "style-convention", "style-case", "style-ticket"]);
var BASICS = /* @__PURE__ */ new Set(["subject-vague", "empty-subject", "missing-why"]);
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
var pick = (xs, seed) => xs[hash(seed) % xs.length];
var sentence = (s) => /[.!?…"]$/.test(s) ? s : s + ".";
function roastLine(f, s, seed, heat = "roast") {
  const nit = heat !== "roast" && f.severity !== "error" ? NITS[f.rule] : void 0;
  const options = ROASTS[f.rule];
  const line = nit ? nit(f, s) : options?.length ? pick(options, seed + f.rule)(f, s) : null;
  return line ?? sentence(f.message);
}
function statsOf(r) {
  return { words: r.words, lines: r.diff?.changedLines ?? 0, budget: r.budget };
}
var n2 = (x) => x.toLocaleString("en-US");
var clip2 = (s, max) => [...s].length > max ? [...s].slice(0, max - 1).join("").trimEnd() + "\u2026" : s;
var SMALL = 20;
function basicsOf(r, body, template) {
  const find = (id) => r.findings.find((f) => f.rule === id);
  const lines2 = r.diff?.changedLines;
  const small = lines2 != null && lines2 <= SMALL;
  let what;
  if (!r.title.trim()) what = { mark: "bad", text: "no title" };
  else if (find("subject-vague")) what = { mark: "bad", text: `"${clip2(r.title, 40)}" doesn't say what changed` };
  else if (find("subject-length")?.severity === "error") what = { mark: "meh", text: `a ${[...r.title].length}-character title` };
  else what = { mark: "ok", text: `"${clip2(r.title, 60)}"` };
  let why;
  const reason = whyOf(r.title, body, template?.lines);
  if (reason) why = { mark: "ok", text: reason === r.title ? "the title says it" : `"${reason}"` };
  else if (small && r.words <= 40) why = { mark: "none", text: r.words ? "doesn't say, but the change is small" : "title only, fine for a change this small" };
  else why = { mark: "bad", text: r.words ? "never says why" : lines2 != null ? `no description for ${changed(lines2)}` : "no description" };
  return { what, why };
}
function verdictLine(r, heat, b, seed) {
  const s = statsOf(r);
  if (r.words === 0) {
    if (b.what.mark === "bad") return "A title that says nothing, and nothing under it. The reviewer has questions.";
    if (b.why.mark !== "bad") return "Title only. For a change this size, fair enough.";
    return r.diff ? `No description for ${changed(s.lines)}. The reviewer gets to guess.` : "No description. The reviewer gets to guess.";
  }
  if (heat === "praise") {
    if (b.what.mark === "ok" && b.why.mark === "ok") return "Says what changed and why, in plain words. Frame this one.";
    return pick(["Short, specific, done.", "The reviewer read it in one breath.", "Senior engineer energy.", "Nothing to cut. Next."], seed);
  }
  if (heat === "nit" && b.why.mark === "bad") return pick(["Tidy. Now tell the reviewer why.", "Clean cut. The reviewer still has to ask why.", "Says what it does. Not why it matters."], seed);
  if (heat === "nit") return pick(["Clean. One trim and it is perfect.", "The reviewer approves. Mostly.", "Almost no yap. Almost.", "Good cut. A little off the top."], seed);
  const longer = s.lines > 0 && s.words > s.lines;
  const options = {
    C: ["Starting to yap. Keep the why, cut the recap.", "Half description, half cover letter.", "Good bones. Too much padding."],
    D: ["Yapping. The diff said it better.", "The reviewer skimmed it. Everyone skims it.", "Somewhere in here is a good five-line description."],
    F: [
      "This isn't a PR description. It's a TED talk.",
      "The reviewer is still reading. Send snacks.",
      ...longer ? ["Longer than the diff, and it isn't close."] : [],
      ...b.why.mark === "bad" ? ["A wall of words and not one reason why."] : [],
      "Certified yapper. The diff could have spoken for itself."
    ]
  };
  return pick(options[r.grade] ?? options.C, seed);
}
var WIDTH = 68;
function meter(score2, p, grade, width = 30) {
  const filled = Math.round(Math.min(100, Math.max(0, score2)) / 100 * width);
  return gradePaint(p, grade)("\u2588".repeat(filled)) + p.dim("\u2591".repeat(width - filled));
}
function banner(p, left, right) {
  const rule = p.dim("\u2501".repeat(WIDTH));
  return [`  ${rule}`, `   ${p.bold(left)}   ${p.dim(right)}`, `  ${rule}`];
}
function scoreBlock(p, r, label = "") {
  const g = gradePaint(p, r.grade);
  return [`   ${p.bold("YAP-O-METER")}  ${meter(r.score, p, r.grade)}  ${g(p.bold(`${r.score}/100`))}  ${g(p.inverse(` ${r.grade} `))}${label}`, `                ${p.dim(r.verdict)}`];
}
var MARK = { ok: "\u2713", bad: "\u2717", meh: "!", none: "\u2013" };
function markPaint(p, m) {
  return m === "ok" ? p.green : m === "bad" ? p.red : m === "meh" ? p.yellow : p.dim;
}
var MAX_BURNS = { A: 2, B: 2, C: 4, D: 5, F: 5 };
function roastCard(pr2, r, opts = {}) {
  const s = statsOf(r);
  const basics = basicsOf(r, pr2.body, opts.template);
  const loud = r.findings.some((f) => !SKIP.has(f.rule) && f.severity !== "info");
  const gap = Object.values(basics).some((b) => b.mark === "bad");
  const heat = r.grade === "A" && !loud && !gap ? "praise" : r.grade === "A" || r.grade === "B" ? "nit" : "roast";
  const said = (f) => BASICS.has(f.rule) || f.rule === "thin-description" && r.words === 0;
  const burnable = heat === "praise" ? [] : r.findings.filter((f) => !SKIP.has(f.rule) && !said(f) && (heat === "roast" || f.severity !== "info"));
  const max = MAX_BURNS[r.grade];
  let keep = null;
  if (heat === "roast" && s.words > s.budget) {
    const files = new Set(r.diff?.files.flatMap((f) => [f.path, f.path.split("/").pop()]) ?? []);
    const kept = worthKeeping(pr2.body, s.budget, files, opts.template?.lines);
    keep = { sentences: kept.sentences, words: kept.words };
  }
  const long = r.findings.some((f) => f.rule === "length");
  return {
    ref: `${pr2.owner}/${pr2.repo}#${pr2.number}`,
    title: pr2.title,
    url: pr2.url,
    score: r.score,
    grade: r.grade,
    verdict: r.verdict,
    heat,
    basics,
    words: s.words,
    lines: r.diff ? s.lines : null,
    budget: s.budget,
    perLine: heat === "roast" && r.diff && s.lines > 0 && s.words >= 2 * s.lines ? Math.round(10 * s.words / s.lines) / 10 : null,
    yapPct: long && s.words > s.budget ? Math.round(100 * (s.words - s.budget) / s.words) : null,
    burns: burnable.slice(0, max).map((f) => ({ severity: f.severity, text: roastLine(f, s, pr2.url, heat) })),
    more: Math.max(0, burnable.length - max),
    keep,
    closer: verdictLine(r, heat, basics, pr2.url)
  };
}
function statLines(c) {
  const size = c.lines != null ? `${n2(c.words)} words for a ${n2(c.lines)}-line diff` : `${n2(c.words)} words`;
  const out = [`${size}${c.perLine ? ` (${c.perLine} words per changed line)` : ""}.`];
  if (c.yapPct != null) out.push(`Could have been ~${n2(c.budget)} words. ${c.yapPct}% of it is yap.`);
  return out;
}
var BURNS_TITLE = { praise: "", nit: "NITS", roast: "THE ROAST" };
function renderRoast(pr2, r, opts) {
  const p = palette(opts.color);
  const c = roastCard(pr2, r, opts);
  const out = [""];
  out.push(...banner(p, "\u{1F488} THE BUZZCUT ROAST", c.ref));
  out.push(`   ${p.dim(`"${clip2(c.title, WIDTH - 6)}"`)}`, "");
  out.push(...scoreBlock(p, r), "");
  for (const [label, b] of [["WHAT CHANGED", c.basics.what], ["WHY         ", c.basics.why]]) {
    const text = wrap(b.text, WIDTH - 21);
    out.push(`   ${markPaint(p, b.mark)(MARK[b.mark])} ${p.bold(label)}  ${text[0]}`, ...text.slice(1).map((t) => `                   ${t}`));
  }
  out.push("");
  for (const l of statLines(c)) for (const w of wrap(l, WIDTH - 4)) out.push(`   ${w}`);
  out.push("");
  if (c.burns.length) {
    out.push(`   ${p.bold(BURNS_TITLE[c.heat])}`);
    for (const b of c.burns) {
      const text = wrap(b.text, WIDTH - 6);
      out.push(`   ${severityPaint(p, b.severity)(ICON[b.severity])} ${text[0]}`, ...text.slice(1).map((t) => `     ${t}`));
    }
    if (c.more) out.push(p.dim(`     \u2026 and ${c.more} more`));
    out.push("");
  }
  if (c.keep) {
    if (c.keep.sentences.length) {
      out.push(`   ${p.bold("WORTH KEEPING")}  ${p.dim(`the ${c.keep.words} words with facts in them`)}`);
      for (const s of c.keep.sentences) for (const w of wrap(s, WIDTH - 6)) out.push(`   ${p.dim("\u2502")} ${w}`);
    } else {
      out.push(`   ${p.bold("WORTH KEEPING")}  ${p.dim("nothing: no numbers, no errors, no reason why")}`);
    }
    out.push("");
  }
  out.push(`   ${p.bold("VERDICT")}  ${c.closer}`, "");
  out.push(`   ${p.dim("Roast any PR")}  ${p.cyan("npx buzzcut roast <pr-url>")}`);
  if (!opts.share) out.push(`   ${p.dim("Post this   ")}  ${p.cyan("add --share")}`);
  out.push("");
  return out.join("\n");
}
function renderRoastMarkdown(pr2, r, opts = {}) {
  const c = roastCard(pr2, r, opts);
  const out = [];
  const bar = "\u2588".repeat(Math.round(r.score / 10)) + "\u2591".repeat(10 - Math.round(r.score / 10));
  out.push(`### \u{1F488} buzzcut roast: [${c.ref}](${c.url})`);
  out.push("");
  out.push(`**Yap-o-meter** \`${bar}\` **${r.score}/100 (${r.grade})**, ${r.verdict}`);
  out.push("");
  out.push(`${MARK[c.basics.what.mark]} **What changed:** ${c.basics.what.text}  `);
  out.push(`${MARK[c.basics.why.mark]} **Why:** ${c.basics.why.text}`);
  out.push("");
  out.push(statLines(c).join(" "));
  out.push("");
  for (const b of c.burns) out.push(`- ${ICON[b.severity]} ${b.text}`);
  if (c.more) out.push(`- \u2026 and ${c.more} more`);
  if (c.keep?.sentences.length) {
    out.push("", `**Worth keeping** (the ${c.keep.words} words with facts in them):`, "");
    for (const s of c.keep.sentences) out.push(`> ${s}`);
  }
  out.push("", `**Verdict:** ${c.closer}`);
  out.push("");
  out.push("<sub>Roast any PR: `npx buzzcut roast <pr-url>`</sub>");
  return out.join("\n");
}
function shareUrl(pr2, r) {
  const s = statsOf(r);
  const what = r.diff ? `${n2(s.words)} words for a ${n2(s.lines)}-line diff` : `${n2(s.words)} words`;
  const text = `This PR scored ${r.score}/100 on the yap-o-meter (${r.grade}, ${r.verdict.replace(/\.$/, "").toLowerCase()}): ${what}. \u{1F488}

Roast any PR: npx buzzcut roast <pr-url>`;
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(pr2.url)}`;
}
function boardSummary(b) {
  const rows = [...b.rows].sort((x, y) => y.report.score - x.report.score);
  const avg = rows.length ? Math.round(rows.reduce((t, r) => t + r.report.score, 0) / rows.length) : 0;
  const words = rows.reduce((t, r) => t + r.report.words, 0);
  const over = rows.reduce((t, r) => t + Math.max(0, r.report.words - r.report.budget), 0);
  const lazy = rows.filter((r) => r.report.findings.some((f) => f.rule === "subject-vague" || f.rule === "empty-subject"));
  const withDiff = rows.filter((r) => r.report.diff && r.report.words > 0);
  const tightest = withDiff.length ? withDiff.reduce((a, c) => c.report.diff.changedLines / c.report.words > a.report.diff.changedLines / a.report.words ? c : a) : null;
  return { rows, avg, words, over, lazy, yappiest: rows[0] ?? null, tightest };
}
var lines = (r) => r.diff?.changedLines ?? 0;
var changed = (k) => `${n2(k)} changed line${k === 1 ? "" : "s"}`;
var failing = (rows) => rows.filter((r) => !passes(r.report, DEFAULTS.max)).length;
function renderBoard(b, opts) {
  const p = palette(opts.color);
  const { rows, avg, words, over, lazy, yappiest, tightest } = boardSummary(b);
  const out = [""];
  out.push(...banner(p, "\u{1F488} THE BUZZCUT ROAST", b.subject), "");
  const { grade, verdict } = gradeOf(avg);
  out.push(...scoreBlock(p, { score: avg, grade, verdict }, p.dim("  average")), "");
  const unit = b.kind === "pr" ? "PR" : "commit";
  const bad = failing(rows);
  const failLine = bad ? `${bad} of ${rows.length} ${unit === "PR" ? "PRs" : "commits"} would be sent back to rewrite.` : `All ${rows.length} would pass.`;
  const idWidth = Math.max(...rows.map((r) => r.id.length), 4);
  for (const { id, title, report: r } of rows) {
    const g = gradePaint(p, r.grade);
    const w = `${n2(r.words)}w`.padStart(6);
    const d = `${n2(lines(r))}L`.padStart(6);
    const mark = passes(r, DEFAULTS.max) ? p.green("\u2713") : p.red("\u2717");
    out.push(`   ${mark} ${p.dim(id.padEnd(idWidth))}  ${g(String(r.score).padStart(3))} ${g(r.grade)}  ${w} ${p.dim(d)}  ${clip2(title, WIDTH - idWidth - 27)}`);
  }
  out.push("");
  if (yappiest && yappiest.report.score > 10) {
    out.push(`   ${p.bold("Yappiest")}  ${yappiest.id}: ${n2(yappiest.report.words)} words for ${changed(lines(yappiest.report))}.`);
  }
  if (tightest && tightest !== yappiest && tightest.report.score <= 10) {
    out.push(`   ${p.bold("Tightest")}  ${tightest.id}: ${n2(tightest.report.words)} words for ${changed(lines(tightest.report))}. Respect.`);
  }
  if (lazy.length) {
    const examples = [...new Set(lazy.map((r) => `"${clip2(r.title, 16)}"`))].slice(0, 3).join(", ");
    out.push(`   ${p.bold("Laziest ")}  ${lazy.length} ${unit}${lazy.length > 1 ? "s that say" : " that says"} nothing: ${examples}.`);
  }
  if (over >= 100) {
    out.push(`   ${p.bold("Total   ")}  ${n2(words)} words, ${n2(over)} of them over budget.`);
  }
  out.push(`   ${p.bold("Verdict ")}  ${failLine}`);
  out.push("");
  out.push(`   ${p.dim(`Roast one ${unit}`)}  ${p.cyan(b.next)}`, "");
  return out.join("\n");
}
function renderBoardMarkdown(b) {
  const { rows, avg, words, over, yappiest } = boardSummary(b);
  const { grade } = gradeOf(avg);
  const out = [`### \u{1F488} buzzcut roast: ${b.subject}`, "", `**Average yap score ${avg}/100 (${grade})**`, ""];
  out.push(`| | ${b.kind === "pr" ? "PR" : "Commit"} | Score | Words | Lines | Title |`, "|---|---|---|---|---|---|");
  for (const { id, title, report: r } of rows) out.push(`| ${passes(r, DEFAULTS.max) ? "\u2713" : "\u2717"} | ${id} | ${r.score} ${r.grade} | ${r.words} | ${lines(r)} | ${title.replace(/\|/g, "\\|")} |`);
  out.push("");
  if (yappiest && yappiest.report.score > 10) out.push(`Yappiest: ${yappiest.id}, ${yappiest.report.words} words for ${changed(lines(yappiest.report))}.`);
  if (over > 0) out.push(`${words} words in total, ${over} over budget.`);
  out.push("", "<sub>Roast yours: `npx buzzcut roast owner/repo`</sub>");
  return out.join("\n");
}
function boardShareUrl(b) {
  const { avg, yappiest } = boardSummary(b);
  const { grade } = gradeOf(avg);
  const worst = yappiest && yappiest.report.score > 10 ? ` Yappiest: ${n2(yappiest.report.words)} words for ${changed(lines(yappiest.report))}.` : "";
  const text = `Roasted ${b.subject}: average yap score ${avg}/100 (${grade}).${worst} \u{1F488}

Roast yours: npx buzzcut roast owner/repo`;
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

// src/cli.ts
var userHome = (env = process.env) => env.HOME || homedir2();
var HELP = `
buzzcut ${package_default.version}: short, specific commit messages and PR descriptions,
checked against the actual diff. No API key, no LLM calls.

Set up this machine (once): every repo, every coding agent
  buzzcut setup                   Global git hooks, the skill for each agent found
                                   (Claude Code, Cursor, Windsurf, Antigravity, VS Code,
                                   Codex), their pre-command hooks, and VS Code's \u2728 buttons
    --no-git-hooks / --no-agents / --no-vscode    Leave that part out
    --uninstall                    Put everything back
    --dry-run                      Show what would change
  buzzcut doctor                  What's installed where, and whether this repo is covered

Set up one repo for the whole team (commit the files it writes)
  buzzcut init                    commit-msg and pre-push hooks, plus hooks and the skill
                                   for the agents this repo already uses
    --agents <list>                claude,cursor,windsurf,antigravity,copilot, or all / none
    --no-git-hooks                 Only the agent files
    --uninstall                    Remove everything buzzcut added
    --dry-run                      Show what would change

Before you write
  buzzcut context [--kind pr]     Diff facts, word budget and repo style, for an agent

Check a draft
  buzzcut check [file|-]          A commit message against the staged diff
  buzzcut pr [file|-]             A PR body against the branch (no file: the open PR)
    -m, --message <text>           Text to check instead of a file or stdin
    --kind commit|pr               What the text is (check only; default: commit)
    --title <text>                 PR title
    --base <ref>                   Base branch (default: origin/HEAD, main, master)
    --rev <commit>                 Check an existing commit against its own diff
    --no-diff                      Skip the diff checks
    --max <n>                      Fail above this score (default: 35, or the config)
    --json                         Machine-readable output

Look back
  buzzcut log [-n 10]             Score your recent commits
  buzzcut roast <pr-url>          Roast any public GitHub PR (or owner/repo#123)
  buzzcut roast <owner/repo>      Leaderboard of a repo's last merged PRs  (-n 10)
  buzzcut roast                   Inside a repo: roast its last commits  (-n 20)
    --share                        Add a link that posts the roast on X
    --md, --json                   Markdown (for a comment) or machine-readable

Config: .buzzcut.json at the repo root, e.g.
  { "max": 30, "block": "agents", "rules": { "em-dash": "off" }, "ignore": ["^release:"] }
`;
var FLAGS_WITH_VALUE = /* @__PURE__ */ new Set(["m", "message", "kind", "title", "base", "rev", "max", "n", "agents"]);
function parseArgs2(argv) {
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-" || !a.startsWith("-")) {
      positional.push(a);
      continue;
    }
    const [rawKey, inline] = a.replace(/^--?/, "").split(/=(.*)/s);
    const key = rawKey;
    if (key.startsWith("no-")) opts[key.slice(3)] = false;
    else if (FLAGS_WITH_VALUE.has(key)) {
      const v = inline ?? argv[++i];
      if (v === void 0) fail(`--${key} needs a value`);
      opts[key] = v;
    } else opts[key] = true;
  }
  return { positional, opts };
}
function fail(msg, code = 2) {
  process.stderr.write(`buzzcut: ${msg}
`);
  process.exit(code);
}
function note(msg, json) {
  if (!json) process.stderr.write(palette(useColor(process.stderr)).dim(`  ${msg}
`));
}
function readStdin() {
  try {
    return readFileSync10(0, "utf8");
  } catch {
    return "";
  }
}
function maxScore(opts, fallback) {
  const n3 = Number(opts.max ?? fallback);
  if (!Number.isFinite(n3)) fail("--max must be a number");
  return n3;
}
function repoOrFail(cwd = process.cwd()) {
  try {
    return loadRepo(cwd);
  } catch (e) {
    if (e instanceof ConfigError) fail(e.message);
    throw e;
  }
}
function readInput(positional, opts, allowTtyEmpty = false) {
  const file = positional[0];
  const message = opts.m ?? opts.message;
  if (typeof message === "string") return message;
  if (file === "-" || !file && !process.stdin.isTTY && !allowTtyEmpty) return readStdin();
  if (file) {
    try {
      return readFileSync10(file, "utf8");
    } catch {
      fail(`can't read ${file}`);
    }
  }
  return null;
}
function report(msg, diff, opts, label, draftFile2, anchor) {
  const repo = repoOrFail();
  const key = draftFile2 && draftFile2 !== "-" ? `file:${resolve7(draftFile2)}` : null;
  const sig = diff ? diffSignature(diff) + (anchor ? `@${anchor}` : "") : void 0;
  const saved = key ? readDraft(key, process.cwd()) : null;
  const prev = saved && (!saved.diff || !sig || saved.diff === sig) ? saved : null;
  const r = analyze(msg, diff, { style: repo.style, template: repo.template, rules: repo.config.rules, length: repo.config.length, previous: prev ? { evidence: prev.evidence, strict: false } : null });
  if (key) saveDraft(key, process.cwd(), { evidence: keepableEvidence(msg, r), at: Date.now(), diff: sig });
  const max = maxScore(opts, repo.config.max);
  const json = opts.json === true;
  process.stdout.write(json ? toJson(r, max) + "\n" : renderReport(r, { color: useColor(), max, label, width: process.stdout.columns }) + "\n");
  return passes(r, max) ? 0 : 1;
}
function check(positional, opts) {
  const json = opts.json === true;
  const title = typeof opts.title === "string" ? opts.title : void 0;
  const kind = opts.kind ?? (title !== void 0 || opts.base ? "pr" : "commit");
  if (kind !== "commit" && kind !== "pr") fail('--kind must be "commit" or "pr"');
  const rev = typeof opts.rev === "string" ? opts.rev : void 0;
  let raw = readInput(positional, opts, Boolean(rev));
  if (raw == null && rev) raw = commitMessage(rev);
  if (raw == null && !rev) fail('nothing to check. Pass a file, -m "text", pipe text in, or use --rev <commit>. See buzzcut --help.');
  if (raw == null) fail(`couldn't read commit ${rev}`);
  if (!raw.trim()) fail('nothing to check: the message is empty. Pass a file, -m "text", or pipe text in.');
  let msg;
  if (kind === "commit") msg = parseCommit(raw);
  else {
    const heading = !title && raw.match(/^# (.+)\n/);
    msg = heading ? prMessage(heading[1], raw.slice(heading[0].length)) : prMessage(title ?? "", raw);
  }
  let diff = null;
  if (opts.diff !== false) {
    if (!inRepo()) note("not a git repo, so the diff checks were skipped", json);
    else if (rev) diff = commitDiff(rev);
    else if (kind === "commit") {
      diff = stagedDiff();
      if (!diff) note("nothing staged, so the diff checks were skipped (stage first, or use --rev)", json);
    } else {
      const base = opts.base ?? defaultBase();
      diff = base ? branchDiff(base) : null;
      if (!diff) note(`couldn't diff against ${base ?? "a base branch"}, so the diff checks were skipped (use --base)`, json);
    }
  }
  const anchor = kind === "commit" && !rev && diff ? git(["rev-parse", "-q", "--verify", "HEAD"]) ?? "root" : void 0;
  return report(msg, diff, opts, void 0, typeof opts.m === "string" || typeof opts.message === "string" ? void 0 : positional[0], anchor);
}
function pr(positional, opts) {
  let raw = readInput(positional, opts);
  let title = typeof opts.title === "string" ? opts.title : "";
  let base = typeof opts.base === "string" ? opts.base : void 0;
  if (raw == null) {
    let view;
    try {
      view = JSON.parse(
        execFileSync4("gh", ["pr", "view", "--json", "title,body,baseRefName"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      );
    } catch {
      fail('no PR body given, and `gh pr view` found no open PR for this branch. Pass a file: buzzcut pr body.md --title "\u2026"');
    }
    raw = view.body ?? "";
    title ||= view.title;
    if (!base) base = git(["rev-parse", "--verify", "-q", `origin/${view.baseRefName}`]) ? `origin/${view.baseRefName}` : view.baseRefName;
  }
  const b = base ?? defaultBase();
  const diff = opts.diff === false || !b ? null : branchDiff(b);
  if (!diff && opts.diff !== false) note(`couldn't diff against ${b ?? "a base branch"}, so the diff checks were skipped (use --base)`, opts.json === true);
  return report(prMessage(title, raw), diff, opts, "pr", typeof opts.m === "string" || typeof opts.message === "string" ? void 0 : positional[0]);
}
function context(opts) {
  const kind = opts.kind ?? "commit";
  if (kind !== "commit" && kind !== "pr") fail('--kind must be "commit" or "pr"');
  let c;
  try {
    c = buildContext(kind, process.cwd(), typeof opts.base === "string" ? opts.base : void 0);
  } catch (e) {
    if (e instanceof ConfigError) fail(e.message);
    throw e;
  }
  process.stdout.write(opts.json ? JSON.stringify(c, null, 2) + "\n" : renderContext(c) + "\n");
  return 0;
}
function log(opts) {
  if (!inRepo()) fail("not a git repository");
  const repo = repoOrFail();
  const n3 = Math.max(1, Math.min(200, Number(opts.n ?? 10) || 10));
  const shas = recentCommits(n3);
  if (!shas.length) fail("no commits found");
  const rows = shas.map((sha) => ({ sha, msg: historyMessage(commitMessage(sha) ?? "") })).filter(({ msg }) => msg.title && !isIgnored(msg.title, repo.config)).map(({ sha, msg }) => ({ sha, report: analyze(msg, commitDiff(sha), { style: repo.style, rules: repo.config.rules, length: repo.config.length }) }));
  if (!rows.length) fail("no commits to score (merges, reverts and version bumps are skipped)");
  if (opts.json) {
    const out2 = rows.map(({ sha, report: r }) => ({ sha, score: r.score, grade: r.grade, title: r.title, rules: r.findings.map((f) => f.rule) }));
    process.stdout.write(JSON.stringify(out2, null, 2) + "\n");
    return 0;
  }
  const p = palette(useColor());
  const out = ["", `  ${p.bold("buzzcut log")} ${p.dim(`\xB7 last ${rows.length} commits`)}`, ""];
  for (const { sha, report: r } of rows) {
    const g = gradePaint(p, r.grade);
    const subject = r.title.length > 60 ? r.title.slice(0, 59) + "\u2026" : r.title;
    const top = r.findings[0] ? p.dim(`  ${r.findings[0].rule}`) : "";
    out.push(`  ${p.dim(sha.slice(0, 7))}  ${g(String(r.score).padStart(3))} ${g(r.grade)}  ${subject}${top}`);
  }
  const avg = Math.round(rows.reduce((s, r) => s + r.report.score, 0) / rows.length);
  const worst = rows.reduce((a, b) => b.report.score > a.report.score ? b : a);
  out.push("");
  out.push(`  ${p.dim("average")} ${avg}  ${p.dim("\xB7 worst")} ${worst.sha.slice(0, 7)} (${worst.report.score})  ${p.dim("\xB7 details:")} buzzcut check --rev ${worst.sha.slice(0, 7)}`);
  out.push("");
  process.stdout.write(out.join("\n") + "\n");
  return 0;
}
var clampN = (v, fallback, max) => Math.max(1, Math.min(max, Number(v ?? fallback) || fallback));
function boardJson(b) {
  const { avg, rows } = boardSummary(b);
  return JSON.stringify(
    {
      subject: b.subject,
      average: avg,
      rows: rows.map(({ id, title, report: r }) => ({ id, title, score: r.score, grade: r.grade, words: r.words, budget: r.budget, changedLines: r.diff?.changedLines ?? null, rules: r.findings.map((f) => f.rule) }))
    },
    null,
    2
  );
}
function printBoard(b, opts) {
  if (opts.json) process.stdout.write(boardJson(b) + "\n");
  else if (opts.md) process.stdout.write(renderBoardMarkdown(b) + "\n");
  else process.stdout.write(renderBoard(b, { color: useColor() }) + "\n");
  if (opts.share && !opts.json) process.stdout.write(`   Post it: ${boardShareUrl(b)}

`);
  return 0;
}
function roastCommits(opts) {
  const repo = repoOrFail();
  const shas = recentCommits(clampN(opts.n, 20, 200));
  const rows = [];
  for (const sha of shas) {
    const msg = historyMessage(commitMessage(sha) ?? "");
    if (!msg.title || isIgnored(msg.title, repo.config)) continue;
    rows.push({ id: sha.slice(0, 7), title: msg.title, report: analyze(msg, commitDiff(sha), { style: repo.style, rules: repo.config.rules, length: repo.config.length }) });
  }
  if (!rows.length) fail("no commits to roast here");
  const name = basename(repo.root ?? process.cwd());
  const worst = [...rows].sort((a, b) => b.report.score - a.report.score)[0];
  return printBoard({ subject: `${name} \xB7 last ${rows.length} commits`, kind: "commit", rows, next: `buzzcut check --rev ${worst.id}` }, opts);
}
async function roastRepo(ref, opts) {
  const client = createClient({ token: localToken() });
  const count = clampN(opts.n, 10, client.authenticated ? 30 : 15);
  if (!opts.json) note(`fetching the last ${count} merged PRs of ${ref.owner}/${ref.repo}\u2026`, false);
  const prs = await fetchRecentPrs(client, ref, count);
  if (!prs.length) fail(`no merged PRs by people found in ${ref.owner}/${ref.repo}`);
  const template = await fetchTemplate(client, ref.owner, ref.repo).catch(() => null);
  const rows = prs.map((pr2) => ({ id: `#${pr2.number}`, title: pr2.title, report: analyze(prMessage(pr2.title, pr2.body), pr2.diff, { template }) }));
  const worst = [...rows].sort((a, b) => b.report.score - a.report.score)[0];
  return printBoard({ subject: `${ref.owner}/${ref.repo} \xB7 last ${rows.length} merged PRs`, kind: "pr", rows, next: `npx buzzcut roast ${ref.owner}/${ref.repo}${worst.id}` }, opts);
}
async function roast(positional, opts) {
  const target = positional[0];
  if (!target) {
    if (!inRepo()) fail("usage: buzzcut roast <pr-url | owner/repo#123 | owner/repo>, or run it inside a git repo to roast its commits");
    return roastCommits(opts);
  }
  const ref = parsePrRef(target);
  if (!ref) {
    const repoRef = parseRepoRef(target);
    if (repoRef) return roastRepo(repoRef, opts);
    fail(`"${target}" isn't a GitHub PR (URL or owner/repo#123) or a repo (owner/repo)`);
  }
  const client = createClient({ token: localToken() });
  const pr2 = await fetchPr(ref, client);
  if (pr2.bot && !opts.json) {
    process.stdout.write(
      `
  \u{1F916} ${pr2.owner}/${pr2.repo}#${pr2.number} was opened by a bot (${pr2.author}).
  Changelogs and dependency bumps aren't yap. Try a PR written by a person or their agent.

`
    );
    return 0;
  }
  const template = await fetchTemplate(client, ref.owner, ref.repo, pr2.baseSha).catch(() => null);
  const r = analyze(prMessage(pr2.title, pr2.body), pr2.diff, { template });
  if (opts.json) process.stdout.write(toJson(r, maxScore(opts, DEFAULTS.max), { pr: { url: pr2.url, author: pr2.author, bot: pr2.bot } }) + "\n");
  else if (opts.md) process.stdout.write(renderRoastMarkdown(pr2, r, { template }) + "\n");
  else process.stdout.write(renderRoast(pr2, r, { color: useColor(), template, share: opts.share === true }) + "\n");
  if (opts.share && !opts.json) process.stdout.write(`   Post it: ${shareUrl(pr2, r)}

`);
  return 0;
}
function emit(r) {
  if (r.stdout) process.stdout.write(r.stdout.endsWith("\n") ? r.stdout : r.stdout + "\n");
  if (r.stderr) process.stderr.write(r.stderr);
  return r.code;
}
function hook(positional) {
  const [name, ...args] = positional;
  const h = { cwd: process.cwd(), env: process.env, color: useColor(process.stderr) };
  if ((name === "commit-msg" || name === "pre-push") && process.env.BUZZCUT_CHECKED === "1") return 0;
  try {
    switch (name) {
      case "commit-msg":
        if (!args[0]) fail("usage: buzzcut hook commit-msg <message-file>");
        return emit(commitMsgHook(args[0], h));
      case "pre-push":
        return emit(prePushHook(args[0] ?? "origin", process.stdin.isTTY ? "" : readStdin(), h, installedAt(userHome(), process.env)));
      case "claude":
      case "copilot":
        return emit(agentHook(readStdin(), "claude", h));
      case "cursor":
      case "windsurf":
      case "antigravity":
        return emit(agentHook(readStdin(), name, h));
      default:
        fail("usage: buzzcut hook <commit-msg|pre-push|claude|copilot|cursor|windsurf|antigravity>");
    }
  } catch (e) {
    process.stderr.write(`buzzcut: ${e.message} (not blocking)
`);
    if (name === "cursor") process.stdout.write(JSON.stringify({ permission: "allow" }) + "\n");
    return 0;
  }
}
function printResult(res, dryRun) {
  const p = palette(useColor());
  if (!res.ok) fail(res.error ?? "failed", 1);
  const dry = dryRun ? p.dim(" (dry run, nothing written)") : "";
  process.stdout.write("\n");
  if (!res.done.length) process.stdout.write(`  ${p.dim("Nothing to change.")}${dry}
`);
  for (const d of res.done) process.stdout.write(`  ${p.green("\u2713")} ${d}${dry}
`);
  for (const n3 of res.notes) process.stdout.write(`  ${p.yellow("!")} ${n3}
`);
}
function runInit(opts) {
  const raw = opts.agents;
  const agents = typeof raw === "string" ? raw === "all" || raw === "none" ? raw : raw.split(",").map((a) => a.trim()).filter(Boolean) : void 0;
  const res = init({
    cwd: process.cwd(),
    agents,
    skillSource: packageFiles(import.meta.url).skill,
    gitHooks: opts["git-hooks"] !== false,
    uninstall: opts.uninstall === true,
    dryRun: opts["dry-run"] === true,
    env: process.env
  });
  printResult(res, opts["dry-run"] === true);
  if (!opts.uninstall && res.done.length && opts["git-hooks"] !== false) {
    const p = palette(useColor());
    process.stdout.write(
      `
  Commits and pushes in this repo are now checked. Coding agents get blocked until
  the message passes; people get a warning. Settings go in ${p.cyan(".buzzcut.json")}.
`
    );
  }
  process.stdout.write("\n");
  return 0;
}
function runSetup(opts) {
  const files = packageFiles(import.meta.url);
  const dryRun = opts["dry-run"] === true;
  const res = setup({
    home: userHome(),
    env: process.env,
    uninstall: opts.uninstall === true,
    dryRun,
    gitHooks: opts["git-hooks"] !== false,
    agents: opts.agents !== false,
    vscode: opts.vscode !== false,
    node: process.execPath,
    bundleSource: files.bundle,
    skillSource: files.skill,
    version: package_default.version
  });
  printResult(res, dryRun);
  if (!opts.uninstall && res.ok && !dryRun) {
    const p = palette(useColor());
    process.stdout.write(
      `
  Done. From now on, commits and PRs are checked in every repo and every agent
  on this machine. Restart open editors so they pick up the new hooks.
  Check anytime with ${p.cyan("buzzcut doctor")}; undo with ${p.cyan("buzzcut setup --uninstall")}.
`
    );
  }
  process.stdout.write("\n");
  return 0;
}
function runDoctor() {
  const p = palette(useColor());
  const lines2 = doctor(userHome(), process.env, process.cwd());
  process.stdout.write(`
  ${p.bold("buzzcut doctor")}

`);
  for (const l of lines2) {
    const icon = l.ok === true ? p.green("\u2713") : l.ok === false ? p.red("\u2717") : p.dim("\xB7");
    process.stdout.write(`  ${icon} ${l.ok === null ? p.dim(l.text) : l.text}
`);
  }
  process.stdout.write("\n");
  return lines2.some((l) => l.ok === false) ? 1 : 0;
}
async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    process.stdout.write(HELP);
    return 0;
  }
  if (cmd === "--version" || cmd === "-v") {
    process.stdout.write(package_default.version + "\n");
    return 0;
  }
  const { positional, opts } = parseArgs2(rest);
  if (opts.help || opts.h) {
    process.stdout.write(HELP);
    return 0;
  }
  if (cmd !== "hook" && cmd !== "setup") {
    try {
      const files = packageFiles(import.meta.url);
      const updated = refreshInstall({ home: userHome(), env: process.env, version: package_default.version, bundleSource: files.bundle, skillSource: files.skill });
      if (updated) note(`buzzcut: ${updated}`, false);
    } catch {
    }
  }
  switch (cmd) {
    case "check":
      return check(positional, opts);
    case "pr":
      return pr(positional, opts);
    case "context":
      return context(opts);
    case "log":
      return log(opts);
    case "roast":
      return roast(positional, opts);
    case "init":
      return runInit(opts);
    case "setup":
      return runSetup(opts);
    case "doctor":
      return runDoctor();
    case "hook":
      return hook(positional);
  }
  if (parsePrRef(cmd)) return roast([cmd, ...positional], opts);
  fail(`unknown command "${cmd}". See buzzcut --help.`);
}
main().then(
  (code) => process.exit(code),
  (err) => fail(err instanceof GitHubError ? err.message : String(err?.stack ?? err), 2)
);
