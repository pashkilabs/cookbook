import { notFound, redirect } from "next/navigation";
import { formatInSystem, stripLeadingDecoration } from "@pashki/core";
import { scaleIngredientAmounts, servingsForScale } from "@/lib/planner";
import { userClient } from "@/lib/supabase-server";
import { maybeRow } from "@/lib/rows";
import { platformStore } from "@/lib/platform";
import { CookMode } from "./cook";

/**
 * Cook mode (§4.3) — one step at a time, on a surface that is always dark.
 *
 * ---------------------------------------------------------------------------
 * What this screen is NOT, and the reason is the handoff's own
 * ---------------------------------------------------------------------------
 *
 * §4.3 asks for seven things and this builds five. The two it leaves out are a **"For this step"
 * ingredient card** and an **optional timer row**, and both are excluded by §5 rather than
 * missing: each needs a column the database does not have — a step→ingredient mapping, and a
 * duration per step — and §5's last bullet puts "backend, schema and AI pipeline changes" out of
 * scope. The handoff anticipates exactly this and names *per-step ingredient mapping* as its own
 * example of a gap to "degrade gracefully" around.
 *
 * So the degradation is deliberate and it is the honest one: the **whole** ingredient list, at
 * the planned scale, with the recipe's own headings. A per-step card we cannot fill is worse than
 * no card — and labelling the full list "FOR THIS STEP" would be the lie, since this screen
 * genuinely does not know which ingredients belong to step 4. It says "All ingredients" because
 * that is what they are.
 *
 * `recipe_steps` carries `position` and `text`. There is no duration, no name, and nothing tying
 * a line to a step; a cook screen inventing any of the three would be inventing a recipe.
 */
export default async function CookPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ planned?: string }>;
}) {
  const { id } = await params;
  const { planned } = await searchParams;

  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/sign-in");

  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) redirect("/recipes");

  /*
   * Filtered by `family_id` as well as by id, for the reason the recipe page gives: the id comes
   * from a URL, and RLS returning nothing is not the same question as this household owning it.
   * A published recipe is world-readable by design (§17), so a policy alone would let this screen
   * cook somebody else's dinner.
   */
  const recipe = maybeRow(
    await supabase
      .from("recipes")
      .select("id, title, servings")
      .eq("id", id)
      .eq("family_id", family.id)
      .is("deleted_at", null)
      .maybeSingle(),
    "recipe",
  );
  if (!recipe) notFound();

  const [steps, ingredients] = await Promise.all([
    supabase
      .from("recipe_steps")
      .select("id, position, text")
      .eq("recipe_id", id)
      .eq("family_id", family.id)
      .is("deleted_at", null)
      .order("position"),
    supabase
      .from("recipe_ingredients")
      .select("id, position, amount, unit, item_text, note, section")
      .eq("recipe_id", id)
      .eq("family_id", family.id)
      .is("deleted_at", null)
      .order("position"),
  ]);

  /*
   * The scale the meal was planned at, carried through from the recipe page's `?planned=` link.
   *
   * Cook mode showing different amounts from the page somebody read five seconds ago is the
   * worst version of this screen being wrong, because nothing on it would look wrong.
   */
  let scale = 1;
  if (planned) {
    const entry = maybeRow(
      await supabase
        .from("plan_entries")
        .select("scale")
        .eq("id", planned)
        .eq("family_id", family.id)
        .eq("recipe_id", id)
        .is("deleted_at", null)
        .maybeSingle(),
      "entry",
    );
    if (entry) scale = Number(entry.scale) || 1;
  }

  /*
   * Formatted on the server, in the household's units (§47), because the client component holds
   * step state and nothing else. A read-only screen converts; the editor and the import review
   * must not, since they re-parse what they show.
   */
  const lines = scaleIngredientAmounts(ingredients.data ?? [], scale).map((line) => ({
    id: line.id,
    measure: formatInSystem(line.amount === null ? null : Number(line.amount), line.unit, family.measurementSystem),
    item: line.item_text ?? "",
    note: line.note ?? null,
    section: line.section ?? null,
  }));

  return (
    <CookMode
      title={recipe.title}
      href={planned ? `/recipes/${id}?planned=${planned}` : `/recipes/${id}`}
      // `stripLeadingDecoration` here too: an imported method often arrives as "1. Preheat…", and
      // a 56px numeral beside a step that numbers itself reads as step 1 of a different recipe
      steps={(steps.data ?? []).map((step) => stripLeadingDecoration(step.text))}
      lines={lines}
      servings={scale === 1 ? null : servingsForScale(scale, recipe.servings)}
    />
  );
}
