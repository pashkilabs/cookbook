# Release notes

What changed, for the person using it — not what changed in the code. Where something is
deliberately strange, this says so, because a known oddity arriving as a decision is a very
different thing from the same oddity arriving as a defect.

---

## Blending two recipes (§60 step 4)

Take the part you like from one recipe — the glaze, the slaw, the sauce — and pair it with a
part of another. The result is a real recipe: it plans, it scales, it shops.

It arrives marked **a proposal, nobody has cooked this**, and it stays that way until you
mark it cooked. It is never published: a blend reproduces two other people's prose, which is a
different thing from your own recipe, so it stays inside the household whatever the sharing
settings say.

### Two things about it are deliberately odd

Both come from one decision: **version one changes no quantities, ever.** Not to reconcile
servings, not to tidy a list. Combining two recipes and quietly adjusting the numbers inside a
familiar-looking layout is the failure nobody catches until they have shopped and cooked, so
this does not do it. That leaves two visible consequences, and it is better to name them than
to let them be reported as bugs.

**1. The method is quoted whole, including steps for ingredients that are not there.**

Each source recipe's method comes across complete, under a heading saying which recipe it came
from. Nothing knows which steps make which part — working that out needs technique extraction,
which is not built, because the recipe corpus does not contain enough technique to measure it
against. So a blend using the glaze from a pork belly recipe reproduces that recipe's method
in full, and some of those steps are about pork belly you have not bought.

Deciding which steps to follow is yours. That is a real limitation and it is why this is a
proposal rather than a recipe. It is visible on the page, and visibly wrong is navigable in a
way faked attribution would not be — a method that quietly claimed to know which steps were
the glaze's would be wrong just as often and impossible to check.

**2. Duplicate ingredients stay as two lines.**

`2 cloves garlic` from one part and `1 tbsp garlic` from the other remain two lines. Merging
them means arithmetic on written units — cloves and tablespoons are not the same measure — and
that is a quantity change.

**This is confined to the recipe view.** The shopping list still consolidates properly: it
works in millilitres and grams, it already combines ingredients across every recipe in a week,
and it treats a blend exactly like any other recipe. So a blend wanting cream and a Friday
recipe wanting cream still buy **one pint between them**, split across both. The duplication
you can see on the recipe page does not reach the list you shop from.

### What it does check

One thing, and it has a temperature behind it. If a part brings a collagen-rich cut — chuck,
shin, brisket, short rib, pork shoulder — into a method too short to break it down, it says so:
collagen needs hours held around 70–90 °C to become gelatin, and minutes will not get there.

It says nothing else. Most pairings have no published basis either way, and saying nothing is
the right answer far more often than a feature like this wants to admit.
