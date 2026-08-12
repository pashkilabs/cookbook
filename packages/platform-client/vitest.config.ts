import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globals: true,
    include: ["test/**/*.test.ts"],
    // the seam's integration suite talks to the real database, so it waits for the same
    // settled stack the db package does rather than skipping itself
    globalSetup: ["@pashki/db/test-support/global-setup"],
  },
});
