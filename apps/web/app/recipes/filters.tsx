import Link from "next/link";

/**
 * Search and filter, as a plain GET form.
 *
 * No client component and no JavaScript: the state lives in the URL, which means a filtered
 * list is a link somebody can bookmark or send to the other adult in the household. A
 * client-side filter would have been less code and would have thrown that away.
 */
export const FILTERS = [
  { key: "make-again", label: "Make again", hint: "marked worth repeating" },
  { key: "untried", label: "Untried", hint: "never cooked" },
  { key: "family-likes", label: "Whole family likes", hint: "everyone who rated gave 4 or 5" },
] as const;

export type FilterKey = (typeof FILTERS)[number]["key"];

export function Filters({ q, filter }: { q: string; filter: FilterKey | null }) {
  return (
    <div className="filters">
      <form method="get" action="/recipes">
        {filter && <input type="hidden" name="filter" value={filter} />}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search titles…"
          aria-label="Search recipes by title"
        />
        <button type="submit">Search</button>
      </form>

      <div className="chips">
        {FILTERS.map((option) => {
          const active = filter === option.key;
          const next = new URLSearchParams();
          if (q) next.set("q", q);
          if (!active) next.set("filter", option.key);
          const href = next.size > 0 ? `/recipes?${next}` : "/recipes";
          return (
            <Link
              key={option.key}
              href={href}
              className={active ? "chip on" : "chip"}
              title={option.hint}
              aria-pressed={active}
            >
              {option.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
