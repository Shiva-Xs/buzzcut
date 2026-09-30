# Dev results

## Round 1 (the skill as it stood, commit aa05aa2)

36 dev PRs × two kinds of notes (R full, T thin) × four arms, written by Gemini 3.8 Flash, graded by Gemini against a frozen checklist with shuffled letters, rubric v1. 72 graded PRs.

| arm | mean rank | needed facts kept | PRs missing a fact | unsupported claims (PRs) | testing claims the notes lack |
|---|---|---|---|---|---|
| D bare prompt | 2.44 | 65% | 25 of 60 | 13 (9) | 6 |
| C plain prompt | 1.22 | **94%** | 4 of 60 | 0 | 0 |
| B0 skill text only | **1.17** | 89% | 10 of 60 | 0 | 0 |
| B skill + context + checker | 1.29 | 87% | 12 of 60 | 0 | 0 |

Head to head (wins, losses, ties): B over D 46–2; C over D 46–4; C over B 16–14 (42 tied); B0 over C 14–9 (49 tied); B0 over B 10–6.

- **The bare prompt is the clear loser.** It drops a third of the needed facts (and more on big PRs: 35% kept), invents claims in 9 of 72 PRs, says something was tested that the notes don't in 6, and uses bold labels or a diff tour in 20 of 72 by the no-model count.
- **The skill and the plain prompt are level.** Mean rank 1.17 to 1.29 with most PRs tied, and C keeps more needed facts than either skill arm, most of all on big PRs (C 85%, B 75%).
- **No arm invented a claim except D.** On the no-model count, B had no unfindable names or files, C three PRs and B0 two: the only place the lookups showed a difference, and B was steered by the same detector that measures it.
- **The grader's ranks are soft.** Audit below.
- **Noise.** C, B0 and B each said "not tested" or "not run" in 67 of 72 descriptions. B, the only arm that saw the checker's hint about "commands you ran in this session", mentioned the session or the notes in 13 of 72 (for example "test suite not run in session"); B0 and C never did.

## Audit of the grader (12 PRs, about 17%, random by hash; Claude graded them blind first)

- Needed facts kept: 87 of 92 fact decisions agree (95%).
- Unsupported claims (none vs some): 47 of 48 agree. Testing claim: 46 of 48 agree.
- Order of the arms: of 61 arm pairs Claude separated, Gemini separated 28 and agreed on 19 (68%, under the 70% bar in PREREG.md); it tied the other 33. Gemini ranked most of B, B0 and C as 1.
- So the fact, unsupported and testing grades are sound. The ranks are not reliable enough to carry a claim: Claude grades the ranks of the test set itself, as PREREG.md says. Rubric v2 (below) asks Gemini to break ties.

## Tuning round 1 (from the above, plus a design call)

The evidence: a "Not tested" line in 67 of 72 descriptions (three arms), and session leaks in arm B. The design call, the user's: a description has no reason to announce what wasn't done. Devs and testers are different roles, CI and review check an unrun change, and a testing line is worth having when something ran. Changes: SKILL.md, the context text and the Copilot instruction now say to add a Tested line only when something ran and otherwise leave testing out; the checker stopped asking for one. Claims that tests passed without a run are still caught.

Because the plain prompt C carried the same "say it wasn't tested" rule, a new arm C2 gives the plain prompt the same idea (mention testing only if the notes say something ran), so the skill isn't credited for it. Rubric v2 for the grader: boilerplate testing lines, mentions of the notes or the session and headings on small changes count against a description, and ties only when equal.
