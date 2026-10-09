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
 * Products bought ready-made, and the allergens each can plausibly contain.
 *
 * **Why a set per product rather than a blanket.** Marking a jar unknown for *all nine* allergens
 * made Worcestershire sauce raise a peanut warning on five recipes, for a sauce that essentially
 * never contains peanut. A warning a household learns to dismiss is worse than no warning —
 * measured twice in this project already — so the blanket was training people to ignore the one
 * flag that matters.
 *
 * **Conservative when uncertain: anything *plausible*, not anything likely.** If a product's set is
 * arguable, the allergen goes in. The cost of a wrong inclusion is one recipe needlessly flagged;
 * the cost of a wrong omission is the failure no caveat covers.
 *
 * **Scoped to plausible ingredients, not cross-contamination.** "Made in a facility that also
 * handles nuts" is true of most manufactured food, so admitting it would reinstate the blanket
 * under a different name and lose the distinction this exists to draw. A household that needs
 * contamination-level caution needs labels, which §71 says this cannot replace.
 *
 * **An allergen near-universal in a product belongs in `TERMS`, not here** — anchovy in
 * Worcestershire, wheat in bread. So everything in these sets is genuinely variable by brand, and
 * one wording covers all of it: *can* contain. No likelihood scale, and therefore no invented
 * confidence (§61).
 *
 * An empty set is meaningful: a bought product with nothing plausible among the nine, which
 * stops forcing `unknown` without being removed from the list.
 */
const COMPOUND: Record<string, readonly Allergen[]> = {
  // fermented and fish-derived sauces
  worcestershire: ["soy", "wheat"],
  "fish sauce": ["shellfish"],
  "oyster sauce": ["soy", "wheat"],
  hoisin: ["soy", "wheat", "sesame", "peanut"],
  "soy sauce": ["wheat"],
  tamari: ["wheat"],
  miso: ["wheat"],
  ponzu: ["wheat", "fish"],
  teriyaki: ["soy", "wheat", "sesame"],
  gochujang: ["soy", "wheat"],
  sriracha: ["fish", "soy", "wheat"],
  mirin: ["soy", "wheat"],
  "cooking wine": ["soy", "wheat"],

  // pastes, blends and powders
  "curry paste": ["fish", "shellfish", "peanut", "soy"],
  "curry powder": ["wheat"],
  "chilli powder": ["wheat"],
  "chili powder": ["wheat"],
  pesto: ["tree-nut", "milk", "fish"],
  harissa: [],
  seasoning: ["wheat", "milk", "sesame"],
  "spice blend": ["wheat", "milk", "sesame"],
  "spice mix": ["wheat", "milk", "sesame"],
  "taco seasoning": ["wheat", "milk"],
  "italian seasoning": ["wheat"],
  "old bay": ["wheat"],

  // stocks and thickened liquids
  stock: ["milk", "soy", "wheat"],
  broth: ["milk", "soy", "wheat"],
  bouillon: ["milk", "soy", "wheat"],
  "stock cube": ["milk", "soy", "wheat"],
  "bouillon cube": ["milk", "soy", "wheat"],
  gravy: ["milk", "soy", "wheat"],
  roux: ["milk"],
  "condensed soup": ["milk", "soy", "wheat"],
  "cream of chicken": ["soy", "wheat"],
  "cream of mushroom": ["soy", "wheat"],

  // table sauces and dressings
  ketchup: ["soy", "wheat"],
  "bbq sauce": ["soy", "wheat", "fish", "sesame"],
  "barbecue sauce": ["soy", "wheat", "fish", "sesame"],
  "yum yum sauce": ["egg", "soy", "wheat"],
  mayonnaise: ["soy"],
  mayo: ["soy"],
  aioli: ["soy", "milk"],
  ranch: ["milk", "egg", "soy", "wheat"],
  "salad dressing": ["milk", "egg", "soy", "wheat"],
  vinaigrette: ["milk", "egg", "soy", "wheat"],
  marinade: ["soy", "wheat", "sesame", "fish"],

  // baked and breaded things — wheat is in TERMS, so these carry what else varies
  bread: ["milk", "egg", "soy", "sesame"],
  bun: ["milk", "egg", "soy", "sesame"],
  roll: ["milk", "egg", "soy", "sesame"],
  tortilla: ["milk", "soy"],
  naan: ["milk", "egg", "soy"],
  pita: ["milk", "soy", "sesame"],
  brioche: ["milk", "egg", "soy"],
  croissant: ["milk", "egg", "soy"],
  pastry: ["milk", "egg", "soy"],
  "puff pastry": ["milk", "egg", "soy"],
  phyllo: ["milk", "egg", "soy"],
  filo: ["milk", "egg", "soy"],
  "pie crust": ["milk", "egg", "soy"],
  "pizza dough": ["milk", "soy"],
  wrap: ["milk", "egg", "soy", "sesame"],
  panko: ["milk", "egg", "soy", "sesame"],
  breadcrumb: ["milk", "egg", "soy", "sesame"],
  breadcrumbs: ["milk", "egg", "soy", "sesame"],
  cracker: ["milk", "egg", "soy", "sesame"],
  crackers: ["milk", "egg", "soy", "sesame"],
  "tortilla chips": ["milk", "soy", "wheat"],
  stuffing: ["milk", "egg", "soy"],

  // prepared meats
  sausage: ["milk", "egg", "soy", "wheat"],
  chorizo: ["milk", "soy", "wheat"],
  "hot dog": ["milk", "egg", "soy", "wheat"],
  "deli meat": ["milk", "soy", "wheat"],
  meatball: ["milk", "egg", "soy", "wheat"],
  bacon: ["soy"],

  // sweet things
  chocolate: ["milk", "soy", "tree-nut", "peanut"],
  "chocolate chips": ["milk", "soy", "tree-nut", "peanut"],
  nutella: ["milk", "soy"],
  marzipan: ["egg"],
  "ice cream": ["egg", "soy", "tree-nut", "peanut"],
  "protein powder": ["milk", "soy", "egg", "tree-nut", "peanut", "wheat"],
  "vanilla extract": [],
};

/**
 * Phrases that contain an allergen's word and are not that allergen.
 *
 * `peanut butter` matched **milk**, because `butter` is a dairy term — found by the test suite,
 * and it is the catalog's lesson in mirror image. There the modifier is *discarded* and the wrong
 * thing gets bought; here the modifier *reverses* the answer. Same word, opposite failure, which
 * is better evidence than the argument that these cannot share code (§71).
 *
 * `coconut milk` is the one that matters most in practice: it appears throughout this corpus and
 * contains no dairy at all.
 *
 * Applied by **removing the phrase from the line** before the positive terms are tried, so
 * "peanut butter and 50 ml milk" still matches milk on the second half. Suppressing the whole line
 * would turn a false positive into a false negative, which is the direction never to trade away.
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
  /**
   * Lines bought ready-made that could plausibly carry *this* allergen.
   *
   * The product is named as well as the line, because the claim changed with the refinement.
   * "We cannot see inside this" has become "we can see inside the category and not the jar", and
   * a more specific claim has to be more specifically worded: a caller writes "contains chicken
   * broth, which can contain milk" rather than raising a generic flag.
   */
  opaque: Array<{ line: string; product: string }>;
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
  const opaque: Array<{ line: string; product: string }> = [];

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
    /*
     * Asked of the *original* line, because cutting an exempt phrase must not hide a jar — and
     * only for products whose plausible set carries this allergen, which is the refinement.
     */
    const product = Object.keys(COMPOUND).find(
      (name) => names(raw, name) && COMPOUND[name]!.includes(allergen),
    );
    if (product) opaque.push({ line: line.trim(), product });
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
