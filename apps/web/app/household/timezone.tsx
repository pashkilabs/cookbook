"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * What day it is where the household cooks.
 *
 * A household setting, like the units, and for the same reason: two adults on two phones in two
 * places must read one week. A device guess would make "this week" mean different things to the
 * two people planning it, and the pages that need it render on a server, where the device is a
 * data centre.
 *
 * **Why this is here at all.** `todayIso` answered in UTC, so a household west of Greenwich read
 * the wrong day every evening — in Texas at 5pm on Tuesday it is already Wednesday in UTC, so the
 * planner rang Wednesday, and on a Sunday evening "Make this week" quietly meant next week.
 *
 * Offered as a short list rather than every zone the runtime knows. Four hundred names in a
 * select is a worse question than "which of these is nearest", and "Something else" takes an
 * exact name for anybody the list does not cover. The current value is always shown even when it
 * is not on the list, so a household that typed one does not see it silently replaced.
 */
const COMMON = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago, Texas)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "Europe/London", label: "UK (London)" },
  { value: "Europe/Paris", label: "Central Europe (Paris)" },
  { value: "Australia/Sydney", label: "Australia (Sydney)" },
  { value: "Pacific/Auckland", label: "New Zealand (Auckland)" },
  { value: "UTC", label: "UTC" },
] as const;

export function TimezoneSetting({ current }: { current: string }) {
  const router = useRouter();
  const [zone, setZone] = useState(current);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (next: string) => {
    if (!next || next === zone || pending) return;
    const previous = zone;
    setZone(next);
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/household", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ timezone: next }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          setZone(previous);
          setError(body.error ?? `that did not work (${response.status})`);
          return;
        }
        router.refresh();
      } catch {
        // the shopping-list lesson: a rejected fetch must not leave the control in limbo
        setZone(previous);
        setError("No signal — that was not saved.");
      }
    });
  };

  // shown even when it is not one of the nine, so a typed zone is never silently replaced
  const options = COMMON.some((option) => option.value === zone)
    ? COMMON
    : [{ value: zone, label: zone }, ...COMMON];

  return (
    <section>
      <h2>Where you cook</h2>
      <p className="meta">
        Decides what <strong>today</strong> and <strong>this week</strong> mean — which day the
        planner rings, and which week “Make this week” puts a recipe in.
      </p>

      <select
        aria-label="Household timezone"
        value={zone}
        disabled={pending}
        onChange={(event) => save(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <div className="tabs">
        <input
          value={typed}
          placeholder="Something else — e.g. Europe/Madrid"
          aria-label="Another timezone"
          onChange={(event) => setTyped(event.target.value)}
        />
        <button type="button" className="quiet" disabled={pending || !typed.trim()} onClick={() => save(typed.trim())}>
          Use it
        </button>
      </div>

      {error && <p className="meta">{error}</p>}
      {zone === "UTC" && (
        // UTC is the default and is wrong for almost everybody; said plainly rather than left as
        // a silent default that looks deliberate
        <p className="meta">
          UTC is the default, not a choice — if you are not on it, the planner is showing you the
          wrong day after early evening.
        </p>
      )}
    </section>
  );
}
