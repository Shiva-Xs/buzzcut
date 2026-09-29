import { attach, MAX_TOTAL_TEXT, parseGitPatch, patchStart, type Changed } from './patch.js';
import type { DiffFacts, FileChange } from './types.js';

const TEST = [
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
  /[._-]?unit_?tests?\.[a-z0-9]+$/i,
];

// In these languages tests usually live inside the source file, so a diff can add
// tests without touching a test file.
const INLINE_TESTS = /\.(rs|zig|d)$/;

export function hasInlineTests(path: string): boolean {
  return INLINE_TESTS.test(path);
}

const DOC =
  /\.(md|mdx|markdown|rst|adoc|txt)$|(^|\/)(docs?|documentation)\/|(^|\/)(README|CHANGELOG|CHANGES|HISTORY|LICENSE|CONTRIBUTING|AUTHORS|NOTICE)(\.[a-z]+)?$/i;

// Lockfiles and build output: thousands of lines nobody reads, so they don't earn prose.
const GENERATED =
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|go\.sum|poetry\.lock|Pipfile\.lock|uv\.lock|Gemfile\.lock|composer\.lock|mix\.lock|pubspec\.lock|Podfile\.lock|packages\.lock\.json|gradle\.lockfile|flake\.lock)$|\.(min\.(js|css)|map|pb\.go)$|_pb2\.py$|\.generated\.\w+$/;

// CI configuration: a diff that only touches these can't add a unit test, and its "tests" are CI jobs.
const CI = /^\.github\/workflows\/|^\.circleci\/|^\.buildkite\/|(^|\/)(Jenkinsfile|\.gitlab-ci\.ya?ml|azure-pipelines\.ya?ml|\.travis\.ya?ml|appveyor\.ya?ml|cloudbuild\.ya?ml|bitbucket-pipelines\.ya?ml)$/i;

export function isCi(path: string): boolean {
  return CI.test(path);
}

export function isGenerated(path: string): boolean {
  return GENERATED.test(path);
}

const generatedFile = (f: FileChange) => f.generated === true || isGenerated(f.path);

export function isTest(path: string): boolean {
  return TEST.some((re) => re.test(path));
}

export function isDoc(path: string): boolean {
  return !isTest(path) && DOC.test(path);
}

export function buildDiff(files: FileChange[], totals?: { additions: number; deletions: number }, truncated = false): DiffFacts {
  const additions = totals?.additions ?? files.reduce((n, f) => n + f.additions, 0);
  const deletions = totals?.deletions ?? files.reduce((n, f) => n + f.deletions, 0);
  const tests = files.filter((f) => isTest(f.path));
  const docs = files.filter((f) => isDoc(f.path));
  const source = files.filter((f) => !isTest(f.path) && !isDoc(f.path));
  const generated = files.filter(generatedFile).reduce((n, f) => n + f.additions + f.deletions, 0);
  return { files, additions, deletions, changedLines: Math.max(0, additions + deletions - generated), tests, docs, source, truncated, searchable: isSearchable(files, truncated) };
}

/** Every file that changes lines has its changed lines here (generated files and empty changes aside). */
function isSearchable(files: FileChange[], truncated: boolean): boolean {
  if (truncated) return false;
  let size = 0;
  for (const f of files) {
    if (generatedFile(f) || f.additions + f.deletions === 0) continue;
    if (f.added === undefined) return false;
    size += f.added.length + (f.removed?.length ?? 0);
  }
  return size <= MAX_TOTAL_TEXT;
}

const cache = new WeakMap<DiffFacts, Changed>();

/** All the added and removed lines of a diff, generated files left out. Empty when it carries none. */
export function changedText(d: DiffFacts): Changed {
  const hit = cache.get(d);
  if (hit) return hit;
  const added: string[] = [];
  const removed: string[] = [];
  for (const f of d.files) {
    if (generatedFile(f)) continue;
    if (f.added) added.push(f.added);
    if (f.removed) removed.push(f.removed);
  }
  const out = { added: added.join('\n'), removed: removed.join('\n') };
  cache.set(d, out);
  return out;
}

/** Files and changed lines out of `git diff --numstat -p -U0` output: the numstat block, then the patch. */
export function parseDiffOutput(out: string): FileChange[] {
  const at = patchStart(out);
  const files = parseNumstat(out.slice(0, at));
  // Numstat can't tell how big the patch is; a diff this large is called unsearchable, not slow.
  if (at >= out.length || out.length > 8 * MAX_TOTAL_TEXT) return files;
  return attach(files, parseGitPatch(out.slice(at)));
}

/** Which change a diff is: its files and their line counts. */
export function diffSignature(d: DiffFacts): string {
  return d.files
    .map((f) => `${f.path}:${f.additions}:${f.deletions}`)
    .sort()
    .join('|');
}

/** `a/{old => new}/b` and `old => new` both resolve to the new path. */
function renamedPath(p: string): string {
  if (p.includes('{') && p.includes(' => ')) {
    return p.replace(/\{([^}]*) => ([^}]*)\}/, '$2').replace(/\/\/+/g, '/');
  }
  const arrow = p.indexOf(' => ');
  return arrow === -1 ? p : p.slice(arrow + 4);
}

/** Parse `git diff --numstat` / `git show --numstat` output. Binary files count as 0 lines. */
export function parseNumstat(out: string): FileChange[] {
  const files: FileChange[] = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^(-|\d+)\t(-|\d+)\t(.+)$/);
    if (!m) continue;
    files.push({
      path: renamedPath(m[3]!),
      additions: m[1] === '-' ? 0 : Number(m[1]),
      deletions: m[2] === '-' ? 0 : Number(m[2]),
      ...(m[3]!.includes(' => ') ? { renamed: true } : {}),
    });
  }
  return files;
}

/** Where a diff's changed lines are, by top-level area (two levels deep for src-like roots). */
export { generatedFile };

export function areasOf(files: FileChange[], max = 6): { area: string; lines: number; files: number }[] {
  const by = new Map<string, { lines: number; files: number }>();
  for (const f of files) {
    if (generatedFile(f)) continue;
    const parts = f.path.split('/');
    const deep = parts.length > 2 && /^(src|lib|packages|apps|crates|pkg|internal|cmd|app|services)$/.test(parts[0]!);
    const area = parts.length === 1 ? '(root)' : deep ? `${parts[0]}/${parts[1]}` : parts[0]!;
    const a = by.get(area) ?? { lines: 0, files: 0 };
    a.lines += f.additions + f.deletions;
    a.files++;
    by.set(area, a);
  }
  return [...by.entries()]
    .map(([area, a]) => ({ area, ...a }))
    .sort((x, y) => y.lines - x.lines)
    .slice(0, max);
}
