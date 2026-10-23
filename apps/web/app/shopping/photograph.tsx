"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PrimaryButton, SecondaryButton } from "@/components/harvest";

interface Read {
  text: string;
  struck: boolean;
  strikeConfidence: "certain" | "unsure";
  legible: boolean;
}

/** what the review screen holds: the reading, plus whether this line is going on the list */
interface Row extends Read {
  add: boolean;
}

/**
 * Photograph a handwritten list, check what was read, then add it.
 *
 * ---------------------------------------------------------------------------
 * Why there is a review screen, and why this input needs one most
 * ---------------------------------------------------------------------------
 *
 * Every import passes a review before saving, and that is what lets a cheap model be good enough.
 * A handwritten list is the input where it matters most: a **misread strike-through silently
 * removes an item**, and the person finds out in the shop. Read and marked, the same misread is
 * one tap from being put back.
 *
 * ---------------------------------------------------------------------------
 * What a line with no amount shows — which is most of them
 * ---------------------------------------------------------------------------
 *
 * The line as written, and **no amount field at all**. `shopping_extras` stores `raw_text` and
 * parses on read (§89), so a quantity is simply part of the line when the paper has one; "bread"
 * is a complete reading rather than an incomplete one, and a box asking "how many?" would turn a
 * correct answer into a blank that looks unfinished. Somebody who wants a number types it into the
 * line.
 *
 * ---------------------------------------------------------------------------
 * Crossed out means read, marked, and not added — not dropped
 * ---------------------------------------------------------------------------
 *
 * A struck line arrives with its box **unticked** and says so in words. It is on the screen, so a
 * misread is visible; it is unticked, so the paper is obeyed by default; and it is one tap from
 * joining the list. Dropping it would be the invisible failure — nothing on screen would say the
 * item had ever been seen.
 *
 * `strikeConfidence: "unsure"` and `legible: false` are shown as their own notes rather than
 * folded into one "check this" flag: a stray mark through a word and a word you cannot read are
 * different problems with different fixes.
 */
export function PhotographList({ weekStart }: { weekStart: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function read(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    // `finally` for the flag, `catch` for the message — one rejection, two consequences (§80)
    try {
      const form = new FormData();
      form.set("mode", "shopping-list");
      for (const file of Array.from(files)) form.append("images", file);
      const response = await fetch("/api/import", { method: "POST", body: form });
      const body = (await response.json().catch(() => ({}))) as {
        lines?: Read[];
        error?: string;
        reason?: string;
      };
      if (!response.ok || !body.lines) {
        /*
         * The reasons stay distinct here too. "Not configured" is a switched-off feature and
         * "unreadable" is a photograph worth retaking, and one message for both tells somebody to
         * do the wrong thing.
         */
        setError(
          body.reason === "not-configured"
            ? "Reading photographs is not switched on for this deployment."
            : (body.error ?? `that did not work (${response.status})`),
        );
        return;
      }
      if (body.lines.length === 0) {
        setError("Nothing on that photograph looked like a list. Try another angle.");
        return;
      }
      /* struck lines arrive unticked: the paper is obeyed by default and the read stays visible */
      setRows(body.lines.map((line) => ({ ...line, add: !line.struck })));
    } catch {
      setError("No signal — that photograph was not read. Try it again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const keeping = (rows ?? []).filter((row) => row.add && row.text.trim());
    if (keeping.length === 0) {
      setRows(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      /*
       * One request per line, sequentially, against the route the typed control already uses —
       * rather than a bulk endpoint that would be a second way in with its own validation. A
       * partial failure leaves the lines that did save, and says how many did not.
       */
      let failed = 0;
      for (const row of keeping) {
        const response = await fetch("/api/shopping-extras", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: row.text.trim(), weekStart }),
        });
        if (!response.ok) failed += 1;
      }
      if (failed > 0) {
        setError(`${keeping.length - failed} of ${keeping.length} added — ${failed} were refused.`);
      }
      setRows(null);
      router.refresh();
    } catch {
      setError("No signal — those were not added. Try it again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  if (rows) {
    return (
      <section className="h-extras">
        <p className="h-extras-label">Check what the photograph said</p>
        <ReviewRows rows={rows} onChange={setRows} />
        <div className="h-extras-row">
          <PrimaryButton disabled={busy} onClick={() => void save()}>
            {busy ? "Adding…" : "Add the ticked ones"}
          </PrimaryButton>
          <SecondaryButton disabled={busy} onClick={() => setRows(null)}>
            Discard
          </SecondaryButton>
        </div>
        {error && <p className="error">{error}</p>}
      </section>
    );
  }

  return (
    <section className="h-extras">
      {/*
        * A labelled control, not another bare glyph. The share button next to it was taken for an
        * upload because it was an unlabelled icon, and this is the one that actually uploads.
        */}
      <p className="h-extras-label">Or photograph a written list</p>
      <div className="h-extras-row h-file">
        {/*
          * The input is **visually hidden, not `hidden`** — `clip-path` keeps it in the tab order
          * and in the accessibility tree, with the label as its visible affordance. A native
          * `<input type="file">` cannot be styled: it rendered as an OS-grey "Choose Files" box
          * inside a Harvest card, which the screenshot showed and the markup did not.
          *
          * The label carries `.h-secondary` so it looks like the control it is, and a focus rule
          * below draws the ring the hidden input can no longer show for itself.
          */}
        <input
          id="list-photo"
          className="h-sr-only"
          type="file"
          accept="image/*"
          multiple
          disabled={busy}
          onChange={(event) => void read(event.target.files)}
        />
        <label htmlFor="list-photo" className="h-secondary">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M3 7h3l2-2h8l2 2h3v12H3V7z M12 16a3.5 3.5 0 100-7 3.5 3.5 0 000 7z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {busy ? "Reading…" : "Choose a photograph"}
        </label>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

/**
 * The rows under review, exported so a test can assert the **words** rather than the row count.
 *
 * Its own component because that is what made the bug assertable: nine rows rendered with tick
 * boxes and no item text, and a count of rows passes with every row empty. Separating it is not a
 * test hook — the reviewing state is a distinct thing from the capture control, and the page
 * composes them.
 */
export function ReviewRows({
  rows,
  onChange,
}: {
  rows: Row[];
  onChange: (next: Row[]) => void;
}) {
  const setRows = onChange;
  return (
        <ul className="h-extras-list">
          {rows.map((row, at) => (
            <li key={at} className="h-photo-row">
              {/*
                * The tick and the text are **siblings**, not nested.
                *
                * The text input was inside the `<label>`, which is wrong twice over: a click
                * inside a label activates its control, so **typing in the field toggled the
                * tick** — and `.h-check input` (a descendant selector meaning "the checkbox")
                * clipped the text field to 1px, so nine rows rendered with boxes and no text at
                * all. The rule is scoped now; this structure is the other half.
                *
                * A plain checkbox wearing Harvest's styling rather than the `Checkbox` primitive:
                * its states are `need | have | check-pantry`, a vocabulary about what is left to
                * buy, and bending `have` to mean "include this line" is modelling by coincidence
                * of shape — the thing refused for `member_preferences` holding a layout.
                */}
              <label className="h-check h-photo-tick">
                <input
                  type="checkbox"
                  checked={row.add}
                  aria-label={`Add ${row.text}`}
                  onChange={() => setRows(rows.map((r, i) => (i === at ? { ...r, add: !r.add } : r)))}
                />
                <span className="h-check-box" aria-hidden="true">
                  {row.add && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12l5 5 9-10" />
                    </svg>
                  )}
                </span>
              </label>
              {/* `min-width: 0`, because this is the flex child holding words (§81) */}
              <span className="h-extras-text" style={{ minWidth: 0 }}>
                <input
                  className="h-extras-input"
                  value={row.text}
                  aria-label={`Line ${at + 1}`}
                  onChange={(event) =>
                    setRows(rows.map((r, i) => (i === at ? { ...r, text: event.target.value } : r)))
                  }
                />
                {row.struck && (
                  <span className="h-extras-who">
                    {row.strikeConfidence === "unsure"
                      ? " — looks crossed out, but the mark is unclear"
                      : " — crossed out, so not added"}
                  </span>
                )}
                {!row.legible && (
                  <span className="h-extras-who"> — hard to read, check the wording</span>
                )}
              </span>
            </li>
          ))}
        </ul>
  );
}
