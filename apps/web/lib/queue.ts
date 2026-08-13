import { createClient } from "@supabase/supabase-js";
import {
  createHttpFetcher,
  drainQueue,
  type JobOutcome,
} from "@pashki/import";
import { createSupabaseImportCache } from "@pashki/import/supabase";
import { createSupabaseJobQueue } from "@pashki/import/job-queue";
import { storeImportedPhoto } from "@pashki/import/photo-storage";
import { createQuotaMeter } from "@pashki/platform-client";
import { createSupabasePlatformStore } from "@pashki/platform-client/supabase";

/**
 * The import queue, reachable from the product for the first time.
 *
 * `import_jobs` has had an atomic claim and a runner since Phase 2 and nothing ever called them.
 * A batch is what they exist for: twenty saved links should not be twenty visits to a form.
 *
 * **Tiers 0 and 1 only**, the same as the single-URL path — `ImportOptions.llm` is omitted, so no
 * model can be reached by accident.
 */
function serviceRole() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * Drain up to `maxJobs`.
 *
 * The claim is `FOR UPDATE SKIP LOCKED`, so two of these running at once take different rows
 * rather than the same one twice. The worker name records which process holds a job, which is
 * what makes a wedged one identifiable rather than merely stuck.
 *
 * **What production needs that this is not.** This runs inside a request: it is bounded by the
 * platform's request timeout, it stops when the response is sent, and nothing retries a job whose
 * lease expires because nothing is running when no one is looking. A deployed worker — the
 * `apps/worker` container in the roadmap, or a scheduled function — is what removes all three.
 * Until then a batch drains while somebody is on the page, which is honest for one household and
 * would not survive a second.
 */
export async function drainImportQueue(maxJobs = 25): Promise<JobOutcome[]> {
  const admin = serviceRole();

  return drainQueue({
    queue: createSupabaseJobQueue(admin),
    // through the seam: the spend is one conditional UPDATE in the database, never counted here
    quota: createQuotaMeter({ store: createSupabasePlatformStore(admin), appKey: "recipes" }),
    worker: `web-${process.pid}`,
    imports: {
      fetcher: createHttpFetcher(),
      cache: createSupabaseImportCache(admin),
      // no `llm`
    },
    storePhoto: async ({ familyId, bytes, photoId }) => {
      const stored = await storeImportedPhoto({ familyId, bytes, photoId }, { supabase: admin });
      // a photo that would not store is not a failed import — the recipe is the point
      if (!stored.ok) return null;
      return { storagePath: stored.storagePath, width: stored.width, height: stored.height };
    },
    maxJobs,
  });
}
