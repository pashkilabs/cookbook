import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    globals: true,
    // .tsx too: a component test written as .tsx was silently not run, and the suite
    // reported the same count as before — a check that does not run is worse than none
    include: ["test/**/*.test.{ts,tsx}"],
    // no globalSetup: nothing here talks to a database. The flows that do are exercised
    // against a running app, and the app is not something a unit test should boot.
  },
});
