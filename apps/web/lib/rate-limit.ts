/**
 * A fixed-window rate limiter, in memory.
 *
 * **In memory, which means per process.** Two instances behind a load balancer each allow
 * the full budget, and a restart forgets everything. That is stated rather than hidden
 * because it decides what this can and cannot be relied on for: it is a courtesy that stops
 * a person hammering *resend* by accident or impatience, not a defence. The real ceiling is
 * Supabase's own `rate_limit_email_sent`, which is 2 per hour in both environments and
 * enforced server-side where we cannot lose track of it.
 *
 * Fixed window rather than a sliding one: a sliding window needs the timestamp of every
 * request in the window, and for a limit of two the extra precision buys nothing.
 *
 * `now` is injectable so a test can advance time instead of sleeping through a window.
 */
export interface RateLimitVerdict {
  allowed: boolean;
  /** how long until the window resets; 0 when allowed */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  check(key: string): RateLimitVerdict;
  /** for tests, and for a long-running process that should not grow forever */
  prune(): void;
}

export function createRateLimiter(options: {
  limit: number;
  windowSeconds: number;
  now?: () => number;
}): RateLimiter {
  const now = options.now ?? Date.now;
  const windowMs = options.windowSeconds * 1000;
  const windows = new Map<string, { count: number; startedAt: number }>();

  return {
    check(key) {
      const at = now();
      const current = windows.get(key);

      if (!current || at - current.startedAt >= windowMs) {
        windows.set(key, { count: 1, startedAt: at });
        return { allowed: true, retryAfterSeconds: 0 };
      }

      if (current.count < options.limit) {
        current.count += 1;
        return { allowed: true, retryAfterSeconds: 0 };
      }

      const remaining = windowMs - (at - current.startedAt);
      return { allowed: false, retryAfterSeconds: Math.ceil(remaining / 1000) };
    },

    prune() {
      const at = now();
      for (const [key, window] of windows) {
        if (at - window.startedAt >= windowMs) windows.delete(key);
      }
    },
  };
}
