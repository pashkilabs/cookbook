import type { ExtractedRecipe, ImportFailure, ImportOptions, Tier } from "./types.js";
import { importRecipe } from "./pipeline.js";
import { extractWithLlm } from "./tier2.js";
import { hashUrl, normaliseUrl } from "./url.js";
import { missingFields } from "./recipe.js";

/**
 * Draining `import_jobs`.
 *
 * A runner rather than a container: callable from a test and from a route, so batch
 * import works before `apps/worker` exists and the deployment shape stays a separate
 * decision.
 *
 * **The runner never saves a recipe.** No import saves without the user seeing it
 * (CLAUDE.md), so a finished job lands in `review` carrying the extraction, and the
 * recipe rows appear when somebody accepts it. That also settles what idempotency
 * means here: a retried job cannot produce two recipes because it produces none. What
 * it could duplicate is quota and stored photo objects, and both are guarded below.
 */

export type ClaimableKind = "url" | "text" | "screenshot" | "video";

export interface ImportJob {
  id: string;
  familyId: string;
  kind: ClaimableKind;
  /** a URL for `url`, the pasted text for `text` */
  inputRef: string;
  attempts: number;
  /** non-null once quota has been spent for this job */
  quotaConsumedAt: string | null;
}

/**
 * What a finished job records.
 *
 * The failure is the typed `ImportFailure`, not a message. A UI has to say "Instagram
 * links never resolve, share a screenshot instead" rather than print a sentence a
 * worker happened to write, and a string cannot be branched on.
 */
export type JobResult =
  | {
      ok: true;
      recipe: ExtractedRecipe;
      tier: Tier;
      fromCache: boolean;
      /** where the photo was stored, if there was one */
      photo: StoredPhotoRef | null;
    }
  | { ok: false; failure: ImportFailure };

export interface FinishJobInput {
  jobId: string;
  status: "review" | "failed";
  result: JobResult;
  /** one line for logs and admin; the typed failure is in `result` */
  errorSummary: string | null;
}

/** The queue, behind a port so the runner can be tested without a database. */
export interface JobQueue {
  claim(worker: string): Promise<ImportJob | null>;
  finish(input: FinishJobInput): Promise<void>;
  markQuotaConsumed(jobId: string): Promise<void>;
}

/**
 * Quota, spent through the seam.
 *
 * A port because a worker is family-scoped and `PlatformClient` is account-scoped —
 * nobody is signed in. `createQuotaMeter` in `@pashki/platform-client` is the
 * implementation; counting locally would put a second opinion about the balance next
 * to the one the database enforces.
 */
export interface QuotaMeter {
  consume(familyId: string, amount: number): Promise<QuotaVerdict>;
}

export type QuotaVerdict =
  | { allowed: true }
  | { allowed: false; reason: "exceeded" | "no-entitlement"; detail?: string };

/** Where a job's photo ended up. Mirrors the columns on `photos`. */
export interface StoredPhotoRef {
  storagePath: string;
  width: number | null;
  height: number | null;
}

export interface JobRunnerOptions {
  queue: JobQueue;
  quota: QuotaMeter;
  /** identifies this process in `import_jobs.worker` */
  worker: string;
  /** fetcher, cache and optionally the llm cascade */
  imports: ImportOptions;
  /**
   * Stores the photo and says where it went.
   *
   * Injected so the runner does not pull in sharp or the Storage client. The `photoId`
   * it is given is the job id, so a retry overwrites the previous attempt instead of
   * leaving an orphan object nobody can reach.
   *
   * Dimensions come back with the path because nothing downstream can recover them: the bytes
   * are gone by the time a person reviews the job, and `photos.width`/`height` exist so a card
   * can reserve space before the image loads.
   */
  storePhoto?: (input: {
    familyId: string;
    bytes: Uint8Array;
    photoId: string;
  }) => Promise<StoredPhotoRef | null>;
}

export type JobOutcome =
  /** nothing claimable */
  | { status: "idle" }
  | { status: "review"; job: ImportJob; result: Extract<JobResult, { ok: true }> }
  | { status: "failed"; job: ImportJob; failure: ImportFailure };

/**
 * Claim one job and run it. Returns `idle` when the queue is empty.
 *
 * Never throws for an expected condition: a job that cannot be imported is a recorded
 * failure, because the point of the status column is that somebody can be told why.
 */
export async function runNextJob(options: JobRunnerOptions): Promise<JobOutcome> {
  const job = await options.queue.claim(options.worker);
  if (!job) return { status: "idle" };

  const fail = async (failure: ImportFailure, summary: string): Promise<JobOutcome> => {
    await options.queue.finish({
      jobId: job.id,
      status: "failed",
      result: { ok: false, failure },
      errorSummary: summary,
    });
    return { status: "failed", job, failure };
  };

  if (job.kind === "screenshot" || job.kind === "video") {
    // tier 3 takes images rather than a path in input_ref, and video is Phase 4.
    // Recorded as a typed refusal rather than left queued forever.
    return fail(
      { kind: "unsupported-job-kind", jobKind: job.kind },
      `${job.kind} jobs are not drained yet`,
    );
  }

  // Does this cost anything? A cached URL costs no model call, so it costs no quota.
  // Peeking the cache before charging is one cheap read; charging first and refunding
  // is the version that goes wrong.
  let cached = false;
  if (job.kind === "url" && options.imports.cache && !options.imports.refresh) {
    const normalised = normaliseUrl(job.inputRef);
    if (!("kind" in normalised)) {
      cached = (await options.imports.cache.get(hashUrl(normalised.href))) !== null;
    }
  }

  if (!cached && job.quotaConsumedAt === null) {
    const verdict = await options.quota.consume(job.familyId, 1);
    if (!verdict.allowed) {
      return fail(
        { kind: "quota-exceeded", reason: verdict.reason, detail: verdict.detail },
        `quota ${verdict.reason}`,
      );
    }
    // Recorded immediately after spending. A crash in between charges the household
    // once more on the retry — the alternative is a distributed transaction across the
    // quota function and this row, which is not worth it for a ceiling only abuse
    // reaches.
    await options.queue.markQuotaConsumed(job.id);
  }

  if (job.kind === "url") {
    const outcome = await importRecipe(job.inputRef, options.imports);
    if (!outcome.ok) return fail(outcome.failure, outcome.failure.kind);

    const photo =
      outcome.photo && options.storePhoto
        ? await options.storePhoto({
            familyId: job.familyId,
            bytes: outcome.photo.bytes,
            // the job id, so a retry replaces rather than orphans
            photoId: job.id,
          })
        : null;

    const result = {
      ok: true as const,
      recipe: outcome.recipe,
      tier: outcome.tier,
      fromCache: outcome.fromCache,
      photo,
    };
    await options.queue.finish({
      jobId: job.id,
      status: "review",
      result,
      errorSummary: null,
    });
    return { status: "review", job, result };
  }

  // text: a pasted caption has no markup, so the deterministic tiers have nothing to
  // read and this goes straight to tier 2
  if (!options.imports.llm) {
    return fail(
      { kind: "no-recipe-found", url: "", triedTiers: [] },
      "no model configured for pasted text",
    );
  }

  const llm = await extractWithLlm({
    content: job.inputRef,
    sourceUrl: "",
    sourceName: null,
    cascade: options.imports.llm,
  });

  if (!llm.recipe || missingFields(llm.recipe).length > 0) {
    return fail(
      { kind: "no-recipe-found", url: "", triedTiers: ["llm"] },
      "no recipe in the pasted text",
    );
  }

  const result = {
    ok: true as const,
    recipe: llm.recipe,
    tier: "llm" as Tier,
    fromCache: false,
    photo: null,
  };
  await options.queue.finish({
    jobId: job.id,
    status: "review",
    result,
    errorSummary: null,
  });
  return { status: "review", job, result };
}

/**
 * Run jobs until the queue is empty.
 *
 * `maxJobs` is a stop, not a target: a runner called from a route needs to return
 * inside a request timeout, and a runaway queue should not hold one open indefinitely.
 */
export async function drainQueue(
  options: JobRunnerOptions & { maxJobs?: number },
): Promise<JobOutcome[]> {
  const limit = options.maxJobs ?? 25;
  const outcomes: JobOutcome[] = [];

  for (let processed = 0; processed < limit; processed += 1) {
    const outcome = await runNextJob(options);
    if (outcome.status === "idle") break;
    outcomes.push(outcome);
  }
  return outcomes;
}
