Point the lockfiles at npmjs.org and add AGENTS.md for cloud agents

`npm install` hung or failed with `ENOTFOUND` outside Tencent Cloud: the lockfiles resolved packages from `mirrors.tencentyun.com`.

- Root, `client/` and `server/` `package-lock.json` are regenerated against `registry.npmjs.org`: about 1,500 lines, lockfile only
- New `AGENTS.md` for Cursor Cloud agents: the layout (Express API on 3001, Vite client on 5173), `npm run dev`, the health check, and two caveats: regenerating the lockfiles inside Tencent Cloud brings the mirror back, and `better-sqlite3` is declared though `server/db.js` persists to a JSON file

Tested: the app ran afterwards, with portfolio management, live quotes and the calculator working ([demo](https://cursor.com/agents/bc-feafd6b1-5cfe-4c9b-94ea-24e3bde69e2d/artifacts?path=%2Fopt%2Fcursor%2Fartifacts%2Fdemo_stock_decision_app.mp4)).
