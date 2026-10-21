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
 * ---------------------------------------------------------------------------
 * The limitation, stated because §80 says a guard's assertion is not its subject
 * ---------------------------------------------------------------------------
 *
 * This list is maintained by hand, and **nothing checks that it matches the stylesheet.** A pair
 * written here as `planned-text on planned-bg` passes happily while the rule it claims to describe
 * says `color: var(--primary)` — which is 3.67:1 on that ground and fails. That happened once, to
 * the "tap to cook" cue, within minutes of this file being extended: the table was right about a
 * pairing the CSS was not using, so the check reported a pass about a declaration that did not
 * exist.
 *
 * Closing it properly needs a cascade — which foreground actually lands on which ground is a
 * question only a browser can answer, and that is the thing no check here has. So the honest
 * position is that this guard is only as good as this list, every entry has to be read against the
 * rule it names, and **a new pair is written by looking at the CSS rather than at the intention.**
 *
 * `check-palette-roles` is the partial backstop: it cannot see pairs, but it does refuse a text
 * role used as a fill and a surface role used as text, which rules out the worst of the
 * mismatches without knowing what sits on what.
 *
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
  // the week plan (§4.4)
  ["week: day-of-month", "text", "bg", "large"],
  ["week: weekday letters", "text-muted", "bg", "text"],
  ["week: recipe name", "text", "surface", "large"],
  ["week: time meta", "text-muted", "surface", "text"],
  ["week: recipe name on today", "text", "planned-bg", "large"],
  ["week: time meta on today", "text-muted", "planned-bg", "text"],
  ["week: + Add dinner label", "text-muted", "surface", "text"],
  ["week: + Add dinner dashed edge", "border-strong", "surface", "ui"],
  ["week: thumbnail initial", "text-muted", "surface-sunken", "text"],
  ["week: alongside footnote text", "text-muted", "surface", "text"],
  ["week: alongside suggestion", "text-body", "surface", "text"],
  /*
   * Every site that uses the accent as TEXT rather than as a fill, which is the audit this file
   * was missing. The palette specifies terracotta as a fill with white on it, so these are an
   * extension of the token — and in light it clears AA on parchment (4.67) and fails on both the
   * app ground (4.24) and the sunken one (3.77). Nothing may paint it on those two.
   */
  ["accent as link text, on a card", "primary", "surface", "text"],
  ["tab bar current label", "primary", "surface", "text"],
  ["week: + Add dinner hover label", "text", "surface", "text"],
  ["week: + Add dinner hover label on today", "text", "planned-bg", "text"],
  ["week: + Add dinner hover edge", "primary", "planned-bg", "ui"],
  // shopping (§4.5)
  ["shop: item name", "text", "surface", "text"],
  ["shop: package amount", "text", "surface", "text"],
  ["shop: counts and notes", "text-muted", "surface", "text"],
  ["shop: a ticked line, struck through", "text-muted", "surface", "text"],
  ["shop: day portion chip", "planned-text", "planned-bg", "text"],
  ["shop: spare chip", "chip-text", "chip-bg", "text"],
  /* the quiet chip is a role now, not a surface borrowed by a screen */
  ["quiet chip anywhere", "chip-quiet-text", "chip-quiet-bg", "text"],
  ["shop: by-meal portion", "text-body", "surface", "text"],
  ["shop: dashed pantry edge", "checkbox-edge", "surface", "ui"],
  ["shop: aisle eyebrow", "text-muted", "surface", "text"],
  /*
   * The bridge rules in `globals.css`, which the Harvest pair table had never covered — and that
   * omission is why two near-black fills survived every check. A guard's blind spot is a list,
   * and this list was "the classes I wrote" rather than "the rules that paint".
   */
  ["bridge: primary button label", "on-primary", "primary", "text"],
  ["bridge: secondary (outlined olive) label", "secondary", "surface", "text"],
  ["bridge: secondary outline", "secondary", "surface", "ui"],
  ["bridge: secondary label on the app ground", "secondary", "bg", "text"],
  ["bridge: chip at rest", "chip-text", "chip-bg", "text"],
  ["bridge: chip selected (clay)", "planned-text", "planned-bg", "text"],
  ["bridge: chip accent edge on hover", "primary", "chip-bg", "ui"],
  ["week: cooked mark, unmarked", "text-muted", "surface", "text"],
  ["week: cooked mark edge, unmarked", "border-strong", "surface", "ui"],
  ["week: cooked mark, marked", "on-secondary", "checked", "text"],
  ["week: cooked mark on today's row", "text-muted", "planned-bg", "text"],
  /* the "tap to cook" cue sits on today's row, which is the clay tint — not on parchment */
  ["week: tap-to-cook cue on today", "planned-text", "planned-bg", "text"],
  ["week: score button, unchosen", "text", "surface", "text"],
  ["week: score button edge", "border-strong", "surface", "ui"],
  ["week: score button, chosen", "on-secondary", "checked", "text"],
  ["week: member name above scores", "text-muted", "surface", "text"],
  // Today (§6)
  ["today: the date above the title", "text-muted", "bg", "text"],
  ["today: meal title", "text", "surface", "large"],
  ["today: meal meta", "text-muted", "surface", "text"],
  ["today: still-to-buy count", "planned-text", "surface", "text"],
  ["today: see-the-list link", "primary", "surface", "text"],
  ["today: leaderboard name", "text", "surface", "large"],
  ["today: counted-from note", "text-muted", "bg", "text"],
  ["today: liked chip", "chip-text", "chip-bg", "text"],
  ["today: made-N-times chip", "planned-text", "planned-bg", "text"],
  ["today: quiet chip (untried, lukewarm)", "chip-quiet-text", "chip-quiet-bg", "text"],
  ["today: photo placeholder initial", "text-muted", "surface-sunken", "text"],
  ["today: no-meal-planned title", "text", "surface", "large"],
  ["today: no-meal-planned sentence", "text-body", "surface", "text"],
  ["today: no-meal-planned link", "planned-text", "surface", "text"],
  ["today: no-meal-planned accent edge", "primary", "surface", "ui"],
  ["today: slot tab, unselected", "text-muted", "surface-sunken", "text"],
  ["today: slot tab, selected", "text", "surface", "text"],
  ["today: plan control label", "secondary", "surface", "text"],
  ["today: plan control outline", "secondary", "surface", "ui"],
  ["today: choosing banner", "planned-text", "planned-bg", "text"],
  ["today: see-every-recipe link", "planned-text", "bg", "text"],
  ["today: links on the app ground", "planned-text", "bg", "text"],
  ["today: chosen slot label", "planned-text", "bg", "text"],
  ["today: chosen slot edge", "primary", "bg", "ui"],
  // §85: the choosing card and the two layouts
  ["choose: question title", "text", "surface", "large"],
  ["choose: question note", "text-body", "surface", "text"],
  ["choose: option label", "text", "bg", "text"],
  ["choose: option edge", "border-strong", "bg", "ui"],
  ["choose: not-yet chip", "chip-quiet-text", "chip-quiet-bg", "text"],
  ["choose: dismiss link", "planned-text", "surface", "text"],
  ["choose: option label", "text", "surface", "large"],
  ["choose: option description", "text-body", "surface", "text"],
  ["choose: option blocked reason", "planned-text", "surface", "text"],
  ["choose: radio ring", "checkbox-edge", "surface", "ui"],
  ["choose: radio ring, chosen", "primary", "surface", "ui"],
  ["choose: preview block", "border-strong", "bg", "ui"],
  ["choose: preview block, emphasised", "primary", "bg", "ui"],
  ["layout: tile title", "text", "surface", "text"],
  ["layout: tile placeholder initial", "text-muted", "surface-sunken", "text"],
  ["layout: shelf see-all", "planned-text", "bg", "text"],
  ["plate: suggestion title", "text", "surface", "large"],
  ["plate: the reason", "text-body", "surface", "text"],
  ["choose: setting title", "text", "bg", "large"],
  ["choose: setting note", "text-muted", "bg", "text"],
  ["layout: planned-count meta", "text-muted", "surface", "text"],
  ["layout: try-something-new band", "text", "surface", "large"],
  ["layout: band accent edge", "primary", "surface", "ui"],
  ["layout: new badge", "on-highlight", "highlight", "text"],
  ["layout: show-the-other-N label", "secondary", "bg", "text"],
  ["layout: show-the-other-N outline", "secondary", "bg", "ui"],
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
  /*
   * The recipe book's contents page and its chapter pages (§86).
   *
   * The chapter icon is the interesting one: it is a PNG **masked** with `var(--text)`, so what
   * reaches the eye is a token and this table can gate it. As an `<img>` it would be the ink baked
   * into the file, which no stylesheet check can see at all — that is `check-chapter-icons.mjs`.
   * "ui" is the right threshold: §1.4.11 asks 3:1 of a graphic, and masked this clears it by four
   * times over in both themes.
   */
  ["contents: book title 25px", "text", "bg", "large"],
  ["contents: recipe count 11px", "text-muted", "bg", "text"],
  ["contents: chapter icon, masked", "text", "surface", "ui"],
  ["contents: chapter name 14.5px", "text", "surface", "text"],
  ["contents: chapter count 11px", "text-muted", "surface", "text"],
  ["contents: unsorted row name", "text", "surface", "large"],
  ["contents: unsorted row edge", "border-strong", "surface", "ui"],
  ["contents: unsorted row chevron", "text-muted", "surface", "text"],
  ["chapter: hero title 26px", "text", "bg", "large"],
  ["chapter: hero icon, masked", "text", "bg", "ui"],
];

/*
 * Empty, and worth keeping rather than deleting.
 *
 * It held two entries — both the same token, `borderStrong`, at 1.63:1 light and 1.58:1 dark
 * against §1.4.11's 3:1. They are gone because the token was **retargeted** to this palette's
 * `checkboxEdge` pair (3.57 light, 6.98 dark) rather than because the threshold moved: a checkbox
 * edge and an unselected day circle are the same visual job, so the role name stayed honest. See
 * the header of `tokens.ts`.
 *
 * The mechanism stays for the next one. An exemption must record the **measured ratio**, so that
 * a known limitation still fails when it gets worse — the difference between accepting a number
 * and ignoring a warning.
 */
const EXEMPT = new Map();

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
    (EXEMPT.size === 0
      ? "with no exemptions."
      : `with ${EXEMPT.size} recorded exemption(s) holding at their measured floor.`),
);
