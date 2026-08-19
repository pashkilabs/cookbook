import { describe, expect, it } from "vitest";
import { warningsFor, type ChildTastes } from "../lib/tastes";
import type { TasteReading } from "@pashki/core";

const reading = (over: Partial<TasteReading> = {}): TasteReading => ({
  dimension: "principalProtein",
  value: "fish",
  count: 8,
  mean: 1.8,
  state: "pattern",
  leaning: "avoids",
  ...over,
});

const child = (readings: TasteReading[]): ChildTastes => ({
  memberId: "m1",
  displayName: "Ada",
  birthYear: 2018,
  totalRatings: 8,
  readings,
  summary: { state: "pattern", message: "" },
});

const FISH = { cuisine: null, principal_protein: "fish", dish_form: null };

describe("warning before a recipe is planned", () => {
  it("warns where a child has consistently rated this dimension low", () => {
    const found = warningsFor([child([reading()])], FISH);
    expect(found).toHaveLength(1);
    expect(found[0]!.displayName).toBe("Ada");
    expect(found[0]!.reading.count).toBe(8);
  });

  /*
   * A warning interrupts somebody's planning, so it is held to the higher bar. An observation
   * may show from three ratings; stopping a person needs the six.
   */
  it("stays quiet on too-few, however low the mean", () => {
    const thin = reading({ count: 2, state: "too-few", leaning: null });
    expect(warningsFor([child([thin])], FISH)).toEqual([]);
  });

  it("never warns that a child likes something — that would be noise", () => {
    const likes = reading({ mean: 4.8, leaning: "likes" });
    expect(warningsFor([child([likes])], FISH)).toEqual([]);
  });

  it("says nothing about a dimension this recipe does not have", () => {
    const noProtein = { cuisine: null, principal_protein: null, dish_form: null };
    expect(warningsFor([child([reading()])], noProtein)).toEqual([]);
  });

  it("matches on the recipe's own value, not on any low rating anywhere", () => {
    const beef = { cuisine: null, principal_protein: "beef", dish_form: null };
    expect(warningsFor([child([reading()])], beef)).toEqual([]);
  });
});
