/**
 * Stating and withdrawing a preference (§71).
 *
 * Writes go through the person's own session, so RLS decides whether they land —
 * `household_can_write` is ANDed into the insert policy, which means a household past its grace
 * window can read its preferences and change none of them. That refusal arrives as an error
 * rather than as silence.
 *
 * **Withdrawing is an UPDATE setting `deleted_at`**, not a DELETE: clients hold no DELETE here,
 * and the unique index excludes tombstones so the same thing can be stated again later.
 */
import { userClient } from "@/lib/supabase-server";
import { maybeRow } from "@/lib/rows";
import { platformStore } from "@/lib/platform";

const KINDS = ["ingredient", "cuisine", "dish_form", "course"];

export async function POST(request: Request) {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ error: "sign in first" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    familyMemberId?: unknown;
    stance?: unknown;
    subjectKind?: unknown;
    subject?: unknown;
  };

  if (typeof body.familyMemberId !== "string" || !body.familyMemberId) {
    return Response.json({ error: "familyMemberId is required" }, { status: 400 });
  }
  if (body.stance !== "like" && body.stance !== "dislike") {
    return Response.json({ error: "stance must be like or dislike" }, { status: 400 });
  }
  if (typeof body.subjectKind !== "string" || !KINDS.includes(body.subjectKind)) {
    return Response.json({ error: `subjectKind must be one of ${KINDS.join(", ")}` }, { status: 400 });
  }
  if (typeof body.subject !== "string" || !body.subject.trim()) {
    return Response.json({ error: "subject is required" }, { status: 400 });
  }

  /*
   * The household comes from the signed-in account, and the member is checked against it —
   * **both through the seam**, because `family_members` is a platform table and app code may not
   * query one. `check-platform-tables` refused the first version of this route for reading it
   * directly, which was the boundary doing its job.
   *
   * Deriving the household from the account rather than from the member is also tighter: a
   * client that could name its own `family_id` would attach a statement to a household it is not
   * in, and the composite FK would be satisfied by the pair it chose.
   */
  const store = platformStore();
  const family = await store.findFamilyForAccount(auth.user.id);
  if (!family) return Response.json({ error: "no household" }, { status: 403 });

  const members = await store.listMembers(family.id);
  const member = members.find((candidate) => candidate.id === body.familyMemberId);
  if (!member) return Response.json({ error: "no such member" }, { status: 404 });

  /*
   * Stating something already stated is an update, not a second row: `stance` is deliberately
   * outside the unique index, so changing your mind cannot create a contradiction for anything
   * downstream to resolve (§71).
   */
  const existing = maybeRow(
    await supabase
      .from("member_preferences")
      .select("id")
      .eq("family_member_id", member.id)
      .eq("subject_kind", body.subjectKind)
      .eq("subject", body.subject.trim())
      .is("deleted_at", null)
      .maybeSingle(),
    "preference already stated",
  ) as { id: string } | null;

  if (existing) {
    const { error } = await supabase
      .from("member_preferences")
      .update({ stance: body.stance })
      .eq("id", existing.id);
    if (error) return Response.json({ error: error.message }, { status: 403 });
    return Response.json({ ok: true, id: existing.id, changed: true });
  }

  const { data, error } = await supabase
    .from("member_preferences")
    .insert({
      family_id: family.id,
      family_member_id: member.id,
      stance: body.stance,
      subject_kind: body.subjectKind,
      subject: body.subject.trim(),
    })
    .select("id")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 403 });
  return Response.json({ ok: true, id: data.id, changed: false });
}

export async function DELETE(request: Request) {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ error: "sign in first" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  // a tombstone, not a delete: clients hold no DELETE, and the unique index ignores tombstones
  // so the same preference can be stated again afterwards
  const { error } = await supabase
    .from("member_preferences")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) return Response.json({ error: error.message }, { status: 403 });
  return Response.json({ ok: true });
}
