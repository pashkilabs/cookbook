import { describe, expect, it } from "vitest";
import { compatibilityReport, COMPONENT_TRUST, READINGS_NEEDED } from "../src/compatibility.js";

const blend = {
  ingredients: ["500 g beef chuck, cubed", "2 tbsp soy sauce"],
  steps: ["Heat a wok", "Stir-fry the beef for 6 minutes"],
};
const settled = { ingredients: ["2 chicken breasts"], steps: ["Grill for 8 minutes"] };

describe("compatibilityReport", () => {
  it("says the mechanism warning even when the components are untrustworthy", () => {
    // gating this would suppress a claim about a temperature because of an unrelated weakness
    const report = compatibilityReport(blend, { agreement: 0.2, readings: 3 });
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.basis).toBe("mechanism");
  });

  it("refuses component claims when the readings disagreed, and says why", () => {
    const report = compatibilityReport(blend, { agreement: COMPONENT_TRUST - 0.01, readings: 3 });
    expect(report.componentClaims).toBe("not-measured");
    expect(report.reason).toContain("disagreed");
  });

  it("allows component claims once three readings agree", () => {
    const report = compatibilityReport(blend, { agreement: COMPONENT_TRUST, readings: READINGS_NEEDED });
    expect(report.componentClaims).toBe("allowed");
    expect(report.reason).toBeNull();
  });

  it("refuses a perfect score that stands on one reading", () => {
    // regression: a lone reading agrees with itself, so agreement alone passes most easily
    // exactly where the evidence is thinnest
    const report = compatibilityReport(blend, { agreement: 1, readings: 1 });
    expect(report.componentClaims).toBe("not-measured");
    expect(report.reason).toContain("1 of 3");
  });

  it("refuses when nothing has been split at all, rather than reporting a clean check", () => {
    const report = compatibilityReport(blend, null);
    expect(report.componentClaims).toBe("not-measured");
    expect(report.reason).toBeTruthy();
  });

  it("distinguishes nothing-to-say from not-checked", () => {
    // an empty warning list with allowed claims is a check that ran and found nothing; an empty
    // list with not-measured is a check that did not run. Rendering them the same is the bug.
    const checked = compatibilityReport(settled, { agreement: 0.9, readings: 3 });
    const unchecked = compatibilityReport(settled, null);
    expect(checked.warnings).toEqual([]);
    expect(unchecked.warnings).toEqual([]);
    expect(checked.componentClaims).not.toBe(unchecked.componentClaims);
  });
});
