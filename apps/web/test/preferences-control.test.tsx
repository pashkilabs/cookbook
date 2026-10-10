import { describe, expect, it, vi } from "vitest";

// the component calls useRouter() for its refresh-after-write; a static render has no app router
// mounted, and the refresh is not what this is asking about
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
import { renderToStaticMarkup } from "react-dom/server";
import { Preferences, type StatedSoFar } from "../app/recipes/[id]/preferences";

/**
 * The control that let a second member's opinion overwrite the first.
 *
 * Reported as "rice noodles disappeared". No reproduction was available — smoke says two members
 * can disagree, and they can — so this chases the mechanism in the component instead, which is
 * where it was always observable: **the member dropdown did not advance.** After Ada said she
 * liked something, the obvious next click stated it for Ada again, and the route found her row
 * and flipped it. One statement where two were intended, and the subject looked spent.
 *
 * `renderToStaticMarkup` sees the *initial* render, which is exactly the question: who does the
 * control default to, given what has already been said?
 */
const MEMBERS = [
  { id: "ada", displayName: "Ada" },
  { id: "paige", displayName: "Paige" },
];
const SUBJECTS = [
  { kind: "ingredient", value: "rice noodles", label: "rice noodles" },
  { kind: "ingredient", value: "lemons", label: "lemons" },
];
const stated = (over: Partial<StatedSoFar> = {}): StatedSoFar => ({
  id: "p1", memberId: "ada", memberName: "Ada", stance: "like",
  subject: "rice noodles", subjectKind: "ingredient", ...over,
});

const render = (stated: StatedSoFar[]) =>
  renderToStaticMarkup(<Preferences members={MEMBERS} subjects={SUBJECTS} stated={stated} />);

/** which option the select marks as chosen in server output */
const selectedMember = (html: string) => {
  const section = html.slice(0, html.indexOf("ingredient:"));
  const found = /<option[^>]*selected[^>]*value="([^"]+)"|<option[^>]*value="([^"]+)"[^>]*selected/.exec(section);
  return found?.[1] ?? found?.[2] ?? null;
};

describe("who the control offers to speak next", () => {
  it("defaults to the first member when nobody has spoken", () => {
    expect(selectedMember(render([]))).toBe("ada");
  });

  // regression: this defaulted to members[0] forever, so the obvious second click restated the
  // subject for the person who had already spoken and the route flipped their stance
  it("advances to the member who has NOT spoken about the selected subject", () => {
    expect(selectedMember(render([stated()]))).toBe("paige");
  });

  it("stays on a member who has spoken about a DIFFERENT subject", () => {
    // Ada has an opinion about lemons; rice noodles is still open to her
    expect(selectedMember(render([stated({ subject: "lemons" })]))).toBe("ada");
  });

  it("falls back to the roster once everyone has spoken, so a mind can still be changed", () => {
    const html = render([stated(), stated({ id: "p2", memberId: "paige", memberName: "Paige", stance: "dislike" })]);
    expect(selectedMember(html)).toBe("ada");
    expect(html).toContain("Everyone has said something about this one");
  });
});

describe("what the row shows when two members disagree", () => {
  const both = [
    stated(),
    stated({ id: "p2", memberId: "paige", memberName: "Paige", stance: "dislike" }),
  ];

  it("groups them into one sentence naming both", () => {
    const html = render(both);
    // "rice noodles — Ada likes it, Paige does not" rather than two unrelated lines
    expect(html).toContain("Ada likes it");
    expect(html).toContain("Paige does not");
    expect((html.match(/<li>/g) ?? []).length).toBe(1);
  });

  it("says a disagreement out loud rather than averaging it away", () => {
    expect(render(both)).toContain("a disagreement");
  });

  it("keeps the subject in the select, so a third member could still speak", () => {
    expect(render(both)).toContain('value="ingredient:rice noodles"');
  });

  it("offers a withdrawal per person, not per subject", () => {
    const html = render(both);
    expect(html).toContain("withdraw Ada&#x27;s opinion of rice noodles");
    expect(html).toContain("withdraw Paige&#x27;s opinion of rice noodles");
  });
});
