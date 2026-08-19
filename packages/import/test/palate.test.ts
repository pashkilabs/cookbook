import { describe, expect, it } from "vitest";
import { ageBand, palateNotes, PALATE_INSTRUCTIONS, PALATE_JSON_SCHEMA } from "../src/palate.js";
import type { LlmProvider, ModelConfig } from "../src/provider.js";

const MODEL: ModelConfig = { provider: "p", model: "m", region: "us" };
const RECIPE = { title: "Orecchiette with Broccoli Rabe", ingredients: ["1 bunch broccoli rabe", "1 lb orecchiette"] };

const answering = (json: unknown) => {
  const seen: { content?: string } = {};
  const provider: LlmProvider = {
    key: "fake",
    async extract(request) {
      seen.content = request.content;
      return { json, usage: { model: "m" } };
    },
  };
  return { provider, seen };
};

describe("what a child might find difficult", () => {
  it("returns reasons and offers no score, because a number cannot be judged", () => {
    // no score *field* — the word appears in the schema only to forbid one, which is the point
    const fields = Object.keys(PALATE_JSON_SCHEMA.properties.notes.items.properties);
    expect(fields).toEqual(["ingredient", "reason"]);
    expect(PALATE_INSTRUCTIONS).toMatch(/never a score/);
  });

  it("carries recipe content only — no name, no ratings, no year of birth", async () => {
    const { provider, seen } = answering({ notes: [] });
    await palateNotes({ provider, model: MODEL, recipe: RECIPE, band: "a younger child" });
    expect(seen.content).toContain("broccoli rabe");
    expect(seen.content).toContain("a younger child");
    // the band is a word; a birth year or an age would be a child's personal data (§58)
    expect(seen.content).not.toMatch(/\b(19|20)\d{2}\b/);
  });

  it("omits the age entirely when no year is recorded, rather than guessing one", async () => {
    const { provider, seen } = answering({ notes: [] });
    await palateNotes({ provider, model: MODEL, recipe: RECIPE, band: null });
    expect(seen.content).not.toMatch(/child|adolescent/i);
  });

  it("keeps an empty list empty — a note on a plain roast teaches people to ignore them all", async () => {
    const { provider } = answering({ notes: [] });
    expect(await palateNotes({ provider, model: MODEL, recipe: RECIPE })).toEqual([]);
  });

  it("drops a malformed note rather than rendering a half sentence", async () => {
    const { provider } = answering({ notes: [{ ingredient: "rabe" }, { ingredient: "", reason: "x" }] });
    expect(await palateNotes({ provider, model: MODEL, recipe: RECIPE })).toEqual([]);
  });

  it("shows at most three, so the block stays readable", async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ ingredient: `i${i}`, reason: "r" }));
    const { provider } = answering({ notes: many });
    expect(await palateNotes({ provider, model: MODEL, recipe: RECIPE })).toHaveLength(3);
  });
});

describe("which end of the evidence a child sits at", () => {
  it("bands coarsely, because the literature offers no sharper threshold", () => {
    expect(ageBand(2019, 2026)).toBe("a younger child");
    expect(ageBand(2014, 2026)).toBe("an older child");
    expect(ageBand(2010, 2026)).toMatch(/moderating/);
  });

  it("says nothing when no year is recorded — most of the time", () => {
    expect(ageBand(null, 2026)).toBeNull();
  });

  it("refuses a year that cannot be a child's, rather than banding it anyway", () => {
    expect(ageBand(1970, 2026)).toBeNull();
    expect(ageBand(2030, 2026)).toBeNull();
  });
});
