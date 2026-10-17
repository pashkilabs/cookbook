import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tokensCss } from "../src/css.js";
import { palette, themes } from "../src/tokens.js";

/**
 * The committed stylesheet is a **second copy** of the tokens, so it is compared rather than
 * trusted.
 *
 * It is committed on purpose — a reader of `apps/web` can see the values without running anything
 * — and a committed generated file is exactly the shape this codebase keeps getting caught by.
 * Edit `tokens.ts` without regenerating, or hand-edit the CSS, and this fails and names the
 * command. The `check-schema-version` argument: a stamp only works if something turns it, so
 * something checks.
 */
const generated = readFileSync(
  path.resolve(import.meta.dirname, "../../../apps/web/app/tokens.generated.css"),
  "utf8",
);

describe("the generated stylesheet", () => {
  it("matches what the generator produces", () => {
    expect(generated, "run: pnpm --filter @pashki/design-tokens gen:css").toBe(tokensCss());
  });

  it("defines the whole light palette on bare :root, not inside a media query", () => {
    // a colour whose only definition lives in a media query disappears when somebody opts out
    const root = generated.slice(generated.indexOf(":root {"), generated.indexOf("@media"));
    for (const role of Object.keys(themes.light)) {
      const name = `--${role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:`;
      expect(root, role).toContain(name);
    }
  });

  it("guards system dark against an explicit light choice", () => {
    // without :not([data-theme="light"]) a toggle cannot win against the OS setting
    expect(generated).toContain('@media (prefers-color-scheme: dark)');
    expect(generated).toContain(':root:not([data-theme="light"])');
  });

  it("redefines dark under an explicit attribute too, which is what cook mode needs", () => {
    // cook mode is always dark regardless of the system setting
    expect(generated).toContain(':root[data-theme="dark"]');
  });

  it("emits every palette entry, so nothing has to be hand-written", () => {
    for (const [name, value] of Object.entries(palette)) {
      expect(generated, name).toContain(value);
    }
  });

  it("keeps the dark heading/body step that the handoff file was missing", () => {
    // regression: themes.dark.textBody mapped to linen, the same as text, collapsing the ramp
    expect(themes.dark.textBody).not.toBe(themes.dark.text);
    expect(themes.dark.textBody).toBe(palette.linenSoft);
  });
});
