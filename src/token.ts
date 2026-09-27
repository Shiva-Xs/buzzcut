import { execFileSync } from 'node:child_process';

/** GITHUB_TOKEN, GH_TOKEN, or whatever `gh` is logged in with. */
export function localToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const t = env.GITHUB_TOKEN || env.GH_TOKEN;
  if (t) return t;
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim() || null;
  } catch {
    return null;
  }
}
