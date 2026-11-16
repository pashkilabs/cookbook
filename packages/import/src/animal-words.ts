/**
 * Which animals a piece of recipe text names — by word, with no model call.
 *
 * Here rather than in the script that uses it so it can be tested: the whole value of a tripwire
 * is that nobody switches it off, and the thing that gets one switched off is a false positive.
 * Every rule below costs recall to buy precision, and the traps are the design.
 *
 * Used by `scripts/tripwire-protein.mts`, which flags a recipe naming exactly one animal whose
 * `principal_protein` says something else — the check that would have caught 22 recipes going
 * unclassified for three weeks on the day it started rather than when somebody opened the Beef
 * chapter.
 */
/** the words that name an animal, mapped to the enum value they imply */
const NAMES: Record<string, readonly string[]> = {
  beef: ["beef", "steak", "sirloin", "brisket", "hamburger", "chuck roast"],
  chicken: ["chicken"],
  turkey: ["turkey"],
  duck: ["duck"],
  pork: ["pork", "bacon", "ham", "pancetta", "prosciutto", "salami", "pepperoni", "gammon"],
  lamb: ["lamb", "mutton"],
  veal: ["veal"],
  goat: ["goat"],
  venison: ["venison"],
  fish: ["fish", "salmon", "tuna", "tilapia", "cod", "haddock", "halibut", "trout", "anchovy", "anchovies"],
  seafood: ["shrimp", "prawn", "prawns", "crab", "lobster", "scallop", "scallops", "mussels", "clams", "squid", "calamari", "oyster", "oysters"],
};

/** a noun within two words after an animal makes that occurrence a flavouring, not the dish */
const FLAVOURING = [
  "broth", "stock", "bouillon", "sauce", "seasoning", "flavor", "flavour", "flavored", "flavoured",
  "powder", "fat", "lard", "cheese", "milk", "base", "paste", "rub", "consomme", "granules",
  "cube", "cubes", "drippings", "dripping", "extract", "essence", "salt",
];

const words = (text: string) => text.toLowerCase().replace(/[^a-z\s-]/g, " ").split(/[\s-]+/).filter(Boolean);

/** every enum value the text names in a way that is about the dish rather than its seasoning */
export function animalsNamed(text: string): string[] {
  const w = words(text);
  const found = new Set<string>();
  for (const [protein, patterns] of Object.entries(NAMES)) {
    for (const pattern of patterns) {
      const parts = pattern.split(" ");
      for (let i = 0; i < w.length; i += 1) {
        if (!parts.every((part, k) => w[i + k] === part)) continue;
        const after = w.slice(i + parts.length, i + parts.length + 2);
        if (after.some((next) => FLAVOURING.includes(next))) continue;
        found.add(protein);
        break;
      }
    }
  }
  return [...found];
}


