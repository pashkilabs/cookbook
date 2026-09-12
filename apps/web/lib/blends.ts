/**
 * The impure half of blending: what a recipe offers, and what a blend becomes when saved.
 *
 * The composition itself is pure and lives in `@pashki/core`. This reads rows, checks the
 * household, and writes — nothing here decides what a blend looks like.
 *
 * ---------------------------------------------------------------------------
 * The client sends selections, never content
 * ---------------------------------------------------------------------------
 *
 * A blend is described by a recipe id and a list of line *indexes*. The lines themselves are
 * read here, from the database, in the caller's own session. A client that could post the
 * ingredient text could write anything it liked and have it stored attributed to somebody
 * else's recipe — the lineage would say "from Slow-braised pork belly" over lines that recipe
 * never contained, and nothing downstream could tell.
 *
 * ---------------------------------------------------------------------------
 * A person confirms the boundaries; the model proposes them
 * ---------------------------------------------------------------------------
 *
 * §61 measured the agreement number and found it separates right from wrong at 50/50 — three
 * runs of one model at temperature zero are one opinion sampled three times, and they fail
 * together on exactly the recipes the prompt handles badly. **So there is no confidence signal
 * to gate on, and nothing may stand between a person and the selection they are blending from.**
 *
 * That is why the offer is a *pre-tick* rather than a choice of chips: the stored partition
 * decides which lines start ticked, and the person decides which lines are actually theirs.
 * Detection stops being a correctness constraint and becomes a convenience gradient — right
 * means no clicks, wrong means a few, absent means picking from scratch and it still works.
 *
 * Measured, the split is worth knowing: the model gets the *count* of parts right for 18 of the
 * 19 recipes that genuinely have two or more, while matching only 47 of 71 individual
 * components. It is good at "this recipe is about three things" and bad at "which line belongs
 * to which", which is exactly the division of labour this screen makes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { composeBlend, type BlendLine, type BlendPart } from "@pashki/core";
import { maybeRow, rows } from "./rows";
import { refusal } from "./refusal";
import { writeChildren } from "./recipe-writes";

export interface OfferLine {
  index: number;
  amount: number | null;
  unit: string | null;
  itemText: string;
  note: string;
  isEstimated: boolean;
  section: string | null;
}

export interface OfferPart {
  /** stable within one recipe's offer, used as the form's value */
  key: string;
  name: string;
  role: string | null;
  taken: "component" | "whole";
  /** which lines start ticked */
  lineIndexes: number[];
  agreement: number | null;
  readings: number | null;
}

export interface BlendOffer {
  recipeId: string;
  title: string;
  servings: number | null;
  /** a blend may not be built on a blend — see `createBlendFrom` for why */
  isBlend: boolean;
  lines: OfferLine[];
  parts: OfferPart[];
  /**
   * Why there is only a whole-recipe part, when that is the case — prose, not an absence.
   * A screen rendering nothing here would be indistinguishable from one that had not looked.
   */
  onlyWholeBecause: string | null;
}

const INGREDIENT_COLUMNS = "position, amount, unit, item_text, note, is_estimated, section";

/**
 * What a recipe offers to a blend: its lines, and the parts it might be cut into.
 *
 * **Reads the stored partition and never infers.** Inference is three model calls and up to a
 * minute, so it lives behind an explicit action (`POST /api/recipes/[id]` with `split`) rather
 * than inside any render. That is not tidiness: a slow render is a blank screen, a blank screen
 * gets reloaded, and a reload used to start three fresh calls — paying twice, with the second
 * run free to disagree with the first. Reading only means a reload of this page costs nothing.
 */
export async function offerFor(
  supabase: SupabaseClient,
  familyId: string,
  recipeId: string,
): Promise<BlendOffer | null> {
  const recipe = maybeRow(
    await supabase
      .from("recipes")
      // filtered by family_id, not left to RLS: published recipes are world-readable (§17), so a
      // policy would happily hand over a stranger's recipe on a URL guess
      .select("id, title, servings, components, components_key, components_agreement, components_readings, derived_at")
      .eq("id", recipeId)
      .eq("family_id", familyId)
      .is("deleted_at", null)
      .maybeSingle(),
    "blend source",
  );
  if (!recipe) return null;

  const ingredients = rows(
    await supabase
      .from("recipe_ingredients")
      .select(INGREDIENT_COLUMNS)
      .eq("recipe_id", recipeId)
      .is("deleted_at", null)
      .order("position"),
    "blend source ingredients",
  );

  const lines: OfferLine[] = ingredients.map((row, index) => ({
    index,
    amount: row.amount === null ? null : Number(row.amount),
    unit: row.unit,
    itemText: row.item_text ?? "",
    note: row.note ?? "",
    isEstimated: Boolean(row.is_estimated),
    section: row.section,
  }));

  const whole: OfferPart = {
    key: "whole",
    name: recipe.title,
    role: null,
    taken: "whole",
    lineIndexes: lines.map((line) => line.index),
    agreement: null,
    readings: null,
  };

  const components = recipe.components;
  const agreement = recipe.components_agreement;
  const readings = recipe.components_readings;
  const stored = Array.isArray(components) ? components : null;
  const usable = (stored ?? []).filter(
    (part): part is { name: string; from: number; to: number; role: string | null } =>
      typeof part === "object" && part !== null &&
      typeof (part as { from?: unknown }).from === "number" &&
      typeof (part as { to?: unknown }).to === "number" &&
      (part as { from: number }).from >= 0 &&
      (part as { to: number }).to < lines.length,
  );

  const parts = usable.map((part, at) => ({
    key: `c${at}`,
    name: typeof part.name === "string" && part.name.trim() ? part.name.trim() : `part ${at + 1}`,
    role: typeof part.role === "string" ? part.role : null,
    taken: "component" as const,
    lineIndexes: Array.from({ length: part.to - part.from + 1 }, (_, n) => part.from + n),
    agreement: typeof agreement === "number" ? agreement : null,
    readings: typeof readings === "number" ? readings : null,
  }));

  return {
    recipeId: recipe.id,
    title: recipe.title,
    servings: recipe.servings,
    isBlend: recipe.derived_at !== null,
    lines,
    // whole first: it is always available and never wrong, which is what a person wants when
    // the proposed parts look nothing like their recipe
    parts: [whole, ...parts],
    onlyWholeBecause:
      parts.length > 0
        ? null
        : stored === null
          ? "This recipe has not been split into parts yet — open it and it will be."
          : "Nothing found more than one part in this recipe, so the whole of it is what there is to take.",
  };
}

export interface RequestedPart {
  sourceRecipeId: string;
  /** the part the model proposed, for the record — the lines below are what is actually taken */
  componentName: string;
  role: string | null;
  taken: "component" | "whole";
  lineIndexes: number[];
  agreement: number | null;
  readings: number | null;
  adjusted: boolean;
}

/**
 * Turn requested selections into a stored blend.
 *
 * Every source is re-read here rather than trusted from the request, and every read is
 * family-scoped, so §60's "every source must share the blend's family_id, checked rather than
 * assumed" is checked twice: here, so a stranger's id produces a sentence, and by the composite
 * foreign key, so it produces a constraint violation if this ever stops checking.
 */
export async function createBlendFrom(
  supabase: SupabaseClient,
  familyId: string,
  input: { title: string; parts: readonly RequestedPart[] },
): Promise<{ ok: true; id: string } | { ok: false; error: string; status: number }> {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "a blend needs a title", status: 400 };
  if (title.length > 200) return { ok: false, error: "that title is too long", status: 400 };
  if (input.parts.length < 2) {
    return { ok: false, error: "a blend needs parts from two recipes", status: 400 };
  }
  if (input.parts.length > 4) {
    return { ok: false, error: "a blend takes at most four parts", status: 400 };
  }

  const built: BlendPart[] = [];

  for (const requested of input.parts) {
    const offer = await offerFor(supabase, familyId, requested.sourceRecipeId);
    // an id belonging to another household lands here too, which is the point
    if (!offer) return { ok: false, error: "one of those recipes is not yours", status: 404 };

    /*
     * A blend may not be built on a blend.
     *
     * Otherwise one run's *inferred* component names come back as though the recipe had
     * *declared* them, and a second inference reads its own guess as evidence. A tree of
     * lineage is also a shape nobody has designed.
     */
    if (offer.isBlend) {
      return { ok: false, error: `"${offer.title}" is itself a blend`, status: 400 };
    }

    const wanted = [...new Set(requested.lineIndexes)].sort((a, b) => a - b);
    const chosen = wanted.map((index) => offer.lines[index]).filter(Boolean) as OfferLine[];
    if (chosen.length !== wanted.length) {
      return { ok: false, error: `a line chosen from "${offer.title}" is no longer there`, status: 409 };
    }
    if (chosen.length === 0) {
      return { ok: false, error: `nothing was chosen from "${offer.title}"`, status: 400 };
    }

    const steps = rows(
      await supabase
        .from("recipe_steps")
        .select("position, text")
        .eq("recipe_id", requested.sourceRecipeId)
        .is("deleted_at", null)
        .order("position"),
      "blend source steps",
    );

    const name = requested.componentName.trim().slice(0, 120) || offer.title;
    built.push({
      sourceRecipeId: offer.recipeId,
      sourceTitle: offer.title,
      componentName: name,
      role: requested.role,
      taken: requested.taken,
      adjusted: requested.adjusted,
      agreement: requested.agreement,
      readings: requested.readings,
      ingredients: chosen.map(
        (line): BlendLine => ({
          amount: line.amount,
          unit: line.unit,
          itemText: line.itemText,
          note: line.note,
          isEstimated: line.isEstimated,
          section: line.section,
        }),
      ),
      steps: steps.map((step) => step.text ?? "").filter(Boolean),
    });
  }

  const composed = composeBlend(built);
  if (composed.parts.length < 2) {
    return { ok: false, error: "a blend needs parts from two recipes", status: 400 };
  }

  const created = await supabase
    .from("recipes")
    .insert({
      family_id: familyId,
      title,
      // no honest number: two parts written for 4 and 2 do not make one (§60 v1 changes nothing)
      servings: null,
      time_minutes: null,
      source_name: null,
      source_url: null,
      course: null,
      cuisine: null,
      dish_form: null,
      principal_protein: null,
      // never attempted, and a blend has no source text to classify from anyway
      classified_at: null,
      // not named: times_made is derived from cooked plan entries and the client
      // has no grant on it. The column default is 0 and this is a single-row insert,
      // so the default applies (the union-of-keys hazard is a *batch* one).
      status: "active",
      // the CHECK refuses public alongside derived_at; this is belt as well as braces
      visibility: "private",
      make_again: null,
      created_by: null,
      derived_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (created.error) return { ok: false, error: refusal(created.error), status: 400 };
  const blendId = created.data.id as string;

  const childError = await writeChildren(supabase, familyId, blendId, {
    title,
    servings: null,
    timeMinutes: null,
    sourceName: null,
    ingredients: composed.ingredients.map((line) => ({
      position: line.position,
      amount: line.amount,
      unit: line.unit,
      itemText: line.itemText,
      note: line.note,
      isEstimated: line.isEstimated,
      section: line.section,
    })),
    steps: composed.steps,
    course: null,
    cuisine: null,
    dishForm: null,
    principalProtein: null,
  });
  if (childError) return { ok: false, error: childError, status: 400 };

  // every column on every row: PostgREST sends the union of keys across a batch and passes NULL
  // for whatever a row omits, so a column default never applies (CLAUDE.md)
  const lineage = await supabase.from("recipe_derivations").insert(
    composed.parts.map((part, position) => ({
      family_id: familyId,
      blend_recipe_id: blendId,
      source_recipe_id: part.sourceRecipeId,
      position,
      taken: part.taken,
      component_name: part.componentName,
      role: part.role,
      source_title: part.sourceTitle,
      ingredients_from: part.ingredientsFrom,
      ingredients_to: part.ingredientsTo,
      steps_from: part.stepsFrom,
      steps_to: part.stepsTo,
      lines_key: part.linesKey,
      steps_key: part.stepsKey,
      source_agreement: part.agreement,
      source_readings: part.readings,
      adjusted: part.adjusted,
    })),
  );
  if (lineage.error) return { ok: false, error: refusal(lineage.error), status: 400 };

  return { ok: true, id: blendId };
}
