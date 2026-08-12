# @pashki/core

Recipe domain logic: ingredient parsing, unit conversion and grocery
consolidation. This package is the product — everything else is replaceable.

No DOM, no network, no framework. Pure functions over plain data, so it runs
identically in the Next.js app, the Expo app and the import worker.

## Use

```ts
import {
  createCatalog, SEED_CATALOG, parseIngredientList,
  consolidate, significantLeftovers, recipesUsingLeftovers,
} from "@pashki/core";

const catalog = createCatalog(SEED_CATALOG);

const list = consolidate(
  [
    { label: "Tuscan Chicken",  ingredients: parseIngredientList(["1 cup heavy cream", "3 cloves garlic"]) },
    { label: "Vodka Rigatoni",  ingredients: parseIngredientList(["1/2 cup heavy cream", "4 cloves garlic"]) },
  ],
  catalog,
);

// → heavy cream: needs 1½ cup, buy "pint (16 oz)", ½ cup spare,
//   split across both recipes for the bar display
```

## Shape

| File | Does |
|---|---|
| `parse.ts` | One written line → amount, unit, item, note |
| `units.ts` | Unit table, canonical spellings, conversion to base units |
| `catalog.ts` | Matching ingredients to grocery items; package selection |
| `consolidate.ts` | Merging recipes into a shopping list with splits and leftovers |
| `format.ts` | Cook-readable output (`1½ cup`, not `354.88 ml`) |
| `text.ts` | Name normalisation, staples, fraction handling |
| `seed-catalog.ts` | Starter grocery data — moves to the database |

## Two things to know

**The catalog is injected, never imported by identity.** `SEED_CATALOG` is seed
data for the `ingredients` and `grocery_packages` tables. Production builds the
catalog from the database so it can be corrected and extended without a release.

**Base units are millilitres and grams.** Everything converts on the way in and
formats on the way out. Never do arithmetic on written units.

## Tests

```bash
npm test          # 90 tests
npm run typecheck
npm run eval      # extractor accuracy against the fixture set
```

The suite covers the awkward real-world shapes — `1 (14.5 oz) can`, `2 to 3
cloves`, `Juice of a lemon`, `▢` checkboxes — and locks down the bugs found in
the prototype so they cannot return:

- `diced tomatoes` (a tin) must not collapse into `tomatoes` (fresh produce)
- three tomatoes must not suggest a twelve-pack
- `T` is a tablespoon; `t` is a teaspoon
- a tin with no printed size must never report `0 g`

`eval/` measures extraction accuracy against hand-checked recipes, so swapping a
model is a number rather than an argument. Extractors are plain functions; no
inference layer exists yet. See `eval/README.md`.
