// @vitest-environment jsdom
//
// Opted in per-file rather than globally: every other test here runs in node, and several assert
// on `renderToStaticMarkup`. A jsdom default would change the environment of twenty files to add
// one.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

/*
 * `act` around every click, not because the assertions need it — they pass either way — but
 * because an unwrapped update logs a warning per test, and a suite that prints warnings on a
 * green run is a suite whose next real warning nobody reads. Noise is how a signal gets lost.
 */
const click = async (element: HTMLElement) => {
  await act(async () => {
    element.click();
  });
};
import { Cooked } from "../app/planner/cooked";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const MEMBERS = [
  { id: "ada", displayName: "Ada", score: null },
  { id: "paige", displayName: "Paige", score: null },
];

/**
 * regression: marking a meal cooked must open the scores.
 *
 * ---------------------------------------------------------------------------
 * Why this test exists, which is a different question from what it asserts
 * ---------------------------------------------------------------------------
 *
 * This behaviour was a single line — `setOpen(cooked)` inside the write's success path — and it
 * was there because of a measurement: **two ratings against twenty-eight planned dinners**, when
 * rating lived anywhere other than the evening the meal was cooked. The moment a household knows
 * something was cooked is the evening it was cooked, and that is the only moment the scores are
 * cheap to collect.
 *
 * When the row took over the disclosure state, `setOpen` ceased to exist and that line became a
 * compile error. It survived because `tsc` objected — not because anything asserted it. The easy
 * resolution was to delete the line, which would have silently given back everything the
 * measurement bought, with every test still green and nothing on screen looking wrong.
 *
 * **A measured behaviour defended only by a type error is one refactor from gone.** The next
 * change that moves this state somewhere else — into a URL, into a reducer, into a server action
 * — will not produce a compile error, because it will have somewhere plausible to put the call.
 * So the assertion is about the *notification*, not about the line.
 */
describe("marking a meal cooked", () => {
  const ok = () => vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));

  it("asks the row to open, so the scores are in front of somebody while it is still tonight", async () => {
    ok();
    const opened: boolean[] = [];
    render(
      <Cooked
        entryId="e1"
        familyId="f1"
        recipeId="r1"
        cookedAt={null}
        members={MEMBERS}
        parts={[]}
        disabled={false}
        onCooked={(cooked) => opened.push(cooked)}
      />,
    );
    await click(screen.getByRole("button", { name: /cooked it/i }));
    await waitFor(() => expect(opened).toEqual([true]));
  });

  it("asks the row to close when the mark is undone, because the scores are about a meal that happened", async () => {
    ok();
    const opened: boolean[] = [];
    render(
      <Cooked
        entryId="e1"
        familyId="f1"
        recipeId="r1"
        cookedAt="2026-10-14T18:00:00Z"
        members={MEMBERS}
        parts={[]}
        disabled={false}
        onCooked={(cooked) => opened.push(cooked)}
      />,
    );
    await click(screen.getByRole("button", { name: /cooked/i }));
    await waitFor(() => expect(opened).toEqual([false]));
  });

  it("does not ask the row to open when the write is refused", async () => {
    // a household with no entitlement gets a refusal, and opening a score grid for a meal that
    // was not recorded would be the app agreeing with itself about something that did not happen
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "read-only" }), { status: 403 })),
    );
    const opened: boolean[] = [];
    render(
      <Cooked
        entryId="e1"
        familyId="f1"
        recipeId="r1"
        cookedAt={null}
        members={MEMBERS}
        parts={[]}
        disabled={false}
        onCooked={(cooked) => opened.push(cooked)}
      />,
    );
    await click(screen.getByRole("button", { name: /cooked it/i }));
    await waitFor(() => expect(screen.getByText(/read-only/i)).toBeTruthy());
    expect(opened).toEqual([]);
  });

  it("does not ask the row to open when there is no signal", async () => {
    // an offline fetch REJECTS rather than returning, which is the shape that once left every
    // control on the shopping list permanently disabled
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const opened: boolean[] = [];
    render(
      <Cooked entryId="e1" familyId="f1" recipeId="r1" cookedAt={null} members={MEMBERS} parts={[]} disabled={false}
        onCooked={(cooked) => opened.push(cooked)} />,
    );
    const button = screen.getByRole("button", { name: /cooked it/i });
    await click(button);
    // and the control must come back: `finally` is what stops one bad tap killing the screen
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(opened).toEqual([]);
  });
});

describe("the row at rest versus expanded", () => {
  it("shows the score grid only when the row is open", () => {
    const props = {
      entryId: "e1", familyId: "f1", recipeId: "r1",
      cookedAt: "2026-10-14T18:00:00Z", members: MEMBERS, parts: [], disabled: false,
    };
    const { unmount } = render(<Cooked {...props} expanded={false} />);
    // five buttons per member is what crushed the day row — at rest there must be none
    expect(screen.queryByRole("button", { name: /Ada: 1 of 5/i })).toBeNull();
    expect(screen.getByText(/who liked it/i)).toBeTruthy();
    unmount();

    render(<Cooked {...props} expanded />);
    expect(screen.getByRole("button", { name: /Ada: 1 of 5/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Paige: 5 of 5/i })).toBeTruthy();
  });

  it("keeps the mark visible in both states, because that is the half that must not move", () => {
    const props = {
      entryId: "e1", familyId: "f1", recipeId: "r1",
      members: MEMBERS, parts: [], disabled: false,
    };
    const { unmount } = render(<Cooked {...props} cookedAt={null} expanded={false} />);
    expect(screen.getByRole("button", { name: /cooked it/i })).toBeTruthy();
    unmount();
    render(<Cooked {...props} cookedAt="2026-10-14T18:00:00Z" expanded={false} />);
    expect(screen.getByRole("button", { name: /^Cooked$/i })).toBeTruthy();
  });
});
