import { defineConfig } from 'vitest/config';

// Integration tests boot a real Grafana 12.4 container via testcontainers
// and round-trip our generated dashboards through Grafana's HTTP API.
// Requires Docker on the host; without it, tests skip with a clear message.
//
// Why a separate config: keeps `pnpm test` Docker-free and fast (~1s for the
// ~160 unit tests). Integration runs only when explicitly requested or in CI's
// dedicated integration job.
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    // Grafana cold-boot can take 5-10s on a warm image cache, longer on first
    // pull. Per-test timeout for individual HTTP round-trips stays default
    // (5s) but the suite-level hooks need headroom.
    hookTimeout: 120_000,
    testTimeout: 30_000,
    // Integration tests share container lifecycle via beforeAll/afterAll, so
    // running files in parallel would either bottleneck on a single container
    // or accidentally start many. Serial is correct here.
    fileParallelism: false,
  },
});
