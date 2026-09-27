import { describe, expect, it } from 'vitest';
import { findCalls, mightMatter, segments, type CommitCall, type PrCall } from '../src/shell.js';

const commit = (cmd: string) => findCalls(cmd).find((c): c is CommitCall => c.tool === 'git-commit');
const pr = (cmd: string) => findCalls(cmd).find((c): c is PrCall => c.tool === 'gh-pr');

describe('segments', () => {
  it('splits on && || ; | and newlines, keeping quotes intact', () => {
    const s = segments(`git add -A && git commit -m "a && b; c" || echo 'x|y'; ls | wc -l`);
    expect(s.map((x) => x.words)).toEqual([
      ['git', 'add', '-A'],
      ['git', 'commit', '-m', 'a && b; c'],
      ['echo', 'x|y'],
      ['ls'],
      ['wc', '-l'],
    ]);
  });

  it('handles escapes, ANSI-C strings and line continuations', () => {
    const s = segments(`git commit -m "say \\"hi\\"" \\\n  -m $'line1\\nline2'`);
    expect(s[0]!.words).toEqual(['git', 'commit', '-m', 'say "hi"', '-m', 'line1\nline2']);
  });

  it('ignores redirects and comments', () => {
    const s = segments('git commit -m hi 2>&1 > /dev/null # trailing comment');
    expect(s[0]!.words).toEqual(['git', 'commit', '-m', 'hi']);
    expect(s[0]!.out).toBe('/dev/null');
  });
});

describe('git commit', () => {
  it('reads the heredoc-in-substitution form agents use', () => {
    const cmd = `git commit -m "$(cat <<'EOF'\nRetry webhook sends on 5xx\n\nStripe returns 502 during deploys (and "quotes") too.\nEOF\n)"`;
    expect(commit(cmd)?.message).toBe('Retry webhook sends on 5xx\n\nStripe returns 502 during deploys (and "quotes") too.');
  });

  it('reads unquoted and <<- heredoc delimiters', () => {
    expect(commit('git commit -m "$(cat <<EOF\nAdd x\nEOF\n)"')?.message).toBe('Add x');
    expect(commit('git commit -m "$(cat <<-EOF\n\tAdd x\n\tEOF\n)"')?.message).toBe('\tAdd x');
  });

  it('joins several -m flags with blank lines, like git', () => {
    expect(commit('git commit -m "Subject" -m "Body one" -m "Body two"')?.message).toBe('Subject\n\nBody one\n\nBody two');
  });

  it.each([
    ['git commit -am "Fix it"', { message: 'Fix it', all: true }],
    ['git commit -m"Fix it"', { message: 'Fix it', all: false }],
    ['git commit --message="Fix it"', { message: 'Fix it', all: false }],
    ['git commit --all --message "Fix it"', { message: 'Fix it', all: true }],
    ['git commit --amend -m "Fix it"', { message: 'Fix it', amend: true }],
  ])('%s', (cmd, want) => {
    expect(commit(cmd)).toMatchObject(want);
  });

  it('reads -F - from a heredoc on stdin', () => {
    expect(commit("git commit -F - <<'EOF'\nAdd retry\n\nWhy it matters.\nEOF")?.message).toBe('Add retry\n\nWhy it matters.\n');
  });

  it('reads -F <file> written earlier in the same command', () => {
    const cmd = "cat > /tmp/msg.txt <<'EOF'\nAdd retry\nEOF\ngit add . && git commit -F /tmp/msg.txt";
    const c = commit(cmd)!;
    expect(c.message).toBe('Add retry\n');
    expect(c.file).toBeNull();
    expect(c.stagesFirst).toBe(true);
  });

  it('keeps -F <file> as a path when it already exists on disk', () => {
    expect(commit('git commit -F .git/BUZZCUT_MSG')).toMatchObject({ message: null, file: '.git/BUZZCUT_MSG' });
  });

  it('reads echo/printf redirected into the message file', () => {
    expect(commit('echo "Add retry" > m.txt && git commit -F m.txt')?.message).toBe('Add retry\n');
    expect(commit("printf 'Add retry\\n\\nBecause.\\n' > m.txt && git commit -F m.txt")?.message).toBe('Add retry\n\nBecause.\n');
  });

  it('tracks git add before commit, but not after', () => {
    expect(commit('git add src && git commit -m x')?.stagesFirst).toBe(true);
    expect(commit('git commit -m x && git add src')?.stagesFirst).toBe(false);
  });

  it('follows cd and git -C', () => {
    expect(commit('cd packages/api && git commit -m x')?.dir).toBe('packages/api');
    expect(commit('git -C packages/web commit -m x')?.dir).toBe('packages/web');
  });

  it('skips env prefixes and wrappers', () => {
    expect(commit('GIT_AUTHOR_NAME=x env FOO=1 git commit -m "Add y"')?.message).toBe('Add y');
  });

  it('ignores commits that reuse a message or open an editor', () => {
    expect(commit('git commit -C HEAD')).toBeUndefined();
    expect(commit('git commit --fixup=abc123')).toBeUndefined();
    expect(commit('git commit')).toMatchObject({ message: null, file: null });
  });

  it("isn't fooled by the word commit elsewhere", () => {
    expect(findCalls('echo "git commit -m nope"')).toEqual([]);
    expect(findCalls('git log --grep commit')).toEqual([]);
  });
});

describe('gh pr', () => {
  it('reads title and heredoc body from gh pr create', () => {
    const cmd = `gh pr create --title "Retry webhooks" --body "$(cat <<'EOF'\nStripe 502s during deploys.\nEOF\n)"`;
    expect(pr(cmd)).toMatchObject({ action: 'create', title: 'Retry webhooks', body: 'Stripe 502s during deploys.' });
  });

  it('reads short flags, = forms, base and body files', () => {
    expect(pr('gh pr create -t T -b B -B develop')).toMatchObject({ title: 'T', body: 'B', base: 'develop' });
    expect(pr('gh pr create --title=T --body-file=body.md')).toMatchObject({ title: 'T', file: 'body.md', body: null });
    expect(pr("gh pr create -t T -F - <<'EOF'\nBody\nEOF")).toMatchObject({ body: 'Body\n' });
  });

  it('marks --fill and --web as generated', () => {
    expect(pr('gh pr create --fill')?.generated).toBe(true);
    expect(pr('gh pr create --web')?.generated).toBe(true);
  });

  it('handles gh pr edit', () => {
    expect(pr('gh pr edit 42 --body "New body"')).toMatchObject({ action: 'edit', body: 'New body' });
  });

  it('works after a push in the same command', () => {
    expect(pr('git push -u origin HEAD && gh pr create --title T --body B')).toMatchObject({ title: 'T', body: 'B' });
  });

  it('ignores other gh pr subcommands', () => {
    expect(findCalls('gh pr view 42 && gh pr list')).toEqual([]);
  });
});

describe('mightMatter', () => {
  it('lets unrelated commands skip parsing', () => {
    expect(mightMatter('npm test')).toBe(false);
    expect(mightMatter('ls -la && cat README.md')).toBe(false);
    expect(mightMatter('git commit -m x')).toBe(true);
    expect(mightMatter('gh pr create')).toBe(true);
  });
});
