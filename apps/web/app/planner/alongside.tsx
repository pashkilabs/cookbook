import Link from "next/link";
import type { Alongside } from "@/lib/alongside";

/**
 * A footnote on the week: what else is worth cooking, and why.
 *
 * **Three lines, never one score.** Each states what it rests on and each may be empty. A single
 * rank mixing exact arithmetic (leftovers), a one-in-five guess (a shared base) and a statistic
 * that needs six ratings to speak (a verdict) produces a number nobody can read — §61's shape,
 * already measured here once.
 *
 * Below the week rather than beside a day, because the cook has already committed: it reads as
 * "and while you're at it" rather than "are you sure". A warning is more forceful than a display
 * and this is a display.
 *
 * **The reason names what is shared**, which is the whole design. Overlap cannot tell a base from
 * a cuisine signature — four of five real firings were a shared spice shelf — so the screen shows
 * `mirin, ginger paste, butter, carrots, mushrooms` and a cook sees in a glance whether that is a
 * thing you cook once. A stated reason makes one-in-five a dismissal; a rank makes it noise.
 */
export function AlongsideThisWeek({
  alongside,
  weekStart,
}: {
  alongside: Alongside;
  weekStart: string;
}) {
  const nothing = alongside.sharesABase.length === 0;

  return (
    <section className="alongside">
      <h2>Alongside this week</h2>

      {alongside.sharesABase.length > 0 ? (
        <>
          <p className="meta">
            Shares enough with something you have planned that one batch might do for both.
            Whether it really is one thing you could cook once is for you to see — the shared
            ingredients are listed so you can tell.
          </p>
          <ul className="ingredients">
            {alongside.sharesABase.map((suggestion) => (
              <li key={suggestion.id}>
                <span>
                  <Link href={`/recipes/${suggestion.id}`}>{suggestion.title}</Link>
                  <span className="meta">
                    {" "}
                    — shares {suggestion.shared.length} with {suggestion.with}:{" "}
                    {suggestion.shared.join(", ")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        // said, not omitted: an absent block is indistinguishable from one that failed to load
        <p className="meta">
          Nothing in your recipes shares a base with this week&rsquo;s meals.
        </p>
      )}

      {/*
        * Leftovers are not recomputed here. The shopping list already works out what is spare
        * after packages are chosen, and suggests what would use it — a second implementation
        * would be a second answer to one question, which is how two parsers came to drift.
        */}
      <p className="meta">
        What a week&rsquo;s shopping leaves spare, and what would use it, is on{" "}
        <Link href={`/shopping?week=${weekStart}`}>the shopping list</Link> — it knows the package
        sizes, so it knows what is actually left over.
      </p>

      {nothing && (
        <p className="meta">
          A shared base gets easier to find as the library grows: the pairs grow with the square
          of the number of recipes, so today is the worst this will be.
        </p>
      )}
    </section>
  );
}
