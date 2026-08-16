# Caption expectations — my reading, for checking

Seventeen captions. **A draft to be checked, not truth.** ⚠ marks a call that is
genuinely arguable and is left open rather than resolved quietly.

Conventions, applied throughout:

- `amount: null` where the source gives none. **No estimates.** "Half a block",
  "to your desire", "a splash" and "eyeball some" are all null.
- Ranges take the **upper bound**, matching the parser's "buy enough" rule.
- Sections carry the heading as written, minus a trailing colon (§45). Captions
  keep sections; URL fixtures do not, because JSON-LD cannot express them.
- Brand handles are dropped from the item (`@jimmydean` → `Italian Sausage`);
  brand *words* that are part of the name are kept (`Boursin`, `Old El Paso`).
- A caption withholding a **link** while printing ingredients is a recipe; only
  one withholding the **ingredients** is a refusal (§46).

---

## 1. `instagram-texas-twinkies` — the null-amount case

**Recipe**, not a refusal. Every ingredient named, not one quantified. This is the
sharpest fixture in the set: it measures directly whether an extractor invents
quantities when the source declines to give them.

title `Texas Twinkies` · servings ⚠ `null` · totalMinutes ⚠ `90`

| amount | unit | item | section |
|---|---|---|---|
| null | null | leftover brisket | null |
| null | null | cream cheese | null |
| null | null | cheddar cheese | null |
| null | null | jalapeños | null |
| null | null | bacon | null |
| null | null | rub | null |
| null | null | traeger glaze | null |

- ⚠ **`half a block of cream cheese` is null, not 0.5 block.** "Block" is a
  container word the parser canonicalises to `can`, so `0.5 can cream cheese`
  would be *expressible* — and wrong, because half of an unstated block is not a
  quantity. Any extractor producing a number here has invented one.
- ⚠ **totalMinutes 90**: "1 hour" plus "an additional 20-30 mins", taking the
  upper bound. Arguable — the source never states a total, and `null` is
  defensible. I lean 90 because both components are stated and adding them is
  arithmetic, not estimation.
- ⚠ `275*` is a temperature, not a quantity, and is not an ingredient. An
  extractor emitting `275` as an amount has read the smoker setting as food.
- `Set @traegergrills` is equipment. Not an ingredient.

## 2. `instagram-summer-toast-board` — three sections, mostly null

**Recipe.** Three toasts, three sections (§45). Most components have no amount;
two do.

title **`null`** · servings `null` · totalMinutes `null`

| amount | unit | item | section |
|---|---|---|---|
| null | null | ricotta | Ricotta and corn |
| 2 | null | ears of corn | Ricotta and corn |
| null | null | prosciutto | Ricotta and corn |
| null | null | flaky salt | Ricotta and corn |
| null | null | hot honey | Ricotta and corn |
| null | null | thyme | Ricotta and corn |
| 1 | null | block feta | Strawberry balsamic |
| null | null | olive oil | Strawberry balsamic |
| null | null | strawberries | Strawberry balsamic |
| null | null | balsamic vinegar | Strawberry balsamic |
| null | null | basil | Strawberry balsamic |
| null | null | pistachios | Strawberry balsamic |
| null | null | flaky salt | Strawberry balsamic |
| null | null | balsamic glaze | Strawberry balsamic |
| null | null | burrata cheese | Peach burrata |
| null | null | grilled peaches | Peach burrata |
| null | null | fresh tomatoes | Peach burrata |
| null | null | flaky salt | Peach burrata |
| null | null | olive oil | Peach burrata |
| null | null | thyme | Peach burrata |
| null | null | basil | Peach burrata |

- **The caption names no dish, so the title is `null`.** `Summer Toasts` was my
  first answer and it was invented; the format now says absence out loud, and an
  extractor producing a title here is scored wrong.
- ⚠ **`2 ears of corn`** — `ear` canonicalises to `count`, which the validator
  requires be written as `null`. So `amount 2, unit null, item "ears of corn"`.
  The word "ears" stays in the item. A known wart, recorded in the eval README: a
  countable-noun model in the parser is real work and must not arrive through a
  fixture quietly asserting one exists.
- ⚠ **`1 block feta`** — same container problem as the cream cheese, but here the
  source *does* say one, so the count is real.
- ⚠ **`a splash of cold water` is null**, per the standing call. It is inside a
  parenthetical describing how the whipped feta is made; I have kept the feta and
  the olive oil and dropped the water as method rather than ingredient. Arguable.
- `flaky salt` appears in all three sections. Three lines, not one — they are
  three separate uses and the shopping list consolidates them itself.
- `#ad #MeijerPartner`, the Meijer prose and "Room & Retreat collection" are not
  ingredients. An extractor emitting `Meijer` has read sponsorship as food.

---

## 3. `instagram-cinnamon-rolls` — five sections

**Recipe.** title `Cinnamon Rolls` · servings ⚠ `null` · totalMinutes ⚠ `null`

Sections as written, minus the brackets: `dough`, `filling`, `caramel for baking
dish`, `cream cheese icing`, `for baking`.

| amount | unit | item | section |
|---|---|---|---|
| 0.75 | cup | warm milk | dough |
| 2.5 | tsp | instant yeast | dough |
| 1 | tbsp | sugar | dough |
| 0.333 | cup | sugar | dough |
| 2 | null | eggs | dough |
| 3 | cup | all purpose flour | dough |
| null | null | salt | dough |
| 0.25 | cup | melted butter | dough |
| 0.5 | cup | butter | filling |
| 1 | cup | brown sugar | filling |
| 2 | tbsp | cinnamon | filling |
| ⚠ null | null | nutmeg | filling |
| 0.25 | cup | brown sugar | caramel for baking dish |
| 0.25 | cup | softened butter | caramel for baking dish |
| ⚠ 1 | null | block cream cheese | cream cheese icing |
| 0.333 | cup | butter | cream cheese icing |
| ⚠ null | null | vanilla | cream cheese icing |
| 1.5 | cup | icing sugar | cream cheese icing |
| 2 | tbsp | milk | cream cheese icing |
| ⚠ null | null | heavy cream | for baking |

- `sugar` appears twice in `dough` with different amounts. Two lines — the source
  says so, and consolidation is the shopping list's job, not the fixture's.
- ⚠ `eyeball some nutmeg` → null. ⚠ `2 splashes vanilla` → null: "splash" is not a
  unit, and 2 of an unmeasured thing is not 2 of anything.
- ⚠ `heavy cream (1 tbsp for each roll)` → **null**, not 1 tbsp. The parenthetical
  is a rate, not a quantity: the total depends on a roll count the recipe never
  fixes ("about 9-12"). An extractor answering `1 tbsp` has read a rate as a total.
- ⚠ `1 block cream cheese` → amount 1, unit null. Unlike the twinkies' *half* a
  block, the count here is real. "block" stays in the item, same wart as "ears".
- ⚠ totalMinutes: 10 min proof + 8 min mix + 2 h rest + 30 min second rest + 25 min
  bake ≈ 193. I read **null**: unlike the twinkies' two stated components, this is
  five scattered through prose, and summing them is reconstruction rather than
  arithmetic. Inconsistent with #1 by design — say if you want one rule.
- `175F` and `350F` are oven temperatures. Not ingredients — the equipment check.

## 4. `instagram-sheet-pan-crunchwrap` — a nested recipe inside a line

**Recipe.** title `Sheet Pan Crunchwrap Supreme` · servings ⚠ `null` · totalMinutes ⚠ `27`

| amount | unit | item | section |
|---|---|---|---|
| 8 | null | burrito-size tortillas | Crunchwrap |
| 2 | lb | ground beef | Crunchwrap |
| 1 | cup | beef broth | Crunchwrap |
| ⚠ 6 | tbsp | taco seasoning | Crunchwrap |
| 1.5 | cup | shredded cheddar cheese | Crunchwrap |
| 6 | null | tostadas | Crunchwrap |
| 2 | cup | shredded lettuce | Crunchwrap |
| 2 | null | tomatoes | Crunchwrap |
| 1 | cup | sour cream | Crunchwrap |
| 3 | tbsp | butter | Crunchwrap |
| 0.333 | cup | sour cream | Creamy Taco Sauce |
| 0.333 | cup | mayonnaise | Creamy Taco Sauce |
| 0.333 | cup | milk | Creamy Taco Sauce |
| 1 | null | lime | Creamy Taco Sauce |
| 1 | tbsp | taco seasoning | Creamy Taco Sauce |
| 1 | tbsp | dried parsley | Creamy Taco Sauce |
| 0.5 | tsp | paprika | Creamy Taco Sauce |
| 0.5 | tsp | garlic powder | Creamy Taco Sauce |

- ⚠ **The taco seasoning parenthetical is a whole sub-recipe** — eight ingredients
  with their own quantities, offered as an alternative to the one line. I read it
  as **one line, `6 tbsp taco seasoning`**, and drop the alternative. The other
  reading gives eight extra ingredients that are only bought if you choose that
  path, and buying both is wrong. **This is the biggest single reading call in the
  caption set**: it moves the ingredient count from 18 to 26.
- ⚠ `Juice of 1 lime` → amount 1, unit null, item `lime`. The juice is the use.
- `sour cream` in both sections at different amounts. Two lines.
- ⚠ totalMinutes 27 (20 + 7 bake, both stated). `420°F` is the equipment check.

---

## The remaining thirteen

Not yet written. Each needs the same line-by-line reading and there are roughly
190 ingredient lines across them. Written at speed they would be plausible and
unchecked, which is the one thing the intake README says must not happen — an
expected output copied from what an extractor produced measures agreement with
today's bugs.

Order they should be done in, hardest-first so the arguable calls surface early:

1. `facebook-chile-lime-chicken-bowl` — three sections, and the sub-recipe yield
   trap (`Makes 2 servings` belongs to the salsa, not the dish — §45)
4. `facebook-street-corn-beef-bowls` — implicit sections by blank line, ranges
   throughout, `1 bag roasted corn`
5. `facebook-sweet-chilli-crispy-rice-salad` — three sections, metric, `Water to thin`
6. `instagram-peach-posset` — a section stated inline (`Brown butter peaches: …`)
7. `instagram-marry-me-sausage-soup` — clean, `Makes 6 servings`, invisible separators
8. `facebook-chicken-pad-thai` — three sections, single line, `Makes 4-6 servings`
9. `instagram-lemony-shrimp-orzo` — two sections, `3 tb fresh fill` (dill typo)
10. `instagram-coconut-curry-brothy-rice` — two sections, `1 14 oz can`
11. `instagram-pb-cookie-dough-smores-bites` — two sections
12. `instagram-potato-sausage-soup` — clean, one section
13. `instagram-one-pot-boursin-pasta` — `▢` bullets, `squeeze of fresh lemon juice (1-2 Tbsp.)`
14. `instagram-boursin-sausage-pasta` — four lines, `1 24oz Jar`
15. `facebook-homemade-burger-buns` — clean, `400 for 12 minutes` is a temperature
