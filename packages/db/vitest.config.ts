import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["test/**/*.test.ts"],
    // isolation tests talk to a real Postgres over HTTP: slower than a unit test
    // and not worth parallelising against one database
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    // waits for the stack once, so a suite started straight after `db reset` cannot
    // skip its integration tests and report green
    globalSetup: ["./test/global-setup.ts"],
  },
});
