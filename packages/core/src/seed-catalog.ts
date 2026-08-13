import type { CatalogItem } from "./types.js";

/**
 * Starter grocery catalog: how things are actually sold.
 *
 * This is seed data for the `ingredients` and `grocery_packages` tables, not a
 * permanent home. Nothing may depend on this array by identity — the catalog is
 * loaded through `createCatalog()` so production can serve it from the database
 * and correct it over time.
 *
 * `amount` values are in the dimension's base unit: millilitres or grams.
 */
/**
 * The grocery catalog, as data.
 *
 * **Canonical names — the first in each `names` array — are singular.** The display pluralises
 * (`formatCountable`), because a list has to say "1 lemon" as often as "3 lemons" and storing
 * one form breaks the other. Plurals stay in the array as aliases, since that is what recipes
 * are written in: "3 lemons" has to find this item.
 *
 * `garlic` is named for the thing rather than the unit: its dimension is `clove`, so
 * `formatMeasure` supplies "2 cloves" and the name supplies "garlic".
 */
export const SEED_CATALOG: CatalogItem[] = [
  // ---- Dairy ----
  { key: "heavy-cream", names: ["heavy cream", "heavy whipping cream", "whipping cream", "double cream"],
    aisle: "Dairy", dimension: "volume",
    packages: [{ label: "½ pint (8 oz)", amount: 237 }, { label: "pint (16 oz)", amount: 473 }, { label: "quart (32 oz)", amount: 946 }] },
  { key: "half-and-half", names: ["half and half", "half & half", "single cream"],
    aisle: "Dairy", dimension: "volume",
    packages: [{ label: "pint", amount: 473 }, { label: "quart", amount: 946 }] },
  { key: "milk", names: ["whole milk", "2% milk", "skim milk", "milk"],
    aisle: "Dairy", dimension: "volume",
    packages: [{ label: "quart", amount: 946 }, { label: "½ gallon", amount: 1893 }, { label: "gallon", amount: 3785 }] },
  { key: "buttermilk", names: ["buttermilk"], aisle: "Dairy", dimension: "volume",
    packages: [{ label: "pint", amount: 473 }, { label: "quart", amount: 946 }] },
  { key: "sour-cream", names: ["sour cream"], aisle: "Dairy", dimension: "weight", gramsPerCup: 230,
    packages: [{ label: "8 oz tub", amount: 227 }, { label: "16 oz tub", amount: 454 }] },
  { key: "yogurt", names: ["greek yogurt", "plain yogurt", "yoghurt", "yogurt"],
    aisle: "Dairy", dimension: "weight", gramsPerCup: 245,
    packages: [{ label: "5.3 oz pot", amount: 150 }, { label: "16 oz tub", amount: 454 }, { label: "32 oz tub", amount: 907 }] },
  { key: "butter", names: ["unsalted butter", "salted butter", "butter"],
    aisle: "Dairy", dimension: "weight", gramsPerCup: 227,
    packages: [{ label: "1 stick", amount: 113 }, { label: "1 lb (4 sticks)", amount: 454 }] },
  { key: "cream-cheese", names: ["cream cheese"], aisle: "Dairy", dimension: "weight", gramsPerCup: 232,
    packages: [{ label: "8 oz block", amount: 227 }] },
  { key: "shredded-cheese", names: ["shredded mozzarella", "shredded cheddar", "mozzarella", "cheddar", "monterey jack", "shredded cheese"],
    aisle: "Dairy", dimension: "weight", gramsPerCup: 113,
    packages: [{ label: "8 oz bag", amount: 227 }, { label: "16 oz bag", amount: 454 }] },
  { key: "parmesan", names: ["parmigiano reggiano", "grated parmesan", "parmesan", "pecorino"],
    aisle: "Dairy", dimension: "weight", gramsPerCup: 100,
    packages: [{ label: "5 oz wedge", amount: 142 }, { label: "8 oz wedge", amount: 227 }] },
  { key: "feta", names: ["feta"], aisle: "Dairy", dimension: "weight", gramsPerCup: 150,
    packages: [{ label: "6 oz", amount: 170 }, { label: "8 oz", amount: 227 }] },
  { key: "eggs", names: ["large egg", "large eggs", "eggs", "egg"], aisle: "Dairy", dimension: "count",
    packages: [{ label: "half dozen", amount: 6 }, { label: "dozen", amount: 12 }, { label: "18-count", amount: 18 }] },

  // ---- Meat & Seafood ----
  { key: "chicken-breast", names: ["boneless skinless chicken breast", "chicken breasts", "chicken breast"],
    aisle: "Meat & Seafood", dimension: "weight",
    packages: [{ label: "1 lb", amount: 454 }, { label: "2 lb", amount: 907 }, { label: "3 lb family pack", amount: 1361 }] },
  { key: "chicken-thighs", names: ["boneless chicken thighs", "chicken thighs", "chicken thigh"],
    aisle: "Meat & Seafood", dimension: "weight",
    packages: [{ label: "1 lb", amount: 454 }, { label: "2 lb", amount: 907 }] },
  { key: "ground-beef", names: ["ground beef", "ground chuck", "beef mince", "hamburger"],
    aisle: "Meat & Seafood", dimension: "weight",
    packages: [{ label: "1 lb", amount: 454 }, { label: "2 lb", amount: 907 }] },
  { key: "ground-turkey", names: ["ground turkey"], aisle: "Meat & Seafood", dimension: "weight",
    packages: [{ label: "1 lb", amount: 454 }] },
  { key: "sausage", names: ["italian sausage", "sausage"], aisle: "Meat & Seafood", dimension: "weight",
    packages: [{ label: "1 lb", amount: 454 }] },
  { key: "bacon", names: ["bacon"], aisle: "Meat & Seafood", dimension: "weight",
    packages: [{ label: "12 oz pack", amount: 340 }, { label: "1 lb pack", amount: 454 }] },
  { key: "salmon", names: ["salmon fillets", "salmon fillet", "salmon"], aisle: "Meat & Seafood", dimension: "weight",
    packages: [{ label: "1 lb", amount: 454 }, { label: "1½ lb", amount: 680 }] },
  { key: "shrimp", names: ["shrimp", "prawns"], aisle: "Meat & Seafood", dimension: "weight",
    packages: [{ label: "1 lb bag", amount: 454 }] },

  // ---- Produce ----
  { key: "onion", names: ["yellow onion", "white onion", "red onion", "onions", "onion"],
    aisle: "Produce", dimension: "count",
    packages: [{ label: "loose", amount: 1 }, { label: "3 lb bag (~6)", amount: 6 }] },
  { key: "garlic", names: ["garlic", "garlic cloves", "garlic clove"], aisle: "Produce", dimension: "clove",
    packages: [{ label: "1 head (~10 cloves)", amount: 10 }, { label: "3-pack heads", amount: 30 }] },
  { key: "lemon", names: ["lemon", "lemons"], aisle: "Produce", dimension: "count",
    packages: [{ label: "loose", amount: 1 }, { label: "bag of 5", amount: 5 }] },
  { key: "lime", names: ["lime", "limes"], aisle: "Produce", dimension: "count",
    packages: [{ label: "loose", amount: 1 }, { label: "bag of 5", amount: 5 }] },
  { key: "potatoes", names: ["russet potatoes", "yukon gold potatoes", "baby potatoes", "potatoes", "potato"],
    aisle: "Produce", dimension: "weight",
    packages: [{ label: "loose lb", amount: 454 }, { label: "5 lb bag", amount: 2268 }] },
  { key: "carrots", names: ["carrots", "carrot"], aisle: "Produce", dimension: "weight",
    packages: [{ label: "1 lb bag", amount: 454 }, { label: "2 lb bag", amount: 907 }] },
  { key: "celery", names: ["celery"], aisle: "Produce", dimension: "count",
    packages: [{ label: "1 bunch (~8 stalks)", amount: 8 }] },
  { key: "bell-pepper", names: ["red bell pepper", "green bell pepper", "bell peppers", "bell pepper"],
    aisle: "Produce", dimension: "count",
    packages: [{ label: "loose", amount: 1 }, { label: "3-pack", amount: 3 }] },
  { key: "spinach", names: ["baby spinach", "spinach"], aisle: "Produce", dimension: "weight",
    packages: [{ label: "5 oz box", amount: 142 }, { label: "10 oz box", amount: 283 }] },
  { key: "tomatoes", names: ["roma tomato", "roma tomatoes", "cherry tomatoes", "cherry tomato", "tomatoes", "tomato"],
    aisle: "Produce", dimension: "count",
    packages: [{ label: "loose", amount: 1 }, { label: "pint container", amount: 12 }] },
  { key: "mushrooms", names: ["cremini mushrooms", "button mushrooms", "mushrooms"],
    aisle: "Produce", dimension: "weight",
    packages: [{ label: "8 oz pack", amount: 227 }, { label: "16 oz pack", amount: 454 }] },
  { key: "broccoli", names: ["broccoli"], aisle: "Produce", dimension: "count",
    packages: [{ label: "1 crown", amount: 1 }] },
  { key: "avocado", names: ["avocado", "avocados"], aisle: "Produce", dimension: "count",
    packages: [{ label: "loose", amount: 1 }, { label: "bag of 4", amount: 4 }] },
  { key: "cilantro", names: ["fresh cilantro", "cilantro", "coriander"], aisle: "Produce", dimension: "bunch",
    packages: [{ label: "1 bunch", amount: 1 }] },
  { key: "parsley", names: ["fresh parsley", "parsley"], aisle: "Produce", dimension: "bunch",
    packages: [{ label: "1 bunch", amount: 1 }] },
  { key: "basil", names: ["fresh basil", "basil"], aisle: "Produce", dimension: "bunch",
    packages: [{ label: "1 packet", amount: 1 }] },
  { key: "green-onions", names: ["green onions", "scallions", "spring onions", "green onion"],
    aisle: "Produce", dimension: "bunch", packages: [{ label: "1 bunch", amount: 1 }] },

  // ---- Pantry ----
  { key: "olive-oil", names: ["extra virgin olive oil", "olive oil"], aisle: "Pantry", dimension: "volume",
    packages: [{ label: "17 oz bottle", amount: 500 }, { label: "34 oz bottle", amount: 1000 }] },
  { key: "flour", names: ["all purpose flour", "all-purpose flour", "plain flour", "flour"],
    aisle: "Pantry", dimension: "weight", gramsPerCup: 125,
    packages: [{ label: "2 lb bag", amount: 907 }, { label: "5 lb bag", amount: 2268 }] },
  { key: "sugar", names: ["granulated sugar", "caster sugar", "sugar"], aisle: "Pantry", dimension: "weight", gramsPerCup: 200,
    packages: [{ label: "2 lb bag", amount: 907 }, { label: "4 lb bag", amount: 1814 }] },
  { key: "brown-sugar", names: ["brown sugar"], aisle: "Pantry", dimension: "weight", gramsPerCup: 213,
    packages: [{ label: "1 lb bag", amount: 454 }, { label: "2 lb bag", amount: 907 }] },
  { key: "rice", names: ["jasmine rice", "basmati rice", "white rice", "rice"], aisle: "Pantry", dimension: "weight", gramsPerCup: 185,
    packages: [{ label: "2 lb bag", amount: 907 }, { label: "5 lb bag", amount: 2268 }] },
  { key: "pasta", names: ["spaghetti", "rigatoni", "fettuccine", "linguine", "penne", "pasta"],
    aisle: "Pantry", dimension: "weight", packages: [{ label: "1 lb box", amount: 454 }] },
  { key: "canned-tomatoes", names: ["crushed tomatoes", "diced tomatoes", "canned tomatoes", "chopped tomatoes", "tomato sauce", "passata"],
    aisle: "Pantry", dimension: "weight", gramsPerCup: 240, canSize: 425,
    packages: [{ label: "15 oz can", amount: 425 }, { label: "28 oz can", amount: 794 }] },
  { key: "tomato-paste", names: ["tomato paste", "tomato puree"], aisle: "Pantry", dimension: "weight", gramsPerCup: 260, canSize: 170,
    packages: [{ label: "6 oz can", amount: 170 }] },
  { key: "sun-dried-tomatoes", names: ["sun dried tomatoes", "sun-dried tomatoes"], aisle: "Pantry", dimension: "weight", gramsPerCup: 110,
    packages: [{ label: "8 oz jar", amount: 227 }] },
  { key: "broth", names: ["chicken broth", "chicken stock", "vegetable broth", "vegetable stock", "beef broth", "broth", "stock"],
    aisle: "Pantry", dimension: "volume", canSize: 429,
    packages: [{ label: "14.5 oz can", amount: 429 }, { label: "32 oz carton", amount: 946 }] },
  { key: "coconut-milk", names: ["coconut milk"], aisle: "Pantry", dimension: "volume", canSize: 400,
    packages: [{ label: "13.5 oz can", amount: 400 }] },
  { key: "beans", names: ["black beans", "kidney beans", "chickpeas", "cannellini beans", "pinto beans"],
    aisle: "Pantry", dimension: "weight", gramsPerCup: 180, canSize: 425,
    packages: [{ label: "15 oz can", amount: 425 }] },
  { key: "soy-sauce", names: ["soy sauce"], aisle: "Pantry", dimension: "volume",
    packages: [{ label: "10 oz bottle", amount: 296 }] },
  { key: "honey", names: ["honey"], aisle: "Pantry", dimension: "volume",
    packages: [{ label: "12 oz jar", amount: 355 }] },
  { key: "maple-syrup", names: ["maple syrup"], aisle: "Pantry", dimension: "volume",
    packages: [{ label: "8 oz bottle", amount: 237 }, { label: "12 oz bottle", amount: 355 }] },

  // ---- Bakery & Frozen ----
  { key: "tortillas", names: ["flour tortilla", "flour tortillas", "corn tortillas", "corn tortilla", "tortillas", "tortilla"], aisle: "Bakery", dimension: "count",
    packages: [{ label: "pack of 8", amount: 8 }, { label: "pack of 12", amount: 12 }] },
  { key: "bread", names: ["sandwich bread", "baguette", "bread"], aisle: "Bakery", dimension: "count",
    packages: [{ label: "1 loaf", amount: 1 }] },
  { key: "frozen-peas", names: ["frozen peas", "frozen corn", "frozen vegetables"], aisle: "Frozen", dimension: "weight",
    packages: [{ label: "10 oz bag", amount: 283 }, { label: "16 oz bag", amount: 454 }] },
];

