"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Save the proposal as it was shown.
 *
 * Sends **selections only** — recipe ids and line numbers. The ingredient text is read from the
 * database by the route, so a client cannot store content under a lineage claiming it came from
 * a recipe that never contained it.
 *
 * No `confirm()`: it is worse on mobile and an embedding context can suppress it (CLAUDE.md).
 */
export interface SavePart {
  sourceRecipeId: string;
  componentName: string;
  role: string | null;
  taken: "component" | "whole";
  lineIndexes: number[];
  adjusted: boolean;
}

export function SaveBlend({ title, parts }: { title: string; parts: SavePart[] }) {
  const router = useRouter();
  const [name, setName] = useState(title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/recipes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blend: { title: name, parts } }),
      });
      const body = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !body.id) {
        // the route's own sentence where there is one; a status where there is not, because
        // "that did not work" with no number is unactionable for whoever is asked about it
        setError(body.error ?? `that did not work (${response.status})`);
        setSaving(false);
        return;
      }
      router.push(`/recipes/${body.id}`);
    } catch {
      setError("that did not reach the server");
      setSaving(false);
    }
  };

  return (
    <section>
      <h2>Name it</h2>
      <p className="meta">
        A suggestion, not a claim — it is made of the two part names and you know better.
      </p>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={200}
        aria-label="blend title"
        style={{ width: "100%", maxWidth: "34rem" }}
      />
      <div className="tabs">
        <button type="button" className="button" onClick={save} disabled={saving || !name.trim()}>
          {saving ? "Saving…" : "Save it as a proposal"}
        </button>
        <a className="button quiet" href="/recipes">
          Start again
        </a>
      </div>
      {error && <p className="meta">{error}</p>}
    </section>
  );
}
