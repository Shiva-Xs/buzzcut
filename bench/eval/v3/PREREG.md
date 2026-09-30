# Writing test v3: plan and pass/fail rules, written before any result

**Question.** Does buzzcut's skill (and its checker) produce better pull request descriptions than a plain "write a clear description" prompt? Round 2 of the three-arm test said: close, not better. This test is built to find out whether it can be made better, and to say so honestly if it can't.

## Arms

| arm | what the writer gets |
|---|---|
| D | "Write the pull request description." The diff and the notes. No rules. This is what an agent does by default. |
| C | The same, plus: clear, keep every needed fact from the notes, add nothing, say it wasn't tested if the notes don't say. The best plain prompt. |
| B0 | The skill text only. No context, no checker. |
| B | The skill text, `buzzcut context` for the diff, and the checker loop (up to 3 drafts). |

B against B0 shows whether the machinery adds anything beyond the words. B against C is the claim.

## Sets

Each PR is written in two conditions, so a set `dev` becomes `devR` and `devT`:

- **R** rich notes: the author's own PR text.
- **T** thin notes: its first one or two sentences, at most 32 words. It stands for an agent that barely kept track of why or how it was tested, where inventing is tempting. Nothing in the notes about how it was tested means the right answer is "Not tested".

- **dev**: 36 PRs from the dev half of the held-out set (15 tiny, 16 normal, 5 big; 8 repos). We tune the skill on these.
- **test**: PRs from a fresh pool of 11 repos that appear nowhere in the corpus or the held-out set (`pool.json`, frozen before anything was read; sha256 in the file). 35 PRs (14 tiny, 14 normal, 7 big) from all 11 repos, list frozen in `manifest-test.json` (sha256 ec1cf972…). Built once, sealed: nobody opens `sets/test*` or reads its outputs or grades until the skill is frozen. Run once per arm.

The writer is Gemini 3.8 Flash in Antigravity, every arm. Real agents are other models, so this says what the skill does for one capable model, not for all.

## Grading

1. **Checklist.** Before the arms are graded, Gemini lists the needed facts in each PR's notes (`TASK-CHECKLIST.md`). It sees only the notes and the diff, never a description.
2. **Grade.** Gemini sees the notes, diff, checklist and the descriptions with shuffled letters, and records which checklist facts each kept, each claim with no support in the notes or diff, whether it claims testing the notes don't, and a rank (`TASK-GRADE.md`). The key stays sealed.
3. **No-model scores** (`score.mjs`): words, yap score, this branch's checker, invented names and figures, testing claims the notes lack, the author's numbers and links kept.
4. **Audit.** Claude blind-grades a random 15% of the graded PRs itself and reports how often it agrees with Gemini on: each kept fact, the count of unsupported claims, and the order of the arms. If the arms' order agrees on fewer than 70% of decided pairs, the Gemini grades are reported as unreliable and Claude grades the test set itself.

The grader and the writer are the same model family. That can favour whatever style that family prefers, in every arm alike, which is why the audit is by a different model.

## Tuning rules

- Only the skill text and what the checker prints may change, and only from what dev shows. No PR-specific rules, no quoting a dev PR in the skill. Every change is written down with the failure it answers.
- At most three tuning rounds on dev. Round 0 is the skill as it stands (commit aa05aa2).
- Tuning stops when B clears the dev bar below, or after round 3, whichever comes first.
- Then the skill and checker are frozen (the commit is recorded), and test is run once. A bad test result is not tuned away: any later change to the skill means a fresh test pool.

## Pass and fail, on test, with R and T together

B **beats the default** if its mean rank is lower than D's by at least 0.30 and it wins more PRs than it loses against D.

B **beats the plain prompt** if all of these hold against C:

1. mean rank lower by at least 0.10;
2. more PRs won than lost;
3. PRs with an unsupported claim no more than C's;
4. the share of checklist facts kept within 5 points of C's, or higher.

The same four conditions, read on dev, are the dev bar. If B clears the default but not the plain prompt, the release says the skill matches a hand-written prompt and adds the checker, the hooks and the CI action, and does not say it writes better PRs than a good prompt.

What the test cannot show is written in the results: one writer model, human PR text not agent sessions, R and T notes built by rule from the same body.
