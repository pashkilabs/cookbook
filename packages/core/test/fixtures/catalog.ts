/**
 * Catalog fixtures, lifted out of consolidate.test.ts so the database round-trip
 * test can assert against the same cases rather than a copy of them.
 *
 * A copy would drift, and a drifted round-trip test is worse than none — it would
 * go green while the seeded catalog diverged from SEED_CATALOG.
 */

/** Names the catalog must resolve, and the key each must resolve to. */
export const MATCH_PROBES: ReadonlyArray<readonly [string, string | null]> = [
  ["finely chopped onion", "onion"],
  ["boneless skinless chicken breasts", "chicken-breast"],
  ["freshly grated parmesan cheese", "parmesan"],
  // regression: stripping "diced" merged a tin into the produce aisle
  ["diced tomatoes", "canned-tomatoes"],
  ["tomatoes", "tomatoes"],
  ["cherry tomatoes", "tomatoes"],
  ["buttermilk", "buttermilk"],
  ["sun dried tomatoes", "sun-dried-tomatoes"],
  ["heavy whipping cream", "heavy-cream"],
  // carried by keyword fallback, not by the catalog
  ["smoked paprika", null],
];

/** Aisle fallbacks for things the catalog does not carry. */
export const AISLE_PROBES: ReadonlyArray<readonly [string, string]> = [
  ["smoked paprika", "Spices"],
  ["courgette", "Produce"],
  ["something unheard of", "Other"],
];

export interface WeekEntry {
  label: string;
  lines: string[];
  scale?: number;
}

/**
 * A week chosen to exercise every dimension the catalog carries, so a
 * consolidation run over it touches every code path that reads catalog data:
 *
 *   volume        heavy cream
 *   weight        chicken breast, ground beef
 *   count         onion
 *   clove         garlic          (converts into heads)
 *   can           black beans     (bare tin -> canSize)
 *   bunch         cilantro        (plus a tbsp that cannot merge into it)
 *   gramsPerCup   parmesan        (a cup measure of a weight-sold item)
 *   uncatalogued  smoked paprika  (no package maths at all)
 *   scale         the last entry is cooked double
 */
export const KNOWN_WEEK: readonly WeekEntry[] = [
  {
    label: "Tuscan Chicken",
    lines: ["1 cup heavy cream", "3 cloves garlic", "1 lb chicken breast", "1 onion"],
  },
  {
    label: "Vodka Rigatoni",
    lines: ["1/2 cup heavy cream", "4 cloves garlic", "1 lb pasta"],
  },
  {
    label: "Chili",
    lines: [
      "1 lb ground beef",
      "1 can black beans",
      "1 (14.5 oz) can diced tomatoes",
      "2 tbsp smoked paprika",
    ],
  },
  {
    label: "Tacos",
    lines: ["1 bunch cilantro", "2 tbsp cilantro", "1/2 cup grated parmesan"],
    scale: 2,
  },
];
