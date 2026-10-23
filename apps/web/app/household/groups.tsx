"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export interface GroupRow {
  id: string;
  name: string;
  items: number;
}

/**
 * The groups this household keeps, and the three things only a table can do.
 *
 * **Rename is the whole argument for the table.** A group was free text for one revision, and
 * renaming free text means finding every copy of the string and rewriting it — miss one and the
 * group silently splits in two. Here the items point at a row, so the name changes under them and
 * nothing is orphaned.
 *
 * **Delete keeps the shopping.** Removing a label must never remove a thing to buy, so the items
 * stay on the week, ungrouped, and the confirmation says how many and what happens to them rather
 * than asking "are you sure?" about a number the person cannot see.
 */
export function GroupSetting({ groups }: { groups: GroupRow[] }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();

  /**
   * One request, and every failure says something.
   *
   * A rejected `fetch` has two consequences — the pending flag and a silent screen — and the
   * second is the worse one, because a dropped write looks like it worked (§80). So the catch
   * writes a sentence as well as clearing `busy`.
   */
  async function send(
    method: "POST" | "PATCH" | "DELETE",
    body: Record<string, string> | null,
    query = "",
  ): Promise<{ created?: boolean; name?: string } | null> {
    if (busy) return null;
    setBusy(true);
    setError(null);
    setSaid(null);
    try {
      const response = await fetch(`/api/shopping-groups${query}`, {
        method,
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; name?: string; created?: boolean }
        | null;
      if (!response.ok) {
        setError(payload?.error ?? "That did not save.");
        return null;
      }
      startTransition(() => router.refresh());
      return payload ?? {};
    } catch {
      setError("No signal — that was not saved.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: "1rem" }}>
      {groups.length > 0 && (
        <ul className="roster">
          {groups.map((group) => (
            <li key={group.id}>
              <span className="who">
                <strong>{group.name}</strong>
                <span className="meta">
                  {group.items === 0
                    ? "nothing in it yet"
                    : `${group.items} ${group.items === 1 ? "thing" : "things"} on the list`}
                </span>
              </span>

              {confirming === group.id ? (
                /*
                 * The sentence names the consequence rather than asking "are you sure?". What a
                 * person needs to know is that the shopping survives — the count is right there,
                 * so "4 things" is checkable against the row above it.
                 */
                <span className="confirm">
                  <span className="meta" style={{ minWidth: 0 }}>
                    {group.items === 0
                      ? "Nothing is in it, so nothing moves."
                      : `The ${group.items} ${group.items === 1 ? "thing" : "things"} in it stay on the list, without a group.`}
                  </span>
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() => void send("DELETE", null, `?id=${encodeURIComponent(group.id)}`).then(() => setConfirming(null))}
                  >
                    Remove {group.name}
                  </button>
                  <button type="button" className="quiet" onClick={() => setConfirming(null)}>
                    Keep it
                  </button>
                </span>
              ) : (
                <span className="tabs">
                  <RenameGroup
                    group={group}
                    busy={busy}
                    onRename={async (name) => (await send("PATCH", { id: group.id, name })) !== null}
                  />
                  <button type="button" className="quiet" disabled={busy} onClick={() => setConfirming(group.id)}>
                    Remove
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        className="row"
        onSubmit={async (event) => {
          event.preventDefault();
          const result = await send("POST", { name: typed });
          if (!result) return;
          setTyped("");
          /*
           * A name that already exists **is** that group, which is the same rule the add box
           * follows: typing "costco" on Friday when "Costco" exists means Costco. So the screen
           * says which happened instead of refusing a duplicate.
           */
          setSaid(
            result.created === false
              ? `${result.name} is already here.`
              : `Added ${result.name}.`,
          );
        }}
      >
        <input
          aria-label="A new group"
          placeholder="Costco, Trader Joes, Boo Basket…"
          maxLength={60}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          style={{ minWidth: 0 }}
        />
        <button className="button" type="submit" disabled={busy || !typed.trim()} style={{ flex: "0 0 auto" }}>
          {busy ? "Adding…" : "Add group"}
        </button>
      </form>

      {said && <p className="meta">{said}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** Rename in place, so a row does not become a form until somebody asks it to. */
function RenameGroup({
  group,
  busy,
  onRename,
}: {
  group: GroupRow;
  busy: boolean;
  onRename: (value: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(group.name);

  if (!open) {
    return (
      <button type="button" className="quiet" disabled={busy} onClick={() => setOpen(true)}>
        Rename
      </button>
    );
  }

  return (
    <span className="confirm">
      <input
        aria-label={`What ${group.name} should be called`}
        value={value}
        maxLength={60}
        autoFocus
        onChange={(event) => setValue(event.target.value)}
        style={{ width: "9rem", minWidth: 0 }}
      />
      <button
        className="button"
        type="button"
        disabled={busy || !value.trim()}
        onClick={async () => {
          if (await onRename(value)) setOpen(false);
        }}
      >
        Save
      </button>
      <button type="button" className="quiet" onClick={() => { setValue(group.name); setOpen(false); }}>
        Cancel
      </button>
    </span>
  );
}
