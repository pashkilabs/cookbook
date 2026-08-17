import { describe, expect, it } from "vitest";
import { canvasPlan } from "../app/recipes/import/rotation";

/**
 * A recipe card photographed in portrait, sideways on a table: 3024 × 4032 as the camera saw it.
 */
const CARD = { width: 3024, height: 4032 };

describe("turning a photographed card", () => {
  it("swaps the canvas dimensions on a quarter turn, so a portrait card is not clipped", () => {
    const upright = canvasPlan({ ...CARD, edge: 1500, rotate: 0 });
    expect([upright.canvasWidth, upright.canvasHeight]).toEqual([1125, 1500]);

    for (const rotate of [90, 270] as const) {
      const turned = canvasPlan({ ...CARD, edge: 1500, rotate });
      // the long edge is now horizontal — the whole point of the turn
      expect([turned.canvasWidth, turned.canvasHeight]).toEqual([1500, 1125]);
      // and the bitmap is still drawn at its own proportions, not the canvas's
      expect([turned.drawWidth, turned.drawHeight]).toEqual([1125, 1500]);
    }
  });

  it("leaves the dimensions alone on a half turn", () => {
    const flipped = canvasPlan({ ...CARD, edge: 1500, rotate: 180 });
    expect([flipped.canvasWidth, flipped.canvasHeight]).toEqual([1125, 1500]);
  });

  it("centres the draw on the point it turns about, so a quarter turn stays in frame", () => {
    const plan = canvasPlan({ ...CARD, edge: 1500, rotate: 90 });
    // the context is translated to the canvas centre first, so the offset is half the drawn
    // size negated — any other offset rotates about a corner and slides the card out of view
    expect(plan.offsetX).toBe(-plan.drawWidth / 2);
    expect(plan.offsetY).toBe(-plan.drawHeight / 2);
  });

  it("turns clockwise, matching the degrees the probe reports", () => {
    expect(canvasPlan({ ...CARD, edge: 1500, rotate: 90 }).radians).toBeCloseTo(Math.PI / 2);
    expect(canvasPlan({ ...CARD, edge: 1500, rotate: 270 }).radians).toBeCloseTo((3 * Math.PI) / 2);
  });

  it("never enlarges a photograph that is already smaller than the edge", () => {
    const small = canvasPlan({ width: 400, height: 300, edge: 1500, rotate: 0 });
    expect([small.drawWidth, small.drawHeight]).toEqual([400, 300]);
  });

  it("fits the probe inside its own edge at every turn, so all four cost the same", () => {
    for (const rotate of [0, 90, 180, 270] as const) {
      const plan = canvasPlan({ ...CARD, edge: 448, rotate });
      expect(Math.max(plan.canvasWidth, plan.canvasHeight)).toBe(448);
    }
  });
});
