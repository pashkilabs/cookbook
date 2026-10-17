/**
 * Pashki Cookbook — "Harvest" design tokens v0.1
 * Single source of truth for web (Next.js) and native (Expo).
 * Web: emit as CSS custom properties. Native: import directly into StyleSheet / theme context.
 *
 * ---------------------------------------------------------------------------
 * Provenance, and the one change made to the handoff file
 * ---------------------------------------------------------------------------
 *
 * This is `tokens.ts` from the Harvest handoff bundle (Oct 17 2026), carried in verbatim except
 * for the addition recorded below. **Nothing here is derived or hand-copied from the reference
 * wireframes** — where the two disagree, this file wins, and the one divergence noticed is
 * recorded at `type.eyebrow`.
 *
 * **Added: `palette.linenSoft` and `themes.dark.textBody`.**
 *
 * The light theme has a three-step text ramp — `bark` → `bodyInk` → `loam` — and dark had two,
 * because no palette entry existed between `linen` and `oatmeal`. So `themes.dark.textBody`
 * doubled back to `linen` and the heading/body step collapsed in dark. The colour was never
 * minted; the mapping was not a decision.
 *
 * `linenSoft #DCD2C2` sits between `linen #EEE6D8` and `oatmeal #B8AC9B`, nearer linen, so it
 * reads as body text rather than as muted — the relationship light already has, inverted.
 * Recorded here rather than applied quietly because a future reader diffing this against the
 * bundle should find the reasoning instead of a discrepancy.
 *
 * **Added: `themes.*.borderStrong` now points at the checkbox edge.**
 *
 * The second addition, and this one came from a measurement rather than from a gap. `borderStrong`
 * mapped to `stone`/`ashEdge` and scored **1.63:1 in light and 1.58:1 in dark** against the
 * surface it outlines — WCAG 2.1 §1.4.11 asks **3:1** of a boundary that identifies a control.
 * Retargeted to the `checkboxEdge` pair already in this palette: **3.57:1 light, 6.98:1 dark**.
 *
 * Light is the tighter of the two and the one that decides this: 3.57 clears 3:1 with little
 * room, which is the honest figure to hold rather than the comfortable dark one.
 *
 * The role name stays truthful because **a checkbox edge and an unselected day circle are the
 * same visual job** — the outline of a control that is not currently chosen. The palette already
 * drew that distinction and gave checkboxes the stronger value; "open/unselected outlines" simply
 * did not get it, which reads as an oversight rather than a decision once the two are measured
 * side by side.
 *
 * It matters most where the edge carries *meaning*. `DayCircle` draws dashed for an offer and
 * solid for a decision — §67's distinction — so an invisible boundary loses **information**, not
 * only definition. Cook mode's `Back` was always identified by a 12.56:1 label; the day circles
 * were not identified by anything else.
 *
 * `palette.stone` and `palette.ashEdge` are left in place, unreferenced by any theme role. They
 * are the handoff's values and a future decision may want them; deleting them would make this
 * file diverge from the bundle for no gain. `scripts/check-contrast.mjs` holds the measurement.
 *
 * **Web does not emit the native-only scales.** `space`, `radius` and `size` are numbers for
 * StyleSheet; the CSS generator turns them into `px`. There is no second copy of either.
 */

export const palette = {
  // Light
  oat: '#F3ECDF',        // app ground
  parchment: '#FBF7F0',  // cards, sheets, docked bars
  oatDeep: '#E8DFD0',    // segmented-control track, dividers
  hairline: '#DED3C2',   // borders on inputs / bars
  stone: '#CFC3B0',      // open/unselected outlines
  bark: '#2B2620',       // primary text
  bodyInk: '#4A433B',    // long-form body text
  loam: '#6A6055',       // secondary text
  checkboxEdge: '#8C8174',
  terracotta: '#B4532A', // primary action (white text, 4.8:1)
  terracottaDeep: '#8E3F1E', // pressed / text on clay tint
  olive: '#56653F',      // secondary action, done/checked (white text, 6.3:1)
  oliveDeep: '#3E4A2D',  // text on sage tint
  turmeric: '#D9A23B',   // highlights — dark text only
  sageTint: '#DDE3D0',   // chips, selected
  clayTint: '#F0D9C8',   // planned / today chips
  // Dark
  espresso: '#1C1915',
  castIron: '#28231E',
  ashWood: '#3A332C',
  ashEdge: '#4A4239',
  linen: '#EEE6D8',
  oatmeal: '#B8AC9B',
  /*
   * Added to the handoff file — see the header. Long-form body text in dark: the step between
   * heading and muted that the dark ramp was missing, which made `textBody` fall back to `linen`.
   */
  linenSoft: '#DCD2C2',
  ember: '#E0855A',      // primary action in dark — espresso text on it
  moss: '#A3B58A',
  turmericDark: '#E3B04F',
} as const;

/**
 * The eight colours that identify a *person*, not a state.
 *
 * Carried in from `globals.css` **verbatim**, and deliberately not re-hued to sit with Harvest.
 * These are not theme colours: the seam stores the *key* (`clay`, `teal`, …) against a family
 * member, so a household has already learned that Ada is the teal one. Changing the hex changes
 * who somebody's colour belongs to, which is a product decision and not a restyle.
 *
 * They live here because colour belongs in one file — that is what `check-hex-literals` enforces —
 * and because storing the key is precisely what lets this block change later without a migration.
 */
export const memberColours = {
  clay: '#B4531F',
  olive: '#6B7A3A',
  teal: '#2F7D78',
  plum: '#7D3F6A',
  indigo: '#40518F',
  mustard: '#A87A12',
  rose: '#B04A5F',
  slate: '#55606B',
} as const;

export type ThemeName = 'light' | 'dark';

export const themes = {
  light: {
    bg: palette.oat,
    surface: palette.parchment,
    surfaceSunken: palette.oatDeep,
    border: palette.hairline,
    // see the header: 3.57:1, where `stone` was 1.63 — §1.4.11 wants 3 for a control's boundary
    borderStrong: palette.checkboxEdge,
    text: palette.bark,
    textBody: palette.bodyInk,
    textMuted: palette.loam,
    primary: palette.terracotta,
    primaryPressed: palette.terracottaDeep,
    onPrimary: '#FFFFFF',
    secondary: palette.olive,
    onSecondary: '#FFFFFF',
    highlight: palette.turmeric,
    onHighlight: palette.bark,
    chipBg: palette.sageTint,
    chipText: palette.oliveDeep,
    plannedBg: palette.clayTint,
    plannedText: palette.terracottaDeep,
    checkboxEdge: palette.checkboxEdge,
    checked: palette.olive,
  },
  dark: {
    bg: palette.espresso,
    surface: palette.castIron,
    surfaceSunken: palette.ashWood,
    border: palette.ashEdge,
    // 6.98:1, where `ashEdge` was 1.58 — the same retarget as light, see the header
    borderStrong: palette.oatmeal,
    text: palette.linen,
    // was `palette.linen`, which collapsed the heading/body step that light has (see the header)
    textBody: palette.linenSoft,
    textMuted: palette.oatmeal,
    primary: palette.ember,
    primaryPressed: '#C96F45',
    onPrimary: palette.espresso,
    secondary: palette.moss,
    onSecondary: palette.espresso,
    highlight: palette.turmericDark,
    onHighlight: palette.espresso,
    chipBg: palette.ashWood,
    chipText: palette.moss,
    plannedBg: palette.ashWood,
    plannedText: palette.ember,
    checkboxEdge: palette.oatmeal,
    checked: palette.moss,
  },
} as const;

export const font = {
  display: 'Fraunces',     // weight 600 — titles, section heads, step numbers
  body: 'Nunito Sans',     // 400 / 600 / 700 — everything else
} as const;

export const type = {
  displayXL: { family: font.display, size: 30, weight: '600', lineHeight: 1.1 },  // screen titles
  displayL: { family: font.display, size: 28, weight: '600', lineHeight: 1.1 },   // recipe title
  displayM: { family: font.display, size: 22, weight: '600', lineHeight: 1.15 },  // card titles
  displayS: { family: font.display, size: 20, weight: '600', lineHeight: 1.2 },   // section heads
  stepNumber: { family: font.display, size: 56, weight: '600', lineHeight: 1 },
  cookBody: { family: font.body, size: 26, weight: '400', lineHeight: 1.35 },    // cook mode instruction
  bodyL: { family: font.body, size: 16, weight: '400', lineHeight: 1.45 },       // ingredients, inputs (16 = no iOS zoom)
  body: { family: font.body, size: 15, weight: '400', lineHeight: 1.5 },
  label: { family: font.body, size: 15, weight: '700', lineHeight: 1.2 },        // buttons
  meta: { family: font.body, size: 13, weight: '400', lineHeight: 1.35 },
  chip: { family: font.body, size: 12, weight: '700', lineHeight: 1.2 },
  /*
   * `letterSpacing: 1.2` (px) rather than the reference wireframes' `0.1em`, which at 12px is
   * 1.2px — the same value expressed two ways, and they agree. Noted because the next person to
   * compare the two should not have to re-derive that, and because this file wins where they
   * diverge.
   */
  eyebrow: { family: font.body, size: 12, weight: '700', lineHeight: 1.2, letterSpacing: 1.2 }, // UPPERCASE aisle headers
  tab: { family: font.body, size: 11, weight: '600', lineHeight: 1.2 },
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const; // screen gutter = xl (20)

export const radius = {
  checkbox: 7,
  thumb: 12,
  input: 14,
  card: 16,
  cardLarge: 20,
  sheet: 22,
  pill: 999,
} as const;

export const size = {
  touchMin: 44,
  button: 44,
  buttonLarge: 60,   // cook mode Back / Next
  input: 48,
  segmented: 38,     // inner button; track adds 3px padding
  checkbox: 24,
  dayCircle: { w: 42, h: 52 },
  tabBar: 84,        // includes bottom safe-area padding on iOS
  dockedActionBar: 84,
  heroImage: 250,
} as const;

export const shadow = {
  segmentedThumb: '0 1px 2px rgba(43,38,32,0.15)',
} as const;
