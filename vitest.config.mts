import { defineConfig } from "vitest/config";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    // `server-only` throws outside Next.js' server bundle; tests run in plain Node.
    alias: { "server-only": new URL("./tests/server-only-stub.ts", import.meta.url).pathname },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: testDatabaseUrl ? ["tests/global-setup.ts"] : [],
    env: {
      NODE_ENV: "test",
      // Integration tests are skipped unless TEST_DATABASE_URL points at a throwaway database.
      DATABASE_URL: testDatabaseUrl ?? "postgresql://unused@localhost:5432/unused",
    },
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
