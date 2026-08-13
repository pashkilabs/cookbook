import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { formatAsWritten } from "@pashki/core";
import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { RecipeForm } from "../../recipe-form";

/**
 * Edit a recipe.
 *
 * The ingredient box is filled with the *parsed* lines rebuilt through the same formatter the
 * detail screen uses, not with the original keystrokes — nothing stores those. So the form shows
 * what the parser understood, which is honest and occasionally instructive: if "1 (14 oz) can
 * tomatoes" came back as "14 oz chopped tomatoes", that is worth seeing before saving over it.
 * Re-saving normalises to whatever the parser makes of the rebuilt text.
 */
export default async function EditRecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await userClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/sign-in");
  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) redirect("/recipes");

  const { data: recipe } = await supabase
    .from("recipes")
    .select("id, title, servings, time_minutes, source_name")
    .eq("id", id)
    .eq("family_id", family.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!recipe) notFound();

  const [ingredients, steps] = await Promise.all([
    supabase
      .from("recipe_ingredients")
      .select("position, amount, unit, item_text, note")
      .eq("recipe_id", id)
      .is("deleted_at", null)
      .order("position"),
    supabase
      .from("recipe_steps")
      .select("position, text")
      .eq("recipe_id", id)
      .is("deleted_at", null)
      .order("position"),
  ]);

  const lines = (ingredients.data ?? []).map((line) => {
    const measure = formatAsWritten(line.amount === null ? null : Number(line.amount), line.unit);
    return [measure, line.item_text].filter(Boolean).join(" ") + (line.note ? `, ${line.note}` : "");
  });

  return (
    <main>
      <p className="subtitle" style={{ marginBottom: "0.75rem" }}>
        <Link href={`/recipes/${id}`}>← {recipe.title}</Link>
      </p>
      <h1>Edit</h1>
      <p className="subtitle">
        These are the lines as the parser understood them, not as they were typed.
      </p>
      <RecipeForm
        mode="edit"
        recipeId={id}
        initial={{
          title: recipe.title,
          servings: recipe.servings === null ? "" : String(recipe.servings),
          timeMinutes: recipe.time_minutes === null ? "" : String(recipe.time_minutes),
          sourceName: recipe.source_name ?? "",
          ingredients: lines.join("\n"),
          steps: (steps.data ?? []).map((step) => step.text).join("\n"),
        }}
      />
    </main>
  );
}
