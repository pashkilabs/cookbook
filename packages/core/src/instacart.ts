/**
 * The shape of an Instacart shopping-list request (§73). Core holds the **shape**, never the call.
 *
 * Pure, so it stays in core beside `consolidate` and `ShoppingLine`: no network, no framework, no
 * key. A route makes the request; this decides what the request would say, which is the half worth
 * testing.
 *
 * ---------------------------------------------------------------------------
 * The consolidated quantity, not the per-recipe breakdown
 * ---------------------------------------------------------------------------
 *
 * Their matcher takes a line item and finds a product. Sending the breakdown would send cream
 * twice — once for Tuesday, once for Friday — and resolve two products or one product twice,
 * **throwing away the single most valuable thing this app computes.** One pint across two days is
 * the product. The breakdown goes in `instructions`, as prose, which is the only place the
 * Tuesday/Friday split survives.
 *
 * ---------------------------------------------------------------------------
 * Aisle order does not survive
 * ---------------------------------------------------------------------------
 *
 * Their schema has no aisle concept, and §72's catalog pass was justified on aisle order for the
 * weekly list. So **the in-app list stays the better artefact for shopping in person** and this is
 * for somebody who is not. Said here because the next reader will look for the aisle field.
 */
import { fingerprint } from "./fingerprint.js";
import type { Dimension, ShoppingLine } from "./types.js";

/**
 * Their published units, verbatim, because an invented one fails *quietly*.
 *
 * "Unsupported units cause quantity matching to fail" — so a unit we make up does not error, it
 * silently matches badly, which is the failure that looks like a worse answer rather than no
 * answer. Checked before sending rather than discovered in a cart.
 *
 * Our base units are millilitres and grams and **both are on the list**, so nothing converts and
 * nothing rounds. That was checked before this was written: a conversion would have been a
 * decision, not an implementation detail.
 */
export const INSTACART_UNITS: ReadonlySet<string> = new Set([
  // measured
  "cup", "cups", "c", "gallon", "gallons", "gal", "gals",
  "milliliter", "millilitre", "milliliters", "millilitres", "ml", "mls",
  "liter", "litre", "liters", "litres", "l",
  "pint", "pints", "pt", "pts", "quart", "quarts", "qt", "qts",
  "tablespoon", "tablespoons", "tb", "tbs", "teaspoon", "teaspoons", "ts", "tsp", "tspn",
  "fl oz", "ounce", "ounces", "oz",
  // weighed
  "gram", "grams", "g", "gs", "kilogram", "kilograms", "kg", "kgs",
  "pound", "pounds", "lb", "lbs", "per lb",
  // countable
  "bunch", "bunches", "can", "cans", "each", "ears", "head", "heads",
  "large", "lrg", "lge", "lg", "medium", "med", "md",
  "package", "packages", "packet", "small", "sm",
]);

/**
 * Each of our dimensions in a unit they publish — **typed as `Record<Dimension, …>`**, so a
 * dimension added to the union and forgotten here fails to compile.
 *
 * The first version keyed `mass` instead of `weight` and silently withheld every flour, sugar and
 * mince in the week as an "unsupported unit". It was *visible* in `withheld`, which is the only
 * reason the whole-path test caught it rather than a household discovering a shopping list with
 * no flour on it — and the lesson is that a lookup by string literal is a typo away from
 * dropping a whole category. The exhaustive type is the fix; the withheld list is the net.
 *
 * `clove`, `can` and `bunch` are counts of a thing, so `each` is the honest unit — their list has
 * `can` and `bunch` too, but a recipe's "2 cans" is already a count and sending `can` would ask
 * their matcher to size a can of a can.
 */
const BASE_UNIT: Record<Dimension, string> = {
  volume: "ml",
  weight: "g",
  count: "each",
  clove: "each",
  can: "each",
  bunch: "each",
};

export interface InstacartMeasurement {
  quantity: number;
  unit: string;
}

export interface InstacartLineItem {
  name: string;
  display_text: string;
  line_item_measurements: InstacartMeasurement[];
}

export interface WithheldLine {
  label: string;
  reason: "ticked" | "already have it" | "already have some" | "nothing to buy" | "unsupported unit";
}

export interface ShoppingListRequest {
  title: string;
  link_type: "shopping_list";
  line_items: InstacartLineItem[];
  instructions: string[];
  landing_page_configuration?: { partner_linkback_url: string };
  /**
   * What was left out and why — stated, never silent.
   *
   * A list that re-buys what a household already has is worse than no integration, and a list
   * that quietly omits something they need is worse still. Both are avoided by the same move:
   * withhold, and name what was withheld, the way the allergen filter names what it hid.
   */
  withheld: WithheldLine[];
  /**
   * Whether this is worth POSTing. Their API requires `line_items`, and a page offering nothing
   * is worse than no page — so an empty export is a refusal here rather than a 400 from them.
   */
  sendable: boolean;
  /**
   * A fingerprint of **everything that changes the body**.
   *
   * Their docs ask that URLs be reused and regenerated only when the content changes.
   * `prompt-version.ts` is the precedent and the failure mode is identical — a stale answer served
   * confidently — and that one happened because the key covered every input the *recipe* carried
   * and omitted the prompt. So this is computed from the serialised body itself rather than from
   * a hand-picked list of the fields somebody remembered.
   */
  bodyFingerprint: string;
}

export interface ShoppingListOptions {
  title: string;
  /** `shopping_ticks.item_key` values — the join `consolidate` cannot see */
  ticked: ReadonlySet<string>;
  /** the per-recipe breakdown, as prose: the only place Tuesday-and-Friday survives */
  instructions?: string[];
  linkbackUrl?: string;
}

/**
 * Turn a consolidated week into the request body, and say what was left out.
 *
 * Four exclusions, each a different sentence on screen:
 *
 *   ticked              already in the trolley. The join, and the reason this function takes a
 *                       set rather than reading `ShoppingLine` alone.
 *   already have it     the pantry covered it completely — `needed` is 0 and a zero must not be
 *                       sent as a quantity.
 *   already have some   in the pantry in an **unknown** amount, so nothing was subtracted.
 *                       Buying re-buys; not buying may leave them short. Named, so it is theirs
 *                       to resolve rather than ours to guess.
 *   unsupported unit    a dimension with no unit on their list. Refused rather than guessed,
 *                       because a wrong unit matches badly instead of failing.
 */
export function buildShoppingListRequest(
  lines: readonly ShoppingLine[],
  options: ShoppingListOptions,
): ShoppingListRequest {
  const items: InstacartLineItem[] = [];
  const withheld: WithheldLine[] = [];

  for (const line of lines) {
    if (options.ticked.has(line.key)) {
      withheld.push({ label: line.label, reason: "ticked" });
      continue;
    }
    if (line.needed <= 0) {
      withheld.push({ label: line.label, reason: line.inPantry ? "already have it" : "nothing to buy" });
      continue;
    }
    if (line.inPantry && !line.pantryDeducted) {
      withheld.push({ label: line.label, reason: "already have some" });
      continue;
    }

    const base = BASE_UNIT[line.dimension];
    if (!base || !INSTACART_UNITS.has(base)) {
      withheld.push({ label: line.label, reason: "unsupported unit" });
      continue;
    }

    /*
     * The package decision first, the measured need second.
     *
     * `line_item_measurements` exists to offer more than one way to size an item, and our two
     * answers are genuinely different: *how many to buy* (which their cart needs) and *how much
     * the week requires* (which lets their matcher size a product itself). The deprecated
     * `quantity`/`unit` pair could carry only one of them.
     */
    const measurements: InstacartMeasurement[] = [];
    const bought = line.packages?.reduce((sum, chosen) => sum + chosen.count, 0) ?? 0;
    if (bought > 0) measurements.push({ quantity: bought, unit: "package" });
    measurements.push({ quantity: round(line.needed), unit: base });

    items.push({
      // the catalog's word is the better search term; the recipe's word is what a person reads
      name: line.key.replace(/-/g, " "),
      display_text: line.label,
      line_item_measurements: measurements,
    });
  }

  const body = {
    title: options.title,
    link_type: "shopping_list" as const,
    line_items: items,
    instructions: options.instructions ?? [],
    ...(options.linkbackUrl ? { landing_page_configuration: { partner_linkback_url: options.linkbackUrl } } : {}),
  };

  return {
    ...body,
    withheld,
    sendable: items.length > 0,
    // over the serialised body, so a field added later is covered without anybody remembering
    bodyFingerprint: fingerprint([JSON.stringify(body)]),
  };
}

/** grams and millilitres to one decimal: a cart does not need a thousandth of a gram */
const round = (amount: number) => Math.round(amount * 10) / 10;

/**
 * A name offering a choice, split into the things it offers (§75).
 *
 * ---------------------------------------------------------------------------
 * Why this is a design gap and not dirty data
 * ---------------------------------------------------------------------------
 *
 * `honey or agave syrup`, `english or hothouse cucumber`,
 * `avocado oil or other neutral oil with a high smoke point`. These are not parser debris — the
 * recipe really did offer a choice, and the name is a faithful record of it. **No single search
 * can match them**, because no product is both honey and agave syrup.
 *
 * So the search takes branches rather than a string, and the caller tries each. One branch that
 * matches is the answer; that is the common case and it is what makes `honey or agave syrup`
 * findable at all.
 *
 * ---------------------------------------------------------------------------
 * When both match, the first wins — and the alternative is kept, not discarded
 * ---------------------------------------------------------------------------
 *
 * **The recipe's order is its preference.** A cook who writes "honey or agave syrup" is asking for
 * honey and saying agave will do; reversing that, or averaging it, or asking the household to
 * choose between two things they already ranked, all lose information the recipe gave freely.
 *
 * The runners-up are **carried, not dropped**. The review screen names them — *"honey; or agave
 * syrup"* — because the one case where order is wrong is the shop being out of the first, and that
 * is exactly when somebody standing in it wants to know what the recipe would also accept. Same
 * reasoning as `withheld`: a thing the machine decided is stated, so a person can overrule it.
 *
 * It is **not** a confidence score and nothing ranks the branches against each other. §61 and §75
 * both measured that no confidence signal is available here, and "first as written" is a fact
 * about the recipe rather than a judgement about the products.
 */
export function searchBranches(name: string): string[] {
  /*
   * Split only on a standalone `or`, and only where both sides have words. `salt or pepper` is a
   * genuine choice; `cream of tartar` and `rack of lamb` must not be touched, which is why the
   * pattern needs whitespace on both sides rather than a bare `or`.
   */
  const parts = name
    .split(/\s+or\s+/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length < 2) return [name.trim()].filter(Boolean);

  /*
   * A trailing branch that only *qualifies* is not a branch.
   *
   * "avocado oil or other neutral oil with a high smoke point" offers one product and a
   * description of what else would do; "other neutral oil with a high smoke point" is not a thing
   * to search for. A branch has to name something, and `other`, `any` and `similar` say it does
   * not.
   */
  const named = parts.filter((part) => !/^(?:other|another|any|some|similar|equivalent)\b/i.test(part));
  return named.length > 0 ? named : [parts[0]!];
}
