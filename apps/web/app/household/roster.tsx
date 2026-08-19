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
  /** a year, not an age: an age is stale within twelve months */
  birthYear: number | null;
  isYou: boolean;
}

export interface PendingInvitation {
  id: string;
  email: string;
  expiresAt: string;
}

export function Roster({
  members,
  colours,
  invitations,
}: {
  members: RosterMember[];
  colours: RosterColour[];
  invitations: PendingInvitation[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  /*
   * A year rather than an age, and optional.
   *
   * An age is stale within twelve months and needs somebody to remember; a year is a fact. It is
   * what makes a five-point rating readable across a spread of ages — a 3 from a seven-year-old
   * and a 3 from a fourteen-year-old are not the same 3.
   */
  const [year, setYear] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [invitee, setInvitee] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  async function send(method: string, body: unknown, path = "/api/members") {
    setBusy(true);
    setError(null);
    setNotice(null);
    const response = await fetch(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = (await response.json().catch(() => ({}))) as { error?: string; sent?: boolean };
    setBusy(false);
    // 202: the invitation is recorded and the email did not go. Said out loud rather than
    // reported as success, because the person will not receive anything.
    if (response.status === 202) {
      setNotice(parsed.error ?? "Saved, but the email could not be sent.");
      router.refresh();
      return true;
    }
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
                {member.birthYear !== null && ` · born ${member.birthYear}`}
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
                <YearField member={member} onSave={(birthYear) =>
                  send("PATCH", { id: member.id, birthYear })} />
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
          if (await send("POST", { displayName: name, birthYear: year || null })) {
            setName("");
            setYear("");
          }
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
            <input
              aria-label="Year of birth, optional"
              placeholder="Born (optional)"
              inputMode="numeric"
              value={year}
              onChange={(event) => setYear(event.target.value.replace(/\D/g, "").slice(0, 4))}
              style={{ flex: "0 0 9rem" }}
            />
            <button type="submit" disabled={busy || !name.trim()} style={{ flex: "0 0 auto" }}>
              {busy ? "Adding…" : "Add"}
            </button>
          </div>
        </div>
      </form>

      {error && <p className="error">{error}</p>}

      <section style={{ marginTop: "2rem" }}>
        <h2>Invite an adult</h2>
        <p className="subtitle" style={{ marginBottom: "1rem" }}>
          They sign in for themselves and share everything — recipes, the week, the shopping list.
          The link works once and expires in seven days.
        </p>

        {invitations.length > 0 && (
          <ul className="roster">
            {invitations.map((invitation) => (
              <li key={invitation.id}>
                <span className="dot" aria-hidden="true" />
                <span className="who">
                  <strong>{invitation.email}</strong>
                  <span className="meta">invited, not yet accepted</span>
                </span>
                <button
                  type="button"
                  className="quiet"
                  disabled={busy}
                  onClick={() => send("DELETE", { id: invitation.id }, "/api/invitations")}
                >
                  Withdraw
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          className="stack"
          style={{ maxWidth: "none" }}
          onSubmit={async (event) => {
            event.preventDefault();
            const result = await send("POST", { email: invitee }, "/api/invitations");
            if (result) setInvitee("");
          }}
        >
          <div>
            <label htmlFor="invite-email">Their email address</label>
            <div className="row">
              <input
                id="invite-email"
                type="email"
                required
                placeholder="them@example.com"
                value={invitee}
                onChange={(event) => setInvitee(event.target.value)}
              />
              <button type="submit" disabled={busy || !invitee.trim()} style={{ flex: "0 0 auto" }}>
                {busy ? "Sending…" : "Send invitation"}
              </button>
            </div>
          </div>
        </form>
        {notice && <p className="meta">{notice}</p>}
      </section>
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

/**
 * Edit a year of birth in place. Blank clears it — a household may have recorded one and want it
 * gone, and refusing to accept "unanswered" would make the field a trap.
 */
function YearField({
  member,
  onSave,
}: {
  member: RosterMember;
  onSave: (birthYear: number | null) => Promise<boolean>;
}) {
  const [value, setValue] = useState(member.birthYear === null ? "" : String(member.birthYear));
  const dirty = value !== (member.birthYear === null ? "" : String(member.birthYear));

  return (
    <span className="row" style={{ gap: "0.35rem" }}>
      <input
        aria-label={`Year ${member.displayName} was born`}
        placeholder="Born"
        inputMode="numeric"
        value={value}
        onChange={(event) => setValue(event.target.value.replace(/\D/g, "").slice(0, 4))}
        style={{ flex: "0 0 6rem" }}
      />
      {dirty && (
        <button type="button" className="button quiet" onClick={() => onSave(value ? Number(value) : null)}>
          Save
        </button>
      )}
    </span>
  );
}
