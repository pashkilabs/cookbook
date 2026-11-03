"use client";

import { useEffect, useState } from "react";
import { readKeepAwake, useWakeLock, writeKeepAwake } from "@/lib/use-wake-lock";

/**
 * Keep the screen awake while this recipe is open — a toggle, default off.
 *
 * **Off by default, because reading is not always cooking.** Cook mode takes the lock without
 * asking: hands are busy and the lit screen is the whole point of that screen. A recipe page is
 * also where somebody decides what to make on Thursday, and holding the screen on for that is the
 * app spending a stranger's battery on a guess.
 *
 * **Per device, in `localStorage`.** A wake lock is a property of the phone on the counter, not of
 * the person — the same account on a laptop wants a different answer, so `member_settings` is the
 * wrong home even though it is where "how you read the recipe book" lives. The useful consequence
 * is that this feature touches no table: no entitlement, no RLS policy, no migration, and nothing
 * for a household with no subscription to be refused.
 *
 * **Nothing renders where the browser has no `wakeLock`.** A dead control that cannot do anything
 * is worse than no control, and a toggle whose only outcome is an apology is a dead control.
 */
export function KeepAwake() {
  /*
   * `false` on the first render, always, and then whatever the device remembers.
   *
   * `localStorage` does not exist during server rendering, so reading it in the initialiser would
   * make the server's HTML and the client's first render disagree. Reading it in an effect costs
   * one frame of the control looking off when it is on, which is the cheaper of the two.
   */
  const [on, setOn] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setOn(readKeepAwake());
    setReady(true);
  }, []);

  const screen = useWakeLock(on);

  /*
   * The state reported is the sentinel's, which is why this is not simply `on`.
   *
   * A person taps the toggle, the browser refuses, and a control that showed its own `on` would
   * say the screen is staying lit while the phone dims — §78's fault written fresh. So the words
   * follow `screen`, and `refused` is said plainly rather than left to be discovered.
   */
  if (screen === "unsupported") return null;

  const toggle = () => {
    const next = !on;
    setOn(next);
    writeKeepAwake(next);
  };

  return (
    <div className="keep-awake">
      <button
        type="button"
        className="button quiet"
        aria-pressed={screen === "holding"}
        onClick={toggle}
        /* until the stored preference has been read, the label would be a guess */
        disabled={!ready}
      >
        {screen === "holding" ? "Screen staying on" : "Keep the screen on"}
      </button>
      {on && screen === "refused" && (
        <p className="meta">This browser would not keep the screen on.</p>
      )}
    </div>
  );
}
