# Hand-scored protein labels, 2026-11-15

Written **before** any fix, so a re-score compares against a fixed judgement rather than a fresh
one (§82). Real households only — 4 of 169 families on the hosted project; the other 165 are
harness, classified by the owner account's reserved email domain.

Scope: the **56 of 104** live recipes that have a `principal_protein` stored. A null is not scored
here — a missing label is bucket 1 or 2, not a wrong answer — except where the right answer *is*
null and a label was stored anyway.

Adjudicated from the title where the title names the animal, and from the **ingredients printed
from the database** wherever it did not. The nine printed are marked `[ings]`; the rest were
unambiguous from the title.

## Verdict: 55 correct, 1 wrong

| recipe | stored | right answer | |
|---|---|---|---|
| Peanut butter balls | `vegetarian` | `null` | **WRONG** — the whole recipe is `2 ripe bananas`. No animal product, no plant protein the dish is built on. This is §95's case, on a row still carrying the stale prompt. |

Every other stored label is right:

- **beef 13/13** — Stroganoff, Beef & Broccoli, Bolognese, Braised Short Ribs, Hamburger Helper,
  pot roast, Meatballs, Tri-Tip, and `[ings]` Homemade Spaghettios (0.75 lb ground beef),
  Easy Fried Rice with hibachi Steak (2 lb top sirloin), Hibachi Steak Bowls,
  Loaded Potato Taco Bowl (500 g minced beef), meatballs with Bolognese.
- **chicken 20/20** — including `[ings]` Asian Lettuce Rolls (cooked chicken),
  Chili-Garlic Broth Bowls (chicken thighs), Hawaiian Chicken Poke Bowl (chicken thighs — a poke
  bowl that is not fish, which is the case a title-only reader would get wrong).
- **pork 15/15** — including `[ings]` Lasagna Soup (1 lb sausage), Italian Chopped Salad
  (salami + pepperoni), loaded potato soup (1 lb bacon). `ÖLMARINERAD RAPSGRISFILÉ` is pork
  ("gris"), named in no English word anywhere in the row.
- **seafood 3/3**, **fish 2/2**, **turkey 1/1**.
- **egg 1/1** — `[ings]` Easy Fried Rice: rice, sesame oil, onion, peas and carrots, soy, two
  eggs, spring onion. Egg is the only animal protein and the dish is built on it.

## Not scored, recorded so the next reader does not re-derive it

`dish_form` is wrong on at least three rows that this measurement did not ask about:
`Italian Sausage & Cheese Baked Manicotti` and `Orecchiette Pasta with Sausage` are both stored
`soup`, and `4 Ingredient Sausage & Boursin Cheese Pasta` is `bowl`. Different field, different
question — reported rather than folded in.

---

# Re-score after the backfill, same day

The judgement above was fixed before anything was changed. This compares against it.

`classifyIfUnclassified` was made per-field, the backfill's family discovery was repaired, and the
backfill then ran over the 93 eligible recipes in the two real households that have any. **93 of
93 classified, zero write failures, and all 104 now carry the current prompt's digest** (it was
11).

## What moved

| | before | after |
|---|---|---|
| recipes naming a protein | 56 of 104 | **76 of 104** |
| mains naming a protein | 55 of 78 | **73 of 78 (94%)** |
| carrying the current prompt | 11 | **104** |

**20 nulls filled, every one correct** — Korean Ground Beef Bowls, both French Dips, Philly
Cheesesteak, Big Mac Salad, Braised Short Ribs, Steakhouse Loaded Potato Bombs, Smash Burger Tacos,
Chicken Enchiladas, Hawaiian Chicken Sheet Pan, Baked Mozzarella Chicken Rolls, Grilled Salmon,
Poached Cod, Creamy Parmesan Basil Shrimp, Zuppa Toscana, Basic Salami, 3-2-1 BBQ Baby Back Ribs,
both Spare Ribs, and `PEANUT CHILLI NOODLES` → `vegan`, which is the row §95 could never settle and
is right: peanut butter and tahini are what the dish is built on.

**Two went backwards**, both shrimp, both to `pork`:

| recipe | before | after | contains any pork? |
|---|---|---|---|
| Garlic Butter Shrimp | `seafood` | `pork` | no — shrimp, butter, garlic, chilli, lemon, parsley |
| Linguine With Zucchini, Corn and Shrimp | `seafood` | `pork` | no — linguine, shrimp, butter, oil, garlic, shallot, courgette, corn, mint, basil |

`pork` with nothing behind it is §95's confabulation label, on a second and unrelated class of
dish. Third and fourth instances.

## And the prompt is not what is wrong, which only a control run could show

Re-run three times each through the shipping path (`pnpm --filter @pashki/import stability:protein`):

```
stable   stored=seafood     seafood@1  seafood@1  seafood@1   Creamy Garlic Shrimp
stable   stored=seafood     seafood@1  seafood@1  seafood@1   Creamy Parmesan Basil Shrimp
stable   stored=pork        seafood@1  seafood@1  seafood@1   Garlic Butter Shrimp
MOVED    stored=pork        seafood@0.67  pork@1  pork@1      Linguine With Zucchini, Corn and Shrimp
```

**`Garlic Butter Shrimp` answers `seafood` unanimously in all three fresh runs.** The stored `pork`
is a bad draw the backfill froze, not a prompt that believes shrimp is pork. A prompt change aimed
at it would have been measuring the weather — §96, arriving as work rather than as a maxim.

## The signal that was already in the column

`classified_agreement.principalProtein` across all 104:

| agreement | recipes | known wrong |
|---|---|---|
| 1.0 (unanimous) | 100 | 1 — `Linguine …` |
| 0.67 (2-1) | 4 | 2 — `Garlic Butter Shrimp`, `Peanut butter balls` |

Four rows in the whole library are below unanimous and **two of them are wrong**: a 50% error rate
against roughly 1% among the unanimous, a fiftyfold enrichment, in a column that is already stored
and has never been read by anything.

**The caveat is the whole reason this is a proposal and not a change.** Agreement is a *within-run*
measure, and `Linguine …` is stored at **1.0** while moving between runs — so unanimity in one run
does not mean stability across runs (§61: a per-row consensus is not a run-to-run spread). A rule
of "re-ask anything below unanimous" would have caught 2 of the 3 errors for 4 extra calls, and
would have missed the third. That is worth doing and worth **measuring over three runs before
doing**, because the last two plausible unmeasured changes to this classifier each moved the error
somewhere new (§94, §95) and one had to be reverted.

Not hand-patched. Three rows are knowably wrong and the fix for one of them is a single re-ask, and
hand-editing production data is not the same as having a rule.
