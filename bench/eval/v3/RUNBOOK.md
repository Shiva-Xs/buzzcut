# Running the writing test v3 in Antigravity

Open the `buzzcut` repo in Antigravity. Every task below is one message in a **fresh chat** (new conversation each). After a chat says it is finished, click Accept all.

If a chat slows down or starts skipping PRs, split it: run `SETS=devR` in one chat and `SETS=devT` in another.

## Round 0 on dev (the skill as it stands)

Send these five, in any order, each in its own chat (they can run side by side):

1. `Read bench/eval/v3/TASK-CHECKLIST.md with SETS=devR,devT and do the task`
2. `Read bench/eval/v3/TASK-D.md with SETS=devR,devT and do the task`
3. `Read bench/eval/v3/TASK-C.md with SETS=devR,devT and do the task`
4. `Read bench/eval/v3/TASK-B0.md with SETS=devR,devT and do the task`
5. `Read bench/eval/v3/TASK-B.md with SETS=devR,devT and do the task`

Each one is 72 files (36 PRs, two conditions). When all five are done, tell Claude. Claude then scores them with no model, builds the grading packets, and gives you one more message:

6. `Read bench/eval/v3/TASK-GRADE.md with SETS=devR,devT ROUND=1 and do the task`

Claude then audits a sample of those grades itself, reads the results, and changes the skill if dev says to. A tuning round reruns only arm B (message 5, after clearing `out/devR/B` and `out/devT/B`) and the grading (message 6 with the next ROUND).

## Tuning round 1 (the skill now adds a testing line only when something ran)

Three chats, each in a fresh chat, same folder rules. The old B and B0 outputs are kept in `out/*/B-r1` and `out/*/B0-r1`.

1. `Read bench/eval/v3/TASK-C2.md with SETS=devR,devT and do the task`
2. `Read bench/eval/v3/TASK-B0.md with SETS=devR,devT and do the task`
3. `Read bench/eval/v3/TASK-B.md with SETS=devR,devT and do the task`

When they're done, Claude builds the round-2 packets (D, C, C2, B0, B) and gives you the grading message with `ROUND=2`.

## Test (once; the skill is frozen, see FROZEN.md)

Nobody opens `sets/test*` or anything under `out/test*` or `grade/test*`. Six chats, each fresh, can run side by side:

1. `Read bench/eval/v3/TASK-CHECKLIST.md with SETS=testR,testT and do the task`
2. `Read bench/eval/v3/TASK-D.md with SETS=testR,testT and do the task`
3. `Read bench/eval/v3/TASK-C.md with SETS=testR,testT and do the task`
4. `Read bench/eval/v3/TASK-C2.md with SETS=testR,testT and do the task`
5. `Read bench/eval/v3/TASK-B0.md with SETS=testR,testT and do the task`
6. `Read bench/eval/v3/TASK-B.md with SETS=testR,testT and do the task`

Each is 70 files (35 PRs, two kinds of notes). When all six are done, tell Claude: it scores them with no model, builds the packets and gives you the grading message (`ROUND=1`, `SETS=testR,testT`). Claude then audits 25% of the grades blind and reports the result against the bar in PREREG.md, whichever way it goes.

## Round 3: the fixed full tool, on the fresh set

The fresh set is built from `pool2.json` and sealed like the test set was: nobody opens `sets/fresh*`, `out/fresh*` or `grade/fresh*`. Five fresh chats, side by side:

1. `Read bench/eval/v3/TASK-CHECKLIST.md with SETS=freshR,freshT and do the task`
2. `Read bench/eval/v3/TASK-C2.md with SETS=freshR,freshT and do the task`
3. `Read bench/eval/v3/TASK-B0.md with SETS=freshR,freshT and do the task`
4. `Read bench/eval/v3/TASK-B.md with SETS=freshR,freshT and do the task`

Then Claude scores them and gives you the grading message: `Read bench/eval/v3/TASK-GRADE.md with SETS=freshR,freshT ROUND=1 and do the task`.

## Round 4: the second cycle, on `fresh2`

Same rules as round 3; nobody opens `sets/fresh2*`, `out/fresh2*` or `grade/fresh2*`. Four fresh chats, side by side:

1. `Read bench/eval/v3/TASK-CHECKLIST.md with SETS=fresh2R,fresh2T and do the task`
2. `Read bench/eval/v3/TASK-C2.md with SETS=fresh2R,fresh2T and do the task`
3. `Read bench/eval/v3/TASK-B0.md with SETS=fresh2R,fresh2T and do the task`
4. `Read bench/eval/v3/TASK-B.md with SETS=fresh2R,fresh2T and do the task`

Then Claude scores them and gives you the grading message with `SETS=fresh2R,fresh2T ROUND=1`.
