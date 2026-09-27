// Finds `git commit` and `gh pr create/edit` calls inside a shell command string, the
// way agents write them: chained with &&, quoted, and very often with the message in a
// heredoc, e.g. git commit -m "$(cat <<'EOF' ... EOF)". It's a small POSIX-ish lexer,
// not a full shell: variables and globs are left as literal text.

export interface Segment {
  words: string[];
  /** heredoc or here-string fed to this command */
  stdin: string | null;
  /** target of a `>` or `>>` redirect */
  out: string | null;
}

export interface CommitCall {
  tool: 'git-commit';
  /** the message from -m (joined like git joins them), -F <file>, or -F - */
  message: string | null;
  /** -F path, when the file isn't written earlier in the same command */
  file: string | null;
  all: boolean;
  amend: boolean;
  /** `git add`/`rm`/`mv` ran earlier in the same command, so the index isn't final yet */
  stagesFirst: boolean;
  /** directory from `cd` or `git -C`, relative to the hook's cwd */
  dir: string | null;
}

export interface PrCall {
  tool: 'gh-pr';
  action: 'create' | 'edit';
  title: string | null;
  body: string | null;
  file: string | null;
  base: string | null;
  /** --fill / --web: gh writes the body, or the user does in a browser */
  generated: boolean;
  dir: string | null;
}

export type Call = CommitCall | PrCall;

const newSeg = (): Segment => ({ words: [], stdin: null, out: null });

/** Command substitution: `$(cat <<EOF ... EOF)` evaluates to the heredoc; anything else stays literal. */
function substitution(src: string, i: number): { value: string; end: number } {
  const m = /^\$\(\s*cat\s*<<(-?)\s*(['"]?)([A-Za-z_][\w.-]*)\2[ \t]*\n/.exec(src.slice(i));
  if (m) {
    const strip = m[1] === '-';
    const delim = m[3]!;
    let pos = i + m[0].length;
    const body: string[] = [];
    while (pos <= src.length) {
      const nl = src.indexOf('\n', pos);
      const line = src.slice(pos, nl === -1 ? src.length : nl);
      const cmp = strip ? line.replace(/^\t+/, '') : line;
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
    const close = src.indexOf(')', pos);
    // $(...) strips every trailing newline from its output.
    return { value: body.join('\n').replace(/\n+$/, ''), end: close === -1 ? src.length : close + 1 };
  }
  // Generic $( ... ): skip to the matching paren, respecting quotes.
  let depth = 0;
  let j = i + 1;
  let quote: string | null = null;
  for (; j < src.length; j++) {
    const c = src[j];
    if (quote) {
      if (c === '\\' && quote === '"') j++;
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) break;
  }
  return { value: src.slice(i, j + 1), end: j + 1 };
}

function ansiC(src: string, i: number): { value: string; end: number } {
  let out = '';
  let j = i + 2;
  const esc: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', a: '\x07', e: '\x1b', '0': '\0' };
  for (; j < src.length && src[j] !== "'"; j++) {
    if (src[j] === '\\' && j + 1 < src.length) {
      j++;
      out += esc[src[j]!] ?? '\\' + src[j];
    } else out += src[j];
  }
  return { value: out, end: j + 1 };
}

/** Split a command line into simple commands, resolving quotes and heredocs. */
export function segments(src: string): Segment[] {
  const segs: Segment[] = [];
  let seg = newSeg();
  let word: string | null = null;
  let redirect: 'out' | 'in' | 'herestring' | null = null;
  const pending: { delim: string; strip: boolean; seg: Segment }[] = [];

  const push = () => {
    if (word === null) return;
    if (redirect === 'out') seg.out = word;
    else if (redirect === 'herestring') seg.stdin = word + '\n';
    else if (redirect !== 'in') seg.words.push(word);
    redirect = null;
    word = null;
  };
  const end = () => {
    push();
    if (seg.words.length) segs.push(seg);
    seg = newSeg();
  };
  const readHeredocs = (i: number): number => {
    for (const h of pending) {
      const body: string[] = [];
      while (i < src.length) {
        const nl = src.indexOf('\n', i);
        const line = src.slice(i, nl === -1 ? src.length : nl);
        i = nl === -1 ? src.length : nl + 1;
        if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) break;
        body.push(h.strip ? line.replace(/^\t+/, '') : line);
      }
      h.seg.stdin = body.length ? body.join('\n') + '\n' : '';
    }
    pending.length = 0;
    return i;
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '\\') {
      if (src[i + 1] === '\n') i += 2;
      else {
        word = (word ?? '') + (src[i + 1] ?? '');
        i += 2;
      }
      continue;
    }
    if (c === "'") {
      const j = src.indexOf("'", i + 1);
      const stop = j === -1 ? src.length : j;
      word = (word ?? '') + src.slice(i + 1, stop);
      i = stop + 1;
      continue;
    }
    if (c === '$' && src[i + 1] === "'") {
      const r = ansiC(src, i);
      word = (word ?? '') + r.value;
      i = r.end;
      continue;
    }
    if (c === '"') {
      let buf = '';
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && '"\\$`\n'.includes(src[i + 1] ?? '')) {
          if (src[i + 1] !== '\n') buf += src[i + 1];
          i += 2;
        } else if (src[i] === '$' && src[i + 1] === '(') {
          const r = substitution(src, i);
          buf += r.value;
          i = r.end;
        } else buf += src[i++];
      }
      i++;
      word = (word ?? '') + buf;
      continue;
    }
    if (c === '$' && src[i + 1] === '(') {
      const r = substitution(src, i);
      word = (word ?? '') + r.value;
      i = r.end;
      continue;
    }
    if (c === '\n') {
      end();
      i++;
      if (pending.length) i = readHeredocs(i);
      continue;
    }
    if (c === ' ' || c === '\t') {
      push();
      i++;
      continue;
    }
    if (c === '#' && word === null) {
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? src.length : nl;
      continue;
    }
    if (c === ';' || c === '(' || c === ')' || c === '{' || c === '}') {
      if ((c === '{' || c === '}') && word !== null) {
        word += c;
        i++;
        continue;
      }
      end();
      i++;
      continue;
    }
    if (c === '&' || c === '|') {
      if (c === '&' && src[i + 1] === '>') {
        // &> file
        push();
        i += 2;
        redirect = 'out';
        continue;
      }
      end();
      i += src[i + 1] === c ? 2 : 1;
      continue;
    }
    if (c === '<' && src[i + 1] === '<' && src[i + 2] === '<') {
      push();
      i += 3;
      redirect = 'herestring';
      continue;
    }
    if (c === '<' && src[i + 1] === '<') {
      push();
      i += 2;
      let strip = false;
      if (src[i] === '-') {
        strip = true;
        i++;
      }
      while (src[i] === ' ' || src[i] === '\t') i++;
      const m = /^(['"]?)([A-Za-z_][\w.-]*)\1/.exec(src.slice(i));
      if (m) {
        pending.push({ delim: m[2]!, strip, seg });
        i += m[0].length;
      }
      continue;
    }
    if (c === '>') {
      if (word !== null && /^\d$/.test(word)) word = null; // 2> file
      push();
      i += src[i + 1] === '>' ? 2 : 1;
      if (src[i] === '&') {
        // >&2, 2>&1
        i++;
        while (/\d|-/.test(src[i] ?? '')) i++;
        continue;
      }
      redirect = 'out';
      continue;
    }
    if (c === '<') {
      push();
      i++;
      redirect = 'in';
      continue;
    }
    word = (word ?? '') + c;
    i++;
  }
  end();
  if (pending.length) readHeredocs(src.length);
  return segs;
}

const WRAPPERS = new Set(['command', 'builtin', 'exec', 'time', 'nohup', 'env']);

/** Drop `FOO=bar` prefixes and wrappers like `env` or `command`. */
function program(words: string[]): string[] {
  let i = 0;
  while (i < words.length) {
    const w = words[i]!;
    if (/^[A-Za-z_]\w*=/.test(w) || WRAPPERS.has(w) || (words[i - 1] === 'env' && w.startsWith('-'))) i++;
    else break;
  }
  return words.slice(i);
}

function echoed(words: string[]): string {
  const args = words.slice(1).filter((w, k) => !(k === 0 && /^-[neE]+$/.test(w)));
  return args.join(' ') + '\n';
}

function printed(words: string[]): string {
  const [fmt = '', ...args] = words.slice(1);
  if (/^%s(\\n)?$/.test(fmt)) return args.join(fmt.endsWith('\\n') ? '\n' : '') + (fmt.endsWith('\\n') ? '\n' : '');
  return fmt.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}

function parseCommit(args: string[], seg: Segment, files: Map<string, string>, stagesFirst: boolean, dir: string | null): CommitCall | null {
  const msgs: string[] = [];
  let file: string | null = null;
  let all = false;
  let amend = false;
  let reuse = false;
  for (let j = 0; j < args.length; j++) {
    const a = args[j]!;
    if (a === '--') break;
    if (a === '-m' || a === '--message') msgs.push(args[++j] ?? '');
    else if (a.startsWith('--message=')) msgs.push(a.slice(10));
    else if (a === '-F' || a === '--file') file = args[++j] ?? null;
    else if (a.startsWith('--file=')) file = a.slice(7);
    else if (a === '--all') all = true;
    else if (a === '--amend') amend = true;
    else if (/^--(reuse|reedit)-message/.test(a) || a === '--fixup' || a.startsWith('--fixup=') || a === '--squash' || a.startsWith('--squash=')) reuse = true;
    else if (/^-[A-Za-z]+/.test(a) && !a.startsWith('--')) {
      // Combined short flags: -am "msg", -m"msg", -aF file
      for (let k = 1; k < a.length; k++) {
        const f = a[k];
        if (f === 'a') all = true;
        else if (f === 'm' || f === 'F') {
          const rest = a.slice(k + 1);
          const v = rest || (args[++j] ?? '');
          if (f === 'm') msgs.push(v);
          else file = v;
          break;
        } else if (f === 'C' || f === 'c') {
          reuse = true;
          if (!a.slice(k + 1)) j++;
          break;
        }
      }
    }
  }
  if (reuse && !msgs.length && !file) return null;
  let message: string | null = msgs.length ? msgs.join('\n\n') : null;
  if (message === null && file !== null) {
    if (file === '-') message = seg.stdin;
    else if (files.has(file)) message = files.get(file)!;
    if (message !== null) file = null;
  }
  return { tool: 'git-commit', message, file, all, amend, stagesFirst, dir };
}

function parsePr(args: string[], seg: Segment, files: Map<string, string>, dir: string | null): PrCall | null {
  const action = args[0] === 'create' || args[0] === 'new' ? 'create' : args[0] === 'edit' ? 'edit' : null;
  if (!action) return null;
  let title: string | null = null;
  let body: string | null = null;
  let file: string | null = null;
  let base: string | null = null;
  let generated = false;
  const value = (a: string, long: string, short: string, j: number): [string | null, number] => {
    if (a === long || a === short) return [args[j + 1] ?? '', j + 1];
    if (a.startsWith(long + '=')) return [a.slice(long.length + 1), j];
    if (short && a.startsWith(short) && a.length > 2 && !a.startsWith('--')) return [a.slice(2), j];
    return [null, j];
  };
  for (let j = 1; j < args.length; j++) {
    const a = args[j]!;
    let v: string | null;
    [v, j] = value(a, '--title', '-t', j);
    if (v !== null) {
      title = v;
      continue;
    }
    [v, j] = value(a, '--body-file', '-F', j);
    if (v !== null) {
      file = v;
      continue;
    }
    [v, j] = value(a, '--body', '-b', j);
    if (v !== null) {
      body = v;
      continue;
    }
    [v, j] = value(a, '--base', '-B', j);
    if (v !== null) {
      base = v;
      continue;
    }
    if (/^(--fill(-first|-verbose)?|-f|--web|-w)$/.test(a)) generated = true;
  }
  if (body === null && file !== null) {
    if (file === '-') body = seg.stdin;
    else if (files.has(file)) body = files.get(file)!;
    if (body !== null) file = null;
  }
  return { tool: 'gh-pr', action, title, body, file, base, generated, dir };
}

/** Every git commit / gh pr create / gh pr edit in the command, in order. */
export function findCalls(command: string): Call[] {
  const calls: Call[] = [];
  const files = new Map<string, string>();
  let stagesFirst = false;
  let dir: string | null = null;
  for (const seg of segments(command)) {
    const w = program(seg.words);
    const cmd = w[0];
    if (!cmd) continue;
    if (cmd === 'cd') {
      dir = w[1] ?? null;
      continue;
    }
    if (seg.out && (cmd === 'cat' || cmd === 'tee') && seg.stdin !== null) files.set(seg.out, seg.stdin);
    else if (seg.out && cmd === 'echo') files.set(seg.out, echoed(w));
    else if (seg.out && cmd === 'printf') files.set(seg.out, printed(w));
    if (cmd === 'tee' && seg.stdin !== null && w[1]) files.set(w[w.length - 1]!, seg.stdin);

    if (cmd === 'git') {
      let k = 1;
      let gitDir = dir;
      while (k < w.length && w[k]!.startsWith('-')) {
        if (w[k] === '-C') {
          gitDir = w[k + 1] ?? gitDir;
          k += 2;
        } else if (w[k] === '-c') k += 2;
        else k++;
      }
      const sub = w[k];
      if (sub === 'add' || sub === 'rm' || sub === 'mv' || sub === 'stage') stagesFirst = true;
      if (sub === 'commit') {
        const call = parseCommit(w.slice(k + 1), seg, files, stagesFirst, gitDir);
        if (call) calls.push(call);
      }
    } else if (cmd === 'gh' && w[1] === 'pr') {
      const call = parsePr(w.slice(2), seg, files, dir);
      if (call) calls.push(call);
    }
  }
  return calls;
}

/** Cheap pre-filter so the agent hook can bail out of unrelated commands fast. */
export function mightMatter(command: string): boolean {
  return /\bgit\b[\s\S]*\bcommit\b|\bgh\b[\s\S]*\bpr\b/.test(command);
}
