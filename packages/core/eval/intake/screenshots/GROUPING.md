# The frames, grouped

Fourteen files arrived. **Thirteen are reel frames across six posts; one was not a
fixture at all** — `Screenshot … 9.38.22 am.png` is Stephen's bug report of the
shopping list failing with `column ingredients.grams_each does not exist`, since
fixed. Moved to `../not-fixtures/` rather than deleted, because a screenshot of a
real failure is worth keeping and is not eval material.

Every grouping below was made by reading the frame, not by inferring from a
timestamp or a file size — dimensions do not cluster by source.

| fixture | frames | source | what the frames add over the caption |
|---|---|---|---|
| `reel-tiffy-lunchbox` | 01 | tiffy.cooks | **refusal.** "Full recipes link in bio", no dish named |
| `reel-coconut-curry` | 02, 03 | tiffy.cooks | `Garlic powder`, `Then add in hot rice` — ingredients the caption withholds |
| `reel-crispy-rice-salad` | 01, 02 | Noa Williams | title card; 02 expands the caption to the full sectioned recipe |
| `reel-street-corn-bowls` | 01–04 | Body Fit Balance | steps 1, 2, 4, 6; **03 and 04 show the whole ingredient list** |
| `reel-chile-lime-bowl` | 01, 02 | The Cooking Diary | `1/2 tbsp cilantro` on screen; 02 is the post with sections |
| `reel-pad-thai` | 01, 02 | Kalejunkie | 02 expands to `Makes 4-6 servings` and the PAD THAI section |

Numbering is the order the recipe happens in, not the order the files arrived —
`reel-street-corn-bowls-01` is "step 1: chop your sweet potatoes", which was
`frame-08`.

## Four of the six duplicate a caption fixture

`crispy-rice-salad`, `street-corn-bowls`, `chile-lime-bowl` and `pad-thai` each
have a caption `.txt` **and** frames. That is not waste: it is the only way to
measure whether the vision path reads a screenshot as well as the text path reads
the same recipe, with the expected output held constant. The expectation should be
**identical** for both, and any difference is the vision tier's error rather than a
different truth.

`coconut-curry` is the exception and the interesting one: caption and frames have
**different correct answers** (decisions §46) — a refusal from the caption, a
partial recipe with null amounts from the frames.
