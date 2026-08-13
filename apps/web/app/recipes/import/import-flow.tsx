"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseIngredientList, formatAsWritten } from "@pashki/core";

/**
 * Paste a link, look at what came back, then save.
 *
 * **The review step is not optional** (CLAUDE.md): no import saves without the person seeing it,
 * which is what lets cheap extraction be good enough. Every field is editable before saving, and
 * the ingredients are a textarea rather than a grid — re-parsed on save through the same path
 * manual entry uses, so there is one parser rather than two.
 */
interface Draft {
  title: string;
  servings: string;
  timeMinutes: string;
  sourceName: string;
  sourceUrl: string;
  ingredients: string;
  steps: string;
}

interface Photo {
  storagePath: string;
  width: number | null;
  height: number | null;
}

export function ImportFlow() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [provenance, setProvenance] = useState<{ tier: string; fromCache: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (field: keyof Draft) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDraft((current) => (current ? { ...current, [field]: event.target.value } : current));

  // the same parse the server will run on save, so somebody can see what a line became
  const preview = draft
    ? parseIngredientList(draft.ingredients.split("\n").map((line) => line.trim()).filter(Boolean))
    : [];

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
      draft?: Draft; photo?: Photo | null; tier?: string; fromCache?: boolean; error?: string;
    };
    setBusy(false);
    if (!response.ok || !body.draft) {
      setError(body.error ?? `that did not work (${response.status})`);
      return;
    }
    setDraft(body.draft);
    setPhoto(body.photo ?? null);
    setProvenance({ tier: body.tier ?? "", fromCache: body.fromCache ?? false });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError(null);
    const response = await fetch("/api/recipes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...draft, photo }),
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

  if (!draft) {
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
          Most recipe sites publish their recipes in a form a machine can read, and that is what
          this uses — no model, nothing invented. Pages that publish nothing readable cannot be
          imported yet, and Facebook, Instagram and TikTok links never resolve to the recipe at
          all.
        </div>
      </>
    );
  }

  return (
    <form className="stack" style={{ maxWidth: "none" }} onSubmit={save}>
      <div className="notice">
        Read from <a href={draft.sourceUrl} target="_blank" rel="noreferrer noopener">the original</a>
        {provenance?.fromCache && " (already extracted for another household — no allowance spent)"}.
        Change anything that is wrong. Nothing is saved until you press save.
      </div>

      {photo && (
        <p className="meta" style={{ margin: 0 }}>
          A photo came with it and will be attached when you save. It stays private to this
          household — it is the site&rsquo;s photograph, not yours.
        </p>
      )}

      <div>
        <label htmlFor="title">Title</label>
        <input id="title" required value={draft.title} onChange={set("title")} />
      </div>

      <div className="row">
        <div>
          <label htmlFor="servings">Serves</label>
          <input id="servings" type="number" min="1" value={draft.servings} onChange={set("servings")} />
        </div>
        <div>
          <label htmlFor="time">Minutes</label>
          <input id="time" type="number" min="1" value={draft.timeMinutes} onChange={set("timeMinutes")} />
        </div>
        <div>
          <label htmlFor="source">Where it came from</label>
          <input id="source" value={draft.sourceName} onChange={set("sourceName")} />
        </div>
      </div>

      <div>
        <label htmlFor="ingredients">Ingredients — one per line, as they were read</label>
        <textarea id="ingredients" rows={10} value={draft.ingredients} onChange={set("ingredients")} />
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
        <label htmlFor="steps">Method — one step per line</label>
        <textarea id="steps" rows={10} value={draft.steps} onChange={set("steps")} />
      </div>

      <div className="tabs">
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save recipe"}
        </button>
        <button
          type="button"
          className="quiet"
          disabled={busy}
          onClick={() => { setDraft(null); setPhoto(null); setError(null); }}
        >
          Start again
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
