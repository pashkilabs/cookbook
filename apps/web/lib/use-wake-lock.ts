"use client";

import { useEffect, useState } from "react";

/**
 * Keep the screen awake, and report what is actually true.
 *
 * ---------------------------------------------------------------------------
 * One hook, two screens, because a second implementation is a second bug
 * ---------------------------------------------------------------------------
 *
 * Cook mode has held a real lock since §4.3 and the recipe page now offers a toggle. Those are
 * different *policies* — automatic against opt-in — over one piece of behaviour, and this project
 * has already paid for the alternative: the eval and the product built their model cascades in
 * separate places, so wiring a provider into one verified nothing about the other. The policy is
 * the caller's (`wanted`); the sentinel is here.
 *
 * ---------------------------------------------------------------------------
 * The sentinel is released when the document becomes hidden, and does not come back
 * ---------------------------------------------------------------------------
 *
 * This is the whole of the feature's difficulty. Switch apps, take a call, lock the phone by hand —
 * the browser releases the lock, and returning to the tab does **not** restore it. An
 * implementation without the `visibilitychange` re-acquisition works for exactly as long as nobody
 * touches the phone, which is the scenario the feature exists for.
 *
 * So: re-request on `visibilitychange` when the document is visible and the lock is still wanted,
 * and only when one is not already held. A request while hidden is refused with `NotAllowedError`,
 * which is why the visibility guard is a guard and not an optimisation.
 *
 * ---------------------------------------------------------------------------
 * The state is the sentinel's, never the request's
 * ---------------------------------------------------------------------------
 *
 * `"holding"` means a lock is held *now*. Not "we asked", not "the browser supports it". A badge
 * reading "Screen on" above a phone that is about to sleep is a claim the person cannot check and
 * the app has not verified — §78's fault, and the reason `refused` is a state of its own rather
 * than folded into "not holding".
 *
 * `"unsupported"` is separated from `"refused"` for the caller's sake: there is no point offering a
 * control that cannot do anything, and "this browser can't" and "this browser wouldn't" want
 * different words. iOS Safari has had it since 16.4, Firefox since 126, Chrome and Edge for years —
 * so `unsupported` is a shrinking case and still a real one. Android's battery saver refuses, which
 * is `refused` on a browser that supports it perfectly.
 *
 * **No `NoSleep.js` and no hidden-video fallback.** It loops a video to fool the OS, costs battery,
 * and is a maintenance burden for a shrinking set of browsers. An honest "this browser can't" beats
 * a hack that drains the phone it is meant to help.
 */
export type WakeState =
  /** `navigator.wakeLock` is absent — do not offer a control */
  | "unsupported"
  /** supported, and no lock wanted or held */
  | "idle"
  /** a lock is held right now */
  | "holding"
  /** asked and was told no — a policy, a battery saver, a hidden document */
  | "refused";

/** `navigator.wakeLock` without a DOM-lib assumption, since `WakeLockSentinel` is not everywhere. */
interface Sentinel {
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
  removeEventListener(type: "release", listener: () => void): void;
}

function supported(): boolean {
  return typeof navigator !== "undefined" && "wakeLock" in navigator;
}

export function useWakeLock(wanted: boolean): WakeState {
  const [state, setState] = useState<WakeState>("idle");

  useEffect(() => {
    if (!supported()) {
      setState("unsupported");
      return;
    }
    if (!wanted) {
      setState("idle");
      return;
    }

    /*
     * `live` rather than a ref, because a request in flight outlives the effect that started it.
     * A person who opens cook mode and leaves within the round trip would otherwise get a lock
     * acquired after unmount and never released — the browser keeps the screen on for a page
     * nobody is looking at. So the resolution path checks whether it still matters, and releases
     * what it was handed if it does not.
     */
    let live = true;
    let held: Sentinel | null = null;
    let onRelease: (() => void) | null = null;

    const drop = () => {
      if (held && onRelease) held.removeEventListener("release", onRelease);
      void held?.release().catch(() => {
        // releasing a lock the browser has already taken back is not a failure worth reporting
      });
      held = null;
      onRelease = null;
    };

    const hold = async () => {
      if (!live || held) return;
      try {
        const api = (navigator as Navigator & { wakeLock: { request(kind: "screen"): Promise<Sentinel> } })
          .wakeLock;
        const sentinel = await api.request("screen");
        if (!live) {
          // acquired after the caller stopped wanting it
          void sentinel.release().catch(() => {});
          return;
        }
        held = sentinel;
        /*
         * The sentinel's own event, so the state follows reality rather than our last intention.
         * It fires both when the browser revokes the lock (the tab went away) and when we release
         * it ourselves, and neither is a refusal — the person asked and got one. `idle` is the
         * honest reading of "not held, nothing was denied".
         */
        onRelease = () => {
          held = null;
          if (live) setState("idle");
        };
        sentinel.addEventListener("release", onRelease);
        setState("holding");
      } catch {
        /*
         * `NotAllowedError` on a hidden document or a browser that refuses; Android's battery saver
         * refuses too. Reported rather than swallowed: the caller decides whether to say it, and a
         * caller that cannot tell "refused" from "idle" would show a dead control.
         */
        if (live) setState("refused");
      }
    };

    const revisit = () => {
      if (document.visibilityState === "visible" && !held) void hold();
    };

    void hold();
    document.addEventListener("visibilitychange", revisit);

    return () => {
      live = false;
      document.removeEventListener("visibilitychange", revisit);
      drop();
    };
  }, [wanted]);

  return state;
}

/**
 * Whether this device should keep the screen awake while a recipe is open.
 *
 * **Per device, not per member, and deliberately.** A wake lock is a property of the phone on the
 * counter: the same account on a laptop wants a different answer, so a household-scoped or
 * member-scoped column would be the wrong shape — `member_settings` carries how somebody *browses*,
 * which really is theirs wherever they are. This also keeps the feature off the write path
 * entirely, so it needs no entitlement, no RLS policy and no migration.
 *
 * `localStorage` can throw outright in a private window or with site data blocked, and can return
 * nothing when it is simply empty. Both read as "off", which is the default anyway — so the failure
 * mode is the feature not persisting rather than the screen not rendering.
 */
const KEY = "pashki.keep-awake";

export function readKeepAwake(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

export function writeKeepAwake(on: boolean): void {
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // a preference that cannot be stored is a preference that lasts this visit
  }
}
