"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  GESTURE,
  autoScrollVelocity,
  confirmDrop,
  dropTargetAt,
  dwell,
  gestureIntent,
  noDwell,
  type Intent,
  type RowBox,
} from "@/lib/drag-geometry";

/**
 * The browser half of dragging a meal to another day. **No arithmetic lives here.**
 *
 * Everything this file does is read the DOM, start and stop timers, and call the pure functions in
 * `lib/drag-geometry.ts`, which are tested. That split is the point: a gesture that *feels* wrong
 * degrades to the Move select, and a gesture that drops Wednesday's dinner on Thursday writes to
 * the database and changes the shopping list. The second is geometry, and it is tested elsewhere.
 *
 * If you find yourself comparing two numbers in this file, it belongs in the other one.
 *
 * ---------------------------------------------------------------------------
 * The one thing correctness rests on
 * ---------------------------------------------------------------------------
 *
 * `confirmDrop` against a **freshly measured** box, once, at release. Rows are measured in
 * document coordinates at drag start — so scrolling is a no-op rather than an invalidation — but a
 * re-render, a resize or a late font swap genuinely moves them, and the only honest way to know is
 * to look again at the end. One measurement, not seven. When it disagrees, **nothing is written**:
 * a geometry doubt becomes a loud no-op, and the select is still there.
 */

/** what the caller gives us: how to find the rows, and what to do when one is chosen */
export interface DragToDay {
  /** the element for a date, so this can measure it — registered by the row itself */
  register: (date: string, element: HTMLElement | null) => void;
  /** spread onto the draggable element; `onPointerDown` only, the rest is capture */
  handlers: { onPointerDown: (event: React.PointerEvent) => void };
  /** the entry being dragged, or null */
  dragging: string | null;
  /** the date currently settled under the pointer, for the highlight */
  settledOn: string | null;
  /** true once a leftward swipe has committed, for the "to next week" affordance */
  sendingNext: boolean;
}

export function useDragToDay({
  onMoveToDate,
  onSendToNextWeek,
  enabled = true,
}: {
  onMoveToDate: (entryId: string, date: string) => void;
  onSendToNextWeek: (entryId: string) => void;
  enabled?: boolean;
}): DragToDay {
  const rows = useRef(new Map<string, HTMLElement>());
  const [dragging, setDragging] = useState<string | null>(null);
  const [settledOn, setSettledOn] = useState<string | null>(null);
  const [sendingNext, setSendingNext] = useState(false);

  /*
   * A ref, not state. Every value here changes many times per pointer-move and none of them is
   * rendered — putting them in state would re-render the week on every frame of a drag, which is
   * both slow and a way to make rows move while they are being measured.
   */
  const live = useRef<{
    entryId: string;
    pointerId: number;
    startX: number;
    startY: number;
    startedAt: number;
    boxes: RowBox[];
    intent: Intent;
    dwellState: typeof noDwell;
    scroller: number | null;
    hold: number;
  } | null>(null);

  const register = useCallback((date: string, element: HTMLElement | null) => {
    if (element) rows.current.set(date, element);
    else rows.current.delete(date);
  }, []);

  /** the one impure line the geometry cannot have: a client rect, lifted into document space */
  const measure = (element: HTMLElement, date: string): RowBox => {
    const rect = element.getBoundingClientRect();
    return { date, top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY };
  };

  const stop = useCallback(() => {
    const state = live.current;
    if (state) {
      // both, always: a pending hold that outlives its drag promotes a gesture that has ended,
      // and an auto-scroll interval that outlives one scrolls the page forever
      window.clearTimeout(state.hold);
      if (state.scroller !== null) window.clearInterval(state.scroller);
    }
    live.current = null;
    setDragging(null);
    setSettledOn(null);
    setSendingNext(false);
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (!enabled || event.button !== 0) return;
      const element = event.currentTarget as HTMLElement;
      const entryId = element.dataset.entryId;
      if (!entryId) return;

      element.setPointerCapture(event.pointerId);
      live.current = {
        entryId,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startedAt: event.timeStamp,
        /*
         * Measured once, here. `router.refresh()` can land mid-drag and move all of them, which
         * is exactly why the release re-measures the chosen one rather than trusting this.
         */
        boxes: [...rows.current.entries()].map(([date, node]) => measure(node, date)),
        intent: "undecided",
        dwellState: noDwell,
        scroller: null,
        /*
         * A timeout, armed here, rather than a clock compared inside pointermove.
         *
         * The hold must become a drag **with no further movement**: somebody who presses and
         * waits sees nothing until they twitch otherwise, and concludes the gesture does not
         * exist. A first attempt polled `performance.now()` against `event.timeStamp` and got the
         * epoch wrong, which makes a hold fire instantly or never — a timer has no epoch to get
         * wrong.
         */
        hold: window.setTimeout(() => {
          const state = live.current;
          if (!state || state.intent !== "undecided") return;
          state.intent = "drag";
          setDragging(state.entryId);
        }, GESTURE.holdMs),
      };
    },
    [enabled],
  );

  /*
   * Window listeners rather than React props, because a pointer that has been captured keeps
   * sending to the captured element — but a drag that ends outside the document, or on a
   * cancelled touch, only surfaces here. A drag that cannot end is worse than one that cannot
   * start.
   */
  useEffect(() => {
    if (!enabled) return;

    const move = (event: PointerEvent) => {
      const state = live.current;
      if (!state || event.pointerId !== state.pointerId) return;

      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;
      const heldMs = event.timeStamp - state.startedAt;

      if (state.intent === "undecided" || state.intent === "scroll") {
        const next = gestureIntent({ dx, dy, heldMs });
        // once it is a scroll it stays a scroll: a list that steals a scroll is unusable in a way
        // nobody can report precisely
        if (state.intent === "scroll") return;
        state.intent = next;
        if (next === "drag") setDragging(state.entryId);
        if (next === "next-week") setSendingNext(true);
        if (next !== "drag") return;
      }

      if (state.intent === "next-week") return;

      // `touch-action: none` on the handle is what lets this take effect; without it the browser
      // has already decided the gesture is a scroll and this does nothing visible
      event.preventDefault();

      const docY = event.clientY + window.scrollY;
      const over = dropTargetAt(docY, state.boxes);
      const dwelled = dwell(state.dwellState, over?.date ?? null, event.timeStamp);
      if (dwelled.settled !== state.dwellState.settled) {
        setSettledOn(dwelled.settled);
        // a short tick where it exists; silence where it does not, never a claim either way
        if (dwelled.settled && typeof navigator.vibrate === "function") navigator.vibrate(8);
      }
      state.dwellState = dwelled;

      const velocity = autoScrollVelocity(event.clientY, window.innerHeight);
      if (velocity === 0 && state.scroller !== null) {
        window.clearInterval(state.scroller);
        state.scroller = null;
      } else if (velocity !== 0 && state.scroller === null) {
        state.scroller = window.setInterval(() => {
          const by = live.current?.intent === "drag" ? velocity : 0;
          if (by !== 0) window.scrollBy(0, by);
        }, 16);
      }
    };

    const up = (event: PointerEvent) => {
      const state = live.current;
      if (!state || event.pointerId !== state.pointerId) return;
      const { entryId, intent, dwellState, boxes } = state;
      stop();

      if (intent === "next-week") {
        onSendToNextWeek(entryId);
        return;
      }
      if (intent !== "drag") return;

      /*
       * The chosen day: the settled one if there is one, otherwise whatever is under the pointer
       * at release. A settle is a stronger signal than a position — somebody who paused over
       * Thursday meant Thursday even if their thumb slid 3px on the way up.
       */
      const docY = event.clientY + window.scrollY;
      const chosen = dwellState.settled ?? dropTargetAt(docY, boxes)?.date ?? null;
      if (chosen === null) return;

      /*
       * **Confirm against a fresh measurement, and write nothing if it disagrees.**
       *
       * The whole staleness answer, in four lines. If the row has moved since the drag began, the
       * old boxes still say "Thursday" and the pointer is now somewhere else — so this asks the
       * DOM again, about one row, and declines rather than guessing. Declining is a no-op the
       * person can see and retry; guessing is a meal on the wrong day with a success message.
       */
      const node = rows.current.get(chosen);
      if (!node) return;
      if (!confirmDrop(docY, measure(node, chosen), 0.5)) return;

      onMoveToDate(entryId, chosen);
    };

    const cancel = () => stop();

    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    // a drag interrupted by anything the pointer events do not report — a tab switch, a context
    // menu, the OS taking over — must end rather than wait forever holding a captured pointer
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      stop();
    };
  }, [enabled, onMoveToDate, onSendToNextWeek, stop]);


  return { register, handlers: { onPointerDown }, dragging, settledOn, sendingNext };
}
