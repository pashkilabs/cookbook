// @vitest-environment jsdom
//
// Opted in per file, as `cooked-opens-scores.test.tsx` explains: every other test here runs in node
// and several assert on `renderToStaticMarkup`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useWakeLock } from "../lib/use-wake-lock";

/**
 * What this suite proves, and what it cannot.
 *
 * **Measurable, and all of it about the sentinel:** that a lock was requested, that the state
 * reports it only when one is held, that it is re-requested after `visibilitychange`, that it is
 * released on exit, and that a refusal reads as a refusal.
 *
 * **Not measurable here: that the screen actually stayed lit.** That needs a physical phone and the
 * OS timeout elapsing. This is an instrument that reads the assertion rather than the subject —
 * the shape already on this project's list — so no test name below claims the screen stayed on.
 * They claim a lock was asked for, granted, re-asked and released, which is a different sentence.
 */

/** A sentinel that records releases and can fire its own `release` event, as the real one does. */
function fakeSentinel() {
  const listeners = new Set<() => void>();
  return {
    released: 0,
    async release() {
      this.released += 1;
      for (const listener of [...listeners]) listener();
    },
    addEventListener(_type: "release", listener: () => void) {
      listeners.add(listener);
    },
    removeEventListener(_type: "release", listener: () => void) {
      listeners.delete(listener);
    },
    /** the browser taking it back, which is not the same as us releasing it */
    revoke() {
      for (const listener of [...listeners]) listener();
    },
    get listening() {
      return listeners.size;
    },
  };
}

type Fake = ReturnType<typeof fakeSentinel>;

function installWakeLock(behaviour: () => Promise<Fake>) {
  const requests: number[] = [];
  Object.defineProperty(navigator, "wakeLock", {
    configurable: true,
    value: {
      request: (kind: string) => {
        requests.push(requests.length);
        expect(kind, "the only lock kind this feature wants").toBe("screen");
        return behaviour();
      },
    },
  });
  return requests;
}

function setVisibility(value: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
}

const visibilityChanged = async () => {
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
};

beforeEach(() => {
  setVisibility("visible");
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "wakeLock");
  Reflect.deleteProperty(document, "visibilityState");
  vi.unstubAllGlobals();
});

describe("asking the browser to keep the screen awake", () => {
  it("asks for a screen lock when the caller wants one", async () => {
    const sentinel = fakeSentinel();
    const requests = installWakeLock(async () => sentinel);

    const { result } = renderHook(() => useWakeLock(true));

    await waitFor(() => expect(result.current).toBe("holding"));
    expect(requests).toHaveLength(1);
  });

  it("asks for nothing when the caller does not want one", async () => {
    const requests = installWakeLock(async () => fakeSentinel());

    const { result } = renderHook(() => useWakeLock(false));

    await waitFor(() => expect(result.current).toBe("idle"));
    expect(requests).toHaveLength(0);
  });

  it("says unsupported when the browser has no wakeLock at all", async () => {
    // no installWakeLock: navigator.wakeLock is absent, which is what a caller needs in order to
    // not render a control that cannot do anything
    const { result } = renderHook(() => useWakeLock(true));

    await waitFor(() => expect(result.current).toBe("unsupported"));
  });

  it("says refused when the request is rejected, rather than staying silent", async () => {
    // NotAllowedError is what a hidden document, a refusing policy and Android's battery saver all
    // produce — a browser that supports the API perfectly and will not give you a lock
    installWakeLock(async () => {
      throw new DOMException("refused", "NotAllowedError");
    });

    const { result } = renderHook(() => useWakeLock(true));

    await waitFor(() => expect(result.current).toBe("refused"));
  });
});

describe("the lock the browser takes back when the document is hidden", () => {
  it("is asked for again when the document becomes visible", async () => {
    /*
     * regression: the fault every implementation of this ships. The sentinel is released when the
     * document becomes hidden and **does not come back** — switch apps, take a call, lock the
     * phone by hand. Without this the feature works for exactly as long as nobody touches the
     * phone, which is the scenario it exists for.
     */
    let sentinel = fakeSentinel();
    const requests = installWakeLock(async () => sentinel);

    const { result } = renderHook(() => useWakeLock(true));
    await waitFor(() => expect(result.current).toBe("holding"));
    expect(requests).toHaveLength(1);

    // the browser revokes it on the way out, as it does
    setVisibility("hidden");
    await act(async () => {
      sentinel.revoke();
    });
    await waitFor(() => expect(result.current).toBe("idle"));
    await visibilityChanged();
    expect(requests, "a request while hidden is refused, so it must not be made").toHaveLength(1);

    // and back
    sentinel = fakeSentinel();
    setVisibility("visible");
    await visibilityChanged();

    await waitFor(() => expect(result.current).toBe("holding"));
    expect(requests).toHaveLength(2);
  });

  it("is not asked for twice while one is still held", async () => {
    const sentinel = fakeSentinel();
    const requests = installWakeLock(async () => sentinel);

    const { result } = renderHook(() => useWakeLock(true));
    await waitFor(() => expect(result.current).toBe("holding"));

    // a visible-to-visible event, which fires more often than a tab actually leaves
    await visibilityChanged();
    await visibilityChanged();

    expect(requests).toHaveLength(1);
  });

  it("reports idle when the browser takes the lock back, not holding", async () => {
    // the state is the sentinel's, never the request's: a badge over a phone about to sleep is a
    // claim the person cannot check
    const sentinel = fakeSentinel();
    installWakeLock(async () => sentinel);

    const { result } = renderHook(() => useWakeLock(true));
    await waitFor(() => expect(result.current).toBe("holding"));

    await act(async () => {
      sentinel.revoke();
    });

    await waitFor(() => expect(result.current).toBe("idle"));
  });
});

describe("giving the lock back", () => {
  it("releases on unmount and stops listening to the document", async () => {
    const sentinel = fakeSentinel();
    const requests = installWakeLock(async () => sentinel);

    const { result, unmount } = renderHook(() => useWakeLock(true));
    await waitFor(() => expect(result.current).toBe("holding"));

    await act(async () => {
      unmount();
    });

    expect(sentinel.released).toBe(1);
    expect(sentinel.listening, "the release listener goes with it").toBe(0);

    // and a later visibilitychange must not resurrect it
    await visibilityChanged();
    expect(requests).toHaveLength(1);
  });

  it("releases when the caller stops wanting it", async () => {
    const sentinel = fakeSentinel();
    installWakeLock(async () => sentinel);

    const { result, rerender } = renderHook(({ on }) => useWakeLock(on), {
      initialProps: { on: true },
    });
    await waitFor(() => expect(result.current).toBe("holding"));

    await act(async () => {
      rerender({ on: false });
    });

    await waitFor(() => expect(result.current).toBe("idle"));
    expect(sentinel.released).toBe(1);
  });

  it("releases a lock that arrives after the caller has gone", async () => {
    /*
     * A request in flight outlives the effect that started it. Somebody who opens cook mode and
     * leaves within the round trip would otherwise hold a lock nothing can release — the browser
     * keeps the screen on for a page nobody is looking at, and no later unmount can undo it
     * because the ref was never set.
     */
    const sentinel = fakeSentinel();
    let settle: (() => void) | null = null;
    installWakeLock(
      () =>
        new Promise<Fake>((resolve) => {
          settle = () => resolve(sentinel);
        }),
    );

    const { unmount } = renderHook(() => useWakeLock(true));
    await act(async () => {
      unmount();
    });
    await act(async () => {
      settle?.();
    });

    await waitFor(() => expect(sentinel.released).toBe(1));
  });
});
