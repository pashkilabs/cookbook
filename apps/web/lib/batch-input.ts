import { blockedPlatform, normaliseUrl } from "@pashki/import";

/**
 * Decide what a pasted block of links becomes, before anything is queued.
 *
 * Pure, and separate from the route, because this is where a batch is either honest or annoying:
 * every judgement that can be made without a network request is made here, so nobody waits in a
 * queue to be told something that was knowable at submission.
 */
export const MAX_URLS = 50;

export type BatchEntry =
  | { line: string; status: "queue"; fetchUrl: string }
  | { line: string; status: "rejected"; reason: string; message: string }
  | { line: string; status: "duplicate"; message: string };

export function planBatch(input: unknown, max = MAX_URLS):
  | { ok: false; error: string }
  | { ok: true; entries: BatchEntry[] } {
  const lines =
    typeof input === "string"
      ? input.split("\n")
      : Array.isArray(input)
        ? input.filter((line): line is string => typeof line === "string")
        : [];

  const trimmed = lines.map((line) => line.trim()).filter(Boolean);
  if (trimmed.length === 0) return { ok: false, error: "paste some recipe links" };
  if (trimmed.length > max) {
    return { ok: false, error: `that is more than ${max} links at once` };
  }

  /**
   * Duplicates collapse on the **normalised** URL, which is what the cache is keyed on — so the
   * same recipe with and without a `www.`, or with a tracking parameter, counts once. Queueing it
   * twice would produce two review cards for one recipe and ask somebody to notice.
   */
  const seen = new Map<string, number>();

  return {
    ok: true,
    entries: trimmed.map((line, index): BatchEntry => {
      const normalised = normaliseUrl(line);
      if ("kind" in normalised) {
        return {
          line,
          status: "rejected",
          reason: normalised.kind,
          message: "That does not look like a recipe link.",
        };
      }

      const blocked = blockedPlatform(normalised.host);
      if (blocked) {
        return {
          line,
          status: "rejected",
          reason: "blocked-platform",
          // refused here rather than after a place in the queue and four doomed attempts
          message:
            `${blocked.platform} links never resolve to a page containing the recipe. ` +
            (blocked.useInstead === "video"
              ? "Share the video file instead — that path arrives in a later phase."
              : "Import a screenshot instead — that path arrives in a later phase."),
        };
      }

      const first = seen.get(normalised.href);
      if (first !== undefined) {
        return { line, status: "duplicate", message: `Same recipe as line ${first + 1}.` };
      }
      seen.set(normalised.href, index);

      // `fetchUrl`, not the cache key: the key strips `www.` and trailing slashes, and requesting
      // it gets a 404 from sites that do not redirect
      return { line, status: "queue", fetchUrl: normalised.fetchUrl };
    }),
  };
}
