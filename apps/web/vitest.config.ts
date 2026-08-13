import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["test/**/*.test.ts"],
    // no globalSetup: nothing here talks to a database. The flows that do are exercised
    // against a running app, and the app is not something a unit test should boot.
  },
});
