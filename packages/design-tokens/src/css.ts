/**
 * The tokens as CSS custom properties, generated — never hand-copied.
 *
 * The handoff's rule is "don't hand-copy the hex values", and the reason is the one this codebase
 * keeps paying: two copies of a value agree until somebody edits one of them. So this is the only
 * route from `tokens.ts` to CSS, `scripts/generate-tokens-css.mjs` writes the file, and
 * `check-hex-literals.mjs` fails the build if a hex appears anywhere else.
 *
 * ---------------------------------------------------------------------------
 * Theme shape, which is not negotiable on the web
 * ---------------------------------------------------------------------------
 *
 * Three states, because that is what a browser actually has: an explicit choice stamps
 * `data-theme`, and the default setting stamps nothing and leaves only `prefers-color-scheme`. So
 * the light palette is defined on bare `:root`, dark is redefined under the media query **guarded
 * against an explicit light choice**, and redefined again under `[data-theme="dark"]` so a toggle
 * wins in both directions. A colour whose only definition lives inside a media query is a colour
 * that disappears when somebody opts out of it.
 *
 * Cook mode is **always dark** regardless of any of that, which is why the dark block is emitted a
 * third time under `[data-theme="dark"]` rather than being folded into the media query.
 */
import { palette, memberColours, themes, type, space, radius, size, shadow, font } from "./tokens.js";

const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

const block = (selector: string, lines: string[]) =>
  `${selector} {\n${lines.map((line) => `  ${line}`).join("\n")}\n}`;

const themeVars = (name: keyof typeof themes) =>
  Object.entries(themes[name]).map(([role, value]) => `--${kebab(role)}: ${value};`);

/** every scale, in the unit CSS wants, from the numbers native wants */
const scaleVars = () => [
  ...Object.entries(space).map(([step, value]) => `--space-${step}: ${value}px;`),
  ...Object.entries(radius).map(([part, value]) =>
    `--radius-${kebab(part)}: ${part === "pill" ? `${value}px` : `${value}px`};`),
  ...Object.entries(size).flatMap(([part, value]) =>
    typeof value === "number"
      ? [`--size-${kebab(part)}: ${value}px;`]
      : Object.entries(value).map(([axis, inner]) => `--size-${kebab(part)}-${axis}: ${inner}px;`)),
  ...Object.entries(shadow).map(([part, value]) => `--shadow-${kebab(part)}: ${value};`),
  /*
   * The loaded face first, then the family name, then a real stack.
   *
   * `next/font` injects `--font-display-loaded` / `--font-body-loaded` on <html>, and those carry
   * the self-hosted files plus the fallback metrics that keep the swap from shifting layout. The
   * bare family name is next so a native build — which has no next/font — still resolves it, and
   * the system stack is last so a page renders with or without either.
   */
  `--font-display: var(--font-display-loaded), "${font.display}", Georgia, "Times New Roman", serif;`,
  `--font-body: var(--font-body-loaded), "${font.body}", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;`,
  ...Object.entries(type).flatMap(([role, spec]) => [
    `--type-${kebab(role)}-size: ${spec.size}px;`,
    `--type-${kebab(role)}-weight: ${spec.weight};`,
    `--type-${kebab(role)}-line: ${spec.lineHeight};`,
    ..."letterSpacing" in spec ? [`--type-${kebab(role)}-tracking: ${spec.letterSpacing}px;`] : [],
  ]),
];

/** the raw palette too, so a one-off that genuinely needs a named colour has a variable for it */
const paletteVars = () => [
  ...Object.entries(palette).map(([name, value]) => `--colour-${kebab(name)}: ${value};`),
  // a person's colour, not a state's — see `memberColours` in tokens.ts
  ...Object.entries(memberColours).map(([name, value]) => `--member-${name}: ${value};`),
];

export function tokensCss(): string {
  return [
    "/* GENERATED from packages/design-tokens/src/tokens.ts — do not edit by hand. */",
    "/* Regenerate with: pnpm --filter @pashki/design-tokens gen:css */",
    "",
    block(":root", [...paletteVars(), "", ...scaleVars(), "", ...themeVars("light")]),
    "",
    "/* system dark, unless an explicit light choice says otherwise */",
    `@media (prefers-color-scheme: dark) {\n${block(':root:not([data-theme="light"])', themeVars("dark"))
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n")}\n}`,
    "",
    "/* an explicit choice, and cook mode, which is always dark */",
    block(':root[data-theme="dark"]', themeVars("dark")),
    "",
  ].join("\n");
}
