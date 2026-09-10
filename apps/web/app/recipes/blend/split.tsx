"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Split a recipe into parts, with the wait made visible.
 *
 * ---------------------------------------------------------------------------
 * Why this is a button and not something the page just does
 * ---------------------------------------------------------------------------
 *
 * Three model calls, twelve to thirty seconds each against a slow provider. Doing that inside
 * the composer's own render meant up to a minute of blank waiting — and a minute of silence is
 * how somebody decides a page has hung and reloads it. A reload started three *fresh* calls:
 * the work was paid for twice and the second run could disagree with the first, because
 * `componentsFor` only writes once it has a consensus.
 *
 * Behind an explicit action that whole problem disappears rather than being mitigated.
 * Reloading the composer now costs nothing, because the composer no longer infers. And a client
 * can say what is happening while it waits, which a server render cannot.
 *
 * ---------------------------------------------------------------------------
 * Three passes, said plainly
 * ---------------------------------------------------------------------------
 *
 * The count is real — `componentsFor` reads the recipe three times and keeps the reading the
 * other two most agree with — but the passes are not reported back one by one, so this does not
 * pretend to a live counter. Naming the three and the rough duration is enough to stop the wait
 * reading as a hang, and inventing "pass 2 of 3" from a timer would be a progress bar that
 * knows nothing, which is worse than a sentence that is true.
 *
 * The button disables itself while it runs, so a second click cannot spend a second three calls.
 */
export function SplitButton({ recipeId, label }: { recipeId: string; label: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const split = async () => {
    setState("working");
    setMessage(null);
    try {
      const response = await fetch(`/api/recipes/${recipeId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ split: true }),
      });
      const body = (await response.json()) as {
        parts?: number; readings?: number; error?: string;
      };
      if (!response.ok) {
        setState("failed");
        // the provider's own sentence where there is one — "it may be busy, worth trying again"
        // is actionable in a way "something went wrong" is not
        setMessage(body.error ?? `that did not work (${response.status})`);
        return;
      }
      if ((body.parts ?? 0) < 2) {
        setState("failed");
        /*
         * Two different answers wearing one result, kept apart.
         *
         * One part after three readings is a real finding — some recipes are one thing. One part
         * after a single reading is a run the provider half-swallowed, and reporting it as a
         * finding would be a confident answer to a question nobody managed to ask. The stored
         * partition is provisional in that case and recomputes, so trying again is not futile —
         * which is exactly what the sentence has to convey.
         */
        setMessage(
          (body.readings ?? 0) < 3
            ? `Only ${body.readings ?? 0} of three readings came back, so this has not really been split — just not contradicted. Worth trying again in a moment.`
            : "It read this as one thing rather than several, so the whole recipe is what there is to take. You can still pair it.",
        );
        return;
      }
      // the composer re-reads the stored partition; nothing here has to pass it along
      router.refresh();
      setState("idle");
    } catch {
      setState("failed");
      setMessage("that did not reach the server");
    }
  };

  return (
    <div>
      <button type="button" className="button" onClick={split} disabled={state === "working"}>
        {state === "working" ? "Reading the recipe…" : label}
      </button>
      {state === "working" && (
        <p className="meta" aria-live="polite">
          It reads the recipe <strong>three times</strong> and keeps the reading the other two
          most agree with, so this usually takes under a minute. Leave the page open — reloading
          starts it again from nothing.
        </p>
      )}
      {state === "failed" && message && (
        <p className="meta" aria-live="polite">
          {message}
        </p>
      )}
    </div>
  );
}
