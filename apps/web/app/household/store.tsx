"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Which Kroger store this household shops at (§74).
 *
 * Beside units, timezone and avoided allergens, because it is the same kind of thing: a household
 * setting that governs a shared document. **Required before any export** — product search and
 * pricing both take a store, and §75 measured why that is the interesting part: the aisle in a
 * product response is *this* store's aisle, not a category average, which is what makes the
 * export worth having for somebody shopping in person.
 */
export function StoreSetting({
  current,
  environment,
}: {
  current: string | null;
  environment: string | null;
}) {
  const router = useRouter();
  const [near, setNear] = useState("");
  const [stores, setStores] = useState<Array<{ locationId: string; name: string; address: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!environment) {
    return (
      <p className="meta">
        Sending a list to a Kroger cart is not configured on this deployment.
      </p>
    );
  }

  async function look() {
    if (busy) return;
    setBusy(true);
    setError(null);
    // `finally`: an offline fetch rejects, and every control here is gated on this flag
    try {
      const response = await fetch(`/api/kroger/stores?near=${encodeURIComponent(near)}`);
      const body = (await response.json().catch(() => ({}))) as {
        stores?: Array<{ locationId: string; name: string; address: string }>;
        error?: string;
      };
      if (!response.ok) {
        setError(body.error ?? `that did not work (${response.status})`);
        return;
      }
      setStores(body.stores ?? []);
      if ((body.stores ?? []).length === 0) setError("No Kroger stores near that postcode.");
    } catch {
      setError("No signal — nothing was looked up.");
    } finally {
      setBusy(false);
    }
  }

  async function choose(locationId: string | null) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/household", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ krogerLocationId: locationId }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `that did not save (${response.status})`);
        return;
      }
      setStores([]);
      router.refresh();
    } catch {
      setError("No signal — that was not saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: "1rem" }}>
      {current ? (
        <p className="meta">
          Store <strong>{current}</strong> chosen.{" "}
          <button type="button" className="quiet" disabled={busy} onClick={() => choose(null)}>
            forget it
          </button>
        </p>
      ) : (
        <p className="meta">No store chosen, so nothing can be sent to a cart yet.</p>
      )}

      <div className="tabs" style={{ margin: 0 }}>
        <input
          value={near}
          onChange={(event) => setNear(event.target.value)}
          placeholder="postcode"
          inputMode="numeric"
          maxLength={5}
          disabled={busy}
        />
        <button type="button" className="button quiet" disabled={busy || near.length !== 5} onClick={look}>
          {busy ? "…" : "Find stores"}
        </button>
      </div>

      {stores.length > 0 && (
        <ul className="ingredients" style={{ marginTop: "0.6rem" }}>
          {stores.map((store) => (
            <li key={store.locationId}>
              <span>
                <strong>{store.name}</strong>
                <span className="meta"> — {store.address}</span>
              </span>
              <button type="button" className="quiet" disabled={busy} onClick={() => choose(store.locationId)}>
                choose
              </button>
            </li>
          ))}
        </ul>
      )}

      {/*
        * Which environment, on the screen. A certification cart is not a production cart, and
        * somebody testing this needs to know which one they are filling without reading a config
        * file (§74).
        */}
      <p className="meta">
        {environment === "certification"
          ? "This deployment is pointed at Kroger's certification environment, so a cart it fills is a test cart and no real order can result."
          : "This deployment is pointed at Kroger production — a cart it fills is your real cart."}
      </p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
