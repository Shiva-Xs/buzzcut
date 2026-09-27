import { loadConfig, type Config, DEFAULTS } from './config.js';
import { git } from './git.js';
import { RULE_IDS } from './rules/index.js';
import { repoStyle, type StyleProfile } from './style.js';
import { findTemplate, type Template } from './template.js';

/** Everything buzzcut knows about the repo it runs in. */
export interface RepoContext {
  root: string | null;
  config: Config;
  style: StyleProfile | null;
  template: Template | null;
}

export function repoRoot(cwd?: string): string | null {
  return git(['rev-parse', '--show-toplevel'], cwd)?.trim() || null;
}

export function loadRepo(cwd?: string): RepoContext {
  const root = repoRoot(cwd);
  if (!root) return { root: null, config: DEFAULTS, style: null, template: null };
  return { root, config: loadConfig(root, RULE_IDS), style: repoStyle(root), template: findTemplate(root) };
}
