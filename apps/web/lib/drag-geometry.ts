/**
 * The arithmetic behind dragging a planned meal to another day — and none of the browser.
 *
 * ---------------------------------------------------------------------------
 * NOTHING CALLS THIS, and that is deliberate. Do not delete it.
 * ---------------------------------------------------------------------------
 *
 * The gesture it was written for was **attempted and withdrawn** (decisions §81): it failed twice
 * on the phone it was for, the second time by selecting text on a handle that carried
 * `touch-action: none`, `-webkit-touch-callout: none` and `user-select: none` — all four verified
 * served, on the right node, in production. Safari in an in-app browser claims a long-press before
 * the page sees it, and every web defence against that is advisory.
 *
 * What is below is 29 tests of correct, framework-free arithmetic with no DOM in it. If a native
 * app ever exists, the gesture belongs there — where the platform does not fight it — and this is
 * the half that will not need rewriting. Deleting it would throw away the part that worked
 * because the part that could not work was removed.
 *
 * Every function here is pure and over numbers. That split is deliberate: a gesture that *feels*
 * wrong degrades to the Move select and somebody shrugs, but a gesture that drops Wednesday's
 * dinner on Thursday writes to the database, changes the shopping list, and reports success. The
 * first is a feel problem and belongs to whoever's thumb it is. The second is geometry, and
 * geometry can be tested.
 *
 * ---------------------------------------------------------------------------
 * The stale-rect problem, and why re-measuring on scroll is the wrong answer
 * ---------------------------------------------------------------------------
 *
 * `dropTargetAt` answers correctly about the rectangles it is given. If the layout moved after
 * those were measured, it answers correctly about a layout that no longer exists — and **no test
 * of it can catch that**, because the input was already wrong. This is the one failure that
 * writes a meal to the wrong day with everything reporting success, so it gets a decision rather
 * than a mitigation.
 *
 * There are four causes and they do not want the same answer:
 *
 *   scroll          the container moves under the pointer
 *   re-render       `router.refresh()`, a row opening, an image loading, a sibling changing
 *   resize          an orientation change, a keyboard appearing
 *   font swap       Fraunces arriving late and changing every row's height
 *
 * **Scroll is not a staleness problem at all — it is a coordinate-space problem.** A
 * `getBoundingClientRect` is viewport-relative, so scrolling changes every number while the
 * layout is identical. Re-measuring on scroll "fixes" that by recomputing the same geometry in a
 * new frame of reference, every frame, while dragging. Working in **document coordinates**
 * (`rect.top + scrollY`, and `clientY + scrollY` for the pointer) makes scroll a no-op instead:
 * cheaper, exact, and nothing to get wrong. So the answer to scroll is arithmetic, not listening.
 *
 * The other three genuinely change the geometry, and no coordinate space saves you. Invalidating
 * the drag on re-render would work and is too blunt: React re-renders for reasons that change no
 * layout at all, so a legitimate drag would abort often enough to teach people to use the select
 * — which is the gesture failing in the way that looks like the gesture being bad.
 *
 * **So the mechanism is confirm-at-drop.** At the moment of release, re-measure the *one* row the
 * drop is believed to be over and check the pointer is still inside it (`confirmDrop`). One
 * measurement, not seven. It catches every cause including ones not listed, because it compares
 * against the actual final state rather than predicting what might have moved. And when it
 * disagrees, nothing is written: the meal stays where it was and the select is still there.
 *
 * That is the asymmetry made structural — **a geometry doubt is converted into a loud no-op.**
 * Live re-measurement during the drag is still worth doing for the highlight, but it is a
 * *feedback* nicety and must never be the thing correctness rests on.
 */

/** a day's row, in document coordinates — `top`/`bottom` are `rect.top + scrollY` and so on */
export interface RowBox {
  /** the ISO date this row is for, which is what a drop ultimately writes */
  date: string;
  top: number;
  bottom: number;
}

/**
 * Which row a document-space Y lands on, or null.
 *
 * **Gaps belong to nobody.** Rows are separated by 8px of margin, and a release in a gap is
 * genuinely ambiguous: the pointer is not over a day. Snapping to the nearest would make the
 * common near-miss silently pick a side, and picking a side is exactly the failure that matters
 * here — so a gap is null and a null is a no-op. The same for above the first row and below the
 * last: somebody dragging off the top of the list has not chosen Sunday.
 *
 * `top` is inclusive and `bottom` exclusive, so two rows that share an edge cannot both claim a
 * pixel. Rows are not assumed sorted or equal in height — one open row is 200px tall beside six
 * 72px ones, which is the normal state of this screen rather than an edge case.
 */
export function dropTargetAt(y: number, rows: readonly RowBox[]): RowBox | null {
  for (const row of rows) {
    if (y >= row.top && y < row.bottom) return row;
  }
  return null;
}

/**
 * Is the pointer still inside the row we think it is over?
 *
 * The staleness answer, called once at release against a **freshly measured** box. Pure, so the
 * arithmetic is testable; the one impure line is the caller's `getBoundingClientRect`.
 *
 * `tolerance` is 0 by default and exists for the sub-pixel case: a row at `top: 100.4` measured
 * twice in different frames can differ in the last decimal, and failing a correct drop for a
 * tenth of a pixel is a loud no-op nobody can explain. It must stay small enough that it cannot
 * reach a neighbouring row — anything at or above half the row gap is a bug.
 */
export function confirmDrop(y: number, fresh: RowBox, tolerance = 0): boolean {
  return y >= fresh.top - tolerance && y < fresh.bottom + tolerance;
}

export interface GestureConfig {
  /** how long a press must be held, with no real movement, before it becomes a drag */
  holdMs: number;
  /** movement during the hold that means "this was a scroll, not a press" */
  slopPx: number;
  /** how far past the slop a committed gesture must go before its direction is believed */
  directionPx: number;
}

export const GESTURE: GestureConfig = {
  // 350ms: long enough that a tap on the row (which opens it) is never mistaken for a hold, and
  // short enough that nobody concludes nothing happened. Below ~250 the two collide.
  holdMs: 350,
  // 8px: a thumb is not still. Under about 6 a press on a moving bus never survives the hold;
  // over about 12 a deliberate small scroll gets eaten.
  slopPx: 8,
  directionPx: 16,
};

export type Intent = "undecided" | "scroll" | "drag" | "next-week";

/**
 * What the pointer is doing — the long-press-versus-scroll decision and the direction split, as
 * one function over numbers.
 *
 * Two separate questions, in order, and conflating them is the usual bug:
 *
 *   1. **Has this become a gesture at all?** Movement beyond `slopPx` *before* `holdMs` is the
 *      page being scrolled and must stay that way — a list that steals a scroll is unusable, and
 *      it is unusable in a way the user cannot report precisely. Before the hold elapses with no
 *      movement, the answer is `undecided`, never `drag`: committing early is what makes a list
 *      feel like it grabs.
 *   2. **Which gesture?** Once held, direction decides: mostly-vertical is a move between days,
 *      mostly-horizontal and leftward is "send it to next week". Compared by **absolute
 *      magnitude** rather than by an angle in degrees — `Math.abs(dx) > Math.abs(dy)` is the 45°
 *      split exactly, with no trigonometry to get wrong and no units to confuse.
 *
 * A leftward swipe only counts leftward. Rightward is nothing: there is no "last week" in
 * Stephen's proposal, and inventing one from a mirror image would be a control nobody asked for
 * that writes to the plan.
 */
export function gestureIntent(
  move: { dx: number; dy: number; heldMs: number },
  config: GestureConfig = GESTURE,
): Intent {
  const { dx, dy, heldMs } = move;
  const moved = Math.max(Math.abs(dx), Math.abs(dy));

  // scrolling wins before the hold completes, and once it wins it keeps winning
  if (heldMs < config.holdMs) return moved > config.slopPx ? "scroll" : "undecided";

  if (moved <= config.directionPx) return "undecided";
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "next-week" : "undecided";
  return "drag";
}

export interface DwellState {
  /** the date currently being dwelled over, or null */
  over: string | null;
  /** when the pointer arrived over `over` */
  since: number;
  /** the date that has been dwelled over long enough to count as chosen */
  settled: string | null;
}

export const DWELL_MS = 400;

export const noDwell: DwellState = { over: null, since: 0, settled: null };

/**
 * "Pause over a day to settle", as a transition table rather than a nest of timers.
 *
 * A reducer because the timer version of this is where the bugs live: a pending `setTimeout` that
 * outlives the row it was about, a dwell that survives the pointer leaving, a settle that fires
 * after the drop. Here the only state is *where* and *since when*, and settling is a comparison
 * against a clock the caller passes in — so the whole behaviour is reachable from a test without
 * waiting for real time to pass.
 *
 * Moving to a different row **restarts** the clock, and moving off every row clears the settle.
 * A settle that survived the pointer wandering away would be the dwell equivalent of a stale
 * rect: a true answer about a moment that has gone.
 */
export function dwell(state: DwellState, over: string | null, now: number): DwellState {
  if (over === null) return { over: null, since: now, settled: null };
  if (state.over !== over) return { over, since: now, settled: null };
  if (state.settled === over) return state;
  return now - state.since >= DWELL_MS ? { over, since: state.since, settled: over } : state;
}

/**
 * How fast to scroll when dragging near an edge, in pixels per frame.
 *
 * Seven day rows do not fit on a phone, so a drag from Sunday to Saturday has to move the list.
 * Ramped rather than constant — proportional to how far into the hot zone the pointer is — because
 * a constant jump makes the target overshoot and a drag that cannot be aimed is worse than no
 * drag. Returns a signed number: negative scrolls up.
 *
 * In **viewport** coordinates, unlike everything else here, because a hot zone is about the edge
 * of the screen rather than a position in the document.
 */
export function autoScrollVelocity(
  clientY: number,
  viewportHeight: number,
  { zone = 80, max = 14 }: { zone?: number; max?: number } = {},
): number {
  if (clientY < zone) {
    const depth = Math.min(zone, zone - clientY);
    return -Math.round((depth / zone) * max);
  }
  const fromBottom = viewportHeight - clientY;
  if (fromBottom < zone) {
    const depth = Math.min(zone, zone - fromBottom);
    return Math.round((depth / zone) * max);
  }
  return 0;
}
