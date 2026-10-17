import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["test/**/*.test.ts"],
    // no globalSetup: nothing here touches a database. The only test reads a generated file off
    // disk and compares it to what the generator produces.
  },
});
