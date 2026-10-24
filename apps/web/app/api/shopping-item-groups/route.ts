import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { memberIdFor } from "@/lib/member-settings";
import { findOrCreateGroup, listGroups, setItemGroup } from "@/lib/shopping-groups";

/**
 * Which group an **item** is in — standing, not weekly.
 *
 * PUT files an item under a group (or, with no group, takes it out of one). The item is named by
 * its consolidated line key, which `consolidate` mints and **this route never derives**: the client
 * sends back the key the list rendered, so there is one implementation of what merges with what.
 *
 * `shopping_extras.group_id` is not touched here. That column records what was *said* when an item
 * was typed; this records what was *chosen* on the list, and `buildShoppingWeek` states the
 * precedence between them in one place.
 */
export async function PUT(request: Request) {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ error: "sign in first" }, { status: 401 });

  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) return Response.json({ error: "no household" }, { status: 403 });

  let body: { itemKey?: unknown; groupId?: unknown; groupName?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const itemKey = typeof body.itemKey === "string" ? body.itemKey.trim() : "";
  if (!itemKey) return Response.json({ error: "which item?" }, { status: 400 });
  /* matches the column's CHECK rather than being a second opinion about it */
  if (itemKey.length > 200) return Response.json({ error: "that is not an item key" }, { status: 400 });

  /*
   * A name that already exists **is** that group — the same rule the add box follows, through the
   * same function. Somebody typing "costco" on the list when "Costco" exists means Costco.
   */
  let groupId: string | null = null;
  let groupName: string | null = null;
  let groupCreated = false;
  if (typeof body.groupName === "string" && body.groupName.trim()) {
    const memberId = await memberIdFor(family.id, auth.user.id);
    if (!memberId) {
      return Response.json(
        { error: "this account is not a member of its household, so it cannot make a group" },
        { status: 409 },
      );
    }
    const outcome = await findOrCreateGroup(supabase, family.id, memberId, body.groupName);
    if ("error" in outcome) return Response.json({ error: outcome.error }, { status: 400 });
    groupId = outcome.group.id;
    groupName = outcome.group.name;
    groupCreated = outcome.created;
  } else if (typeof body.groupId === "string" && body.groupId) {
    /*
     * An id from the client is still checked against this household's groups. RLS would refuse
     * another household's row, but a 403 out of a foreign key reads as a bug rather than an answer.
     */
    const known = (await listGroups(supabase, family.id)).find((group) => group.id === body.groupId);
    if (!known) return Response.json({ error: "no such group" }, { status: 400 });
    groupId = known.id;
    groupName = known.name;
  }

  const error = await setItemGroup(supabase, family.id, itemKey, groupId);
  if (error) return Response.json({ error }, { status: 400 });

  return Response.json({
    itemKey,
    ...(groupId ? { group: groupName, groupId, groupCreated } : { group: null }),
  });
}
