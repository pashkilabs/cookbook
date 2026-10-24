"use client";

export interface GroupOption {
  id: string;
  name: string;
}

/**
 * The one group picker.
 *
 * Lifted out of the add box rather than reimplemented beside it, and the reason is the whole point
 * of the groups table: **a second picker with its own normalisation is how "costco" and "Costco"
 * come back.** Both callers hand their choice to the same routes, which hand it to
 * `findOrCreateGroup`, which is the only thing that decides whether a typed name is a new group.
 *
 * `NEW_GROUP` is the sentinel the caller watches for to show the naming field; it is deliberately
 * not a valid uuid, so a stray one cannot be mistaken for a group id by anything downstream.
 */
export const NEW_GROUP = "__new";

export function GroupPicker({
  groups,
  value,
  onChange,
  disabled = false,
  label = "Which group this is for",
}: {
  groups: GroupOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    /*
     * `h-extras-group` rather than a bare select so it can shrink: a non-shrinking control in a
     * flex row is what put the page 176px past the viewport once already (§81).
     */
    <select
      className="h-extras-group"
      value={value}
      aria-label={label}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">No group</option>
      {groups.map((option) => (
        <option key={option.id} value={option.id}>
          {option.name}
        </option>
      ))}
      <option value={NEW_GROUP}>New group…</option>
    </select>
  );
}

/** The field that names a group being created, shown only while the picker says `NEW_GROUP`. */
export function NewGroupField({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <input
      className="h-extras-input"
      value={value}
      aria-label="Name the new group"
      placeholder="Costco, Trader Joes, Boo Basket…"
      maxLength={60}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
