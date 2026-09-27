import { defineConfig } from 'tsup';

export default defineConfig([
  // The npm package.
  {
    entry: ['src/cli.ts', 'src/index.ts'],
    format: ['esm'],
    target: 'node20',
    dts: { entry: 'src/index.ts' },
    clean: true,
  },
  // Single-file builds committed to the repo, so the Claude Code plugin and the
  // GitHub Action run straight from a clone with no npm install.
  {
    entry: { buzzcut: 'src/cli.ts', action: 'src/action.ts' },
    outDir: 'bundle',
    format: ['esm'],
    target: 'node20',
    splitting: false,
    clean: true,
    outExtension: () => ({ js: '.mjs' }),
  },
]);
