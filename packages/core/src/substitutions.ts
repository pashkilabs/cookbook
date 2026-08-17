import type { CatalogItem } from "./types.js";
import { normaliseName } from "./text.js";

/**
 * What to use when you have run out.
 *
 * §6's rule applied to a new feature: "I have no buttermilk" has a correct answer that needs no
 * model, and reaching for one here is the same mistake as consulting tier 2 for a page that
 * publishes structured data. Buttermilk is milk plus a tablespoon of acid per cup; that is a fact,
 * not an inference, and a table states it for free and identically every time.
 *
 * ---------------------------------------------------------------------------
 * The caveat is the feature
 * ---------------------------------------------------------------------------
 *
 * Every entry carries **what it costs**, and that field is not a disclaimer — it is the reason
 * this is safe to ship. Somebody who does not know what they are trading should not be told to
 * trade it: swapping oil for butter works and changes the texture, and a person who learns that
 * after baking has been badly served by a table that only said "yes".
 *
 * Where a substitution holds only in some uses, `notFor` says where it fails. Greek yogurt stands
 * in for sour cream in a sauce and splits in a bake, and one line saying so is worth more than
 * three that do not.
 *
 * ---------------------------------------------------------------------------
 * Keys, and the gap that is reported rather than hidden (§50)
 * ---------------------------------------------------------------------------
 *
 * A key is a catalog key where one exists and a bare normalised name otherwise. They will not all
 * line up: households run out of self-raising flour and crème fraîche, and the catalog holds what
 * is bought as a line item. `substitutionCoverage` counts the mismatch, which is the honest input
 * to catalog expansion — a substitution keyed to a bare name is a candidate for the catalog,
 * ranked by something better than a guess.
 *
 * Seed data, like `SEED_CATALOG`: a table this can grow into, not a constant to import.
 */
export interface Substitution {
  /** what to use instead */
  use: string;
  /** the ratio, as something a person can act on without arithmetic */
  ratio: string;
  /** what it costs. Never empty — a substitution with no trade-off still has one worth naming. */
  cost: string;
  /** where this is actively wrong. Absent means it holds generally. */
  notFor?: string;
}

export interface SubstitutionEntry {
  /** a catalog key where one exists, a normalised bare name otherwise (§50) */
  key: string;
  /** what a recipe writes. Matched longest-first, as catalog names are. */
  names: string[];
  /** in order — the first is the best answer, not merely one of several */
  options: Substitution[];
}

/**
 * Forty-six entries, chosen for **what a household actually runs out of mid-recipe**, not as a
 * reference. The bias is deliberate and has a shape: dairy and baking staples dominate, because
 * those are the things a recipe needs a cup of and a fridge quietly lacks. Spices are mostly
 * absent — running out of paprika is annoying and rarely stops a dish — and so is anything whose
 * honest answer is "go to the shop".
 */
export const SUBSTITUTIONS: SubstitutionEntry[] = [
  {
    key: "buttermilk",
    names: ["buttermilk"],
    options: [
      {
        use: "milk with lemon juice or white vinegar",
        ratio: "1 tbsp acid into a cup, top up with milk to 1 cup, stand 10 minutes",
        cost: "None worth minding. This is what most people mean by buttermilk anyway.",
      },
      {
        use: "plain yogurt thinned with milk",
        ratio: "3 parts yogurt to 1 part milk",
        cost: "Slightly thicker and tangier; fine in pancakes and soda bread.",
      },
    ],
  },
  {
    key: "self-raising flour",
    names: ["self raising flour", "self-raising flour", "self rising flour"],
    options: [
      {
        use: "plain flour with baking powder",
        ratio: "2 tsp baking powder per 150 g (1 cup) plain flour, whisked through",
        cost: "The ratio matters — under-measure and it will not rise, over-measure and it tastes metallic. Add ¼ tsp salt per cup if the recipe adds none.",
      },
    ],
  },
  {
    key: "baking powder",
    names: ["baking powder"],
    options: [
      {
        use: "bicarbonate of soda with cream of tartar",
        ratio: "¼ tsp bicarb plus ½ tsp cream of tartar per 1 tsp baking powder",
        cost: "Acts on contact rather than in the oven, so get it in and bake it.",
      },
      {
        use: "bicarbonate of soda with an acid already in the recipe",
        ratio: "¼ tsp bicarb per 1 tsp baking powder, only if the batter has buttermilk, yogurt or lemon",
        cost: "Only works when the acid is there. Without it, bicarb alone tastes soapy.",
        notFor: "a batter with no acid in it",
      },
    ],
  },
  {
    key: "sour-cream",
    names: ["sour cream", "soured cream"],
    options: [
      {
        use: "full-fat Greek yogurt",
        ratio: "one for one",
        cost: "Tangier and lower in fat.",
        notFor: "baking — it splits where sour cream holds. Use crème fraîche instead.",
      },
      {
        use: "crème fraîche",
        ratio: "one for one",
        cost: "Richer and less sharp; the closest thing there is, and it does not split.",
      },
    ],
  },
  {
    key: "creme fraiche",
    names: ["creme fraiche", "crème fraîche"],
    options: [
      {
        use: "sour cream",
        ratio: "one for one",
        cost: "Sharper, and it can split at a hard simmer where crème fraîche will not.",
      },
      {
        use: "double cream with a spoon of yogurt",
        ratio: "1 tbsp yogurt per 100 ml cream, left somewhere warm for a few hours",
        cost: "Needs the time. Fine if you thought of it this morning.",
      },
    ],
  },
  {
    key: "heavy-cream",
    names: ["heavy cream", "double cream", "whipping cream"],
    options: [
      {
        use: "whole milk with melted butter",
        ratio: "¾ cup milk plus ¼ cup melted butter per cup of cream",
        cost: "Works in sauces and baking; it will not whip. Nothing that will not whip whips.",
        notFor: "anything whipped — no substitute whips like cream",
      },
      {
        use: "evaporated milk",
        ratio: "one for one",
        cost: "Thinner and slightly caramelised in flavour.",
        notFor: "whipping",
      },
    ],
  },
  {
    key: "half-and-half",
    names: ["half and half", "half & half", "single cream"],
    options: [
      {
        use: "equal parts whole milk and cream",
        ratio: "half and half, which is the name",
        cost: "None.",
      },
    ],
  },
  {
    key: "milk",
    names: ["whole milk", "milk"],
    options: [
      {
        use: "evaporated milk let down with water",
        ratio: "equal parts",
        cost: "A faint cooked note. Unnoticeable in a batter, noticeable in tea.",
      },
      {
        use: "unsweetened oat or soy milk",
        ratio: "one for one",
        cost: "Fine in baking. In a custard, soy sets firmer and oat stays looser.",
      },
    ],
  },
  {
    key: "eggs",
    names: ["egg", "eggs", "large egg"],
    options: [
      {
        use: "ground flaxseed and water",
        ratio: "1 tbsp flax plus 3 tbsp water per egg, stand 5 minutes",
        cost: "Binds but does not lift or enrich. Good in a muffin, poor in a sponge.",
        notFor: "anything relying on whipped egg — meringue, mousse, a genoise",
      },
      {
        use: "unsweetened apple sauce",
        ratio: "¼ cup per egg",
        cost: "Adds moisture and a little sweetness; the crumb is denser.",
        notFor: "savoury baking, and anything needing structure",
      },
    ],
  },
  {
    key: "butter",
    names: ["unsalted butter", "butter"],
    options: [
      {
        use: "oil",
        ratio: "¾ of the butter's weight in oil — 85 g oil per 115 g butter",
        cost: "Not one for one, because butter is a fifth water. The result is moister and softer, and it will not cream with sugar or hold a laminated dough.",
        notFor: "creaming, pastry, shortbread — anything where solid fat is the structure",
      },
      {
        use: "salted butter with the salt reduced",
        ratio: "one for one, less ¼ tsp salt per 115 g",
        cost: "None if you adjust the salt. Everything if you do not.",
      },
    ],
  },
  {
    key: "olive-oil",
    names: ["olive oil", "extra virgin olive oil", "vegetable oil", "neutral oil"],
    options: [
      {
        use: "melted butter",
        ratio: "add a quarter more by weight than the oil called for",
        cost: "Butter is part water, so it browns sooner and burns lower. Watch the pan.",
      },
      {
        use: "any other neutral oil",
        ratio: "one for one",
        cost: "None, unless the olive flavour was the point.",
      },
    ],
  },
  {
    key: "brown-sugar",
    names: ["brown sugar", "light brown sugar", "dark brown sugar", "demerara"],
    options: [
      {
        use: "white sugar with molasses or treacle",
        ratio: "1 tbsp molasses per 200 g (1 cup) sugar, rubbed through with your fingers",
        cost: "None. This is what brown sugar is.",
      },
      {
        use: "white sugar alone",
        ratio: "one for one",
        cost: "Loses the caramel note and a little moisture; biscuits spread more and stay crisper.",
      },
    ],
  },
  {
    key: "sugar",
    names: ["caster sugar", "granulated sugar", "sugar", "superfine sugar"],
    options: [
      {
        use: "granulated sugar blitzed briefly",
        ratio: "one for one, a few seconds in a processor",
        cost: "None. Caster is granulated, ground finer.",
      },
    ],
  },
  {
    key: "icing sugar",
    names: ["icing sugar", "powdered sugar", "confectioners sugar"],
    options: [
      {
        use: "caster sugar blitzed with cornflour",
        ratio: "200 g sugar with 1 tbsp cornflour, blitzed to a powder",
        cost: "Never quite as fine; an icing made with it can feel faintly gritty.",
      },
    ],
  },
  {
    key: "honey",
    names: ["honey", "runny honey"],
    options: [
      {
        use: "maple syrup or golden syrup",
        ratio: "one for one",
        cost: "Different flavour, same sweetness and moisture.",
      },
      {
        use: "sugar with a little water",
        ratio: "1¼ cups sugar plus ¼ cup water per cup of honey",
        cost: "Bakes drier and browns less — honey holds water that sugar does not.",
      },
    ],
  },
  {
    key: "maple-syrup",
    names: ["maple syrup"],
    options: [
      {
        use: "honey or golden syrup",
        ratio: "one for one",
        cost: "Honey is sweeter and more floral; golden syrup is closer in texture.",
      },
    ],
  },
  {
    key: "golden syrup",
    names: ["golden syrup", "light corn syrup", "corn syrup"],
    options: [
      {
        use: "honey",
        ratio: "one for one",
        cost: "Stronger flavour, and it browns faster.",
      },
      {
        use: "sugar dissolved in water",
        ratio: "2 parts sugar to 1 part water, simmered until it coats a spoon",
        cost: "It can crystallise where an invert syrup will not — a squeeze of lemon helps.",
      },
    ],
  },
  {
    key: "cornflour",
    names: ["cornflour", "cornstarch", "corn starch"],
    options: [
      {
        use: "plain flour",
        ratio: "2 tbsp flour per 1 tbsp cornflour",
        cost: "Cloudier and it needs longer cooking to lose the raw taste. Fine in gravy, wrong in a clear fruit glaze.",
        notFor: "anything that should stay glossy or clear",
      },
      {
        use: "arrowroot",
        ratio: "one for one",
        cost: "Sets softer and does not hold up to long boiling.",
      },
    ],
  },
  {
    key: "breadcrumbs",
    names: ["breadcrumbs", "bread crumbs", "panko"],
    options: [
      {
        use: "stale bread blitzed",
        ratio: "one for one by volume",
        cost: "None. Panko is drier and crisps harder if that is what you wanted.",
      },
      {
        use: "crushed crackers or oats",
        ratio: "one for one",
        cost: "Crackers add salt; oats stay chewier and suit meatballs more than a coating.",
      },
    ],
  },
  {
    key: "yogurt",
    names: ["plain yogurt", "natural yogurt", "yogurt", "yoghurt"],
    options: [
      {
        use: "soured cream",
        ratio: "one for one",
        cost: "Richer and less tangy.",
      },
      {
        use: "buttermilk, where the recipe is wet",
        ratio: "one for one in batters, not in dips",
        cost: "Much looser — it will not hold in anything spooned.",
        notFor: "a dip, a marinade coating, or anything served as it is",
      },
    ],
  },
  {
    key: "greek-yogurt",
    names: ["greek yogurt", "greek yoghurt", "strained yogurt"],
    options: [
      {
        use: "plain yogurt, strained",
        ratio: "one for one, through a cloth or coffee filter for an hour",
        cost: "Only the time. This is what Greek yogurt is.",
      },
      {
        use: "sour cream",
        ratio: "one for one",
        cost: "Fattier, less protein, less tang.",
      },
    ],
  },
  {
    key: "cream-cheese",
    names: ["cream cheese"],
    options: [
      {
        use: "mascarpone",
        ratio: "one for one",
        cost: "Sweeter and much richer; a cheesecake made with it is softer set.",
      },
      {
        use: "ricotta, blitzed smooth",
        ratio: "one for one",
        cost: "Grainier and wetter — drain it first, and expect a looser set.",
        notFor: "a no-bake cheesecake, which needs the firmness",
      },
    ],
  },
  {
    key: "mascarpone",
    names: ["mascarpone"],
    options: [
      {
        use: "cream cheese loosened with cream",
        ratio: "225 g cream cheese with 3 tbsp double cream",
        cost: "Slightly tangier than mascarpone, which is nearly flavourless.",
      },
    ],
  },
  {
    key: "ricotta",
    names: ["ricotta"],
    options: [
      {
        use: "cottage cheese, blitzed",
        ratio: "one for one, drained",
        cost: "Saltier and wetter; drain it properly or a filling will run.",
      },
    ],
  },
  {
    key: "parmesan",
    names: ["parmesan", "parmigiano reggiano", "parmigiano"],
    options: [
      {
        use: "pecorino or grana padano",
        ratio: "one for one",
        cost: "Pecorino is saltier and sharper — taste before adding more salt.",
      },
    ],
  },
  {
    key: "shortening",
    names: ["shortening", "vegetable shortening", "lard"],
    options: [
      {
        use: "butter",
        ratio: "one for one plus a spoonful, since butter is part water",
        cost: "Better flavour, less lift. Pastry is shorter and browns more.",
      },
    ],
  },
  {
    key: "vanilla extract",
    names: ["vanilla extract", "vanilla essence", "vanilla bean paste"],
    options: [
      {
        use: "vanilla paste or a scraped pod",
        ratio: "1 tsp paste, or half a pod, per 1 tsp extract",
        cost: "None — better, if anything.",
      },
      {
        use: "leave it out",
        ratio: "—",
        cost: "In most bakes it is a background note. In a plain custard or a shortbread it is the flavour.",
        notFor: "custard, ice cream, shortbread — anything where vanilla is the point",
      },
    ],
  },
  {
    key: "yeast",
    names: ["instant yeast", "active dry yeast", "dried yeast", "yeast"],
    options: [
      {
        use: "the other kind of dried yeast",
        ratio: "one for one; active dry wants proving in warm liquid first, instant does not",
        cost: "Only the proving step. Skipping it with active dry gives a loaf that barely rises.",
      },
      {
        use: "fresh yeast",
        ratio: "three times the weight of dried",
        cost: "None, but it keeps a fortnight rather than a year.",
      },
    ],
  },
  {
    key: "cocoa powder",
    names: ["cocoa powder", "unsweetened cocoa", "cacao powder"],
    options: [
      {
        use: "unsweetened chocolate, melted",
        ratio: "30 g chocolate per 3 tbsp cocoa, and take out 1 tbsp of the recipe's fat",
        cost: "Adds fat, so the batter loosens — hence removing some.",
      },
    ],
  },
  {
    key: "unsweetened chocolate",
    names: ["unsweetened chocolate", "baking chocolate", "unsweetened choc"],
    options: [
      {
        use: "cocoa powder with butter or oil",
        ratio: "3 tbsp cocoa plus 1 tbsp fat per 30 g (1 square)",
        cost: "None to speak of; this is the same thing taken apart.",
      },
      {
        use: "dark chocolate, with less sugar in the recipe",
        ratio: "one for one, cutting the sugar by about 1 tbsp per 30 g",
        cost: "Sweeter unless you adjust, and the set is softer.",
      },
    ],
  },
  {
    key: "molasses",
    names: ["molasses", "treacle", "black treacle"],
    options: [
      {
        use: "dark brown sugar dissolved in a little water",
        ratio: "¾ cup packed dark brown sugar plus 1 tbsp water per cup",
        cost: "Milder and less bitter; gingerbread loses some of its darkness.",
      },
    ],
  },
  {
    key: "broth",
    names: ["chicken broth", "chicken stock", "vegetable stock", "beef broth", "stock", "broth"],
    options: [
      {
        use: "a stock cube or bouillon in water",
        ratio: "as the packet says, usually 1 cube per 500 ml",
        cost: "Saltier than homemade — hold back the recipe's salt until you have tasted.",
      },
      {
        use: "water, with the seasoning increased",
        ratio: "one for one",
        cost: "Plainer. Fine in a stew with plenty else going on, thin in a risotto or a clear soup.",
        notFor: "risotto, or any soup where the stock is the dish",
      },
    ],
  },
  {
    key: "white wine",
    names: ["white wine", "dry white wine"],
    options: [
      {
        use: "stock with a splash of vinegar or lemon",
        ratio: "1 tbsp acid per 120 ml stock",
        cost: "You lose the wine's sweetness and depth; the acidity is what mattered most.",
      },
      {
        use: "dry vermouth",
        ratio: "one for one",
        cost: "None, and it keeps for months once open where wine does not.",
      },
    ],
  },
  {
    key: "red wine",
    names: ["red wine", "dry red wine"],
    options: [
      {
        use: "beef stock with a spoon of balsamic",
        ratio: "1 tsp balsamic per 120 ml stock",
        cost: "Less body. In a long braise it is barely noticeable; in a pan sauce it is.",
      },
    ],
  },
  {
    key: "tomato-paste",
    names: ["tomato paste", "tomato puree", "tomato purée"],
    options: [
      {
        use: "passata or tinned tomatoes, reduced",
        ratio: "3 tbsp passata simmered down per 1 tbsp paste",
        cost: "Takes ten minutes and adds liquid you may then have to cook off.",
      },
      {
        use: "ketchup",
        ratio: "1 tbsp per 1 tbsp, and cut the recipe's sugar",
        cost: "Sweet and vinegary. Acceptable in a bolognese, wrong in a curry base.",
        notFor: "anything where the tomato should taste savoury and deep",
      },
    ],
  },
  {
    key: "canned-tomatoes",
    names: ["canned tomatoes", "chopped tomatoes", "passata", "tinned tomatoes"],
    options: [
      {
        use: "fresh tomatoes, skinned and chopped",
        ratio: "500 g fresh per 400 g tin",
        cost: "Needs longer cooking and ripe fruit. Out of season a tin is genuinely better.",
      },
    ],
  },
  {
    key: "lemon",
    names: ["lemon juice", "lemon"],
    options: [
      {
        use: "lime juice",
        ratio: "one for one",
        cost: "More floral and slightly more bitter.",
      },
      {
        use: "white wine vinegar",
        ratio: "half as much",
        cost: "Sharper and without the fruit. Fine to acidify a sauce, wrong in a lemon tart.",
        notFor: "anything where lemon is the flavour rather than the acid",
      },
    ],
  },
  {
    key: "lime",
    names: ["lime juice", "lime"],
    options: [
      {
        use: "lemon juice",
        ratio: "one for one",
        cost: "Rounder and less aromatic; in a Thai or Mexican dish the difference shows.",
      },
    ],
  },
  {
    key: "white wine vinegar",
    names: ["white wine vinegar", "rice vinegar", "cider vinegar"],
    options: [
      {
        use: "any other light vinegar, or lemon juice",
        ratio: "one for one; lemon juice a little more",
        cost: "Each is slightly sweeter or sharper. Malt and balsamic are not light — do not swap those in.",
        notFor: "swapping in malt or balsamic, which taste of themselves",
      },
    ],
  },
  {
    key: "soy-sauce",
    names: ["soy sauce", "light soy sauce", "tamari"],
    options: [
      {
        use: "tamari or coconut aminos",
        ratio: "one for one; aminos are sweeter, so taste",
        cost: "Coconut aminos are much less salty — the dish may need salt separately.",
      },
    ],
  },
  {
    key: "fish sauce",
    names: ["fish sauce", "nam pla"],
    options: [
      {
        use: "soy sauce with a squeeze of lime",
        ratio: "one for one, plus a good squeeze",
        cost: "Loses the savoury depth entirely. It is a stand-in, not a substitute.",
      },
    ],
  },
  {
    key: "dijon mustard",
    names: ["dijon mustard", "wholegrain mustard", "mustard"],
    options: [
      {
        use: "any other prepared mustard",
        ratio: "one for one",
        cost: "English is far hotter — start with half. American is sweeter and milder.",
      },
      {
        use: "mustard powder with water",
        ratio: "1 tsp powder plus 1 tsp water per 1 tbsp prepared",
        cost: "Hotter and without the vinegar, so a dressing loses some of its tang.",
      },
    ],
  },
  {
    key: "shallots",
    names: ["shallot", "shallots"],
    options: [
      {
        use: "the mild part of an onion",
        ratio: "half a small onion per 2 shallots",
        cost: "Coarser and less sweet. In a vinaigrette, where shallot is raw, it shows.",
        notFor: "a raw dressing",
      },
    ],
  },
  {
    key: "garlic",
    names: ["garlic", "garlic clove", "garlic cloves"],
    options: [
      {
        use: "garlic powder",
        ratio: "⅛ tsp per clove",
        cost: "Flatter and slightly dusty; it cannot brown, so a dish built on softened garlic loses its base.",
        notFor: "anything that starts by frying garlic in oil",
      },
    ],
  },
  {
    key: "fresh herbs",
    names: ["fresh herbs", "fresh basil", "fresh parsley", "fresh thyme", "fresh oregano"],
    options: [
      {
        use: "the dried version",
        ratio: "a third as much — 1 tsp dried per 1 tbsp fresh",
        cost: "Dried herbs need cooking to open up, so add them early rather than at the end. As a garnish they are simply wrong.",
        notFor: "a garnish, a salad, or anything stirred in off the heat",
      },
    ],
  },
  {
    key: "spring onions",
    names: ["spring onions", "green onions", "scallions"],
    options: [
      {
        use: "chives, or the green top of a leek",
        ratio: "one for one by volume",
        cost: "Chives are milder and will not stand up to frying.",
      },
    ],
  },
];

/** Longest name first, so "greek yogurt" is not answered by the entry for "yogurt". */
export interface Substitutions {
  find(name: string): SubstitutionEntry | null;
  all(): SubstitutionEntry[];
}

export function createSubstitutions(entries: SubstitutionEntry[]): Substitutions {
  const byLength = entries
    .flatMap((entry) => entry.names.map((name) => ({ name: normaliseName(name), entry })))
    .filter((row) => row.name)
    .sort((a, b) => b.name.length - a.name.length);

  return {
    find(name) {
      const wanted = normaliseName(name);
      if (!wanted) return null;
      for (const { name: candidate, entry } of byLength) {
        if (wanted === candidate || wanted.includes(candidate)) return entry;
      }
      return null;
    },
    all: () => [...entries],
  };
}

/**
 * How much of the table speaks the catalog's language (§50).
 *
 * The gap is reported rather than hidden, exactly as `metricPackageCoverage` reports package
 * sizes: a substitution keyed to a bare name is a candidate for catalog expansion, ranked by
 * something better than a guess about what a household buys.
 */
export function substitutionCoverage(
  catalog: readonly CatalogItem[],
  entries: readonly SubstitutionEntry[] = SUBSTITUTIONS,
): { total: number; keyed: number; bare: string[] } {
  const keys = new Set(catalog.map((item) => item.key));
  const bare = entries.filter((entry) => !keys.has(entry.key)).map((entry) => entry.key);
  return { total: entries.length, keyed: entries.length - bare.length, bare };
}
