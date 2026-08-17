# overton — the failing pair

The two images Stephen uploaded that returned "no recipe could be read". These are
NOT from the fixture set: they are a fresh, full-resolution photograph of the same
recipe as `card-7323`, front and back.

`card-7323` in the fixture set is the **front only**. The back has never been in the
set, and it carries the half that matters.

## Why this pair is hard

**Front** — Grandma Overton's Rolls. Rotated 90°, cursive, in a decorative card frame
with a red border and `PSALM 34:8` printed in red script. No ingredient list at all:
every quantity is embedded in prose. `Scald 2 c. milk. Add ½ c. sugar and ½ c.
shortening.` Sugar appears twice at different amounts — ½ c. in the milk, ½ tsp with
the yeast — and both are real.

**Back** — plain paper, same hand, also rotated 90°. Continues the method, then
carries a **second variant under its own heading**: `(Cinnamon Rolls)`, made from the
same dough with different shaping, a different bake time and cream cheese frosting.

So the recipe is: one dough, two shaping options, quantities in prose, across two
images, both sideways.

## The reference reading

Gemini, given both images at full resolution with a prose prompt, produced a correct
recipe — including the variant split, the two sugars, and the different bake times.
Stephen assessed it at 95%. It is a **reference**, not an expectation: it shows the
ceiling is reachable, not what our expectation should be.

Our app, given the same two images through the product at 6674 KB → 623 KB, returned
no recipe at all.

## What the ablation must explain

Not "why is this read badly" but "why does this produce nothing" — when a two-image
pair of a different card (`card-7327` + `card-7328`) read cleanly through the same
strict tool-calling path.

The candidate that fits the shape: a card whose true structure is
`one dough → two variants` cannot be expressed in `{title, servings, ingredients[],
steps[]}`, and a forced tool call gives the model no way to say so.
