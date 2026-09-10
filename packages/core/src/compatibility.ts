/**
 * What may be said about a blend, and — more often — what may not.
 *
 * ---------------------------------------------------------------------------
 * Two tiers, kept apart on purpose
 * ---------------------------------------------------------------------------
 *
 * §57a's rule is that a claim carries its source class and never blends two. Here that is the
 * difference between:
 *
 *   `mechanism`  a temperature and a protein — collagen needs hours at 70–90 °C, and this dish
 *                gives it minutes. Arguable only by disputing the chemistry.
 *   `direction`  a perceptual interaction whose *sign* is measured and whose magnitude is not —
 *                salt suppresses bitterness, acid cuts richness. Supports a sentence, never a
 *                coefficient (§60).
 *
 * **Version one ships the mechanism tier only.** Not because the direction tier is wrong but
 * because it needs an ingredient-to-property lookup — which is acid, which is rich — and the
 * catalog matcher this repository already has conflates `almond milk` with `whole milk` and
 * `onion powder` with `onion`. A directional warning built on that matcher would be confidently
 * wrong about the ingredient before it ever got to the interaction. Silence is the correct
 * answer until the matcher is worth trusting.
 *
 * ---------------------------------------------------------------------------
 * The gate, and why it is not applied to everything
 * ---------------------------------------------------------------------------
 *
 * A warning about a component nobody should build on yet is worse than no warning. So claims
 * that **rest on the partition** — "this sauce was built for pork belly; on cod it may read as
 * heavy" — are gated on how well the three readings agreed.
 *
 * A mechanism warning does not rest on the partition. It reads an ingredient line and a duration
 * in a step, neither of which the component inference produced, and it is just as true of a
 * badly split recipe as a well split one. Gating it would suppress a sound claim on account of
 * an unrelated weakness. So the gate **reports** rather than censors: the mechanism warnings
 * stand, and `componentClaims` says whether anything partition-shaped was allowed to be said.
 *
 * That is deliberate. A gate that silently returns an empty list is indistinguishable from a
 * clean check — the failure this project keeps meeting — so "not measured" is a state a caller
 * has to render, exactly as `too-few` is in the taste readings.
 */
import { collagenWarnings, type CompatibilityWarning } from "./collagen.js";

/**
 * How closely the three readings must agree before anything may be said *about a component*.
 *
 * Chosen to match `AGREEMENT` in the components fixture, so one codebase holds one notion of
 * "same partition". That is an argument about coherence, and it was the only argument here
 * until the number was measured.
 *
 * ---------------------------------------------------------------------------
 * Measured, and it does not do what this name promises
 * ---------------------------------------------------------------------------
 *
 * Against the thirty hand-labelled recipes, scored from readings captured once:
 *
 *   passes the gate (>=0.7 and three readings)   7 of 14 right   50%
 *   fails the gate                               8 of 16 right   50%
 *
 * The gate separates nothing. Worse, the band table says why: among recipes where three
 * readings agreed at **0.85 or better**, only 7 of 13 were right. Three independent readings
 * agreeing *perfectly* were wrong four times in eleven.
 *
 * **Agreement measures consistency, not correctness.** Three runs of one model at temperature
 * zero on one prompt are not three independent opinions; they are one opinion sampled three
 * times, and they fail together on exactly the recipes the prompt handles badly. A number built
 * from their concurrence cannot see that, by construction.
 *
 * So this must not be read as confidence, and nothing may be suppressed or admitted on it
 * alone. It is kept because §60 requires the number be *shown* beside a partition — a reader
 * can weigh "the three readings disagreed" for themselves — and because the reverse claim is
 * still sound: **low agreement is genuine evidence of trouble even though high agreement is not
 * evidence of correctness.** The two directions are not symmetric and only one was ever
 * measurable this way.
 *
 * The thing that actually decides whether a component is right is a person looking at it.
 */
export const COMPONENT_TRUST = 0.7;

/**
 * All three readings must have come back.
 *
 * The structural argument is sound and still holds: with a single reading there is nothing to
 * compare against, so agreement is reported as 1.0 — perfect agreement with itself — and a gate
 * on agreement alone would pass most easily exactly where the evidence is thinnest. That is why
 * `components_readings` is stored; before it was, two surviving runs and three wrote the same
 * 1.0 and were indistinguishable afterwards.
 *
 * **But it buys no accuracy, and I claimed it would.** I argued this condition mattered more
 * than the threshold. Measured: recipes with three readings were right 7 of 15; recipes with
 * fewer were right 8 of 15. If anything it points the wrong way. (That comparison is confounded —
 * a provider outage put recipes in the "fewer" bucket that would otherwise have had three — so
 * the honest reading is "no measurable benefit", not "actively harmful".)
 *
 * Kept because a lone reading genuinely cannot report agreement, which is a statement about what
 * the number *means* rather than a claim about accuracy. Not kept as a quality filter, because
 * it is not one.
 */
export const READINGS_NEEDED = 3;

export type ComponentClaims = "allowed" | "not-measured";

export interface CompatibilityReport {
  /** mechanism-backed and ungated: true of the dish however it was split */
  warnings: CompatibilityWarning[];
  /** whether anything resting on the component split was permitted */
  componentClaims: ComponentClaims;
  /** why not — a sentence to render, never a silence to swallow */
  reason: string | null;
}

export function compatibilityReport(
  blend: { ingredients: readonly string[]; steps: readonly string[] },
  components: { agreement: number; readings: number } | null,
): CompatibilityReport {
  const warnings = collagenWarnings(blend);

  const reason = whyNot(components);
  return {
    warnings,
    componentClaims: reason === null ? "allowed" : "not-measured",
    reason,
  };
}

function whyNot(components: { agreement: number; readings: number } | null): string | null {
  if (components === null) return "This recipe has not been split into components yet.";
  if (components.readings < READINGS_NEEDED) {
    return (
      `Only ${components.readings} of ${READINGS_NEEDED} readings came back, so how this splits ` +
      `into components has not really been agreed — just not contradicted.`
    );
  }
  if (components.agreement < COMPONENT_TRUST) {
    return (
      `The three readings disagreed about how this splits into components ` +
      `(${Math.round(components.agreement * 100)}% agreement), so nothing is said about them.`
    );
  }
  return null;
}
