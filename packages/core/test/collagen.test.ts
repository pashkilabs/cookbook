import { describe, expect, it } from "vitest";
import {
  collagenRichCut,
  collagenWarnings,
  longestSustainedMinutes,
  SUSTAINED_MINUTES_NEEDED,
} from "../src/collagen.js";

describe("longestSustainedMinutes", () => {
  it("takes the longest single interval, never the sum", () => {
    // collagen wants one sustained stretch; three short ones are not one long one
    expect(longestSustainedMinutes(["cook 20 minutes", "rest 15 minutes", "fry 10 minutes"])).toBe(20);
  });

  it("takes the upper bound of a range, because a borderline recipe should pass", () => {
    expect(longestSustainedMinutes(["braise for 2-3 hours"])).toBe(180);
    expect(longestSustainedMinutes(["braise for 2 to 3 hours"])).toBe(180);
    expect(longestSustainedMinutes(["simmer 15–20 minutes"])).toBe(20);
  });

  it("reports null when no step names a duration, which is not zero", () => {
    expect(longestSustainedMinutes(["sear the beef", "add stock and cover"])).toBeNull();
  });

  it("treats overnight as long", () => {
    expect(longestSustainedMinutes(["marinate overnight"])).toBe(480);
  });
});

describe("collagenRichCut", () => {
  it("finds the cut in a written line, plural included", () => {
    expect(collagenRichCut("2 kg bone-in short ribs")).toBe("short rib");
    expect(collagenRichCut("racks spare ribs")).toBe("spare rib");
    expect(collagenRichCut("1 beef chuck roast")).toBe("chuck");
  });

  it("does not match inside a longer word", () => {
    // regression: substring matching is how "onion powder" became "onion" in the shopping list
    expect(collagenRichCut("shankar's spice mix")).toBeNull();
    expect(collagenRichCut("woodchuck cider")).toBeNull();
  });

  it("ignores poultry entirely, because fast-cooked thigh is not a mistake", () => {
    expect(collagenRichCut("6 chicken thighs")).toBeNull();
    expect(collagenRichCut("2 chicken breasts")).toBeNull();
  });

  it("does not read a shape or a tool as a cut", () => {
    expect(collagenRichCut("1 round of pizza dough")).toBeNull();
    expect(collagenRichCut("sharpen the blade")).toBeNull();
  });
});

describe("collagenWarnings", () => {
  it("warns when a collagen-rich cut is given minutes instead of hours", () => {
    // the case the feature exists for: chuck moved into a stir-fry's method by a blend
    const [warning, ...rest] = collagenWarnings({
      ingredients: ["500 g beef chuck, cubed", "2 tbsp soy sauce"],
      steps: ["Heat a wok", "Stir-fry the beef for 6 minutes"],
    });
    expect(rest).toHaveLength(0);
    expect(warning?.basis).toBe("mechanism");
    expect(warning?.subject).toBe("500 g beef chuck, cubed");
    expect(warning?.note).toContain("70–90");
  });

  it("says nothing about a braise that already cooks it properly", () => {
    expect(
      collagenWarnings({
        ingredients: ["bone-in short ribs"],
        steps: ["Sear 2–3 min a side", "Braise for 3 hours"],
      }),
    ).toEqual([]);
  });

  it("says nothing when no step names a duration", () => {
    // regression: a rule reading `time_minutes` announced that smoked ribs stored as 20 minutes
    // needed longer cooking, to a cook already smoking them for two hours
    expect(
      collagenWarnings({ ingredients: ["racks spare ribs"], steps: ["Smoke until tender"] }),
    ).toEqual([]);
  });

  it("says nothing under pressure, where the temperature is not one it can reason about", () => {
    expect(
      collagenWarnings({
        ingredients: ["1 kg pork shoulder"],
        steps: ["Pressure cook for 45 minutes"],
      }),
    ).toEqual([]);
  });

  it("stays silent right up to the threshold rather than arguing about degrees", () => {
    const steps = [`Cook for ${SUSTAINED_MINUTES_NEEDED} minutes`];
    expect(collagenWarnings({ ingredients: ["beef brisket"], steps })).toEqual([]);
  });
});
