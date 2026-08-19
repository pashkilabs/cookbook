import type { PalateNote } from "@pashki/import";

/**
 * What children generally find demanding in this dish — a different kind of claim from a rating.
 *
 * **Visually distinct, and never sharing a sentence with an observation** (§57a). "Ada rated this
 * low" is a fact about a child; "children are more bitter-sensitive than adults" is a
 * generalisation about children. A reader can tell them apart only if the page does, so this is
 * its own block with its own heading and its own attribution line.
 *
 * Reasons, never a score (§59): the evidence supports directional principles and no coefficient,
 * so a number would be precision the research does not have. A reason can be judged by a parent
 * who knows their own child eats broccoli rabe quite happily.
 */
export function PalateNotes({ notes }: { notes: readonly PalateNote[] }) {
  if (notes.length === 0) return null;

  return (
    <aside className="notice" style={{ marginTop: "1.5rem" }}>
      <h3 style={{ margin: "0 0 0.5rem" }}>What children often find demanding</h3>
      <p className="meta" style={{ marginTop: 0 }}>
        General, not about anyone in this household — nobody here has rated this.
      </p>
      <ul>
        {notes.map((note) => (
          <li key={note.ingredient}>
            <strong>{note.ingredient}</strong> — {note.reason}
          </li>
        ))}
      </ul>
    </aside>
  );
}
