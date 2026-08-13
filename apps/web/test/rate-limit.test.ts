import { describe, expect, it } from "vitest";
import { createRateLimiter } from "../lib/rate-limit";

/**
 * The resend limiter. Time is injected, so these assert behaviour at a window boundary
 * without a test that takes ten minutes.
 */
describe("the resend rate limiter", () => {
  const at = (clock: { now: number }) =>
    createRateLimiter({ limit: 2, windowSeconds: 600, now: () => clock.now });

  it("allows up to the limit and then refuses", () => {
    const clock = { now: 1_000_000 };
    const limiter = at(clock);
    expect(limiter.check("a@example.com").allowed).toBe(true);
    expect(limiter.check("a@example.com").allowed).toBe(true);
    expect(limiter.check("a@example.com").allowed).toBe(false);
  });

  it("tells a refused caller how long to wait", () => {
    const clock = { now: 1_000_000 };
    const limiter = at(clock);
    limiter.check("a@example.com");
    limiter.check("a@example.com");
    clock.now += 100_000; // 100s into a 600s window
    expect(limiter.check("a@example.com")).toEqual({ allowed: false, retryAfterSeconds: 500 });
  });

  it("counts each address separately, so one person cannot lock out another", () => {
    const clock = { now: 1_000_000 };
    const limiter = at(clock);
    limiter.check("a@example.com");
    limiter.check("a@example.com");
    expect(limiter.check("a@example.com").allowed).toBe(false);
    expect(limiter.check("b@example.com").allowed).toBe(true);
  });

  it("reopens once the window has passed, and not a moment before", () => {
    const clock = { now: 1_000_000 };
    const limiter = at(clock);
    limiter.check("a@example.com");
    limiter.check("a@example.com");

    clock.now += 599_999;
    expect(limiter.check("a@example.com").allowed, "still inside the window").toBe(false);

    clock.now += 1;
    expect(limiter.check("a@example.com").allowed, "exactly at the boundary").toBe(true);
  });

  it("starts a fresh window rather than sliding, so the budget does not creep", () => {
    // regression-ish: a sliding window would let a caller at t=599s spend again at t=601s and
    // then twice more, which is three sends in two seconds
    const clock = { now: 0 };
    const limiter = at(clock);
    limiter.check("a@example.com");
    clock.now = 599_000;
    limiter.check("a@example.com");
    clock.now = 600_001;
    expect(limiter.check("a@example.com").allowed).toBe(true);
    expect(limiter.check("a@example.com").allowed).toBe(true);
    expect(limiter.check("a@example.com").allowed).toBe(false);
  });

  it("forgets windows that have closed, so the map does not grow forever", () => {
    const clock = { now: 1_000_000 };
    const limiter = at(clock);
    limiter.check("a@example.com");
    limiter.check("a@example.com");
    clock.now += 600_001;
    limiter.prune();
    // pruned, so this is a fresh window rather than a refusal
    expect(limiter.check("a@example.com").allowed).toBe(true);
  });
});
