# Releasing buzzcut

A checklist for publishing to npm, written for a first release. Nothing here runs automatically; you run each step.

## One-time setup

1. **npm account with 2FA.** Sign up at npmjs.com, then turn on two-factor auth for logins and publishes:
   ```bash
   npm login
   npm profile enable-2fa auth-and-writes
   npm whoami
   ```
2. **Check the name is still free.** `npm view buzzcut` should print a 404. If it's taken, rename in `package.json`, `README.md`, `action.yml`, `.claude-plugin/`, `skills/`, and `src/cli.ts` before going further.
3. **The GitHub repo** is `Shiva-Xs/buzzcut`. Make it public when you launch, after checking that `git ls-files` lists nothing you'd keep private (LAUNCH.md, PLAN.md and `.claude/` stay local through `.git/info/exclude`).
   `bundle/` and `site/buzzcut-web.js` must be committed: the Claude Code plugin, the GitHub Action and the website run from them. CI fails if `bundle/` is stale.
4. **Wait for CI to go green** on the push (Linux and macOS on Node 20, 22 and 24, and Windows).

## Before every release

Run all of these from a clean checkout of `main`:

```bash
npm ci
npm run typecheck
npm test                      # builds, then unit + end-to-end tests with real git
npm run test:pack             # installs the real tarball locally and globally, then commits with it
npm run bench                 # every cached PR and commit, offline (run `npm run bench:fetch` once first)
node scripts/agent-test.mjs   # 5 real Claude Code sessions (needs `claude /login`), about $0.60
npm publish --dry-run         # shows exactly what would be uploaded
```

When the skill changes, rerun the writing test too (about $7.50 for 30 PRs): `node bench/eval/corpus/run.mjs --run <name> --split test --set agent --sample 30`, then `node bench/eval/corpus/summary.mjs <name>`. See [bench/eval/corpus/](bench/eval/corpus).

The dry run should list 10 files (about 150 kB): `LICENSE`, `README.md`, `package.json`, `schema.json`, `bundle/buzzcut.mjs` (the copy `buzzcut setup` installs), `dist/cli.js`, `dist/index.js`, a `dist/chunk-*.js`, `dist/index.d.ts`, and `skills/buzzcut/SKILL.md`. Nothing from `src/`, `test/`, `scripts/`, `bench/` or `site/`.

`npm run bench` should still show about 1% of PRs by people blocked. If a rule change pushes that up, read `bench/review/people-prs-blocked.md` before releasing.

### GUI editors (by hand, when their hook code changes)

For Cursor, Windsurf and Antigravity: make a throwaway repo, stage a change, run `buzzcut init --agents <cursor|windsurf|antigravity>` in it (with buzzcut installed in that repo), open it in the editor, and ask its agent: *Commit it with exactly the message "Update webhook.js". If a hook rejects it, write a better message yourself and commit.* It should be blocked once and then commit a real message.

## Publish

1. Bump the version in **both** `package.json` and `.claude-plugin/plugin.json` (a test checks they match), add a `CHANGELOG.md` entry, run `npm run build`, and commit (the rebuilt `bundle/` included).
2. Tag it. The moving `v0` tag is what `uses: Shiva-Xs/buzzcut@v0` in people's workflows resolves to:
   ```bash
   git tag v0.1.0
   git tag -f v0
   git push origin v0.1.0
   git push -f origin v0
   ```
3. Publish:
   ```bash
   npm publish --access public
   ```
   npm asks for your 2FA code. `prepublishOnly` re-runs typecheck, tests and the packaging test first, so a broken build can't go out.
4. Create a GitHub release from the tag and paste the CHANGELOG entry.

## The website (free, no domain needed)

`site/` is one static page: the pitch, the install command, and a roast box that runs buzzcut in the visitor's browser against GitHub's public API. No server, no keys.

```bash
npm run build:site            # rebuilds site/buzzcut-web.js from src/
npx wrangler login            # once, opens Cloudflare in your browser
npx wrangler pages deploy site --project-name trybuzzcut
```

That serves it at `https://trybuzzcut.pages.dev`. If Cloudflare gives the project a different name, update the three `trybuzzcut.pages.dev` links in `site/index.html` (the link-preview image needs an absolute URL). Or connect the GitHub repo under Cloudflare → Workers & Pages → Create → Pages, with build command `npm ci && npm run build:site` and output directory `site`, and every push to `main` deploys. Roast links look like `https://trybuzzcut.pages.dev/?roast=owner/repo%23123`.

## After publishing, check it the way a user would

In a fresh folder, not this repo:

```bash
npx buzzcut@latest --version
npx buzzcut roast https://github.com/nodejs/node/pull/66154
npx skills add Shiva-Xs/buzzcut --list
```

In Claude Code: `/plugin marketplace add Shiva-Xs/buzzcut`, then `/plugin install buzzcut@buzzcut`, then ask it to commit something with a bloated message and watch it get blocked and rewrite.

For the Action, open a test PR on any repo with this workflow and a deliberately bloated description:

```yaml
on:
  pull_request:
    types: [opened, edited, synchronize, reopened]
permissions:
  contents: read
  pull-requests: write
jobs:
  buzzcut:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: Shiva-Xs/buzzcut@v0
```

## If something goes wrong

- **Published a broken version:** publish a fixed patch version right away. `npm deprecate buzzcut@0.1.0 "broken, use 0.1.1"` warns anyone installing it. `npm unpublish` only works within 72 hours and blocks that version number forever, so prefer a patch.
- **Leaked a token:** revoke it at npmjs.com → Access Tokens, and GitHub → Settings → Developer settings.
