# Task: grade pull request descriptions against what the author knew

My message gives you SETS, for example `SETS=devR,devT` and a ROUND name, for example `ROUND=1`. Do the sets in that order.

For each set, go through the packets `bench/eval/v3/grade/<SET>/r<ROUND>/packets/pr01.txt`, `pr02.txt`, and so on, in order. Each packet has one PR's notes, its diff, a checklist of needed facts, and two to five descriptions labelled with letters. The labels are shuffled; don't guess who wrote which.

For each packet, write `bench/eval/v3/grade/<SET>/r<ROUND>/out/prNN.json`:

```json
{
  "X": { "kept": [1, 3], "unsupported": ["short quote of each claim"], "testing_claim": false },
  "Y": { "kept": [1], "unsupported": [], "testing_claim": true },
  "rank": { "X": 1, "Y": 2 },
  "why": "one sentence"
}
```

One entry per letter in the packet, then `rank` and `why`.

- `kept`: the numbers of the checklist facts the description still carries (the meaning counts, exact words don't). An empty checklist gives `[]`.
- `unsupported`: each claim in the description that is in neither the notes nor the diff: a reason the author never gave, something the code is said to do that the diff doesn't show, a result, a name or number that isn't there. A fair paraphrase or a plain description of the diff is not unsupported. Quote a few words of each claim.
- `testing_claim`: true if the description says something was tested, run, verified, or that tests pass, and the notes don't say so. "Not tested" is not a testing claim.
- `rank`: 1 is the description you'd most want to receive as the reviewer. Decide in this order: (1) the needed facts are carried; (2) nothing unsupported, and no claim that something was tested that the notes don't say; (3) it reads like a person wrote it for a reviewer: as short as the change allows, no padding, no boilerplate. Boilerplate includes a line that only says it wasn't tested ("Not tested", "This change was not tested", a "How tested" heading with nothing run), any mention of "the notes" or "the session", and section headings or bold labels on a small change. Descriptions that differ on any of these get different ranks; tie them only when they are equal on all three. Use 1 to N as needed.
- `why`: one sentence.

## Don't

- Don't open anything else in this repository: only the packets, and only write into `out/`.
- Don't open `key.json`.
- Don't commit anything.

When a set is done, write `bench/eval/v3/grade/<SET>/r<ROUND>/out/DONE.md` with the number of packets graded.
