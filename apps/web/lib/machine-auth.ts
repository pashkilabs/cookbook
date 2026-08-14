import { timingSafeEqual } from "node:crypto";
import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";

/**
 * A signed-in household, or a scheduled job presenting the shared secret.
 *
 * Extracted so the drain and the reaper cannot drift apart: both are called by pg_cron with the
 * same secret, and an authentication rule implemented twice is one that will eventually be two
 * different rules.
 *
 * The secret is compared with `timingSafeEqual` on equal-length buffers. A `===` leaks the length
 * and the matching prefix through timing, and these are the doors a machine knocks on every
 * minute — the ideal conditions for that to matter.
 */
export async function machineCaller(request: Request): Promise<boolean> {
  const presented = request.headers.get("x-pashki-drain-secret");
  const expected = process.env.PASHKI_DRAIN_SECRET;

  if (presented && expected) {
    const a = Buffer.from(presented);
    const b = Buffer.from(expected);
    // length first: timingSafeEqual throws on a mismatch, and a wrong-length guess should be
    // refused without revealing anything else
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }

  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return false;

  // a signed-in account with no household has nothing to sweep or drain for
  return (await platformStore().findFamilyForAccount(auth.user.id)) !== null;
}
