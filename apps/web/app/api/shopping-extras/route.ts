import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { memberIdFor } from "@/lib/member-settings";
import { findOrCreateGroup, listGroups } from "@/lib/shopping-groups";
import { isIsoDate, startOfWeek } from "@/lib/week";

/**
 * Things somebody adds to a week's shopping that no recipe asked for.
 *
 * Its own route rather than a branch on `/api/shopping-ticks`: that one answers "what is already
 * in the trolley" and this is a different resource at a different path. §37's twelve-function
 * ceiling is what would normally argue against a new file, and it no longer binds — this app
 * deploys 22 route files today and `pnpm smoke` exercises them against production.
 *
 * POST adds one. DELETE removes one, as a soft delete, because clients hold no DELETE privilege
 * and `ON DELETE CASCADE` would not fire on a tombstone anyway (§30).
 */
export async function POST(request: Request) {
  const scope = await household();
  if ("response" in scope) return scope.response;
  const { supabase, familyId, memberId } = scope;

  let body: { text?: unknown; weekStart?: unknown; groupId?: unknown; groupName?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return Response.json({ error: "type something to add" }, { status: 400 });
  /*
   * The ceiling matches the column's CHECK rather than being a second opinion about it. A longer
   * line is refused with a sentence instead of arriving as a constraint violation nobody can read.
   */
  if (text.length > 200) {
    return Response.json({ error: "that is longer than a shopping list line" }, { status: 400 });
  }

  const weekStart = typeof body.weekStart === "string" && isIsoDate(body.weekStart)
    ? startOfWeek(body.weekStart)
    : null;
  if (!weekStart) return Response.json({ error: "weekStart must be a date" }, { status: 400 });

  /*
   * The group, by id or by name — and a name that already exists **is** that group.
   *
   * Somebody typing "costco" on Friday when "Costco" exists means Costco, so the collision is not
   * an error: `findOrCreateGroup` returns the existing row and says it did not create one, and the
   * screen says "Added to Costco". The create path is a duplicate source exactly as the typed-match
   * path is, so it goes through the same normalisation and the same unique index.
   */
  let groupId: string | null = typeof body.groupId === "string" ? body.groupId : null;
  let groupName: string | null = null;
  let groupCreated = false;
  if (!groupId && typeof body.groupName === "string" && body.groupName.trim()) {
    const outcome = await findOrCreateGroup(supabase, familyId, memberId, body.groupName);
    if ("error" in outcome) return Response.json({ error: outcome.error }, { status: 400 });
    groupId = outcome.group.id;
    groupName = outcome.group.name;
    groupCreated = outcome.created;
  } else if (groupId) {
    /*
     * An id from the client is still checked against this household's groups. RLS would refuse
     * another household's row, but a 403 from a foreign key reads as a bug rather than an answer.
     */
    const known = (await listGroups(supabase, familyId)).find((g) => g.id === groupId);
    if (!known) return Response.json({ error: "no such group" }, { status: 400 });
    groupName = known.name;
  }

  const { data, error } = await supabase
    .from("shopping_extras")
    .insert({
      family_id: familyId,
      week_start: weekStart,
      raw_text: text,
      added_by: memberId,
      ...(groupId ? { group_id: groupId } : {}),
    })
    .select("id, raw_text")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 400 });

  return Response.json({
    id: data.id,
    text: data.raw_text,
    ...(groupName ? { group: groupName, groupId, groupCreated } : {}),
  });
}

export async function DELETE(request: Request) {
  const scope = await household();
  if ("response" in scope) return scope.response;
  const { supabase, familyId } = scope;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "which one?" }, { status: 400 });

  /*
   * Scoped by `family_id` as well as by id, and that is not redundant: RLS decides what may leave
   * the database, a route decides whose kitchen it writes to. `select` is what distinguishes
   * "removed" from "no such row" — an UPDATE matching nothing is not an error, and a 200 over a
   * write that touched nothing is the silent-success shape this project keeps paying for.
   */
  const { data, error } = await supabase
    .from("shopping_extras")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("family_id", familyId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!data) return Response.json({ error: "that is not on the list" }, { status: 404 });

  return Response.json({ removed: data.id });
}

/**
 * The household, and **which member is asking** — which ticks does not need and this does.
 *
 * `added_by` is NOT NULL, so an account with no member row has nowhere to attach an extra. It
 * refuses loudly rather than answering 200 to a write that stored nothing.
 */
async function household() {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { response: Response.json({ error: "sign in first" }, { status: 401 }) };

  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) return { response: Response.json({ error: "no household" }, { status: 403 }) };

  const memberId = await memberIdFor(family.id, auth.user.id);
  if (!memberId) {
    return {
      response: Response.json(
        { error: "this account is not a member of its household, so it has nowhere to save this" },
        { status: 409 },
      ),
    };
  }
  return { supabase, familyId: family.id, memberId };
}
