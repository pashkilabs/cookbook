import { describe, expect, it } from "vitest";
import { MEMBER_COLOURS } from "@pashki/platform-client";
import { memberColours } from "@pashki/design-tokens";

/**
 * The seam's reference hexes and the tokens' real ones, compared — because they are two copies.
 *
 * `member-colours.ts` is the one exemption in `check-hex-literals`, and it is a decision: the seam
 * stores the *key* so appearance stays the app's business, and making the seam import a design
 * package would invert that dependency and cost the portability the key-storage exists for. Its
 * own comment calls the hex "a reference value for anything that cannot read the stylesheet".
 *
 * So neither owns the other, and the drift is caught by **asking whether they agree** — the shape
 * that closed the same problem between core's allergen list and the SQL CHECK behind it. A value
 * changed on one side and not the other fails here rather than showing a household two different
 * colours for the same person.
 *
 * It lives in `apps/web` rather than in either package, and that is the point: the app already
 * depends on both, so comparing them here creates **no new package edge**. Putting it in
 * design-tokens pulled the seam's source into that package's typecheck; putting it in the seam
 * would make the platform depend on one app's design system, which is the inversion the
 * key-storage exists to prevent.
 */
describe("the seam's reference colours and the tokens", () => {
  it("name exactly the same eight keys", () => {
    expect(MEMBER_COLOURS.map((colour) => colour.key).sort()).toEqual(Object.keys(memberColours).sort());
  });

  it("agree on every value, case aside", () => {
    for (const colour of MEMBER_COLOURS) {
      const token = memberColours[colour.key as keyof typeof memberColours];
      expect(token?.toLowerCase(), colour.key).toBe(colour.hex.toLowerCase());
    }
  });
});
