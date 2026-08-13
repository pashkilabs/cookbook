import type { SupabaseClient } from "@supabase/supabase-js";
import type { IsoDate } from "./week";

/**
 * Finding or creating the week's plan.
 *
 * `meal_plans` has a partial unique index on `(family_id, week_start) where deleted_at is null`,
 * so a week has at most one live plan. That index is also why this is find-then-insert rather
 * than an upsert: PostgREST cannot name a partial index as an `ON CONFLICT` target — it has no
 * way to restate the predicate. A concurrent insert therefore loses the race with `23505`, which
 * is treated as "somebody else just created it" and re-read rather than reported.
 */
export async function findOrCreateWeek(
  supabase: SupabaseClient,
  familyId: string,
  weekStart: IsoDate,
): Promise<{ id: string } | { message: string; code?: string }> {
  const existing = await supabase
    .from("meal_plans")
    .select("id")
    .eq("family_id", familyId)
    .eq("week_start", weekStart)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing.error) return { message: existing.error.message, code: existing.error.code };
  if (existing.data) return { id: existing.data.id };

  const created = await supabase
    .from("meal_plans")
    .insert({ family_id: familyId, week_start: weekStart })
    .select("id")
    .single();
  if (!created.error) return { id: created.data.id };

  if (created.error.code === "23505") {
    const again = await supabase
      .from("meal_plans")
      .select("id")
      .eq("family_id", familyId)
      .eq("week_start", weekStart)
      .is("deleted_at", null)
      .maybeSingle();
    if (again.data) return { id: again.data.id };
  }
  return { message: created.error.message, code: created.error.code };
}

/** The scales the prototype offered. A free numeric field invites 0.3333. */
export const SCALES = [1, 1.5, 2] as const;
export type Scale = (typeof SCALES)[number];

export function isScale(value: unknown): value is Scale {
  return SCALES.some((scale) => scale === Number(value));
}
