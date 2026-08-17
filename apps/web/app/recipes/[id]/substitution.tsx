import type { SubstitutionEntry } from "@pashki/core";

/**
 * "No buttermilk?" — the answer, inline, with what it costs.
 *
 * A `<details>` rather than a component with state: this is read-only and needs no JavaScript, so
 * it works on a phone in a kitchen with one bar of signal. Nothing here rewrites the recipe,
 * calls a model or spends quota (decisions §51).
 *
 * **`notFor` is never behind a further tap.** A substitution that is actively wrong in a bake is
 * the most valuable line in the table, and hiding it one level deeper than the substitution it
 * qualifies would be the same fault as a total that omits the chorizo: the encouraging half
 * visible, the warning a click away.
 */
export function Substitution({ entry }: { entry: SubstitutionEntry }) {
  return (
    <details className="substitution">
      <summary>no {entry.names[0]}?</summary>
      <ul>
        {entry.options.map((option) => (
          <li key={option.use}>
            <strong>{option.use}</strong>
            <span className="ratio">{option.ratio}</span>
            <span className="cost">{option.cost}</span>
            {option.notFor && <span className="notfor">Not for {option.notFor}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}
