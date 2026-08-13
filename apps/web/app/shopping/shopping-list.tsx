"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ShoppingLine } from "@pashki/core";

/**
 * The list, and the two things you can do to it while standing in a shop.
 *
 * Every string on a line — the amount needed, the packages to buy, what each recipe takes, what
 * is left spare — was produced by `consolidate()`. This component chooses layout and nothing
 * else. If a number looks wrong, the fix is a test in `packages/core`.
 *
 * **The package line is the point of the product**, so it is the loudest thing on the row rather
 * than a subtitle: "buy 1 pint" above "Tuesday takes 1 cup, Friday takes ½ cup, 100 ml spare" is
 * the whole pitch — one pint bought instead of two half-pints and waste.
 */
export function ShoppingList(props: {
  weekStart: string;
  plannedCount: number;
  byAisle: Array<{ aisle: string; lines: ShoppingLine[] }>;
  leftovers: ShoppingLine[];
  suggestions: Array<{ id: string; title: string; uses: string[] }>;
  pantry: Array<{ id: string; name: string }>;
  ticked: string[];
}) {
  const router = useRouter();
  const [ticked, setTicked] = useState(new Set(props.ticked));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function call(key: string, path: string, method: string, body: unknown) {
    setBusy(key);
    setError(null);
    const response = await fetch(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(null);
    if (!response.ok) {
      const failed = (await response.json().catch(() => ({}))) as { error?: string };
      setError(failed.error ?? `that did not work (${response.status})`);
      return false;
    }
    return true;
  }

  async function toggleTick(line: ShoppingLine) {
    const on = ticked.has(line.key);
    // moved immediately: this is a shop, and waiting for a round trip to cross something off is
    // the difference between usable and not. Rolled back if the write is refused.
    setTicked((current) => {
      const next = new Set(current);
      if (on) next.delete(line.key);
      else next.add(line.key);
      return next;
    });
    const ok = await call(`tick-${line.key}`, "/api/shopping-ticks", on ? "DELETE" : "POST", {
      weekStart: props.weekStart,
      itemKey: line.key,
    });
    if (!ok) {
      setTicked((current) => {
        const next = new Set(current);
        if (on) next.add(line.key);
        else next.delete(line.key);
        return next;
      });
    }
  }

  async function togglePantry(line: ShoppingLine) {
    const held = props.pantry.find((item) => item.name.toLowerCase() === line.label.toLowerCase());
    const ok = held
      ? await call(`pantry-${line.key}`, "/api/pantry", "DELETE", { id: held.id })
      : await call(`pantry-${line.key}`, "/api/pantry", "POST", { name: line.label });
    // the list itself changes — a pantry item can remove a line's need entirely — so re-read
    if (ok) router.refresh();
  }

  const total = props.byAisle.reduce((sum, group) => sum + group.lines.length, 0);

  return (
    <>
      {error && <p className="error">{error}</p>}

      <p className="subtitle">
        {total} {total === 1 ? "item" : "items"} for {props.plannedCount}{" "}
        {props.plannedCount === 1 ? "meal" : "meals"} · {ticked.size} in the trolley
      </p>

      {props.byAisle.map((group) => (
        <section key={group.aisle} className="aisle">
          <h2>{group.aisle}</h2>
          {group.lines.map((line) => {
            const isTicked = ticked.has(line.key);
            const inPantry = line.inPantry;
            return (
              <div className={isTicked ? "line ticked" : "line"} key={line.key}>
                <label className="tick">
                  <input
                    type="checkbox"
                    checked={isTicked}
                    disabled={busy !== null}
                    onChange={() => toggleTick(line)}
                    aria-label={`Got ${line.label}`}
                  />
                </label>

                <div className="what">
                  <p className="buy">
                    {/* the package decision, said plainly */}
                    {line.packagesDisplay ? (
                      <>
                        <strong>{line.packagesDisplay}</strong>{" "}
                        <span className="meta">of {line.label}</span>
                      </>
                    ) : (
                      <>
                        <strong>{line.neededDisplay || line.label}</strong>{" "}
                        {line.neededDisplay && <span className="meta">{line.label}</span>}
                      </>
                    )}
                    {inPantry && <span className="chip pantry">in the pantry</span>}
                  </p>

                  {/* what each meal takes out of it, and what survives */}
                  <p className="split">
                    {line.uses.map((use, index) => (
                      <span key={index}>
                        {use.label} takes {use.display || "some"}
                      </span>
                    ))}
                    {line.leftoverDisplay && (
                      <span className="spare">{line.leftoverDisplay} spare</span>
                    )}
                  </p>

                  {line.otherDimensions.length > 0 && (
                    <p className="meta">
                      also {line.otherDimensions.map((other) => other.display).join(", ")}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  className="quiet"
                  disabled={busy !== null}
                  title={inPantry ? "Take it out of the pantry" : "I already have this"}
                  onClick={() => togglePantry(line)}
                >
                  {inPantry ? "Not in pantry" : "Have it"}
                </button>
              </div>
            );
          })}
        </section>
      ))}

      {props.suggestions.length > 0 && (
        <section>
          <h2>Uses up the spare</h2>
          <p className="subtitle" style={{ marginBottom: "0.75rem" }}>
            {props.leftovers.map((line) => `${line.leftoverDisplay} ${line.label}`).join(" · ")}
          </p>
          <ul className="waiting">
            {props.suggestions.map((suggestion) => (
              <li key={suggestion.id}>
                <Link href={`/recipes/${suggestion.id}`}>{suggestion.title}</Link>
                {suggestion.uses.length > 0 && (
                  <span className="meta">uses the {suggestion.uses.join(", ")}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {props.pantry.length > 0 && (
        <section>
          <h2>Pantry</h2>
          <p className="subtitle" style={{ marginBottom: "0.75rem" }}>
            Things you already have. They stay on the list, marked, so you can see what a meal
            needs even when you are not buying it.
          </p>
          <ul className="chips">
            {props.pantry.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="chip"
                  disabled={busy !== null}
                  onClick={async () => {
                    if (await call(`pantry-${item.id}`, "/api/pantry", "DELETE", { id: item.id })) {
                      router.refresh();
                    }
                  }}
                >
                  {item.name} ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
