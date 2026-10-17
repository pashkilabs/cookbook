import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  /*
   * The same `@/` alias `tsconfig.json` declares. Next resolves it at build time and vitest does
   * not, so a component importing `@/lib/...` failed to transform — which looks like a broken
   * test rather than a missing alias.
   */
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
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
