import { describe, expect, it } from "vitest";
import { formatAsWritten } from "../src/format.js";
import { canonicalUnit } from "../src/units.js";
import { parseIngredientLine } from "../src/parse.js";

/**
 * The split display — "Tuesday takes 1 cup, Friday takes ½ cup" — is where somebody checks which
 * meal takes what, so it has to read the way their recipe reads. It said "2 clove".
 *
 * "As written" means the parse (decisions §29). It cannot mean the source text, because nothing
 * stores it.
 */
describe("formatAsWritten", () => {
  it("inflects word units", () => {
    // regression: the canonical unit was printed verbatim, so "2 cloves garlic" came back as
    // "2 clove"
    expect(formatAsWritten(2, "clove")).toBe("2 cloves");
    expect(formatAsWritten(1.5, "cup")).toBe("1½ cups");
    expect(formatAsWritten(2, "stick")).toBe("2 sticks");
    expect(formatAsWritten(3, "can")).toBe("3 cans");
    expect(formatAsWritten(2, "bunch")).toBe("2 bunches");
  });

  it("keeps one of anything singular", () => {
    expect(formatAsWritten(1, "clove")).toBe("1 clove");
    expect(formatAsWritten(1, "cup")).toBe("1 cup");
  });

  it("never inflects a symbol", () => {
    // "250 gs" is not a thing anybody has written
    for (const unit of ["g", "kg", "ml", "l", "oz", "lb", "tsp", "tbsp", "floz"]) {
      expect(formatAsWritten(250, unit), unit).toBe(`250 ${unit}`);
    }
  });

  it("says nothing about the unit when the recipe counted whole things", () => {
    expect(formatAsWritten(3, "count")).toBe("3");
    expect(formatAsWritten(3, null)).toBe("3");
  });

  it("survives an amount it was never given", () => {
    expect(formatAsWritten(null, "cup")).toBe("cup");
    expect(formatAsWritten(null, null)).toBe("");
  });

  it("emits only plurals the parser can read back", () => {
    // the recipe editor rebuilds its lines from these strings and re-parses them, so a plural
    // this produced but canonicalUnit could not read would silently lose a unit on the next save
    for (const unit of ["cup", "pint", "quart", "gallon", "stick", "clove", "can", "bunch"]) {
      const written = formatAsWritten(2, unit);
      const [, plural] = written.split(" ");
      expect(canonicalUnit(plural!), written).toBe(unit);
    }
  });

  it("round-trips a rebuilt line through the parser unchanged", () => {
    // what the edit form actually does: render the stored parse, then read it again
    for (const line of ["2 cloves garlic", "1½ cups heavy cream", "250 g mushrooms", "3 cans beans"]) {
      const first = parseIngredientLine(line)!;
      const rebuilt = `${formatAsWritten(first.amount, first.unit)} ${first.item}`.trim();
      const second = parseIngredientLine(rebuilt)!;
      expect(second.amount, line).toBe(first.amount);
      expect(second.unit, line).toBe(first.unit);
      expect(second.item, line).toBe(first.item);
    }
  });
});
