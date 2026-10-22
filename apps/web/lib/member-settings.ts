import type { SupabaseClient } from "@supabase/supabase-js";
import { maybeRow } from "./rows";
import { platformStore } from "./platform";
import { isRecipeLayout, type RecipeLayout } from "./recipe-layout";

/**
 * How *this person* reads the recipe book — their layout, and whether they have been asked.
 *
 * ---------------------------------------------------------------------------
 * Why this is not on the household, and not in the seam
 * ---------------------------------------------------------------------------
 *
 * It was `families.recipe_layout` until §87. Two separate mistakes in one column:
 *
 *   - **A household setting.** How somebody browses is personal, exactly the way a dislike is
 *     personal (§71 one table along). Stephen choosing the recipe book changed what Paige saw,
 *     and Paige is the person who cooks from it.
 *   - **A platform setting.** `families` is a platform table, so changing a layout went through
 *     the seam — a method the platform had to carry for a vocabulary it does not own. The
 *     platform knows who people are; this app knows how they like to read it.
 *
 * So it is an app table, scoped by `family_id` like every app table, read and written through
 * the signed-in person's own session with RLS deciding the rows.
 *
 * ---------------------------------------------------------------------------
 * `member_settings` rather than `member_preferences` or a column on `family_members`
 * ---------------------------------------------------------------------------
 *
 * `member_preferences` is a row per *statement about food*: `(member, subject_kind, subject)`
 * with a `stance` of like or dislike. A layout is not a stance about a subject, and putting it
 * there needs a `subject_kind` of 'layout' with the value smuggled into `subject` and `stance`
 * forced to a lie. That is modelling by coincidence of shape.
 *
 * A column on `family_members` fails the boundary above: an app setting on a platform table.
 *
 * So a third table, one row per member, settings as CHECKed columns on it. The next per-member
 * app setting lands here — display units are the open candidate (decisions §88).
 */
export interface MemberSettings {
  /** this person's family_members id, or null when their account has no member row */
  memberId: string | null;
  layout: RecipeLayout;
  /** null means never asked, and only null prompts */
  askedAt: string | null;
}

/**
 * The default for somebody who has never chosen.
 *
 * A literal here and a column default in the migration, which is two sites for one value — and
 * deliberately, because they answer different questions. The column default is what an INSERT
 * that omits the layout stores; this is what to render when there is **no row at all**, which is
 * every member until they are asked. A read that invented a row to learn its default would be a
 * write on a GET.
 */
const UNCHOSEN: RecipeLayout = "rotation";

/**
 * Resolve the signed-in account to its member row.
 *
 * Through the seam, because `family_members` is a platform table and
 * `check-platform-tables.mjs` fails the build on a direct read.
 *
 * `null` is a real state rather than an error: an account can hold a household it has no member
 * row in — provisioning creates one, but an account restored from a tombstoned member would not
 * have it. Such a person reads the default and is asked, and the **write** refuses loudly rather
 * than succeeding against nobody (see `/api/household`).
 */
export async function memberIdFor(familyId: string, accountId: string): Promise<string | null> {
  const members = await platformStore().listMembers(familyId);
  return members.find((member) => member.accountId === accountId)?.id ?? null;
}

/**
 * This person's settings, or the unchosen default.
 *
 * `isRecipeLayout` still guards the stored value, because a layout removed from the code would
 * otherwise reach a screen with no branch for it — the CHECK knows the list the database was
 * created with, not the list this build ships.
 */
export async function readMemberSettings(
  supabase: SupabaseClient,
  familyId: string,
  accountId: string,
): Promise<MemberSettings> {
  const memberId = await memberIdFor(familyId, accountId);
  if (!memberId) return { memberId: null, layout: UNCHOSEN, askedAt: null };

  const row = maybeRow(
    await supabase
      .from("member_settings")
      .select("recipe_layout, recipe_layout_asked_at")
      .eq("family_id", familyId)
      .eq("family_member_id", memberId)
      .is("deleted_at", null)
      .maybeSingle(),
    "this person's settings",
  );

  if (!row) return { memberId, layout: UNCHOSEN, askedAt: null };
  return {
    memberId,
    layout: isRecipeLayout(row.recipe_layout) ? row.recipe_layout : UNCHOSEN,
    askedAt: row.recipe_layout_asked_at,
  };
}

/**
 * Write the layout and the asked-at stamp **together**.
 *
 * One event rather than two, because answering the question and recording that it was asked are
 * the same event: two independent writes would let the first succeed and the second fail, leaving
 * a person who has chosen a layout and will be prompted again anyway — and a prompt that returns
 * after an answer is worse than one that never appeared.
 *
 * `layout: null` is a **dismissal**: it stamps the question and leaves the layout at whatever it
 * was. That is why there are two columns — the layout says what to render, the stamp says whether
 * to ask.
 *
 * ---------------------------------------------------------------------------
 * Why this is not an upsert, which is what it obviously wants to be
 * ---------------------------------------------------------------------------
 *
 * `.upsert(...)` was the first version and it failed with *permission denied for table
 * member_settings* while a plain insert and a plain update both worked. PostgREST renders a
 * merge-duplicates upsert as `ON CONFLICT (…) DO UPDATE SET` **every column in the payload** —
 * `family_id` and `family_member_id` included — and those two carry an INSERT grant and
 * deliberately no UPDATE grant, because a client must not be able to move somebody's setting into
 * another household (§26: grant columns, not tables).
 *
 * So the grant matrix is right and the statement was wrong. `ON CONFLICT DO NOTHING` needs only
 * INSERT, so: **ensure the row, then set the columns we may set.** Two statements, no race — a
 * concurrent first write loses the insert harmlessly instead of raising a unique violation — and
 * a failure between them still leaves a coherent row, because the insert already carried the
 * values this call meant to store.
 *
 * No validation of the value here. The CHECK on the column owns the list, and a second copy would
 * be a third site for it.
 */
export async function writeRecipeLayout(
  supabase: SupabaseClient,
  familyId: string,
  memberId: string,
  layout: RecipeLayout | null,
): Promise<{ layout: RecipeLayout; askedAt: string }> {
  const asked = new Date().toISOString();

  /*
   * Every column spelled out, including the ones with defaults: PostgREST sends the union of the
   * keys across a batch and passes NULL for whatever a row omits rather than taking the default.
   */
  const ensured = await supabase.from("member_settings").upsert(
    {
      family_id: familyId,
      family_member_id: memberId,
      recipe_layout: layout ?? UNCHOSEN,
      recipe_layout_asked_at: asked,
    },
    { onConflict: "family_member_id,family_id", ignoreDuplicates: true },
  );
  if (ensured.error) throw new Error(`saving how you read the recipe book: ${ensured.error.message}`);

  /*
   * The stamp always; the layout only when one was chosen. A dismissal that carried the layout
   * would overwrite a choice somebody had already made — the screens cannot send that today,
   * since the card only appears to somebody who has never answered, but "the UI cannot send that"
   * is not a property of the route.
   */
  const patch: Record<string, unknown> = { recipe_layout_asked_at: asked };
  if (layout !== null) patch.recipe_layout = layout;

  const row = maybeRow(
    await supabase
      .from("member_settings")
      .update(patch)
      .eq("family_id", familyId)
      .eq("family_member_id", memberId)
      .is("deleted_at", null)
      .select("recipe_layout, recipe_layout_asked_at")
      .maybeSingle(),
    "saving how you read the recipe book",
  );
  if (!row) throw new Error("saving how you read the recipe book: the row was not there to write");
  return stored(row);
}

/**
 * What the row now holds, read back from the write rather than assumed from the request.
 *
 * The caller echoes this to the screen, and for a **dismissal** the two differ: the request
 * carried `null` and the stored layout is whatever it already was. A route echoing its own input
 * would report a dismissal as having set the layout to nothing — and the check asserting that a
 * dismissal leaves the layout alone would have been reading the request back to itself.
 */
function stored(row: { recipe_layout: string; recipe_layout_asked_at: string | null }): {
  layout: RecipeLayout;
  askedAt: string;
} {
  if (!row.recipe_layout_asked_at) {
    throw new Error("the question was stamped and read back unstamped, which cannot be true");
  }
  return {
    layout: isRecipeLayout(row.recipe_layout) ? row.recipe_layout : UNCHOSEN,
    askedAt: row.recipe_layout_asked_at,
  };
}
