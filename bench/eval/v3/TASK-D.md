# Task: write pull request descriptions (ARM = D)

My message gives you SETS, for example `SETS=devR,devT`. Do the sets in that order.

For each set, go through the folders `bench/eval/v3/sets/<SET>/pr01`, `pr02`, and so on, in order. You are the engineer who made the change in `diff.txt`. Your notes from working on it are in `notes.md`. Write the pull request description.

Write each one to `bench/eval/v3/out/<SET>/D/prNN.md`: the title on the first line, a blank line, then the body. Nothing else in the file.

## Don't

- Don't open anything else in this repository: not `skills/`, `src/`, `bench/cache/`, `bench/eval/corpus/`, `bench/eval/planted/`, `bench/eval/threearm/`, `bench/eval/v3/grade/`, any other file in a PR folder (such as `context.txt`), or any `out/` folder other than `out/<SET>/D/`.
- Don't run any command that checks or scores your writing.
- Don't change any file outside `bench/eval/v3/out/<SET>/D/`.
- Don't commit anything.

When all the PRs in a set are written, write `bench/eval/v3/out/<SET>/D/DONE.md` with the number of PRs you wrote.
