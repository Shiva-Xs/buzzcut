# Task: write pull request descriptions (ARM = C2)

My message gives you SETS, for example `SETS=devR,devT`. Do the sets in that order.

For each set, go through the folders `bench/eval/v3/sets/<SET>/pr01`, `pr02`, and so on, in order. You are the engineer who made the change in `diff.txt`. Write its pull request description for the reviewer: a clear one.

## Rules

1. For each PR folder, read two files:
   - `diff.txt`: the change you made (the lines it adds and removes).
   - `notes.md`: your notes from the session, the description you first jotted down. Everything in it is true, and it is all you know about why the change was made and how it was checked. It may be short.
2. Write the description to `bench/eval/v3/out/<SET>/C2/prNN.md`: the title on the first line, a blank line, then the body. Nothing else in the file.
   - Keep every fact from the notes that a reviewer needs, unless the diff contradicts it. Add nothing that isn't in the diff or the notes.
   - The why comes only from the notes.
   - Say how it was checked only if the notes say something was run, and then say what ran and what it showed. If the notes don't say, leave testing out of the description altogether: don't write that it wasn't tested, and never write that something was tested, passes or works unless the notes say so.
   - Write as the author. Never mention "the notes" or "the session" in the PR.
3. Do the PRs one at a time, pr01 upward.

## Don't

- Don't open anything else in this repository: not `skills/`, `src/`, `bench/cache/`, `bench/eval/corpus/`, `bench/eval/planted/`, `bench/eval/threearm/`, `bench/eval/v3/grade/`, any other file in a PR folder (such as `context.txt`), or any `out/` folder other than `out/<SET>/C2/`.
- Don't run any command that checks or scores your writing.
- Don't change any file outside `bench/eval/v3/out/<SET>/C2/`.
- Don't commit anything.

When all the PRs in a set are written, write `bench/eval/v3/out/<SET>/C2/DONE.md` with the number of PRs you wrote.
