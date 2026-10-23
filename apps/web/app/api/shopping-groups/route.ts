import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { memberIdFor } from "@/lib/member-settings";
import { findOrCreateGroup, listGroups, normaliseGroupName } from "@/lib/shopping-groups";

/**
 * The groups a household keeps — created here or beside the add box, managed on `/household`.
 *
 * POST makes one (or returns the existing one by that name). PATCH renames. DELETE removes the
 * label and **never the things to buy**.
 */
export async function POST(request: Request) {
  const scope = await household();
  if ("response" in scope) return scope.response;
  const { supabase, familyId, memberId } = scope;

  let body: { name?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }
  if (typeof body.name !== "string") return Response.json({ error: "a group needs a name" }, { status: 400 });

  const outcome = await findOrCreateGroup(supabase, familyId, memberId, body.name);
  if ("error" in outcome) return Response.json({ error: outcome.error }, { status: 400 });
  return Response.json({ id: outcome.group.id, name: outcome.group.name, created: outcome.created });
}

/**
 * Rename, which is the whole reason this is a table rather than free text.
 *
 * Nothing is orphaned: the items point at the row, so the name changes under them and every extra
 * keeps its group. That is the property free text cannot have — renaming a string means finding and
 * rewriting every copy of it, and missing one silently splits the group.
 */
export async function PATCH(request: Request) {
  const scope = await household();
  if ("response" in scope) return scope.response;
  const { supabase, familyId } = scope;

  let body: { id?: unknown; name?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }
  if (typeof body.id !== "string" || typeof body.name !== "string") {
    return Response.json({ error: "which group, and what name?" }, { status: 400 });
  }
  const name = body.name.trim();
  if (!name || name.length > 60) return Response.json({ error: "a group needs a name" }, { status: 400 });
  if (!normaliseGroupName(name)) {
    return Response.json({ error: "a group name needs a letter or a number in it" }, { status: 400 });
  }

  /*
   * A rename that collides with another group is refused with a sentence rather than a constraint
   * violation. Merging two groups is a different operation with a different question — what happens
   * to both sets of items — and nothing has asked for it.
   */
  const groups = await listGroups(supabase, familyId);
  const clash = groups.find(
    (group) => group.id !== body.id && normaliseGroupName(group.name) === normaliseGroupName(name),
  );
  if (clash) {
    return Response.json(
      { error: `${clash.name} already exists. Renaming this one to match would make two.` },
      { status: 409 },
    );
  }

  const { data, error } = await supabase
    .from("shopping_groups")
    .update({ name })
    .eq("id", body.id)
    .eq("family_id", familyId)
    .is("deleted_at", null)
    .select("id, name")
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!data) return Response.json({ error: "no such group" }, { status: 404 });
  return Response.json({ id: data.id, name: data.name });
}

/**
 * Delete the label, keep the list.
 *
 * A soft delete, and the `nullify` trigger on the table forgets the group on every item rather than
 * tombstoning it — **deleting a label must never delete a thing to buy**. The items stay on the
 * week, ungrouped, which is the state most items are in anyway.
 */
export async function DELETE(request: Request) {
  const scope = await household();
  if ("response" in scope) return scope.response;
  const { supabase, familyId } = scope;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "which group?" }, { status: 400 });

  const { data, error } = await supabase
    .from("shopping_groups")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("family_id", familyId)
    .is("deleted_at", null)
    .select("id, name")
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!data) return Response.json({ error: "no such group" }, { status: 404 });
  return Response.json({ removed: data.id, name: data.name });
}

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
