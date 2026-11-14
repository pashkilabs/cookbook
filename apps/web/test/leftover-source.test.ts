import { describe, expect, it } from "vitest";
import { leftoverSource } from "@/lib/planner";
import { SLOTS } from "@/lib/slots";

/**
 * What a leftover's card says instead of a quantity.
 *
 * The line this replaces was `serves 6 · already cooked`, and `serves 6` was the **recipe's
 * yield** standing in for how much is in the fridge. §106 refused quantity tracking, so that
 * figure was never measured — and a number is the one thing on a card somebody acts on.
 *
 * Tested here rather than through the screen because the screen is a server component and this is
 * a pure sentence. `pnpm shots` photographs the rendered card; this covers both of its branches,
 * only one of which a fixture on a single day can reach.
 */
describe("the meal a leftover came from", () => {
  it("names the day and the meal, so Thursday's lunch says where it was cooked", () => {
    expect(leftoverSource({ date: "2026-03-03", slot: "dinner" }, "2026-03-05")).toBe(
      "From Tuesday's dinner",
    );
  });

  it("says today when the cook was earlier the same day, because a weekday name would read as last week", () => {
    expect(leftoverSource({ date: "2026-03-05", slot: "lunch" }, "2026-03-05")).toBe(
      "From today's lunch",
    );
  });

  it("uses the meal's own word rather than the tab's abbreviation", () => {
    // SLOT_LABEL is "Bkfst", which is four tabs on a 390px phone and not a sentence
    expect(leftoverSource({ date: "2026-03-02", slot: "breakfast" }, "2026-03-05")).toBe(
      "From Monday's breakfast",
    );
  });

  it("says nothing about how much is left, because nothing measured it", () => {
    /*
     * The rule §106 is enforcing, asserted as a property rather than as four strings: no digit
     * reaches this line. A later version reaching for `recipe.servings` again — the obvious
     * thing to do when a card looks sparse — fails here and reads why.
     */
    for (const slot of SLOTS) {
      for (const date of ["2026-03-02", "2026-03-05", "2026-03-07"]) {
        const said = leftoverSource({ date, slot }, "2026-03-07");
        expect(said, `${date} ${slot}`).not.toMatch(/\d/);
      }
    }
  });

  it("gives a word rather than throwing for a slot the database cannot hold", () => {
    // unreachable through the CHECK constraint, and a sentence rather than a crash if that changes
    expect(leftoverSource({ date: "2026-03-03", slot: "brunch" }, "2026-03-05")).toBe(
      "From Tuesday's meal",
    );
  });
});
