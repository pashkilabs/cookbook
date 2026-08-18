"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { uploadRecipePhoto } from "../photo-upload";
import { RecipeReview, type Draft, type Photo } from "./recipe-review";

/**
 * A folder of saved links, imported without pasting them one at a time.
 *
 * The queue behind this — `import_jobs`, its atomic claim and the runner — has existed since
 * Phase 2 and has never been reachable from the product. This is what reaches it.
 *
 * Three properties are worth naming, because they are the ones a batch gets wrong:
 *
 * - **A failed job does not block the others.** Each job is claimed, run and finished on its own;
 *   a 404 on line seven is a `failed` row and line eight runs regardless.
 * - **Accepting is per recipe.** Nineteen good imports are not held hostage by one bad one, and
 *   discarding is a decision about a single result rather than about the batch.
 * - **Social links never enter the queue.** They are refused when the batch is submitted, so
 *   nobody waits for an answer that was knowable immediately.
 */
type JobStatus = "queued" | "running" | "review" | "failed";

interface Job {
  id: string;
  url: string;
  status: JobStatus;
  queuedAt: string;
  draft?: Draft;
  photo?: Photo | null;
  fromCache?: boolean;
  message?: string;
}

interface SubmitResult {
  url: string;
  status: "queued" | "rejected" | "duplicate";
  message?: string;
}

export function BatchFlow() {
  const router = useRouter();
  const [urls, setUrls] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [refused, setRefused] = useState<SubmitResult[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<Record<string, string | null>>({});

  // survives re-renders without causing them, so the drain loop below has one owner
  const draining = useRef(false);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/import/jobs");
    if (!response.ok) return 0;
    const body = (await response.json().catch(() => ({}))) as { jobs?: Job[]; pending?: number };
    setJobs(body.jobs ?? []);
    return body.pending ?? 0;
  }, []);

  /**
   * Turn the handle until the queue is empty, refreshing between slices.
   *
   * Deliberately sequential and deliberately small: each call drains a few jobs and returns, so
   * the screen updates as results land rather than freezing until the last one. Nothing here
   * belongs in a browser in the long run — see the note under the form.
   */
  const drain = useCallback(async () => {
    if (draining.current) return;
    draining.current = true;
    setWorking(true);
    try {
      for (let slice = 0; slice < 40; slice += 1) {
        const response = await fetch("/api/import/drain", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ maxJobs: 3 }),
        });
        if (!response.ok) {
          setError("The importer stopped. Press “keep going” to carry on where it left off.");
          break;
        }
        const body = (await response.json().catch(() => ({}))) as { idle?: boolean };
        const pending = await refresh();
        // idle means this worker found nothing claimable; pending means nothing of ours is left
        if (body.idle || pending === 0) break;
      }
    } finally {
      draining.current = false;
      setWorking(false);
    }
  }, [refresh]);

  useEffect(() => {
    // anything left running from a closed tab is still claimable, so the screen picks it up
    void refresh().then((pending) => {
      if (pending > 0) void drain();
    });
  }, [refresh, drain]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch("/api/import/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ urls }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      results?: SubmitResult[];
      error?: string;
    };
    setBusy(false);
    if (!response.ok || !body.results) {
      setError(body.error ?? `that did not work (${response.status})`);
      return;
    }
    // rejected and duplicate lines never became jobs, so they are shown from the submission
    setRefused(body.results.filter((result) => result.status !== "queued"));
    setUrls("");
    await refresh();
    void drain();
  }

  async function accept(job: Job, edited: Draft, photoFile: File | null) {
    setSaving((current) => ({ ...current, [job.id]: null }));
    const response = await fetch(`/api/import/jobs/${job.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...edited, photo: job.photo ?? null }),
    });
    const body = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!response.ok || !body.id) {
      setSaving((current) => ({
        ...current,
        [job.id]: body.error ?? `could not save (${response.status})`,
      }));
      return;
    }
    // after the recipe exists, because a photo needs an id to hang on; a failure is reported
    // against this job and does not unwind the save
    if (photoFile) {
      const failed = await uploadRecipePhoto(body.id, photoFile).catch((thrown) =>
        thrown instanceof Error ? thrown.message : "that photo did not upload.",
      );
      if (failed) {
        setSaving((current) => ({ ...current, [job.id]: `Saved, but the photo did not: ${failed}` }));
      }
    }

    // the others stay exactly where they were
    setJobs((current) => current.filter((other) => other.id !== job.id));
    setOpen(null);
    router.refresh();
  }

  async function discard(job: Job) {
    await fetch(`/api/import/jobs/${job.id}`, { method: "DELETE" });
    setJobs((current) => current.filter((other) => other.id !== job.id));
    setOpen(null);
  }

  const ready = jobs.filter((job) => job.status === "review");
  const pending = jobs.filter((job) => job.status === "queued" || job.status === "running");
  const failed = jobs.filter((job) => job.status === "failed");

  return (
    <>
      <form className="stack" onSubmit={submit}>
        <div>
          <label htmlFor="urls">Recipe links — one per line</label>
          <textarea
            id="urls"
            rows={8}
            required
            placeholder={"https://www.example.com/recipes/carbonara\nhttps://www.example.com/recipes/ragu"}
            value={urls}
            onChange={(event) => setUrls(event.target.value)}
          />
        </div>
        <div className="tabs">
          <button type="submit" disabled={busy}>
            {busy ? "Queueing…" : "Queue these"}
          </button>
          {pending.length > 0 && !working && (
            <button type="button" className="quiet" onClick={() => void drain()}>
              Keep going
            </button>
          )}
        </div>
        {error && <p className="error">{error}</p>}
      </form>

      {refused.length > 0 && (
        <section>
          <h2>Not queued</h2>
          {refused.map((result, index) => (
            <div className="card" key={`${result.url}-${index}`}>
              <p style={{ margin: 0, wordBreak: "break-all" }}>{result.url}</p>
              <p className="meta" style={{ margin: "0.25rem 0 0" }}>{result.message}</p>
            </div>
          ))}
        </section>
      )}

      {pending.length > 0 && (
        <section>
          <h2>
            Working — {pending.length} left{working ? "" : " (paused)"}
          </h2>
          {pending.map((job) => (
            <div className="card" key={job.id}>
              <p style={{ margin: 0, wordBreak: "break-all" }}>{job.url}</p>
              <p className="meta" style={{ margin: "0.25rem 0 0" }}>
                {job.status === "running" ? "Reading the page…" : "Waiting its turn"}
              </p>
            </div>
          ))}
        </section>
      )}

      {ready.length > 0 && (
        <section>
          <h2>Ready to review — {ready.length}</h2>
          <p className="subtitle" style={{ marginBottom: "1rem" }}>
            Nothing here is saved yet. Look at each one, then keep it or throw it away.
          </p>
          {ready.map((job) => (
            <div className="card" key={job.id}>
              <p style={{ margin: 0 }}>
                <strong>{job.draft?.title}</strong>
              </p>
              <p className="meta" style={{ margin: "0.25rem 0 0", wordBreak: "break-all" }}>
                {job.url}
                {job.fromCache && " · already extracted for another household, no allowance spent"}
              </p>
              <div className="card-actions tabs" style={{ marginBottom: 0 }}>
                <button type="button" onClick={() => setOpen(open === job.id ? null : job.id)}>
                  {open === job.id ? "Close" : "Review"}
                </button>
                <button type="button" className="quiet danger" onClick={() => void discard(job)}>
                  Discard
                </button>
              </div>
              {open === job.id && job.draft && (
                <div style={{ marginTop: "1rem" }}>
                  <RecipeReview
                    draft={job.draft}
                    photo={job.photo ?? null}
                    fromCache={job.fromCache}
                    error={saving[job.id] ?? null}
                    saveLabel="Keep this one"
                    onSave={(edited, photoFile) => void accept(job, edited, photoFile)}
                    onDiscard={() => void discard(job)}
                  />
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {failed.length > 0 && (
        <section>
          <h2>Did not work — {failed.length}</h2>
          {failed.map((job) => (
            <div className="card" key={job.id}>
              <p style={{ margin: 0, wordBreak: "break-all" }}>{job.url}</p>
              <p className="meta" style={{ margin: "0.25rem 0 0" }}>{job.message}</p>
              <div className="card-actions">
                <button type="button" className="quiet" onClick={() => void discard(job)}>
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <div className="notice" style={{ marginTop: "1.5rem" }}>
        Imports run while this page is open. Closing it pauses the batch rather than losing it —
        the queue is in the database, and reopening this page carries on where it stopped.
      </div>
    </>
  );
}
