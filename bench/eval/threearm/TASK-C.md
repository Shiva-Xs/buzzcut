# Task: write 24 pull request descriptions

For each folder `bench/eval/threearm/prs/pr01` … `pr24`, you are the engineer who made the change in `diff.txt`. Write its pull request description for the reviewer: a clear one.

## Rules

1. For each PR folder, read two files:
   - `diff.txt`: the change you made (the lines it adds and removes).
   - `notes.md`: your notes from the session, the description you first jotted down. Everything in it is true, and it is all you know about why the change was made and how it was checked.
2. Write the description to `bench/eval/threearm/out/C/prNN.md`: the title on the first line, a blank line, then the body. Nothing else in the file.
   - Keep every fact from the notes that a reviewer needs, unless the diff contradicts it. Add nothing that isn't in the diff or the notes.
   - The why and how it was checked come only from the notes. If the notes don't say what was run, say it wasn't tested.
   - Write as the author. Never mention "the notes" or "the session" in the PR.
3. Do the PRs one at a time, pr01 to pr24.

## Don't

- Don't open anything else in this repository: not `skills/`, `src/`, `bench/cache/`, `bench/eval/corpus/`, `bench/eval/planted/`, `bench/eval/threearm/old/`, any other file in a PR folder (such as `context.txt`), or any `out/` folder other than `out/C/`.
- Don't run any command that checks or scores your writing.
- Don't change any file outside `bench/eval/threearm/out/C/`.
- Don't commit anything.

When all 24 are written, write `bench/eval/threearm/out/C/DONE.md` with the single line: 24.
