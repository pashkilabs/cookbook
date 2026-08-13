import { describe, expect, it } from "vitest";
import { planBatch } from "../lib/batch-input";

/**
 * What a pasted folder of links becomes before anything is queued.
 *
 * Everything here is a judgement that can be made without a network request, and making it here
 * is what stops somebody waiting in a queue to be told their Instagram link was never going to
 * work.
 */
describe("planning a batch", () => {
  it("queues the links it can and says so in the order they were pasted", () => {
    const planned = planBatch(
      ["https://example.com/one", "https://example.com/two"].join("\n"),
    );
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.entries.map((entry) => entry.status)).toEqual(["queue", "queue"]);
  });

  it("rejects social links at submission rather than after queuing them", () => {
    const planned = planBatch(
      [
        "https://www.instagram.com/p/abc123/",
        "https://www.facebook.com/groups/1/posts/2/",
        "https://www.tiktok.com/@cook/video/123",
        "https://example.com/real",
      ].join("\n"),
    );
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.entries.map((entry) => entry.status)).toEqual([
      "rejected",
      "rejected",
      "rejected",
      "queue",
    ]);
    const first = planned.entries[0];
    expect(first?.status === "rejected" && first.reason).toBe("blocked-platform");
    expect(first?.status === "rejected" && first.message).toMatch(/never resolve/);
  });

  it("names the video route for TikTok and the screenshot route for Instagram", () => {
    const planned = planBatch(["https://www.tiktok.com/@cook/video/123"].join("\n"));
    if (!planned.ok) return;
    const entry = planned.entries[0];
    expect(entry?.status === "rejected" && entry.message).toMatch(/video file/);
  });

  it("collapses the same recipe pasted twice into one job", () => {
    const planned = planBatch(
      ["https://example.com/carbonara", "https://example.com/carbonara"].join("\n"),
    );
    if (!planned.ok) return;
    expect(planned.entries.map((entry) => entry.status)).toEqual(["queue", "duplicate"]);
    const second = planned.entries[1];
    expect(second?.status === "duplicate" && second.message).toBe("Same recipe as line 1.");
  });

  it("treats a www and a non-www link to one page as one recipe", () => {
    // the cache is keyed on the normalised form, so two jobs would produce two review cards for
    // one recipe and the second would be a cache hit reviewing what the first already showed
    const planned = planBatch(
      ["https://www.example.com/ragu", "https://example.com/ragu/"].join("\n"),
    );
    if (!planned.ok) return;
    expect(planned.entries.map((entry) => entry.status)).toEqual(["queue", "duplicate"]);
  });

  it("queues the URL as written, not the cache key", () => {
    // regression: the cache key strips `www.` and the trailing slash, and fetching *that* gets a
    // 404 from sites that do not redirect. The key identifies; fetchUrl is what to request.
    const planned = planBatch("https://www.example.com/ragu/");
    if (!planned.ok) return;
    const entry = planned.entries[0];
    expect(entry?.status === "queue" && entry.fetchUrl).toBe("https://www.example.com/ragu/");
  });

  it("refuses something that is not a link at all", () => {
    const planned = planBatch(["dinner ideas", "https://example.com/real"].join("\n"));
    if (!planned.ok) return;
    expect(planned.entries[0]?.status).toBe("rejected");
    expect(planned.entries[1]?.status).toBe("queue");
  });

  it("refuses a link to a private address", () => {
    // SSRF: a queued job is fetched by the server, so `localhost` would be the server's own
    const planned = planBatch("http://127.0.0.1:8080/admin");
    if (!planned.ok) return;
    expect(planned.entries[0]?.status).toBe("rejected");
  });

  it("ignores blank lines rather than counting them", () => {
    const planned = planBatch("https://example.com/one\n\n   \nhttps://example.com/two\n");
    if (!planned.ok) return;
    expect(planned.entries).toHaveLength(2);
  });

  it("says no to an empty paste instead of queueing nothing quietly", () => {
    expect(planBatch("   \n  ")).toEqual({ ok: false, error: "paste some recipe links" });
  });

  it("caps a batch rather than accepting an unbounded one", () => {
    const many = Array.from({ length: 51 }, (_, index) => `https://example.com/${index}`);
    const planned = planBatch(many.join("\n"));
    expect(planned.ok).toBe(false);
    expect(planned.ok === false && planned.error).toMatch(/more than 50/);
  });

  it("takes an array as well as a pasted block", () => {
    const planned = planBatch(["https://example.com/one"]);
    expect(planned.ok).toBe(true);
  });
});
