# Expected outputs — my reading, for checking

Captured 15 Aug 2026. **These are a draft to be checked, not truth.** Where the
right answer is genuinely arguable it is marked ⚠ and left undecided rather than
resolved quietly — those calls decide what the review screen shows.

## Capture results first, because they change the set

| # | URL | HTTP | JSON-LD Recipe | usable |
|---|---|---|---|---|
| 1 | smittenkitchen chicken-salad | 200 | **none** — markup only | yes, tier 1 |
| 2 | pinchofyum gochujang | 200 | yes, 18 lines | yes |
| 3 | bbcgoodfood traybake | 200 | yes, 6 | yes |
| 4 | recipetineats mediterranean | 200 | yes, 16 | yes |
| 5 | recipetineats chicken-breast | 200 | yes, 12 | yes |
| 6 | budgetbytes pesto pasta | 200 | yes, 13 | yes |
| 7 | smittenkitchen tortellini | **404** | — | **no — dead URL** |
| 8 | seriouseats pan-seared | **402** | — | no — bot-blocked |
| 9 | jamieoliver hit-n-run-traybake | **404** | — | **no — dead URL** |
| 10 | nytimes tomato jam | 200 | yes, 9 | yes |
| 11 | americastestkitchen | 200 | yes, 11 | ⚠ **wrong recipe** — see below |
| 12 | tasty.co | **406** | — | no — bot-blocked |
| 13 | cookpad chicken curry | **404** | — | **no — dead URL** |
| 18 | archive.org (refusal) | **404** | — | see below |

**Tier-0 hit rate, three honest framings.** 7 of 13 as supplied (54%); 7 of 10
that resolve (70%); 7 of 8 that returned HTML (88%). The first is the number that
matters for a user pasting a link, because a dead link is a failed import
whatever the cause.

Three URLs 404 against both a plain fetch and a browser user-agent, and the
Jamie Oliver one 404s on both `/recipes/chicken/` and `/recipes/chicken-recipes/`.
They are dead or mistyped, not blocked. Two more are live but refuse a
server-side fetch: Serious Eats answers **402**, Tasty **406** with an empty
body. That is a product finding as much as an eval one — the import service will
meet the same wall, and neither is a case tier 2 can rescue, because there is no
page text to send it.

---

## 1. smittenkitchen — chicken salad for celery enthusiasts  (tier 1)

No JSON-LD at all. Eight ingredient lines in markup.

| amount | unit | item | section |
|---|---|---|---|
| 2 | null | bone-in skin-on chicken breasts | null |
| null | null | Olive oil | null |
| null | null | Kosher salt | null |
| null | null | Freshly ground black pepper | null |
| ⚠ 4 | null | large ribs celery | null |
| 3 | null | scallions | null |
| 1 | tbsp | smooth Dijon mustard | null |
| 3 | tbsp | mayonnaise | null |

- title ⚠ — not captured. Needs the `<h1>`, which the capture must start keeping
  for tier-1 pages.
- servings: ⚠ unknown; not in markup I captured.
- totalMinutes: ⚠ unknown, same reason.
- `3 to 4 large ribs celery` — I read **4**, the upper bound, matching the
  parser's existing range rule ("buy enough"). ⚠ Confirm that is right for an
  *eval expectation* as well as for a shopping list.
- Eight lines is few for a chicken salad. ⚠ The capture may be partial; the page
  should be re-read by hand before this fixture is trusted.

## 2. pinchofyum — Saucy Gochujang Noodles with Chicken

title `Saucy Gochujang Noodles with Chicken` · servings **4** · totalMinutes **30**

`recipeYield` is `["4", "4-6 servings"]`; I take 4.

Sections exist on the page — `Gochujang Sauce:` and `Ramen:` — and are **not in
the JSON-LD**. See the section problem below.

| amount | unit | item | section |
|---|---|---|---|
| 3 | tbsp | soy sauce | Gochujang Sauce |
| ⚠ 3 | tbsp | gochujang sauce | Gochujang Sauce |
| 2 | tbsp | tomato paste | Gochujang Sauce |
| 2 | tbsp | peanut butter | Gochujang Sauce |
| 2 | tbsp | water | Gochujang Sauce |
| ⚠ 2 | tbsp | brown sugar | Gochujang Sauce |
| 1 | tbsp | sesame oil | Gochujang Sauce |
| 1 | clove | minced garlic | Gochujang Sauce |
| ⚠ 2 | cup | broth or water for thinning the sauce | Gochujang Sauce |
| 1 | lb | ground chicken | Ramen |
| 0.5 | tsp | salt | Ramen |
| null | null | freshly ground black pepper | Ramen |
| 2 | null | packets ramen or stir fry noodles | Ramen |
| ⚠ 2 | cup | fresh spinach | Ramen |
| 0.25 | cup | chives, scallions, cilantro, basil, or whatever herbs you like for topping | Ramen |
| null | null | salt to taste | Ramen |
| 1 | tbsp | chili oil for finishing | Ramen |
| 1 | tbsp | sesame seeds for finishing | Ramen |

⚠ **Four ranges**: `2-3 tbsp`, `1-2 tbsp`, `1-2 cups` (twice). I have taken the
upper bound throughout, consistent with the parser. Confirm.
⚠ `(like this one (affiliate link))` stripped from the gochujang line — nested
parentheses, and the inner text is not about the ingredient.

## 3. bbcgoodfood — Summer roast chicken traybake

title `Summer roast chicken traybake` · servings ⚠ **4 or 6** · totalMinutes **90**

| amount | unit | item | section |
|---|---|---|---|
| 1.5 | kg | whole chicken | null |
| 4 | tbsp | olive oil | null |
| 600 | g | frozen mixed roasted veg | null |
| **800** | g | cannellini beans | null |
| 145 | g | fresh pesto | null |
| 400 | g | cherry tomatoes on the vine | null |

- ⚠ **`Serves 4-6`.** The field is a number. 4 understates, 6 overstates, and the
  choice moves every per-serving calorie figure by 50%. My reading is **4** — the
  lower bound is what the dish reliably feeds — but this is a real call.
- **`2 x 400g cans cannellini beans` → 800 g.** The multiplier reading, matching
  the parser: two tins of 400 g is 800 g, which is what a shopping list needs.
- `1 ½kg` exercises both a vulgar fraction and a unit closed up against its
  number — the form that was unreadable until yesterday.

## 4. recipetineats — Mediterranean Chicken Dinner

title `Mediterranean Chicken Dinner` · servings **4** · totalMinutes ⚠ **55**

⚠ The page states prep 10 and cook 55 and total 55. Those cannot all be true. I
take `totalTime` as stated (55) because it is the field, but an extractor summing
prep+cook would say 65 and would not be obviously wrong.

Dual-unit lines throughout (`1kg / 2lb`, `1/2 cup (125 ml)`, `250g/8oz`). ⚠ I
take **the first-stated**, which is metric on this site.

| amount | unit | item | section |
|---|---|---|---|
| 1 | kg | bone in, skin on chicken thighs and drumsticks | ⚠ Marinade |
| 0.5 | cup | lemon juice | ⚠ Marinade |
| 6 | clove | garlic | ⚠ Marinade |
| 2 | tsp | Dijon mustard | ⚠ Marinade |
| 2 | tbsp | honey | ⚠ Marinade |
| 1 | tbsp | dried oregano | ⚠ Marinade |
| 1.5 | tsp | paprika | ⚠ Marinade |
| 1 | tbsp | olive oil | ⚠ Marinade |
| 0.5 | tsp | salt | ⚠ Marinade |
| 0.5 | tsp | pepper | ⚠ Marinade |
| 5 | null | smallish potatoes | ⚠ Potatoes |
| 2 | null | red onions | ⚠ Potatoes |
| 1 | cup | chicken broth/stock | ⚠ Potatoes |
| 250 | g | cherry tomatoes | ⚠ Potatoes |
| 0.5 | tsp | salt | ⚠ Potatoes |
| 0.5 | tsp | pepper | ⚠ Potatoes |
| 1 | tbsp | Olive oil | ⚠ Potatoes |
| null | null | Fresh oregano | ⚠ Garnish |

- ⚠ **`1/2 tsp EACH salt and pepper` is one source line naming two ingredients.**
  I have split it into two, twice. That is a reading, not a fact — and it changes
  the ingredient count, so it changes recall and precision. It is also the only
  reason the duplicate salt/pepper rows exist.
- ⚠ **`2 tbsp honey or 1 tbsp sugar`** — one line, two alternatives. I take the
  first. An extractor taking the second is not wrong about the dish.
- ⚠ Section names are **mine**, inferred from the duplicate seasoning lines. The
  JSON-LD does not carry them and I have not read the card markup for this page.

## 5. recipetineats — My go-to Chicken Breast recipe

title `My go-to Chicken Breast recipe` · servings **4** · totalMinutes ⚠ **12 or null**

⚠ `totalTime` is absent; prep 5 and cook 7 are present. Expect **12** (the honest
total) or **null** (what the field says)? This is the same question as #4 from the
other side, and the two should be answered the same way.

| amount | unit | item | section |
|---|---|---|---|
| 2 | null | large chicken breasts | ⚠ Chicken |
| 20 | g | unsalted butter | ⚠ Chicken |
| 1 | tsp | paprika | ⚠ Seasoning |
| 0.5 | tsp | onion powder | ⚠ Seasoning |
| 0.5 | tsp | garlic powder | ⚠ Seasoning |
| 0.25 | tsp | cumin | ⚠ Seasoning |
| 0.75 | tsp | cooking salt / kosher salt | ⚠ Seasoning |
| 0.125 | tsp | black pepper | ⚠ Seasoning |
| 1.5 | tbsp | flour | ⚠ Sauce |
| 0.333 | cup | dry white wine | ⚠ Sauce |
| 30 | g | unsalted butter | ⚠ Sauce |
| 1 | tbsp | roughly chopped parsley | ⚠ Sauce |

⚠ `20g/ 1 1/2 tbsp unsalted butter` — metric first again. Note butter appears
twice with different amounts; that is correct, not a duplicate.

## 6. budgetbytes — One Pot Creamy Pesto Chicken Pasta

title `One Pot Creamy Pesto Chicken Pasta` · servings **4** · totalMinutes **25**

Every line carries a price — `($6.25)` — which is not part of the ingredient and
is stripped throughout.

| amount | unit | item | section |
|---|---|---|---|
| 1 | lb | boneless, skinless chicken breast | null |
| 2 | tbsp | butter | null |
| 2 | clove | garlic | null |
| 0.5 | lb | penne pasta | null |
| 1.5 | cup | chicken broth | null |
| 1 | cup | milk | null |
| 3 | oz | cream cheese | null |
| 0.333 | cup | basil pesto | null |
| 0.25 | cup | grated Parmesan | null |
| null | null | freshly cracked pepper | null |
| ⚠ null | null | crushed red pepper | null |
| 3 | cup | fresh spinach | null |
| 0.25 | cup | sliced sun dried tomatoes | null |

- ⚠ **`1 pinch crushed red pepper`.** "pinch" is not a canonical unit, so this is
  either `amount 1, unit null, item "pinch crushed red pepper"` (wrong — the
  pinch is not the food) or `amount null, item "crushed red pepper"` (loses the
  pinch). I take the second. The validator will reject anything else.
- `3 oz. cream cheese*` — trailing asterisk is a footnote marker, stripped.

## 7. nytimes — Tomato Jam

title `Tomato Jam` · servings ⚠ **null** · totalMinutes **90**

⚠ `recipeYield` is **`1 pint`** — a volume, not a serving count. `servings` is a
number, so I read **null**. An extractor answering `1` is reading the digit and
losing the meaning, which is worse than null.

| amount | unit | item | section |
|---|---|---|---|
| 1.5 | lb | good ripe tomatoes | null |
| 1 | cup | sugar | null |
| 2 | tbsp | freshly squeezed lime juice | null |
| 1 | tbsp | fresh grated or minced ginger | null |
| 1 | tsp | ground cumin | null |
| 0.25 | tsp | ground cinnamon | null |
| 0.125 | tsp | ground cloves | null |
| 1 | tsp | salt | null |
| 1 | null | jalapeño | null |

## 8. americastestkitchen — ⚠ THE PAGE SERVES A DIFFERENT RECIPE

The URL is `11322-crispy-skin-pan-seared-chicken-breasts`. The only JSON-LD
`Recipe` node on the page is **`Sautéed Mushrooms with Red Wine and Rosemary`**,
with eleven mushroom ingredients.

This is not my misreading — there is exactly one Recipe node and that is it. The
page is paywalled, and what it exposes to an anonymous fetch is some other
recipe's structured data.

**Tier 0 would confidently extract the wrong recipe**, with no signal that
anything is wrong. That is worse than a refusal and worse than a bad parse: it is
a correct-looking answer to a different question, and the review screen would show
a mushroom recipe under a chicken URL.

⚠ **This needs a decision, and it is the most consequential one here.** Options:

1. Expect `Sautéed Mushrooms…` — measures the extractor faithfully reading the
   markup, and enshrines the wrong answer as correct.
2. Expect the real ATK chicken recipe — unreadable behind the paywall, so the
   expectation cannot be hand-checked against the capture.
3. Expect a **refusal**, on the grounds that a page whose markup disagrees with
   its own URL cannot be trusted. There is no reason for that in §46's closed
   set, and inventing one on this evidence would be premature.

I have not chosen. My inclination is 3 with a new reason, but one page is not
enough evidence to add a reason to a closed set.

---

## Two problems with the capture format itself

**Sections are not in JSON-LD, and tier 0 therefore cannot produce them.**
Confirmed by hand on pinchofyum: the recipe card renders `Gochujang Sauce:` and
`Ramen:` as headings inside the ingredient list, and the JSON-LD `recipeIngredient`
array is flat, in order, with the headings gone. So §45 is **unmeasurable from a
JSON-LD-only capture**, and a tier-0 extractor scoring 0/18 on sections would be
reporting a limitation of the format rather than of itself.

Either the capture keeps the recipe-card ingredient markup as well as the Recipe
node — bigger, still far short of 680 KB — or URL fixtures state `section: null`
throughout and §45 is measured only on captions, which carry their headings as
text. This is a call, and it should be made before eighteen expectations are
written against the wrong assumption. I tried to extract headings generically and
it worked on 3 of 8 pages; a per-plugin reader would do better, which is a real
piece of work rather than a regex.

**Tier-1 pages need more captured than the ingredient list.** Smitten Kitchen has
no JSON-LD, so title, servings and time have to come from the page, and my capture
kept only ingredient lines. Three of its five fields are therefore uncheckable.
