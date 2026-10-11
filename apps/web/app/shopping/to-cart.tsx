"use client";

import { useState } from "react";

/**
 * Send the week's list to a Kroger cart (§74).
 *
 * ---------------------------------------------------------------------------
 * Built from what a real week returned, not from a guess at the screen
 * ---------------------------------------------------------------------------
 *
 * Run against this household's own store: 60 lines on the list, **49 already ticked**, 10 to
 * propose, 5 of which matched with two to five options each, carrying a price and the aisle in
 * that store. So the shape this needs is a short list of choices and a named list of things to
 * add by hand — not a progress bar, and not a single "send" that implies the machine got it right.
 *
 * ---------------------------------------------------------------------------
 * The review IS the mechanism
 * ---------------------------------------------------------------------------
 *
 * §75 measured a matcher returning parmesan for red pepper flakes with the correct products in the
 * same result set, and this run returned **body oil for sesame oil** and **sun cream for coconut
 * oil**, both priced and both first. Filtering non-food categories fixed those two — and the
 * residue is still shown, with its category, because a filter cannot judge what it has not heard
 * of. Every option is a proposal; nothing is chosen on anybody's behalf.
 *
 * ---------------------------------------------------------------------------
 * There is no undo
 * ---------------------------------------------------------------------------
 *
 * Kroger's cart cannot be read or corrected — confirmed with a valid token: the read paths are 404
 * while a forbidden one is 403. So sending twice doubles the order and nothing can detect it, and
 * the sentence saying so is **on the control** rather than in a dialog somebody dismisses.
 */
export interface CartProposal {
  key: string;
  label: string;
  needed: string;
  alreadyInCart: boolean;
  products: Array<{
    upc: string;
    description: string;
    size: string | null;
    priceCents: number | null;
    aisle: string | null;
    categories: string[];
  }>;
}

export function ToCart({ weekStart, environment }: { weekStart: string; environment: string | null }) {
  const [state, setState] = useState<"idle" | "looking" | "ready" | "sending">("idle");
  const [proposals, setProposals] = useState<CartProposal[]>([]);
  const [unavailable, setUnavailable] = useState<Array<{ label: string; reason: string }>>([]);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [previous, setPrevious] = useState<{ at: string | null; items: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!environment) return null;

  async function look() {
    setState("looking");
    setError(null);
    // `finally`: an offline fetch rejects, and every control here is gated on this flag
    try {
      const response = await fetch("/api/kroger/propose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weekStart }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        proposals?: CartProposal[];
        unavailable?: Array<{ label: string; reason: string }>;
        previouslySent?: { at: string | null; items: number } | null;
        error?: string;
      };
      if (!response.ok) {
        setError(body.error ?? `that did not work (${response.status})`);
        setState("idle");
        return;
      }
      setProposals(body.proposals ?? []);
      setUnavailable(body.unavailable ?? []);
      setPrevious(body.previouslySent ?? null);
      // the first option is a default, never a decision — a person can change every one
      setChosen(Object.fromEntries((body.proposals ?? []).map((p) => [p.key, p.products[0]?.upc ?? ""])));
      setState("ready");
    } catch {
      setError("No signal — nothing was looked up.");
      setState("idle");
    } finally {
      if (state === "looking") setState((was) => (was === "looking" ? "idle" : was));
    }
  }

  async function send() {
    setState("sending");
    setError(null);
    try {
      const items = proposals
        .filter((proposal) => chosen[proposal.key])
        .map((proposal) => ({ upc: chosen[proposal.key]!, quantity: 1 }));
      const response = await fetch("/api/kroger/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          weekStart,
          items,
          lineKeys: proposals.filter((p) => chosen[p.key]).map((p) => p.key),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { authorizeUrl?: string; error?: string; detail?: string };
      if (!response.ok) {
        setError([body.error, body.detail].filter(Boolean).join(" "));
        setState("ready");
        return;
      }
      // Kroger's own sign-in: the only place a cart-writing token can come from, and the person
      // authorises against their own account rather than ours
      if (body.authorizeUrl) window.location.href = body.authorizeUrl;
    } catch {
      setError("No signal — nothing was sent.");
      setState("ready");
    }
  }

  const money = (cents: number | null) => (cents === null ? "no price" : `$${(cents / 100).toFixed(2)}`);
  const chosenCount = proposals.filter((proposal) => chosen[proposal.key]).length;

  return (
    <section style={{ marginTop: "2rem" }}>
      <h2>Send to your Kroger cart</h2>

      {state === "idle" && (
        <>
          <p className="meta">
            Matches each thing on this list to a product at your store, with its shelf price and
            the aisle it is in — then you choose, and it goes to your cart.
          </p>
          <button type="button" className="button" onClick={look}>
            See what it would send
          </button>
        </>
      )}

      {state === "looking" && (
        <p className="meta" aria-live="polite">
          Asking your store about each thing on the list — a few seconds.
        </p>
      )}

      {(state === "ready" || state === "sending") && (
        <>
          {previous && (
            <p className="meta">
              <strong>You already sent {previous.items} items for this week.</strong> Kroger&rsquo;s
              cart cannot be read back, so anything sent again is added a second time — the rows
              below marked <em>already sent</em> are the ones to leave unticked.
            </p>
          )}

          {proposals.length === 0 ? (
            <p className="meta">Nothing on this list matched a product at your store.</p>
          ) : (
            <ul className="ingredients">
              {proposals.map((proposal) => (
                <li key={proposal.key}>
                  <span>
                    <strong>{proposal.label}</strong>
                    <span className="meta"> · {proposal.needed}</span>
                    {proposal.alreadyInCart && <span className="meta"> · already sent</span>}
                    <br />
                    <select
                      value={chosen[proposal.key] ?? ""}
                      onChange={(event) =>
                        setChosen((was) => ({ ...was, [proposal.key]: event.target.value }))
                      }
                      disabled={state === "sending"}
                    >
                      <option value="">— don&rsquo;t send this —</option>
                      {proposal.products.map((product) => (
                        <option key={product.upc} value={product.upc}>
                          {product.description}
                          {product.size ? ` · ${product.size}` : ""} · {money(product.priceCents)}
                          {product.aisle ? ` · ${product.aisle}` : ""}
                          {/* the category, because a filter cannot judge what it has not heard of */}
                          {product.categories.length > 0 ? ` · ${product.categories[0]}` : ""}
                        </option>
                      ))}
                    </select>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {unavailable.length > 0 && (
            <p className="meta">
              <strong>Add these yourself:</strong>{" "}
              {unavailable.map((item) => item.label).join(", ")} — nothing at your store matched
              them, so they are not in what gets sent.
            </p>
          )}

          <p className="meta">
            {environment === "certification"
              ? "This deployment is pointed at Kroger's certification environment, so this fills a test cart and no real order can result."
              : "This fills your real Kroger cart."}{" "}
            <strong>There is no undo:</strong> Kroger&rsquo;s cart cannot be read back or corrected,
            so sending the same thing twice adds it twice.
          </p>

          <button type="button" className="button" disabled={state === "sending" || chosenCount === 0} onClick={send}>
            {state === "sending"
              ? "Taking you to Kroger…"
              : `Send ${chosenCount} item${chosenCount === 1 ? "" : "s"} to my cart`}
          </button>
        </>
      )}

      {error && <p className="error">{error}</p>}
    </section>
  );
}
