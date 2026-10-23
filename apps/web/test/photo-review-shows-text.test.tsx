import { describe, expect, it, vi } from "vitest";

// the component refreshes the router after a write; a static render has no app router mounted
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewRows } from "../app/shopping/photograph";

/**
 * The review screen rendered nine tick boxes and **no item text**.
 *
 * Reported as the feature being unusable, and it was: nobody can check a reading they cannot read.
 * The extraction was fine — nine objects, each with its text. The render lost it, because
 * `.h-check input` is a descendant selector that means "the checkbox" and says "every input", so
 * the text field inside a row was clipped to 1px by a rule written to hide a native checkbox.
 *
 * **The assertion that would have caught it is the text of a line, not the count of rows.** A row
 * count passes with every row empty — which is precisely what shipped — and it is the same
 * absence-versus-emptiness confusion this project keeps paying for. So this asserts the words.
 *
 * `renderToStaticMarkup` cannot see CSS, so it cannot catch the clipping itself; `pnpm shots`
 * owns that half and now renders this screen. What this owns is the half a picture cannot assert
 * cheaply: that the value reaches the markup at all, for every line, including a struck one.
 */
describe("the photographed-list review screen", () => {
  const lines = [
    { text: "Chick nugs", struck: false, strikeConfidence: "certain" as const, legible: true },
    { text: "sasuage", struck: true, strikeConfidence: "certain" as const, legible: true },
    { text: "cab sav", struck: true, strikeConfidence: "unsure" as const, legible: false },
  ];

  /*
   * `ReviewRows` is the reviewing state, which the page composes with the capture control. The
   * struck lines arrive unticked exactly as the product sets them, so what is rendered here is
   * what a person would be looking at.
   */
  const review = () =>
    renderToStaticMarkup(
      <ReviewRows rows={lines.map((line) => ({ ...line, add: !line.struck }))} onChange={() => {}} />,
    );

  // regression: nine rows, nine tick boxes, no text — a row count would have passed
  it("renders the words of every line, not just a row for each", () => {
    const html = review();
    for (const line of lines) {
      expect(html, `"${line.text}" is not in the markup`).toContain(line.text);
    }
  });

  it("keeps a misspelling exactly as the paper wrote it", () => {
    // "sasuage" must not arrive as "sausage": the premise of the screen is that she is checking a
    // reading, and a silently corrected word is no longer the reading
    expect(review()).toContain("sasuage");
    expect(review()).not.toContain("sausage");
  });

  it("says why a struck line is unticked, and distinguishes an unclear mark from an unreadable word", () => {
    const html = review();
    expect(html).toContain("crossed out, so not added");
    expect(html).toContain("the mark is unclear");
    expect(html).toContain("hard to read");
  });
});
