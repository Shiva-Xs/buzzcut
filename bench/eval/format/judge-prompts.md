# Judge prompts

The exact instructions each blind judge got: a separate subagent on a different model from the writer, one run per batch. Batches were tiny, normal, and two halves of big, for each comparison: 8 judges, 60 verdicts. `<dirs>` was the list of PR directories from `judge-prep.mjs`, and `<out>` the JSON file to write.

## Original vs new

> You are an experienced software engineer doing code review. For each pull request listed below you get the change itself (`change.diff`) and two candidate PR descriptions, `A.md` and `B.md` (the title is the first line). Both were written for the same change by people who worked on it, so either may know things the diff doesn't show (why the change was made, what was run to test it). Read the diff and both descriptions, then judge them as the reviewer who has to review this PR.
>
> For each PR decide:
> 1. `prefer`: which description you would rather receive as the reviewer: "A", "B" or "tie", and a one-sentence `reason`.
> 2. `missing_A` / `missing_B`: facts a reviewer needs that this description leaves out but the diff or the other description has. Only facts that matter for reviewing (behavior changes, why, risks, what was tested and how), not things obvious from the diff's file list. Short phrases.
> 3. `unsupported_A` / `unsupported_B`: claims in this description that are wrong or unsupported: contradicted by the diff, or stated as fact with no support in the diff or the other description (invented tests, results, numbers, behavior, motivation). A claim present in both descriptions counts as supported unless the diff contradicts it. Short phrases, quoting the claim.
>
> Judge only from these files. Do not read any other file on this machine, do not look for where the descriptions came from, and use no tools except reading these files and writing your result.
>
> PR directories (each has change.diff, A.md, B.md): `<dirs>`
>
> Write your results as a JSON array to `<out>`, one object per PR: `{"id":"P29","prefer":"A","reason":"...","missing_A":[],"missing_B":[],"unsupported_A":[],"unsupported_B":[]}`. Then reply with one line: how many you preferred A, B and tie.

The two judges of big diffs were also told: "The diffs are large; read enough of each to check what the descriptions claim", and could grep the files.

## Old one-paragraph style vs new

> You are an experienced software engineer doing code review. For each pull request listed below you get the change itself (`change.diff`), the author's working notes (`notes.md`: what the author knew from their session, including why and what they ran), and two candidate PR descriptions, `A.md` and `B.md` (the title is the first line), both written from that same diff and those notes. Judge them as the reviewer who has to review this PR.
>
> For each PR decide:
> 1. `prefer`: which description you would rather receive as the reviewer: "A", "B" or "tie", and a one-sentence `reason`.
> 2. `missing_A` / `missing_B`: facts a reviewer needs that this description leaves out but the diff or the notes have. Only facts that matter for reviewing (behavior changes, why, risks, what was tested and how), not things obvious from the diff's file list. Short phrases.
> 3. `unsupported_A` / `unsupported_B`: claims in this description that are wrong or unsupported: contradicted by the diff, or stated as fact with no support in the diff or the notes (invented tests, results, numbers, behavior, motivation). Short phrases, quoting the claim.
>
> (Same file, output and reply instructions as above; the directories also held `notes.md`.)
