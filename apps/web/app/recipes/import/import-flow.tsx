"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RecipeReview, type Draft, type Photo } from "./recipe-review";

/**
 * Paste one link, look at what came back, then save.
 *
 * The review form itself lives in `recipe-review.tsx`, shared with the batch screen — there is one
 * review, whichever door the recipe arrived through.
 */
export function ImportFlow() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function fetchRecipe(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch("/api/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      draft?: Draft;
      photo?: Photo | null;
      fromCache?: boolean;
      error?: string;
    };
    setBusy(false);
    if (!response.ok || !body.draft) {
      setError(body.error ?? `that did not work (${response.status})`);
      return;
    }
    setDraft(body.draft);
    setPhoto(body.photo ?? null);
    setFromCache(body.fromCache ?? false);
  }

  async function save(edited: Draft) {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/recipes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...edited, photo }),
    });
    const body = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!response.ok || !body.id) {
      setError(body.error ?? `could not save (${response.status})`);
      setBusy(false);
      return;
    }
    router.push(`/recipes/${body.id}`);
    router.refresh();
  }

  if (draft) {
    return (
      <RecipeReview
        draft={draft}
        photo={photo}
        fromCache={fromCache}
        busy={busy}
        error={error}
        discardLabel="Start again"
        onSave={save}
        onDiscard={() => {
          setDraft(null);
          setPhoto(null);
          setError(null);
        }}
      />
    );
  }

  return (
    <>
      <form className="stack" onSubmit={fetchRecipe}>
        <div>
          <label htmlFor="url">Recipe link</label>
          <input
            id="url"
            type="url"
            required
            placeholder="https://www.example.com/recipes/carbonara"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </div>
        <div className="tabs">
          <button type="submit" disabled={busy}>
            {busy ? "Reading the page…" : "Read the recipe"}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </form>

      <div className="notice" style={{ marginTop: "1.5rem" }}>
        Most recipe sites publish their recipes in a form a machine can read, and that is what this
        uses — no model, nothing invented. Pages that publish nothing readable cannot be imported
        yet, and Facebook, Instagram and TikTok links never resolve to the recipe at all —{" "}
        <a href="/recipes/import?tab=text">paste the caption instead</a>, or{" "}
        <a href="/recipes/import?tab=photos">a screenshot of it</a>.
      </div>
    </>
  );
}
