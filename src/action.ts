// Entry point for the GitHub Action (see action.yml). A crash in buzzcut itself only
// warns: it should never be the reason someone's CI goes red.
import { runCi } from './ci.js';

runCi({ env: process.env, fetch, cwd: process.cwd(), log: (l) => console.log(l) }).then(
  (code) => process.exit(code),
  (err) => {
    console.log(`::warning::buzzcut hit an internal error and skipped this run: ${(err as Error)?.message ?? err}`);
    process.exit(0);
  },
);
