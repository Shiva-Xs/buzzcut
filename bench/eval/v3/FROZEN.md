# Frozen for the test run

The skill and the checker are fixed from this point. A change to any of them means a fresh test pool, since this one will have been seen.

- Commit: `fec476dcf83c01818214ca94b27bbc73a0e13d2b` (branch `v0.3`)
- `src/` tree: `8c83ff6d3eb70b31bb3af673a96b035ebdd631f1`
- `skills/buzzcut/SKILL.md` sha256 starts `17466764afab378899db4a4f`
- Test list: `manifest-test.json` sha256 starts `ec1cf97290008c4d`, drawn from `pool.json` (sha256 in that file) before anything in it was read
- Test sets were rebuilt after the freeze so their `context.txt` files carry the frozen wording; the list of PRs did not change
- Arms: D, C, C2, B0, B. Writer and grader: Gemini 3.8 Flash in Antigravity. Grader rubric v2. Audit: 25% by Claude, blind
- Pass bar: PREREG.md ("Pass and fail"), against C2 and C, whichever is stricter

## Round 3 (the fixed full tool, fresh set)

- Commit: `8c57f49` (branch `v0.3`); `src/` tree `bf65b3d4a59d651f6fecb9f02cfeef061e0b5ee7`; `skills/buzzcut/SKILL.md` sha256 starts `db6d13e29eed4da9399fa9ac`
- Fresh list: `manifest-fresh.json` sha256 starts `553be72b05974140`, drawn from `pool2.json` (28 repos, 828 PRs frozen before reading; the first 437 fetched were eligible, 37 chosen from 16 repos)
- Arms B, B0, C2. Pass conditions: PREREG.md, "Round 3". One cycle only.
