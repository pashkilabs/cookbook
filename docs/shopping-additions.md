# Adding things to the shopping list — design, not built

A proposal answering the five questions in the brief, plus the photograph path. **Nothing here is
implemented and no migration exists.** Three of the findings below were measured by running the
real `consolidate` over the text a person would actually type, not predicted from reading it —
those are marked **measured**, and two of them change the design.

---

## The short version

An added item is **one more `ConsolidationEntry`**, handed to the same `consolidate()` every
recipe goes through. That single decision answers most of the brief:

- it merges with recipe lines by construction, because `consolidate` buckets by catalog key;
- unresolvable text already has defined behaviour there, and it is the right behaviour;
- the tick key is the same key, so a merged addition ticks with the carton it merged into.

What it needs is a table holding the typed text, one small change to `packages/core`, and a
rendering rule for an item with no quantity.

---

## (a) The table

```
public.shopping_additions
  id                uuid primary key
  family_id         uuid not null  -> families (id)
  week_start        date not null                     -- see (c)
  raw_text          text not null  check (btrim <> '')
  added_by          uuid not null  -> family_members (id, family_id)   -- composite, see (d)
  created_at, updated_at, deleted_at
```

**`raw_text` only — the parse is not stored.** `recipe_ingredients` stores `amount`, `unit` and
`item_text`, so storing the parse is the house convention, and it is the wrong convention here.
A recipe's parse is stored because a **review screen** confirmed it; a typed line has no review
screen, and demanding one for "milk" is absurd friction. A stored parse nobody confirmed is a
cache with no version — the exact trap this project has paid for twice (`EXTRACTOR_VERSION`
unturned, `promptKey` omitting the prompt). `parseIngredientList` is pure, in core, and costs
microseconds. **Parse on read.** There is then one source of truth, no stale answer to serve, and
an improvement to the parser fixes every existing addition with no migration.

The cost is honest and worth stating: a parser change can alter what an existing addition means,
including its tick key. See (e).

No `amount`/`unit` columns, therefore, and **no `resolved_ingredient_id`** either — resolution is
a function of the catalog, which changes, and freezing it in a row is the same cache.

---

## (b) Consolidation, and what happens to text that resolves to nothing

The addition becomes one entry alongside the planned meals:

```ts
{ label: member.displayName, groupKey: "added", scale: 1,
  ingredients: parseIngredientList(rawTexts), keepStaples: true }
```

`consolidate` then keys each item as `catalog.find(item)?.key ?? normaliseName(item) ?? item`, so
there are four outcomes. All four were **measured**:

| typed | key | needed | what the list shows |
|---|---|---|---|
| `1 pint double cream` | `double cream` | 473 ml | merges with every recipe's cream; one carton bought |
| `2 lemons` | `lemons` | 2 (count) | merges; loose produce bought individually |
| `a bag of those little tomatoes` | the normalised phrase | 0 | its own line, **no package advice**, in the words typed |
| `milk` | `milk` | **0** | **renders as "0 milk"** |
| `salt` | — | — | **silently dropped** |

The first two are the feature working with no new merging code at all. The last two are faults,
and neither was predicted from reading the code.

### Fault 1 — staples vanish, silently (measured)

`consolidate` takes `excludeStaples = true` and `apps/web/lib/shopping.ts` does not override it.
That is **right** for a recipe line: "1 tsp salt" has no business on a shopping list. It is
**wrong, and invisible, for a typed one** — somebody types "salt" precisely because they have run
out of salt, and the item does not appear anywhere. A write that looks like it worked and stored
nothing is the worse half of §80.

The fix is one condition in `packages/core/src/consolidate.ts`, per entry rather than per call:

```ts
if (excludeStaples && !entry.keepStaples && isStaple(ingredient.item)) continue;
```

Per-entry and not a second `consolidate` call, because two consolidation sites is the second-site
problem this codebase keeps paying for. With the test named as behaviour: *"keeps salt when
somebody asked for salt, and drops it when a recipe did"*.

### Fault 2 — an item with no quantity, and it is already on the shipped list (measured)

`parseIngredientList("milk")` gives `amount: null`, so `toBaseMeasure` returns null, nothing is
added to the bucket's totals, and the line comes back `needed: 0`. What the screen then renders
was measured rather than assumed, because `shopping-list.tsx` has its own branch for count
dimensions and I expected it to guard the zero. It does not:

```
formatCountable(0, "spinach")        ->  "0 spinach"
formatMeasure(0, "volume", "us")     ->  "0 tsp"
formatMeasure(0, "mass", "us")       ->  "0"
```

**This is not a consequence of the new feature. It is live on the shopping list today.** Across
the hosted library: **118 of 1407 live ingredient lines carry no amount**, and while many are
staples and correctly dropped, plenty are not —

> `pineapple slices` · `spinach` · `cooked rice` · `butter lettuce or romaine` ·
> `shredded lettuce` · `sliced green onion` · `fresh basil` · `cream cheese frosting` ·
> `additional lime wedges` · `marinade`

Any week planning one of those recipes shows **"0 spinach"** above the item. So the rendering rule
below is owed to the list that exists, and the addition feature only makes it easier to reach.

Two consequences for an addition specifically:

- **Alone**, it renders as "0 milk".
- **Merged** into an existing milk line, it contributes nothing — the quantity does not move, so
  the addition is invisible except as a `uses` entry whose `display` is the empty string.

The merge case is arguably correct in substance: milk is on the list, so milk gets bought. But a
person in a shop cannot tell whether their request was honoured, and "I asked for milk as well"
is a different request from "make sure we have milk". The list cannot know which, and **must not
invent a quantity to resolve it**.

So the rendering rule: a line whose `needed` is 0 shows **the item with no quantity**, never
`"0"`, and any `uses` entry with no amount renders as *"Paige asked for this"* rather than a
blank. The information is already in the data; only the rendering is missing.

### Text that resolves to nothing

Already correct and no change needed. `packages` is null, so no package advice is offered, and
the line carries the words that were typed. This is the degraded mode `shopping.ts` already
argues for: *"a list of the right ingredients with no package advice is worth a great deal more
than an error message, and the household is standing in a shop."* Nothing is dropped and nothing
is guessed.

---

## (c) Lifetime, and what clears it

**`week_start` on the row. An addition belongs to a week and does not outlive it.**

The shopping list *is* a week — `shopping_ticks` is already keyed `(family_id, week_start,
item_key)` for the same reason. So nothing has to clear an addition: next week simply does not
select it. **No reaper, no expiry job, no cron.** That is the main argument for the column.

Within the week, the only clearing is an explicit removal, which is a soft delete like everything
else. **Ticking does not clear it** — ticking means bought, and a bought addition stays on the
list struck through exactly as a bought recipe line does.

### Standing items are out of scope — flagged, as the brief asked

"We always need milk" is a different feature and should not be smuggled in behind this one. It
has questions this design does not answer and must not pretend to:

- does it come back after you tick it, or only next week?
- does it come back if you bought it last week and still have some?
- does it interact with the pantry, which already holds "what we have" and would then be in a
  conversation with "what we always buy"?

A `standing boolean` on this table would look like a cheap way in and would commit all three
answers by accident. Its own table, its own decision, later.

---

## (d) Who added it

`added_by` references `family_members (id, family_id)` — composite, as
`assert_household_invariants` requires of any reference between household tables.

**`family_members`, not `accounts`**, because the shopping list is a household document and the
roster is its cast. A child has no login and cannot add, so in practice this is always an adult
member; using the member grain anyway keeps it consistent with `ratings`, `member_preferences`
and `member_settings`.

**NOT NULL.** Unlike §88's `allergen_changes.changed_by`, there is no writer here without an
actor: the only path is a route holding a session. A NOT NULL column is a constraint rather than
an assumption — it refuses an unattributed addition rather than quietly accepting one, and if a
future importer wants to add items it has to answer the question rather than skip it.

**Where it shows.** The member's display name becomes the entry's `label`, which means it lands
in `ShoppingLine.uses` — the field the screen already uses to say which meals want an ingredient.
So the line reads *"Cream — Tuesday's carbonara, Friday's tart, Paige"* with no new UI.

One constraint to preserve, stated rather than assumed: **no export sends `uses`.**
`packages/core/src/instacart.ts` sends `display_text: line.label` and nothing else. If an export
ever carries `uses`, it would then be sending both recipe titles and household names to a third
party, and that is a decision to take deliberately. (`health_filters` already must not go to
Instacart; this is the same category of care.)

---

## (e) Ticking, with a stable key

**The tick key is whatever `consolidate` produces. There is no second scheme for additions.**

- An addition that resolves to a catalog item **shares the recipe lines' key**, so ticking the
  cream ticks the whole cream — correct, it is one carton.
- An addition that does not resolve gets `normaliseName(item) || item`.

The temptation is to key an unresolved addition by its own uuid, which would be perfectly stable.
**Reject it:** a merged addition cannot use its uuid (it has to share the carton's key), so a
uuid scheme would mean two keying schemes with a conditional between them — and which one applies
would depend on the catalog, which changes. One scheme, with a known weakness, beats two.

The known weakness, named so it is not discovered later: **`normaliseName` is a key-stability
dependency for ticks.** If it changes, unresolved keys change and their ticks orphan — an item
un-ticks itself mid-week. This is **not new**: every unresolved recipe line already has exactly
this exposure, and it has never been written down. Parse-on-read (a) widens it slightly, since a
parser change can also move the key.

Neither is worth a cache to avoid. If it ever bites, the fix is one guard — a test pinning
`normaliseName` against a corpus of stored tick keys — and that guard is cheap whether or not
this feature exists.

---

## The photograph path

Capture a card, a scribbled list, or a shelf label, and get lines onto the shopping list.

**It reuses three things that already exist and builds nothing new of its own:**

1. **The orientation probe (§75)** — `/api/import` with `mode=orientation`, four rotations in,
   `{status: "established" | "unreadable" | "unconfigured"}` out. It spends **no quota**, which is
   the right call here for the same reason: a probe asking which way up the paper is should not
   bill a household. Reused verbatim, including the three-way status — "unreadable" and
   "unconfigured" are different news and collapsing them is what made a sideways card report as
   upright.
2. **`parseIngredientList`** — the same parser the recipes and the typed additions go through. The
   model returns *lines of text*, and the parser turns them into quantities. **The model must not
   be asked for amounts and units as structured fields**: that would be a second parser, reached
   only through the vision path, diverging from the one every other line uses.
3. **The review screen.** Every import passes one before saving, and that is what makes a cheap
   model good enough. A photograph of a shopping list is no exception — it is the cheapest place
   to catch "2 lemons" read as "7 lemons".

### §54 applies, and it is the thing most likely to go wrong

*A schema field is not a request, and a field nobody scores stays empty forever.* `steps` sat in
the extraction schema with a description while every sentence of `EXTRACTION_INSTRUCTIONS` was
about ingredients, so every caption came back `"steps":[]` — including one with a `DIRECTIONS:`
heading. So:

- **Ask for every field in words**, in the instructions, not only in the schema. A photograph of a
  shopping list wants lines and nothing else; if it is also meant to read a shelf price or a
  store name, the instructions have to say so in sentences.
- **Score every field asked for.** A shopping-list photograph needs its own fixtures in the eval —
  the recipe fixtures score recipe fields and would report nothing about this path. Without them
  the capability is *never asked for and never measured*, which is "silence reads as success" one
  level up.
- **An example in a description is a default (§54a).** Whatever example the schema shows for a
  line is what will come back for an ambiguous one. Write the example you want.

### Two things to settle before building this half

- **Does a photographed list go through the review screen as a recipe does, or does it need its
  own?** A recipe review screen is built around title, servings, ingredients and method. A list
  has only lines. Probably the same screen in a reduced mode, but that is a screen decision and
  wants a look rather than a guess.
- **Is this a shopping-list feature or an import feature?** It lands rows in
  `shopping_additions`, but every other photograph in the product lands a recipe. If the answer is
  "both, depending on what the photo is", something has to decide which — and a model deciding it
  is a classification nobody is scoring yet. The narrower build is a capture that is only ever
  reached from the shopping screen and only ever produces list lines.

### And the one that is not a design question

**A capture path needs a way in from a screen.** Caption paste and screenshot upload both shipped
with green checks and **no way in from the product** — the import screen offered only "One link"
and "A whole folder". Whatever this becomes, the deliverable is a control somebody can find, and
an endpoint existing is not that.

---

## Build order, if this is approved

1. `keepStaples` in `packages/core`, with its test. Independent of everything else and fixes a
   real fault in the existing list.
2. The rendering rule for `needed: 0` and for an amountless `uses` entry. Also independent.
3. The table, the route, and the typed-entry control on `/shopping`.
4. The photograph, once the two questions above are settled.

**1 and 2 are owed to the list that exists and should land whether or not the rest does.** Step 2
is a measured, live fault: 118 of 1407 lines carry no amount and "0 spinach" renders today.

Step 2 is deliberately *not* done in this pass, because the obvious fix — making
`formatCountable(0, x)` return the bare noun — changes a `packages/core` formatter used in places
that may legitimately want to say "0 of something", and the right answer is a copy decision
("spinach"? "some spinach"?) rather than a mechanical one. It wants a look at the screen, which is
the thing a design document should hand over rather than settle.
