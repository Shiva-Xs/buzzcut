import { defineConfig } from 'vitest/config';

// Only the repo's own tests: bench/cache holds cloned third-party repos for the evals, with spec files of their own.
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
