"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * The roster, and the three things a household does to it.
 *
 * Colour is never the only signal: every dot sits beside a name, because two of these hues are a
 * harder pair than they look under deuteranopia, and a colour that identifies nobody is
 * decoration.
 *
 * **The palette arrives as a prop.** `@pashki/platform-client` is server-only — it can hold the
 * service role — so importing it here would put the seam in a client bundle, which
 * `check-server-only.mjs` refuses. It caught exactly that on the first attempt.
 */
export interface RosterColour {
  key: string;
  label: string;
}

export interface RosterMember {
  id: string;
  displayName: string;
  colour: string | null;
  isChild: boolean;
  isYou: boolean;
}

export function Roster({ members, colours }: { members: RosterMember[]; colours: RosterColour[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function send(method: string, body: unknown) {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/members", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setError(parsed.error ?? `that did not work (${response.status})`);
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <>
      <ul className="roster">
        {members.map((member) => (
          <li key={member.id}>
            <span className={`dot ${member.colour ?? ""}`} aria-hidden="true" />
            <span className="who">
              <strong>{member.displayName}</strong>
              <span className="meta">
                {member.isYou ? "you" : member.isChild ? "child" : "adult"}
              </span>
            </span>

            {editing === member.id ? (
              <span className="chips">
                {colours.map((colour) => (
                  <button
                    key={colour.key}
                    type="button"
                    className={`swatch ${colour.key}${member.colour === colour.key ? " on" : ""}`}
                    title={colour.label}
                    aria-label={colour.label}
                    disabled={busy}
                    onClick={async () => {
                      if (await send("PATCH", { id: member.id, colour: colour.key })) {
                        setEditing(null);
                      }
                    }}
                  />
                ))}
                <button type="button" className="quiet" onClick={() => setEditing(null)}>
                  Done
                </button>
              </span>
            ) : confirming === member.id ? (
              // inline, not confirm(): better on a phone and an embedding context cannot
              // suppress it (CLAUDE.md)
              <span className="confirm">
                <span className="meta">Remove {member.displayName}?</span>
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={() => send("DELETE", { id: member.id })}
                >
                  Remove
                </button>
                <button type="button" className="quiet" onClick={() => setConfirming(null)}>
                  Keep
                </button>
              </span>
            ) : (
              <span className="tabs" style={{ margin: 0 }}>
                <button type="button" className="quiet" onClick={() => setEditing(member.id)}>
                  Colour
                </button>
                <RenameButton member={member} busy={busy} onRename={(value) =>
                  send("PATCH", { id: member.id, displayName: value })} />
                {!member.isYou && (
                  <button type="button" className="quiet" onClick={() => setConfirming(member.id)}>
                    Remove
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>

      <form
        className="stack"
        style={{ maxWidth: "none" }}
        onSubmit={async (event) => {
          event.preventDefault();
          if (await send("POST", { displayName: name })) setName("");
        }}
      >
        <div>
          <label htmlFor="member-name">Add someone</label>
          <div className="row">
            <input
              id="member-name"
              required
              placeholder="Their name"
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
            />
            <button type="submit" disabled={busy || !name.trim()} style={{ flex: "0 0 auto" }}>
              {busy ? "Adding…" : "Add"}
            </button>
          </div>
        </div>
      </form>

      {error && <p className="error">{error}</p>}

      <div className="notice" style={{ marginTop: "1.5rem" }}>
        Adding an adult who signs in for themselves is not built yet — everyone added here is
        rated but does not have an account.
      </div>
    </>
  );
}

/** Rename in place, so the row does not become a form. */
function RenameButton({
  member,
  busy,
  onRename,
}: {
  member: RosterMember;
  busy: boolean;
  onRename: (value: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(member.displayName);

  if (!open) {
    return (
      <button type="button" className="quiet" onClick={() => setOpen(true)}>
        Rename
      </button>
    );
  }

  return (
    <span className="confirm">
      <input
        value={value}
        maxLength={60}
        autoFocus
        onChange={(event) => setValue(event.target.value)}
        style={{ width: "9rem" }}
      />
      <button
        type="button"
        disabled={busy || !value.trim()}
        onClick={async () => {
          if (await onRename(value)) setOpen(false);
        }}
      >
        Save
      </button>
      <button type="button" className="quiet" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </span>
  );
}
