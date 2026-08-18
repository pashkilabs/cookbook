import { describe, expect, it } from "vitest";
import { stripLeadingDecoration } from "../src/format.js";

describe("decoration at the start of a step", () => {
  it("drops the emoji a caption used as a bullet", () => {
    expect(stripLeadingDecoration("💕Start by seasoning the chicken breast")).toBe(
      "Start by seasoning the chicken breast",
    );
    expect(stripLeadingDecoration("💕 Next, dip into the egg white")).toBe(
      "Next, dip into the egg white",
    );
  });

  it("keeps an emoji that is doing work mid-sentence", () => {
    // removing this would be editing the method rather than formatting it
    expect(stripLeadingDecoration("Sear over 🔥 high heat for two minutes")).toBe(
      "Sear over 🔥 high heat for two minutes",
    );
  });

  it("drops bullets and dashes too, and a run of them", () => {
    expect(stripLeadingDecoration("• Fold into a burrito")).toBe("Fold into a burrito");
    expect(stripLeadingDecoration("- Slice into half")).toBe("Slice into half");
    expect(stripLeadingDecoration("💕💕  Microwave the wraps")).toBe("Microwave the wraps");
  });

  it("leaves an ordinary step exactly as written", () => {
    expect(stripLeadingDecoration("Add yeast to warm milk, stir, stand 10 minutes")).toBe(
      "Add yeast to warm milk, stir, stand 10 minutes",
    );
  });

  it("never empties a step that is nothing but decoration", () => {
    expect(stripLeadingDecoration("💕💕💕")).toBe("💕💕💕");
  });

  it("does not touch a numbered step — a number may be the source's own ordering", () => {
    expect(stripLeadingDecoration("2. Whisk the eggs")).toBe("2. Whisk the eggs");
  });
});
