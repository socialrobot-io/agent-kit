import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/node',
  test: {
    name: 'node',
    watch: false,
    globals: true,
    environment: 'node',
    // Postgres specs boot a WASM Postgres (PGlite) per file; allow for slow CI runners.
    hookTimeout: 60_000,
    testTimeout: 30_000,
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
