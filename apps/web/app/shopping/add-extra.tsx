"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Add something to this week's list that no recipe asked for.
 *
 * **A text box, not a picker.** The catalog is the thing that makes a pint of cream one carton
 * across two meals, and it is also 200-odd items that somebody standing in a kitchen does not want
 * to scroll. Whatever they type goes through `parseIngredientList` — the same parser every recipe
 * line goes through — and if it names something the catalog knows it merges with the recipes and
 * gets package advice; if it does not, it becomes its own line in the words they used. Both are
 * correct outcomes and neither needs the person to know which they got.
 *
 * No review screen, deliberately. Every *import* passes one because a model wrote it; a person who
 * typed "milk" has already reviewed it, and a confirmation step on a shopping line is the kind of
 * friction that makes somebody write it on their hand instead.
 */
export function AddExtra({
  weekStart,
  extras,
  groups,
}: {
  weekStart: string;
  extras: Array<{ id: string; text: string; addedBy: string; group: string | null; groupId: string | null }>;
  groups: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  /*
   * The group lives beside the item, not on another screen.
   *
   * Somebody adding "2 lemons" is already thinking about where they are buying them; sending them
   * to Household to make a group first means nobody makes one. `""` is no group, which is what most
   * items have and always will — a recipe-derived item has no opinion about where to buy it.
   *
   * `__new` opens an inline field rather than navigating. The create path normalises exactly as the
   * match path does, so "costco" typed here when "Costco" exists resolves to Costco and says so
   * rather than making a near twin (§91).
   */
  const [group, setGroup] = useState("");

  const [newGroup, setNewGroup] = useState("");
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const typed = text.trim();
    if (!typed || busy) return;
    setBusy(true);
    setError(null);
    // `finally` for the flag, `catch` for the message — one rejection, two consequences (§80)
    try {
      const response = await fetch("/api/shopping-extras", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: typed,
          weekStart,
          ...(group === "__new"
            ? newGroup.trim()
              ? { groupName: newGroup.trim() }
              : {}
            : group
              ? { groupId: group }
              : {}),
        }),
      });
      if (!response.ok) {
        const failed = (await response.json().catch(() => ({}))) as { error?: string };
        setError(failed.error ?? `that did not work (${response.status})`);
        return;
      }
      const body = (await response.json().catch(() => ({}))) as {
        group?: string;
        groupCreated?: boolean;
      };
      setText("");
      setNewGroup("");
      /*
       * "Added to Costco" rather than an error, when a typed group already existed. The person
       * asked for that group and there is now one — saying which it went to is the whole feedback
       * they need, and saying "created" when it was not would be a small lie about their list.
       */
      if (body.group) {
        setSaid(body.groupCreated ? `Added to a new group, ${body.group}` : `Added to ${body.group}`);
        window.setTimeout(() => setSaid(null), 2500);
      }
      router.refresh();
    } catch {
      setError("No signal — that was not added. Try it again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setRemoving(id);
    setError(null);
    try {
      const response = await fetch(`/api/shopping-extras?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const failed = (await response.json().catch(() => ({}))) as { error?: string };
        setError(failed.error ?? `that did not work (${response.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("No signal — that was not removed.");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <section className="h-extras">
      <form onSubmit={add}>
        {/* labelled, because a bare box beside a shopping list does not say what it adds to */}
        <label className="h-extras-label" htmlFor="extra">
          Anything else you need
        </label>
        <div className="h-extras-row">
          <input
            id="extra"
            className="h-extras-input"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="2 lemons, a bag of rice…"
            maxLength={200}
            disabled={busy}
          />
          {/*
            * The group control, beside the item. `h-extras-group` rather than a bare select so it
            * can shrink: a non-shrinking control in a flex row is what put the page 176px past the
            * viewport once already (§81).
            */}
          <select
            className="h-extras-group"
            value={group}
            aria-label="Which group this is for"
            disabled={busy}
            onChange={(event) => setGroup(event.target.value)}
          >
            <option value="">No group</option>
            {groups.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
            <option value="__new">New group…</option>
          </select>
          <button type="submit" className="h-secondary" disabled={busy || text.trim().length === 0}>
            Add
          </button>
        </div>
      </form>

      {group === "__new" && (
        <div className="h-extras-row">
          <input
            className="h-extras-input"
            value={newGroup}
            aria-label="Name the new group"
            placeholder="Costco, Trader Joes, Boo Basket…"
            maxLength={60}
            disabled={busy}
            onChange={(event) => setNewGroup(event.target.value)}
          />
        </div>
      )}

      {said && <p className="meta">{said}</p>}

      {/*
        * A flat log of what was typed, with the group named beside it — **not** grouped.
        *
        * The grouping moved to the shopping list proper, where it belongs: a group is where
        * something is bought, so it needs tick boxes and package advice, and a person standing in
        * Costco wants the list rather than the record of requests. This panel answers a different
        * question — what have we typed, and how do I take one back off — so the group is a note on
        * the row. §78's third case: the same question answered deliberately elsewhere.
        */}
      {extras.length > 0 && (
        <ul className="h-extras-list">
          {extras.map((extra) => (
            <li key={extra.id} className="h-extras-item">
              {/*
                * `min-width: 0` on the text, because it is the flex child holding words and a long
                * unbreakable name would otherwise widen the row past the viewport — which makes the
                * *page* wider than the screen and sends every docked bar with it (§81).
                */}
              <span className="h-extras-text" style={{ minWidth: 0 }}>
                {extra.text}
                <span className="h-extras-who">
                  {extra.group ? ` — ${extra.group}, ${extra.addedBy}` : ` — ${extra.addedBy}`}
                </span>
              </span>
              <button
                type="button"
                className="h-icon"
                aria-label={`Remove ${extra.text}`}
                disabled={removing === extra.id}
                onClick={() => void remove(extra.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="error">{error}</p>}
    </section>
  );
}
