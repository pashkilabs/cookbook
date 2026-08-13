import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { formatAsWritten } from "@pashki/core";
import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { Verdicts } from "./verdicts";

/**
 * One recipe: what is in it, how to make it, who liked it, and what it looked like.
 *
 * Everything here already existed in the schema and none of it had ever been shown —
 * `recipe_steps` since the method became a child table (decisions §19), `ratings` since the
 * first migration, the photo since the storage bucket.
 *
 * **Filtered by `family_id`, not left to RLS.** Published recipes are world-readable
 * (decisions §17), so a policy would happily hand over a stranger's public recipe on a URL
 * guess. The filter is what makes an id that is not yours indistinguishable from an id that
 * does not exist — both are `notFound()`, and neither confirms the recipe is real.
 */
export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await userClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/sign-in");

  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) redirect("/recipes");

  const { data: recipe } = await supabase
    .from("recipes")
    .select("id, title, source_name, source_url, servings, time_minutes, times_made, make_again, visibility")
    .eq("id", id)
    .eq("family_id", family.id)
    .is("deleted_at", null)
    .maybeSingle();

  // an id belonging to another household lands here too, which is the point
  if (!recipe) notFound();

  const [ingredients, steps, ratings, members, photo] = await Promise.all([
    supabase
      .from("recipe_ingredients")
      .select("id, position, amount, unit, item_text, note, is_estimated")
      .eq("recipe_id", id)
      .is("deleted_at", null)
      .order("position"),
    supabase
      .from("recipe_steps")
      .select("id, position, text")
      .eq("recipe_id", id)
      .is("deleted_at", null)
      .order("position"),
    supabase
      .from("ratings")
      .select("id, family_member_id, score")
      .eq("recipe_id", id)
      .is("deleted_at", null),
    platformStore().listMembers(family.id),
    supabase
      .from("photos")
      .select("storage_path, source, width, height")
      .eq("recipe_id", id)
      .eq("upload_state", "stored")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // The bucket is private, so a URL has to be signed. Signed as the person viewing, so the
  // storage policy is what authorises it — the same reasoning as reading the rows.
  let photoUrl: string | null = null;
  if (photo.data?.storage_path) {
    const signed = await supabase.storage
      .from("recipe-photos")
      .createSignedUrl(photo.data.storage_path, 600);
    photoUrl = signed.data?.signedUrl ?? null;
  }

  const scores = new Map(ratings.data?.map((r) => [r.family_member_id, r.score]) ?? []);

  return (
    <main>
      <p className="subtitle" style={{ marginBottom: "0.75rem" }}>
        <Link href="/recipes">← {family.name}</Link>
      </p>

      <div className="bar" style={{ marginBottom: "1.5rem" }}>
        <div>
          <h1>{recipe.title}</h1>
          <p className="meta" style={{ margin: 0 }}>
            {[
              recipe.source_name,
              recipe.servings ? `serves ${recipe.servings}` : null,
              recipe.time_minutes ? `${recipe.time_minutes} min` : null,
              recipe.times_made ? `made ${recipe.times_made}×` : null,
              recipe.visibility === "public" ? "published" : null,
            ]
              .filter(Boolean)
              .join(" · ") || "no details yet"}
          </p>
        </div>
      </div>

      {photoUrl && (
        <img
          src={photoUrl}
          alt=""
          className="photo"
          width={photo.data?.width ?? undefined}
          height={photo.data?.height ?? undefined}
        />
      )}

      <section>
        <h2>Ingredients</h2>
        {ingredients.data?.length ? (
          <ul className="ingredients">
            {ingredients.data.map((line) => {
              // formatted by packages/core, so the web app and the app agree on what
              // "1½ cup" looks like without either of them deciding
              const measure = formatAsWritten(
                line.amount === null ? null : Number(line.amount),
                line.unit,
              );
              return (
                <li key={line.id}>
                  {measure && <span className="measure">{measure}</span>}
                  <span>{line.item_text}</span>
                  {line.note && <span className="meta"> — {line.note}</span>}
                  {line.is_estimated && (
                    <span className="estimated" title="This amount was inferred, not stated">
                      estimated
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="meta">No ingredients recorded.</p>
        )}
      </section>

      <section>
        <h2>Method</h2>
        {steps.data?.length ? (
          <ol className="steps">
            {steps.data.map((step) => (
              <li key={step.id}>{step.text}</li>
            ))}
          </ol>
        ) : (
          <p className="meta">
            No method recorded. Imported recipes link back to the source rather than
            reproducing it — see decisions §19.
            {recipe.source_url && (
              <>
                {" "}
                <a href={recipe.source_url} rel="noreferrer noopener" target="_blank">
                  Open the original
                </a>
                .
              </>
            )}
          </p>
        )}
      </section>

      <Verdicts
        recipeId={recipe.id}
        familyId={family.id}
        makeAgain={recipe.make_again}
        members={members.map((member) => ({
          id: member.id,
          displayName: member.displayName,
          isChild: member.isChild,
          score: scores.get(member.id) ?? null,
        }))}
      />
    </main>
  );
}
