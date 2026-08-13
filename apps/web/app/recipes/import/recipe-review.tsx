"use client";

import { useState } from "react";
import { parseIngredientList, formatAsWritten } from "@pashki/core";

/**
 * What an extracted recipe looks like before a person has agreed to it.
 *
 * **The review step is not optional** (CLAUDE.md): no import saves without somebody seeing it,
 * which is what lets cheap extraction be good enough. Every field is editable, and the ingredients
 * are a textarea rather than a grid — re-parsed on save through the same path manual entry uses,
 * so there is one parser rather than two.
 *
 * Shared by the single-link screen and the batch screen. A batch that reviewed results in a
 * lighter-weight way would be the silent-save path arriving by the back door.
 */
export interface Draft {
  title: string;
  servings: string;
  timeMinutes: string;
  sourceName: string;
  sourceUrl: string;
  ingredients: string;
  steps: string;
}

export interface Photo {
  storagePath: string;
  width: number | null;
  height: number | null;
}

interface RecipeReviewProps {
  draft: Draft;
  photo: Photo | null;
  fromCache?: boolean;
  busy?: boolean;
  error?: string | null;
  saveLabel?: string;
  discardLabel?: string;
  onSave: (draft: Draft) => void;
  onDiscard: () => void;
}

export function RecipeReview({
  draft: initial,
  photo,
  fromCache,
  busy,
  error,
  saveLabel = "Save recipe",
  discardLabel = "Discard",
  onSave,
  onDiscard,
}: RecipeReviewProps) {
  const [draft, setDraft] = useState(initial);

  const set =
    (field: keyof Draft) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft((current) => ({ ...current, [field]: event.target.value }));

  // the same parse the server will run on save, so somebody can see what a line became
  const preview = parseIngredientList(
    draft.ingredients.split("\n").map((line) => line.trim()).filter(Boolean),
  );

  return (
    <form
      className="stack"
      style={{ maxWidth: "none" }}
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
    >
      <div className="notice">
        Read from{" "}
        <a href={draft.sourceUrl} target="_blank" rel="noreferrer noopener">
          the original
        </a>
        {fromCache && " (already extracted for another household — no allowance spent)"}. Change
        anything that is wrong. Nothing is saved until you press save.
      </div>

      {photo && (
        <p className="meta" style={{ margin: 0 }}>
          A photo came with it and will be attached when you save. It stays private to this
          household — it is the site&rsquo;s photograph, not yours.
        </p>
      )}

      <div>
        <label htmlFor={`title-${draft.sourceUrl}`}>Title</label>
        <input id={`title-${draft.sourceUrl}`} required value={draft.title} onChange={set("title")} />
      </div>

      <div className="row">
        <div>
          <label htmlFor={`servings-${draft.sourceUrl}`}>Serves</label>
          <input
            id={`servings-${draft.sourceUrl}`}
            type="number"
            min="1"
            value={draft.servings}
            onChange={set("servings")}
          />
        </div>
        <div>
          <label htmlFor={`time-${draft.sourceUrl}`}>Minutes</label>
          <input
            id={`time-${draft.sourceUrl}`}
            type="number"
            min="1"
            value={draft.timeMinutes}
            onChange={set("timeMinutes")}
          />
        </div>
        <div>
          <label htmlFor={`source-${draft.sourceUrl}`}>Where it came from</label>
          <input
            id={`source-${draft.sourceUrl}`}
            value={draft.sourceName}
            onChange={set("sourceName")}
          />
        </div>
      </div>

      <div>
        <label htmlFor={`ingredients-${draft.sourceUrl}`}>
          Ingredients — one per line, as they were read
        </label>
        <textarea
          id={`ingredients-${draft.sourceUrl}`}
          rows={10}
          value={draft.ingredients}
          onChange={set("ingredients")}
        />
        {preview.length > 0 && (
          <ul className="parsed">
            {preview.map((line, index) => (
              <li key={index}>
                {formatAsWritten(line.amount, line.unit) || "—"} · {line.item}
                {line.note && ` (${line.note})`}
                {line.estimated && " · estimated"}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <label htmlFor={`steps-${draft.sourceUrl}`}>Method — one step per line</label>
        <textarea
          id={`steps-${draft.sourceUrl}`}
          rows={10}
          value={draft.steps}
          onChange={set("steps")}
        />
      </div>

      <div className="tabs">
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : saveLabel}
        </button>
        <button type="button" className="quiet" disabled={busy} onClick={onDiscard}>
          {discardLabel}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
