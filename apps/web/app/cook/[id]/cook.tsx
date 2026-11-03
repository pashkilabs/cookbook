"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWakeLock } from "@/lib/use-wake-lock";

export interface CookLine {
  id: string;
  measure: string | null;
  item: string;
  note: string | null;
  section: string | null;
}

/**
 * The screen somebody stands in front of with wet hands.
 *
 * Step state is local rather than in the route, because a server round-trip per tap is the one
 * thing this screen cannot afford — six taps through a method should be instant. It is mirrored
 * into the URL with `replaceState` so a reload resumes where the cooking got to, and
 * **deliberately not** `pushState`: adding six history entries would mean six back-presses to
 * leave, and an accidental swipe mid-recipe should exit rather than rewind one step.
 */
export function CookMode({
  title,
  href,
  steps,
  lines,
  servings,
}: {
  title: string;
  href: string;
  steps: string[];
  lines: CookLine[];
  servings: number | null;
}) {
  const [at, setAt] = useState(() => {
    if (typeof window === "undefined") return 0;
    const asked = Number(new URLSearchParams(window.location.search).get("step"));
    // 1-indexed in the URL because that is what the screen says; clamped, since a URL is typed
    return Number.isFinite(asked) && asked >= 1 ? Math.min(asked, Math.max(steps.length, 1)) - 1 : 0;
  });

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("step", String(at + 1));
    window.history.replaceState(null, "", url);
  }, [at]);

  /*
   * ---------------------------------------------------------------------------
   * "Screen on" reports the lock, never the request
   * ---------------------------------------------------------------------------
   *
   * §4.3 asks for a "Screen on" indicator that keeps the screen awake, and the badge below renders
   * only on a lock that is actually **held** — not on the request having been made. A badge over a
   * phone that is about to sleep is a claim the person cannot check and the app has not verified.
   *
   * **No control here, and that is the design.** Hands are busy; the screen staying lit is the
   * whole point of cook mode, so wanting it is not a question worth asking. The recipe page gets a
   * toggle instead, because reading is not always cooking.
   *
   * The sentinel, the `visibilitychange` re-acquisition and the release all live in
   * `useWakeLock` — shared with the recipe page's toggle, so a fix reaches both. This screen had
   * its own copy of all of it, which was correct and was a second site.
   */
  const screen = useWakeLock(true);

  /*
   * A recipe with no method still opens.
   *
   * It is a real state — plenty of imports carry ingredients and no steps, and §4.3's screen has
   * nothing to show for one. Saying so beats an empty 56px numeral over blank space, and the
   * ingredient list below is still worth standing in front of.
   */
  const total = steps.length;
  const text = steps[at] ?? null;

  const groups: Array<{ heading: string | null; lines: CookLine[] }> = [];
  for (const line of lines) {
    const last = groups[groups.length - 1];
    if (last && last.heading === line.section) last.lines.push(line);
    else groups.push({ heading: line.section, lines: [line] });
  }

  return (
    <div className="h-cook">
      <header className="h-cook-head">
        <div>
          <p className="h-eyebrow">Cook mode</p>
          <h1 className="h-cook-title">{title}</h1>
        </div>
        <div className="h-cook-head-right">
          {screen === "holding" && (
            <span className="h-cook-awake">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="4" fill="currentColor" />
                <path
                  d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              Screen on
            </span>
          )}
          <Link href={href} className="h-cook-close" aria-label={`Close cook mode and go back to ${title}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </Link>
        </div>
      </header>

      {total > 0 && (
        <div className="h-cook-progress">
          {/*
           * The bar is decoration and the sentence is the fact, so the bar is `aria-hidden` and
           * "Step 2 of 6" is read. One control, one name — the same reasoning `DayCircle` carries.
           */}
          <div className="h-cook-bars" aria-hidden="true">
            {steps.map((_, index) => (
              <span key={index} className={index <= at ? "is-done" : undefined} />
            ))}
          </div>
          <p className="h-cook-count" aria-live="polite">
            Step {at + 1} of {total}
            {servings !== null && <span className="h-cook-servings"> · for {servings}</span>}
          </p>
        </div>
      )}

      {/*
        * A refusal says so, which reverses an earlier call in this file.
        *
        * It read "refused — a low battery, or a policy. Not an error worth a message on a cooking
        * screen", and silence was the honest half: the badge correctly did not appear. But the
        * three states have to be *visibly distinct*, and "nothing" cannot separate a browser that
        * cannot do this from one that would not — and the cost of not knowing is highest exactly
        * here, over a pan, with the screen about to go dark.
        *
        * Here rather than beside the close control, where the badge is: the first version put it
        * in the header corner and the screenshot settled it — five words wrapped to three lines
        * and squeezed a 44px target. A badge is two words and a sentence is a sentence; they do
        * not belong in the same slot. And outside the progress block, because a recipe with no
        * method still opens and its screen still dims.
        *
        * `unsupported` renders nothing at all. There is no decision to report to somebody whose
        * browser has no such feature, and iOS Safari has had one since 16.4.
        */}
      {screen === "refused" && (
        <p className="h-cook-asleep">This browser would not keep the screen on.</p>
      )}

      <main className="h-cook-step">
        {text === null ? (
          <p className="h-cook-nosteps">
            This recipe has no method saved — the ingredients are below.{" "}
            <Link href={href}>Add the steps</Link> and they will show here.
          </p>
        ) : (
          <>
            <p className="h-cook-number" aria-hidden="true">
              {at + 1}
            </p>
            <p className="h-cook-text">{text}</p>
          </>
        )}

        {/*
         * The whole list, said plainly — see the page's header for why there is no per-step card.
         */}
        {lines.length > 0 && (
          <section className="h-cook-ingredients">
            <p className="h-eyebrow">All ingredients</p>
            {groups.map((group, index) => (
              <div key={group.heading ?? index}>
                {group.heading && <p className="h-cook-section">{group.heading}</p>}
                <ul>
                  {group.lines.map((line) => (
                    <li key={line.id}>
                      <span>
                        {line.item}
                        {line.note && <span className="h-cook-note"> — {line.note}</span>}
                      </span>
                      {line.measure && <strong>{line.measure}</strong>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )}
      </main>

      {total > 0 && (
        <nav className="h-cook-nav">
          <button
            type="button"
            className="h-cook-back"
            onClick={() => setAt((was) => Math.max(0, was - 1))}
            disabled={at === 0}
          >
            Back
          </button>
          {at + 1 < total ? (
            <button type="button" className="h-cook-next" onClick={() => setAt((was) => was + 1)}>
              Next step
            </button>
          ) : (
            /*
             * The last step ends the screen rather than dead-ending it.
             *
             * It goes back to the recipe, where "Cook it tonight" records that it happened — this
             * screen does not write anything, because a person reaching the last step has not
             * necessarily finished and a screen must not decide that for them.
             */
            <Link href={href} className="h-cook-next">
              Done
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
