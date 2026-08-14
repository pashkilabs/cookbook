import { createClient } from "@supabase/supabase-js";
import { RECIPE_PHOTO_BUCKET } from "@pashki/import/photo-bucket";
import { machineCaller } from "@/lib/machine-auth";

/**
 * Remove the photographs nobody can reach.
 *
 * An import stores its picture before anyone agrees to save the recipe, and every storage read
 * policy resolves through a `photos` row — so an abandoned review leaves an object that is
 * unreachable by every client and deleted by nothing. It counts against the bucket forever, and
 * since §37 it is the publisher's full-size original rather than a resized copy.
 *
 * **This exists as a route, rather than in SQL, because storage objects cannot be deleted with
 * SQL.** `storage.protect_delete()` refuses direct deletes from `storage.objects` so that objects
 * are never orphaned by a stray statement — which is exactly right, and means the only door is
 * the Storage API, which needs the service role and therefore a server.
 *
 * The database decides *what* is collectable (`private.orphaned_photo_objects`, migration
 * 093000); this only carries out the removal. Grace windows and the rules about live import jobs
 * belong next to the tables they read, not in a route handler.
 */
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!(await machineCaller(request))) {
    return Response.json({ error: "sign in first" }, { status: 401 });
  }

  let graceHours = 24;
  try {
    const body = (await request.json()) as { graceHours?: unknown };
    if (Number.isInteger(body.graceHours) && (body.graceHours as number) >= 0) {
      graceHours = body.graceHours as number;
    }
  } catch {
    // no body is fine; the default matches the migration's
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return Response.json({ error: "storage credentials are not configured" }, { status: 503 });
  }
  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin.rpc("list_orphaned_photo_objects", {
    p_grace_hours: graceHours,
  });
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const orphans = (data ?? []) as Array<{ name: string; size_bytes: number }>;
  if (orphans.length === 0) {
    return Response.json({ collected: 0, bytes: 0, graceHours });
  }

  /*
   * A bounded slice per call. The Storage API takes a list, and a sweep that tried to remove ten
   * thousand objects in one request would be one timeout away from collecting none of them —
   * whereas the schedule comes round again in an hour.
   */
  const slice = orphans.slice(0, 200);
  const { error: removed } = await admin.storage
    .from(RECIPE_PHOTO_BUCKET)
    .remove(slice.map((orphan) => orphan.name));

  if (removed) {
    return Response.json({ error: removed.message, attempted: slice.length }, { status: 500 });
  }

  const bytes = slice.reduce((total, orphan) => total + Number(orphan.size_bytes ?? 0), 0);
  console.warn(`[pashki] reaped ${slice.length} unreachable photo objects (${bytes} bytes)`);

  return Response.json({
    collected: slice.length,
    bytes,
    remaining: orphans.length - slice.length,
    graceHours,
  });
}
