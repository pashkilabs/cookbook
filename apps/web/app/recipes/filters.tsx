import Link from "next/link";
import { COURSES, PROTEINS, label } from "./drill-down";

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
  /*
   * Kid-friendly sits here and **not** in the protein row under Mains, which is where it began.
   *
   * It was never a protein — it rode in that row because that is where the sketch drew it, and a
   * row of Chicken / Beef / Fish / Kid-friendly asks a person to read one of those as unlike the
   * others. Here it sits with its own kind: filters about the household's judgement rather than
   * the dish's nature. And "Mains that are kid-friendly" is still reachable, by combining this
   * with the Mains chip, which is what combining is for.
   */
  { key: "kid-friendly", label: "Kid-friendly", hint: "a child rated it 4 or 5, and none rated it lower" },
] as const;

export type FilterKey = (typeof FILTERS)[number]["key"];

/**
 * Search, the household's own filters, and the drill-down — all on the list, all in the URL.
 *
 * **The browse screen is gone.** It was a second door onto the same recipes, and a screen you
 * could enter and not leave; folding it in removes both problems at once. The chips do the
 * drill-down in place: tapping Mains hides the other courses and reveals the proteins, and every
 * step is a link with its state in the query string, so a filtered view can be sent to somebody.
 * That is how the planner and the shortlist already work.
 *
 * **The way out is a chip, not a back button.** The active course stays visible and pressed, and
 * pressing it again clears the drill-down — plus an explicit "All recipes" when anything is
 * narrowing the list. Re-creating browse's dead end inside the list would have been worse than
 * leaving it where it was.
 */
export function Filters({
  q,
  filter,
  course,
  protein,
  proteinsAvailable,
}: {
  q: string;
  filter: FilterKey | null;
  course: string | null;
  protein: string | null;
  /** only the proteins this household actually has, so no chip leads to an empty list */
  proteinsAvailable: readonly string[];
}) {
  const link = (over: Record<string, string | null>) => {
    const next = new URLSearchParams();
    const all = { q, filter, in: course, protein, ...over };
    for (const [key, value] of Object.entries(all)) if (value) next.set(key, String(value));
    return next.size > 0 ? `/recipes?${next}` : "/recipes";
  };
  const narrowed = Boolean(course || protein || filter || q);

  return (
    <div className="filters">
      <form method="get" action="/recipes">
        {filter && <input type="hidden" name="filter" value={filter} />}
        {/* searching inside a drill-down keeps it, or the chips would silently reset */}
        {course && <input type="hidden" name="in" value={course} />}
        {protein && <input type="hidden" name="protein" value={protein} />}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search titles and ingredients…"
          aria-label="Search recipes by title or ingredient"
        />
        <button type="submit">Search</button>
      </form>

      {/*
        * The drill-down, in place.
        *
        * With no course chosen, every course shows. Choose one and the others give way to its
        * proteins — the same narrowing browse did on its own screen, without leaving the list.
        * The chosen course stays visible and pressed, so pressing it again is the way back, and
        * "All recipes" is there whenever anything is narrowing the view. Browse's dead end was
        * the complaint; re-creating it inside the list would have been worse.
        */}
      <div className="chips">
        {(course ? COURSES.filter((c) => c.key === course) : COURSES).map((entry) => (
          <Link
            key={entry.key}
            href={course === entry.key ? link({ in: null, protein: null }) : link({ in: entry.key, protein: null })}
            className={course === entry.key ? "chip on" : "chip"}
            aria-pressed={course === entry.key}
          >
            {entry.label}
          </Link>
        ))}
        {course && proteinsAvailable.length > 0 && (
          <>
            <span className="meta"> · </span>
            {proteinsAvailable.map((key) => (
              <Link
                key={key}
                href={protein === key ? link({ protein: null }) : link({ protein: key })}
                className={protein === key ? "chip on" : "chip"}
                aria-pressed={protein === key}
              >
                {label(key)}
              </Link>
            ))}
          </>
        )}
        {narrowed && (
          <Link href="/recipes" className="chip quiet">
            All recipes
          </Link>
        )}
      </div>

      <div className="chips">
        {FILTERS.map((option) => {
          const active = filter === option.key;
          // the course and protein survive a filter change: narrowing is cumulative, not exclusive
          const href = link({ filter: active ? null : option.key });
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
