Build health branches in CI, deploy only from main, move Actions to v5

A cleanup from the project health review: CI builds the health branches without deploying them, the Pages workflow's actions move to v5, and VS Code lints Markdown with the repo's config.

- `deploy-github-pages.yml` also runs on pushes to `cursor/project-health-review-*` and `cursor/project-health-cleanup-*`; the `deploy` job now needs `github.ref == 'refs/heads/main'`, so those branches never deploy
- checkout and setup-node v4 → v5, upload-pages-artifact v3 → v5, deploy-pages v4 → v5
- VS Code recommends the markdownlint extension and runs it on save with `.markdownlint.json`

Tested: `npx markdownlint-cli2`, 0 errors, and `npm run build` succeeded locally. The workflow change itself runs on the next push.
