import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { describeJob, type JobRow } from "@/lib/import-jobs";
import { refusal } from "@/lib/refusal";
import { statusFor } from "@/lib/recipe-writes";

/**
 * Where the batch has got to.
 *
 * **Filtered by `family_id` here, not only by RLS.** The policy on `import_jobs` is household-
 * scoped so a stranger's job is unreadable, but filtering in the query is the habit that matters:
 * the moment a table gains a public read path — as `recipes` did for published pages — a view
 * that leaned on RLS alone starts showing other people's kitchens.
 */
export async function GET() {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ error: "sign in first" }, { status: 401 });

  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) return Response.json({ error: "this account has no household" }, { status: 403 });

  const { data, error } = await supabase
    .from("import_jobs")
    .select("id, input_ref, status, error, result_json, created_at")
    .eq("family_id", family.id)
    .is("deleted_at", null)
    .in("status", ["queued", "running", "review", "failed"])
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) return Response.json({ error: refusal(error) }, { status: statusFor(error) });

  const jobs = (data ?? []).map((row) => describeJob(row as JobRow));
  return Response.json({
    jobs,
    // what the screen needs to decide whether to keep draining
    pending: jobs.filter((job) => job.status === "queued" || job.status === "running").length,
  });
}
