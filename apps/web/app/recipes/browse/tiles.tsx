import Link from "next/link";
import { TOP_LEVEL } from "./top-level";

/**
 * The grouping, on the recipes landing page.
 *
 * One definition of the rows, shared with `/recipes/browse` — two lists would drift, and the
 * whole point of this is that a person meets the same eight groups wherever they start.
 */
export function BrowseTiles() {
  return (
    <div className="tiles" style={{ marginBottom: "1.5rem" }}>
      {TOP_LEVEL.map((entry) => (
        <Link key={entry.key} className="tile" href={`/recipes/browse?in=${entry.key}`}>
          {entry.label}
        </Link>
      ))}
    </div>
  );
}
