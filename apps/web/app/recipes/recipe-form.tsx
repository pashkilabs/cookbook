"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseIngredientList, formatAsWritten } from "@pashki/core";

/**
 * One form for creating and editing.
 *
 * **Ingredients are a textarea, not a repeating amount/unit/item widget.** A person writing
 * down a recipe writes "2 tbsp olive oil", and `packages/core` already knows how to read that.
 * A structured form would ask them to do the parser's job, and — the part that matters — it
 * would mean the parser only ever sees text from importers. This way every hand-typed recipe
 * exercises it.
 *
 * The preview under the box is the same parse the server will do, run in the browser because
 * `packages/core` is pure and bundles anywhere. It is there so somebody can see that "1 (14oz)
 * can tomatoes" was understood before they save it, which is the same reassurance the import
 * review screen will need.
 */
export interface RecipeFormValues {
  title: string;
  servings: string;
  course: string;
  cuisine: string;
  dishForm: string;
  principalProtein: string;
  timeMinutes: string;
  sourceName: string;
  ingredients: string;
  steps: string;
}

const EMPTY: RecipeFormValues = {
  title: "",
  servings: "",
  course: "",
  cuisine: "",
  dishForm: "",
  principalProtein: "",
  timeMinutes: "",
  sourceName: "",
  ingredients: "",
  steps: "",
};

export function RecipeForm(
  props:
    | { mode: "create" }
    | { mode: "edit"; recipeId: string; initial: RecipeFormValues },
) {
  const router = useRouter();
  const [values, setValues] = useState<RecipeFormValues>(
    props.mode === "edit" ? props.initial : EMPTY,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (field: keyof RecipeFormValues) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  const preview = parseIngredientList(
    values.ingredients.split("\n").map((line) => line.trim()).filter(Boolean),
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const target = props.mode === "edit" ? `/api/recipes/${props.recipeId}` : "/api/recipes";
    const response = await fetch(target, {
      method: props.mode === "edit" ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    const body = (await response.json().catch(() => ({}))) as { id?: string; error?: string };

    if (!response.ok) {
      setError(body.error ?? `could not save (${response.status})`);
      setBusy(false);
      return;
    }

    const id = props.mode === "edit" ? props.recipeId : body.id;
    router.push(`/recipes/${id}`);
    router.refresh();
  }

  return (
    <form className="stack" style={{ maxWidth: "none" }} onSubmit={submit}>
      <div>
        <label htmlFor="title">Title</label>
        <input id="title" required value={values.title} onChange={set("title")} />
      </div>

      <div className="row">
        <div>
          <label htmlFor="servings">Serves</label>
          <input id="servings" type="number" min="1" value={values.servings} onChange={set("servings")} />
        </div>

        {/*
          * What the dish is — inferred at import, and correctable here.
          *
          * This is what makes the backfill safe to run. Course was only editable on the review
          * screen, which no already-saved recipe will ever pass through again, so a wrong course
          * would have been permanent on the field the whole browse picker rests on.
          */}
        <div className="row">
          <label htmlFor="course">Course</label>
          <select id="course" value={values.course} onChange={set("course")}>
            <option value="">Not sure</option>
            {["breakfast", "starter", "main", "side", "dessert", "drink", "snack"].map((c) => (
              <option key={c} value={c}>{c[0]!.toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
          <label htmlFor="cuisine">Cuisine</label>
          <input id="cuisine" value={values.cuisine} placeholder="Italian, Thai, …" onChange={set("cuisine")} />
        </div>
        <div className="row">
          <label htmlFor="dishForm">Form</label>
          <select id="dishForm" value={values.dishForm} onChange={set("dishForm")}>
            <option value="">Not one of these</option>
            {["soup", "salad", "sandwich", "bake", "stew", "bowl"].map((f) => (
              <option key={f} value={f}>{f[0]!.toUpperCase() + f.slice(1)}</option>
            ))}
          </select>
          <label htmlFor="principalProtein">Protein</label>
          <select id="principalProtein" value={values.principalProtein} onChange={set("principalProtein")}>
            <option value="">None or unclear</option>
            {["chicken", "beef", "pork", "lamb", "fish", "seafood", "egg", "vegetarian", "vegan"].map((p) => (
              <option key={p} value={p}>{p[0]!.toUpperCase() + p.slice(1)}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="time">Minutes</label>
          <input id="time" type="number" min="1" value={values.timeMinutes} onChange={set("timeMinutes")} />
        </div>
        <div>
          <label htmlFor="source">Where it came from</label>
          <input id="source" placeholder="Nonna's book" value={values.sourceName} onChange={set("sourceName")} />
        </div>
      </div>

      <div>
        <label htmlFor="ingredients">Ingredients — one per line</label>
        <textarea
          id="ingredients"
          rows={8}
          placeholder={"400 g spaghetti\n3 eggs\n1½ cups pecorino, grated\nblack pepper"}
          value={values.ingredients}
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
        <label htmlFor="steps">Method — one step per line</label>
        <textarea
          id="steps"
          rows={6}
          placeholder={"Boil the pasta.\nRender the guanciale.\nFold it together off the heat."}
          value={values.steps}
          onChange={set("steps")}
        />
      </div>

      <div className="tabs">
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : props.mode === "edit" ? "Save changes" : "Save recipe"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
