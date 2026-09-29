# Task: plant one false statement in each of 311 pull request descriptions

You are helping test a checker. It must catch a description that says something untrue about a change. To measure that, each real pull request below gets exactly one false statement written into its description, of a kind that is assigned to it. You write the false statement; you do not decide the kind.

For each file `bench/eval/planted/inputs/NNN.json` (001 to 311) you are given:

- `kind` and `instruction`: the kind of false statement to plant, and how.
- `title`, `body`: the real description, written by a person.
- `files`, `added`, `removed`: what the change really did. `added` and `removed` are the lines it adds and removes (cut at 12,000 characters).

## What to write

Write `bench/eval/planted/out/NNN.json`, valid JSON, exactly this shape:

```json
{
  "id": "NNN",
  "kind": "<the same kind as the input>",
  "body": "<the full description, with the false statement in it>",
  "planted": { "name": "...", "path": "...", "number": "...", "claim": "..." },
  "whatIsFalse": "<one sentence: why the planted statement is not true of this change>"
}
```

Fill in only the `planted` field the instruction names (`name`, `path`, `number` or `claim`) and leave the others out.

## Rules

1. **One false statement, nothing else changed.** `body` is the original body with one sentence added or one sentence replaced. Keep every other character of the original, including its headings, bullets, line breaks, links and footers.
2. **Sound like the author.** Same voice, tense and formatting as the rest of the body. The false sentence must read like a normal part of the description: no hedging, no "(fake)", no hint that it is planted.
3. **Follow the instruction for the assigned kind.** Do not use a different kind, even if another would be easier.
4. **The rest of the description stays true.** Do not add other claims about tests, numbers, files or names beyond the one you plant.
5. **If the body is empty,** the whole body is your one false sentence, in the voice of a short pull request description.
6. Do the files in order, 001 to 311, one at a time.

## Don't

- Don't open anything under `bench/cache/`, `bench/eval/corpus/` or `src/`. Use only the input file.
- Don't change any file outside `bench/eval/planted/out/`.
- Don't commit anything.
- Don't try to check your work against any tool in this repository.

When all 311 are written, write `bench/eval/planted/out/DONE.md` with a single line: how many files you wrote.
