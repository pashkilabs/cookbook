#!/usr/bin/env node
/**
 * Does every pair of colours a screen paints actually read?
 *
 * ---------------------------------------------------------------------------
 * Why this exists beside check-theme-complete
 * ---------------------------------------------------------------------------
 *
 * That one is a **construction** check: every role token a screen uses resolves in every theme.
 * It cannot tell you whether the result is legible, and cook mode makes that the question rather
 * than a nicety — dark is a product surface there, not a fallback, so nobody's system preference
 * will ever route around a bad pair.
 *
 * A browser is the only thing that can compute a cascade and a person is the only thing that can
 * say whether type *looks* right. But contrast is neither: it is arithmetic on two hex values,
 * and WCAG 2.1 §1.4.3 and §1.4.11 say what the numbers have to be. So this is the part of "does
 * it read on espresso" that does not need eyes, computed from the generated stylesheet — the
 * artifact that actually ships — rather than from the TypeScript it came from.
 *
 * ---------------------------------------------------------------------------
 * Two thresholds, and an exemption that records a number
 * ---------------------------------------------------------------------------
 *
 * Text is unambiguous: 4.5:1 normally, 3:1 at 24px or 18.66px bold and above. Those are gated.
 *
 * Non-text boundaries are arguable — §1.4.11 asks for 3:1 on "visual information required to
 * identify a component", and a control with a 12:1 text label inside it is arguably identified
 * already. Two pairs here fail that line, both inherited from the handoff's palette, and both are
 * a design decision rather than a bug to fix quietly. So they are exempt **by name, with the
 * measured ratio written down**: an exemption that records 1.58 fails if the pair ever gets
 * worse, which is the difference between a known limitation and an ignored warning.
 *
 * A check that fails routinely is one people learn to ignore — the reason
 * `check-migrations-pushed` is deliberately outside `pnpm check`. This one fails only on a real
 * regression.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
let css;
try {
  css = readFileSync(path.join(root, "apps/web/app/tokens.generated.css"), "utf8");
} catch (error) {
  console.error(`COULD NOT MEASURE: ${error.message}`);
  process.exit(2);
}

function ruleBody(selector) {
  const at = css.indexOf(selector);
  if (at === -1) return null;
  const open = css.indexOf("{", at);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  return null;
}
const tokensIn = (body) =>
  Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\b/g)].map(([, k, v]) => [k, v]));

const lightBody = ruleBody(":root");
const cookBody = ruleBody(".h-cook");
const attrBody = ruleBody(':root[data-theme="dark"]');
if (!lightBody || !cookBody || !attrBody) {
  console.error("COULD NOT MEASURE: the generated stylesheet has no recognisable theme blocks.");
  process.exit(2);
}
const light = tokensIn(lightBody);
/* the dark themes inherit every token they do not restate, exactly as the cascade does */
const dark = { ...light, ...tokensIn(attrBody) };
const cook = { ...light, ...tokensIn(cookBody) };

const channel = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function ratio(a, b) {
  const luminance = (hex) => {
    const n = hex.slice(1);
    const [r, g, bl] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(bl);
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

/*
 * What each screen paints. A new surface adds its pairs here — the whole value of this file is
 * that the list is explicit, because nothing can infer which foreground lands on which background
 * from a stylesheet.
 *
 * `kind` picks the threshold: "text" 4.5, "large" 3.0 (≥24px, or ≥18.66px bold), "ui" 3.0 for a
 * boundary that identifies a control, "decorative" ungated — a divider carries no information.
 */
const TEXT = 4.5;
const LARGE = 3.0;
const UI = 3.0;

const PAIRS = [
  // cook mode (§4.3) — every one of these is painted on a surface that is always dark
  ["cook: recipe title", "text", "bg", "large"],
  ["cook: step instruction 26px", "text-body", "bg", "large"],
  ["cook: step number 56px", "primary", "bg", "large"],
  ["cook: step count 13px", "text-muted", "bg", "text"],
  ["cook: ingredient name", "text-body", "surface", "text"],
  ["cook: ingredient amount", "text", "surface", "text"],
  ["cook: ingredient note", "text-muted", "surface", "text"],
  ["cook: section heading", "text", "surface", "large"],
  ["cook: Next step label", "on-primary", "primary", "text"],
  ["cook: Back label", "text", "surface", "text"],
  ["cook: Screen on badge", "chip-text", "chip-bg", "text"],
  ["cook: close icon", "text", "surface", "ui"],
  ["cook: progress done vs track", "primary", "surface-sunken", "ui"],
  ["cook: Back button outline", "border-strong", "surface", "ui"],
  ["cook: ingredient divider", "border", "surface", "decorative"],
  ["cook: no-method note", "text-muted", "bg", "text"],
  // the shared primitives, which every screen paints
  ["primary button label", "on-primary", "primary", "text"],
  ["secondary button label", "on-secondary", "secondary", "text"],
  ["chip label", "chip-text", "chip-bg", "text"],
  ["planned chip label", "planned-text", "planned-bg", "text"],
  ["highlight badge label", "on-highlight", "highlight", "text"],
  ["body text on the app ground", "text-body", "bg", "text"],
  ["body text on a card", "text-body", "surface", "text"],
  ["muted text on a card", "text-muted", "surface", "text"],
  ["heading on a card", "text", "surface", "large"],
  ["checkbox edge, unchecked", "checkbox-edge", "surface", "ui"],
  ["checked fill vs card", "checked", "surface", "ui"],
  ["day circle, open outline", "border-strong", "surface", "ui"],
  ["input border", "border", "surface", "decorative"],
];

/*
 * Known and measured, not ignored. Each entry records the ratio at the time it was accepted; a
 * pair that gets worse than its recorded value fails even though it is exempt.
 *
 * Both of these are the same token — `borderStrong`, which the handoff labels "open/unselected
 * outlines" — and both are a palette decision rather than a defect in a screen. Worth knowing:
 * the same palette's `checkboxEdge` scores 3.57 light and 6.98 dark, so a stronger outline is
 * available inside the system the moment this is wanted.
 *
 * The day circle is the sharper of the two. `DayCircle` draws a *meaning* with this edge —
 * dashed is an offer, solid is a decision — so an invisible boundary loses information rather
 * than only definition. The Back button is identified by a 12.56:1 label regardless.
 */
const EXEMPT = new Map([
  ["cook: Back button outline", { floor: 1.55, why: "identified by its 12.56:1 label; borderStrong is the handoff's outline token" }],
  ["day circle, open outline", { floor: 1.55, why: "borderStrong; the dashed/solid distinction rides on it — flagged, not fixed quietly" }],
]);

const NEED = { text: TEXT, large: LARGE, ui: UI, decorative: 0 };
const THEMES = [
  ["light", light],
  ["system / toggled dark", dark],
  ["cook mode (always dark)", cook],
];

const failures = [];
const exempted = [];
for (const [themeName, theme] of THEMES) {
  for (const [what, fg, bg, kind] of PAIRS) {
    if (!theme[fg] || !theme[bg]) {
      console.error(`COULD NOT MEASURE: "${what}" needs --${fg} on --${bg} and one of them is not defined in ${themeName}.`);
      process.exit(2);
    }
    const r = ratio(theme[fg], theme[bg]);
    const exemption = EXEMPT.get(what);
    if (exemption) {
      if (r < exemption.floor) {
        failures.push(`${themeName}: ${what} fell to ${r.toFixed(2)}:1, below its recorded ${exemption.floor} — ${exemption.why}`);
      } else exempted.push(`${themeName}: ${what} ${r.toFixed(2)}:1 (exempt: ${exemption.why})`);
      continue;
    }
    if (r < NEED[kind]) {
      failures.push(
        `${themeName}: ${what} is ${r.toFixed(2)}:1 and needs ${NEED[kind]} — ${theme[fg]} on ${theme[bg]} (--${fg} on --${bg})`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error(`${failures.length} contrast failure(s):`);
  for (const line of failures) console.error(`  ${line}`);
  process.exit(1);
}
console.log(
  `${PAIRS.length} colour pairs × ${THEMES.length} themes meet WCAG AA, ` +
    `with ${EXEMPT.size} recorded exemption(s) holding at their measured floor.`,
);
