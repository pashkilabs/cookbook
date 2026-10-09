/**
 * Does a recipe name an allergen — and when it cannot be known, say so (§71).
 *
 * ---------------------------------------------------------------------------
 * Why this is not the catalog, and must not become it
 * ---------------------------------------------------------------------------
 *
 * `catalog.ts` matches an ingredient by its **head noun**, because its job is deciding what to
 * buy: that is why `almond milk` bought whole milk and `onion powder` bought onions. That comment
 * reads like an argument for fixing the matcher. Here it is an argument for **not reusing it**.
 *
 * The catalog wants `milk` and discards `almond`. An allergen check wants exactly what is
 * discarded. One throws away what the other needs, so a shared implementation is not a tuning
 * problem — it is two requirements pulling opposite ways through one function.
 *
 * The error directions are opposite too. The catalog must err **toward a match**, or nothing gets
 * bought. This must err **toward flagging**, because a missed match is the failure with a
 * consequence. Over-flagging costs a recipe somebody could have eaten; under-flagging costs
 * something no caveat covers.
 *
 * So: word-boundary matching against the **written line**, before normalisation. No catalog, no
 * stemming beyond plurals, no fuzzy match, no distance metric.
 *
 * ---------------------------------------------------------------------------
 * What this CANNOT do, which is the whole point of the third outcome
 * ---------------------------------------------------------------------------
 *
 * **An ingredient list names what is added, not what is inside what is added.** `2 tbsp red curry
 * paste` contains fish sauce. `¼ cup pesto` contains pine nuts and parmesan. `1 brioche bun`
 * contains milk and egg. No text matching sees inside, and brand variation defeats even a
 * per-product table: tamari is wheat-free and soy sauce is not.
 *
 * So a **compound** — an assembled product with an interior — forces `unknown`, naming the line.
 * This is a filter that reduces exposure. It is **not a safety check**, it never returns "safe",
 * and the strongest sentence available to a caller is "nothing we could see".
 *
 * The term lists below are **not exhaustive and cannot be**. They are deliberately broad: a term
 * that over-matches is a recipe needlessly hidden, which is recoverable, and the measurement
 * script reports how often that happens so the breadth is a number rather than a hope.
 */

/** The nine that labelling regimes agree on, plus sesame. Not a claim to completeness. */
export type Allergen =
  | "peanut"
  | "tree-nut"
  | "milk"
  | "egg"
  | "fish"
  | "shellfish"
  | "soy"
  | "wheat"
  | "sesame";

export const ALLERGENS: readonly Allergen[] = [
  "peanut", "tree-nut", "milk", "egg", "fish", "shellfish", "soy", "wheat", "sesame",
];

/**
 * Written words that name an allergen directly.
 *
 * Multi-word terms are matched as phrases, so `pine nut` does not depend on `nut` being listed —
 * and `nut` is deliberately **absent**, because `nutmeg`, `butternut` and `coconut` are not tree
 * nuts and a bare `nut` would match inside all three. Word boundaries make `nutmeg` safe from
 * `nut` anyway; listing the specific nuts is what keeps the opposite error from happening.
 */
const TERMS: Record<Allergen, readonly string[]> = {
  peanut: ["peanut", "peanuts", "groundnut", "peanut butter", "satay"],
  "tree-nut": [
    "almond", "almonds", "walnut", "walnuts", "pecan", "pecans", "cashew", "cashews",
    "pistachio", "pistachios", "hazelnut", "hazelnuts", "filbert", "macadamia",
    "brazil nut", "brazil nuts", "pine nut", "pine nuts", "pignoli", "chestnut", "chestnuts",
    "marzipan", "frangipane", "praline", "nutella", "amaretto", "nut butter", "mixed nuts",
  ],
  milk: [
    "milk", "cream", "creme", "butter", "buttermilk", "cheese", "yoghurt", "yogurt", "ghee",
    "whey", "casein", "custard", "mascarpone", "ricotta", "parmesan", "parmigiano", "mozzarella",
    "cheddar", "feta", "halloumi", "paneer", "brie", "gruyere", "pecorino", "gouda", "provolone",
    "havarti", "boursin", "quark", "kefir", "ice cream", "half and half", "condensed milk",
    "evaporated milk", "clotted cream", "dulce de leche",
  ],
  egg: ["egg", "eggs", "mayonnaise", "mayo", "aioli", "meringue", "albumen", "custard", "hollandaise"],
  fish: [
    "fish", "anchovy", "anchovies", "salmon", "tuna", "cod", "tilapia", "haddock", "sardine",
    "sardines", "trout", "halibut", "mackerel", "sea bass", "snapper", "pollock", "fish sauce",
    "nam pla", "worcestershire", "caviar", "roe", "bonito", "katsuobushi", "dashi",
  ],
  shellfish: [
    "shrimp", "prawn", "prawns", "crab", "lobster", "crayfish", "langoustine", "scallop",
    "scallops", "mussel", "mussels", "clam", "clams", "oyster", "oysters", "squid", "calamari",
    "octopus", "crawfish", "oyster sauce", "shellfish", "krill",
  ],
  soy: [
    "soy", "soya", "soybean", "soybeans", "soy sauce", "tofu", "edamame", "miso", "tempeh",
    "tamari", "hoisin", "ponzu", "textured vegetable protein", "tvp",
  ],
  wheat: [
    "wheat", "flour", "bread", "breadcrumb", "breadcrumbs", "panko", "pasta", "spaghetti",
    "noodle", "noodles", "macaroni", "orzo", "lasagne", "lasagna", "couscous", "semolina",
    "farro", "bulgur", "spelt", "seitan", "cracker", "crackers", "tortilla", "tortillas",
    "pastry", "phyllo", "filo", "puff pastry", "pita", "naan", "brioche", "croissant", "bagel",
    "pretzel", "biscuit", "cake", "cookie", "cookies", "dough", "roux", "udon", "ramen", "wonton",
  ],
  sesame: ["sesame", "tahini", "benne", "halva", "gomashio", "za'atar", "zaatar", "hummus"],
};

/**
 * Manufactured or assembled products whose interior an ingredient list does not name.
 *
 * The presence of any of these makes the answer `unknown` for every allergen that was not
 * *already* matched outright — a jar of red curry paste may contain fish sauce, shrimp paste and
 * peanut, and which of those is true depends on the jar.
 *
 * Judged by whether a cook buys it made rather than by how many ingredients it has: a stock cube
 * is compound and a chopped onion is not, however many onions.
 */
const COMPOUND: readonly string[] = [
  "curry paste", "curry powder", "chilli powder", "chili powder", "pesto", "harissa", "gochujang",
  "stock", "broth", "bouillon", "stock cube", "bouillon cube", "gravy", "roux",
  "worcestershire", "oyster sauce", "fish sauce", "hoisin", "teriyaki", "ponzu", "sriracha",
  "soy sauce", "tamari", "miso", "ketchup", "bbq sauce", "barbecue sauce", "yum yum sauce",
  "mayonnaise", "mayo", "aioli", "ranch", "salad dressing", "vinaigrette", "marinade",
  "seasoning", "spice blend", "spice mix", "taco seasoning", "italian seasoning", "old bay",
  "bread", "bun", "roll", "tortilla", "naan", "pita", "brioche", "croissant", "pastry",
  "puff pastry", "phyllo", "filo", "panko", "breadcrumb", "breadcrumbs", "cracker", "crackers",
  "stuffing", "sausage", "chorizo", "hot dog", "bacon", "deli meat", "meatball",
  "chocolate", "chocolate chips", "nutella", "marzipan", "ice cream", "condensed soup",
  "cream of chicken", "cream of mushroom", "vanilla extract", "mirin", "cooking wine",
  "protein powder", "tortilla chips", "pie crust", "pizza dough", "puff", "wrap",
];

/**
 * Phrases that contain an allergen's word and are not that allergen.
 *
 * `peanut butter` matched **milk**, because `butter` is a dairy term — found by the test suite,
 * and it is the catalog's lesson in mirror image: there the modifier was discarded and bought the
 * wrong product; here the modifier *reverses* the answer. `coconut milk` is the one that matters
 * most in practice, appearing in a quarter of this corpus and containing no dairy at all.
 *
 * Applied by **removing the phrase from the line** before the positive terms are tried, so
 * "peanut butter and 50 ml milk" still matches milk on the second half. Suppressing the whole
 * line would be the over-correction that turns a false positive into a false negative, which is
 * the direction that must never be traded away.
 */
const NOT_TERMS: Record<Allergen, readonly string[]> = {
  peanut: [],
  "tree-nut": ["water chestnut", "water chestnuts", "nutmeg", "coconut"],
  milk: [
    "peanut butter", "almond butter", "cashew butter", "nut butter", "sunflower butter",
    "seed butter", "cocoa butter", "apple butter", "shea butter", "coconut butter",
    "coconut milk", "almond milk", "oat milk", "soy milk", "soya milk", "rice milk",
    "cashew milk", "hemp milk", "coconut cream", "cream of coconut", "cream of tartar",
    "creamed corn", "cream of chicken", "cream of mushroom",
  ],
  egg: ["eggplant"],
  fish: ["shellfish"],
  shellfish: [],
  soy: [],
  wheat: [
    "almond flour", "coconut flour", "rice flour", "corn flour", "cornflour", "chickpea flour",
    "oat flour", "tapioca flour", "potato flour", "gluten free flour", "gluten-free flour",
    "rice noodle", "rice noodles", "glass noodle", "glass noodles", "corn tortilla",
    "corn tortillas", "rice paper", "almond bread", "cauliflower rice",
  ],
  sesame: [],
};

/** lowercase, collapse whitespace — and nothing else. Normalising further is what loses `almond`. */
const written = (line: string) => ` ${line.toLowerCase().replace(/[^a-z0-9'&]+/g, " ").trim()} `;

/*
 * Word-boundary containment, with the padding doing the work.
 *
 * Both haystack and needle are wrapped in spaces, so `nut` cannot match inside `butternut` and
 * `egg` cannot match inside `eggplant`. A trailing `s` is tried as well, which covers the plurals
 * not spelled out above without a stemmer — `scallion` must not become `scallio`, so nothing is
 * ever stripped, only added.
 */
const names = (haystack: string, term: string): boolean =>
  haystack.includes(` ${term} `) || haystack.includes(` ${term}s `);

export type AllergenVerdict = "clear" | "unknown" | "excluded";

export interface AllergenReading {
  verdict: AllergenVerdict;
  /** the written words that matched, quoted back so a person can check the reasoning */
  matched: string[];
  /** lines bought ready-made, whose interior this cannot see */
  opaque: string[];
  /** lines the caller could not recognise at all */
  unrecognised: string[];
}

/**
 * One allergen against a recipe's written lines.
 *
 * `unrecognised` is supplied by the caller rather than computed here: only something holding the
 * catalog knows which lines it failed to resolve, and this module stays free of it on purpose.
 * Passing none means "every line was recognised", which is the honest default for a caller that
 * has not checked — it narrows this to the compound question rather than inventing confidence.
 *
 * **A direct match outranks an unknown.** A named peanut is a definite exclusion even in a recipe
 * that also contains a jar of something; there is nothing provisional about it.
 */
export function readAllergen(
  lines: readonly string[],
  allergen: Allergen,
  options: { unrecognised?: readonly string[] } = {},
): AllergenReading {
  const terms = TERMS[allergen];
  const matched: string[] = [];
  const opaque: string[] = [];

  for (const line of lines) {
    const raw = written(line);
    if (!raw.trim()) continue;
    // the exempt phrase is cut out, not the line: "peanut butter and 50 ml milk" still matches
    let hay = raw;
    for (const phrase of NOT_TERMS[allergen]) {
      hay = hay.split(` ${phrase} `).join("  ").split(` ${phrase}s `).join("  ");
    }
    const hit = terms.find((term) => names(hay, term));
    if (hit) {
      matched.push(line.trim());
      continue;
    }
    // compound is asked of the original line: cutting an exempt phrase must not hide a jar
    if (COMPOUND.some((product) => names(raw, product))) opaque.push(line.trim());
  }

  const unrecognised = [...(options.unrecognised ?? [])];
  const verdict: AllergenVerdict =
    matched.length > 0 ? "excluded" : opaque.length > 0 || unrecognised.length > 0 ? "unknown" : "clear";

  return { verdict, matched, opaque, unrecognised };
}

/**
 * Every allergen a household cares about, in one pass.
 *
 * Returns a reading per allergen rather than one combined answer: "excluded for peanut and
 * unknown for milk" is two different things to tell two different people, and collapsing them
 * into a single worst-case verdict loses which member it concerns.
 */
export function readAllergens(
  lines: readonly string[],
  allergens: readonly Allergen[],
  options: { unrecognised?: readonly string[] } = {},
): Map<Allergen, AllergenReading> {
  return new Map(allergens.map((allergen) => [allergen, readAllergen(lines, allergen, options)]));
}
