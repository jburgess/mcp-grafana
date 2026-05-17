import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests only. Integration tests live under test/integration/ and run
    // via the separate vitest.integration.config.ts (`pnpm test:integration`).
    // Keeping them split means `pnpm test` stays Docker-free and ~1s.
    include: ['test/{assets,mcp,ingest,examples}/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts'],
    },
  },
});
