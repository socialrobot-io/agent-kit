import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/examples/postgres-worker',
  test: {
    name: 'example-postgres-worker',
    watch: false,
    environment: 'node',
    // Each test boots a WASM Postgres (PGlite); allow for slow CI runners.
    hookTimeout: 60_000,
    testTimeout: 60_000,
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
  },
}));
