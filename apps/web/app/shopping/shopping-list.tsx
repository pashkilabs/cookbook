"use client";

import { GroupPicker, NewGroupField, NEW_GROUP } from "./group-picker";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatCountable, pluralise, type ShoppingLine } from "@pashki/core";
import { Checkbox, Chip, Eyebrow, SectionHeader, SegmentedControl } from "@/components/harvest";
import { byMeal } from "@/lib/by-meal";
import { isIsoDate, weekdayName } from "@/lib/week";
import { ShareList } from "./share";

/**
 * The list, and the two things you can do to it while standing in a shop.
 *
 * Every string on a line — the amount needed, the packages to buy, what each recipe takes, what
 * is left spare — was produced by `consolidate()`. This component chooses layout and nothing
 * else. If a number looks wrong, the fix is a test in `packages/core`.
 *
 * **The package line is the point of the product**, so it is the loudest thing on the row rather
 * than a subtitle: "buy 1 pint" above "Tuesday takes 1 cup, Friday takes ½ cup, 100 ml spare" is
 * the whole pitch — one pint bought instead of two half-pints and waste.
 */
export function ShoppingList(props: {
  weekStart: string;
  plannedCount: number;
  byAisle: Array<{ aisle: string; lines: ShoppingLine[] }>;
  /**
   * A section per group with something in it — Costco, Boo Basket.
   *
   * Rendered after the aisles rather than among them: an aisle is a position inside one shop, and
   * a group is a different shop or a different basket. The tick keys are already namespaced by
   * group id upstream, so ticking Costco's paper towels does not tick the main trip's.
   */
  groupedLines: Array<{ id: string; name: string; lines: ShoppingLine[] }>;
  /** the household's groups, for the per-line picker — the same list the add box offers */
  groups: Array<{ id: string; name: string }>;
  leftovers: ShoppingLine[];
  suggestions: Array<{ id: string; title: string; uses: string[] }>;
  pantry: Array<{ id: string; name: string }>;
  ticked: string[];
}) {
  const router = useRouter();
  const [ticked, setTicked] = useState(new Set(props.ticked));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<"aisle" | "meal">("aisle");

  /*
   * `finally`, and the whole list depends on it.
   *
   * regression: `setBusy(null)` sat after the await with no `try`. A shop is exactly where a
   * connection drops, and an offline `fetch` **rejects** rather than returning — so that line
   * never ran, `busy` stayed set, and every checkbox, every "Have it" and every pantry chip on
   * the page is `disabled={busy !== null}`. One failed tap in aisle four and the entire list
   * went dead in somebody's hand, silently: the caller drops the promise, so nothing surfaced.
   * The optimistic tick stayed crossed off on screen, was never saved, and was gone on reload.
   *
   * CLAUDE.md requires this to work with no signal. It could not survive one bad tap.
   */
  async function call(key: string, path: string, method: string, body: unknown) {
    setBusy(key);
    setError(null);
    try {
      const response = await fetch(path, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const failed = (await response.json().catch(() => ({}))) as { error?: string };
        setError(failed.error ?? `that did not work (${response.status})`);
        return false;
      }
      return true;
    } catch {
      // named as signal rather than as an error, because that is what it almost always is in a
      // supermarket, and because the useful thing to say is that the list still works
      setError("No signal — that one was not saved. The list still works; try it again in a moment.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function toggleTick(line: ShoppingLine) {
    const on = ticked.has(line.key);
    // moved immediately: this is a shop, and waiting for a round trip to cross something off is
    // the difference between usable and not. Rolled back if the write is refused.
    setTicked((current) => {
      const next = new Set(current);
      if (on) next.delete(line.key);
      else next.add(line.key);
      return next;
    });
    const ok = await call(`tick-${line.key}`, "/api/shopping-ticks", on ? "DELETE" : "POST", {
      weekStart: props.weekStart,
      itemKey: line.key,
    });
    if (!ok) {
      setTicked((current) => {
        const next = new Set(current);
        if (on) next.add(line.key);
        else next.delete(line.key);
        return next;
      });
    }
  }

  /*
   * Which group each line is currently in, by the key the list renders.
   *
   * Built from `groupedLines` rather than fetched: the server has already resolved the precedence —
   * standing row, then inherited from the extras feeding the line, then none — and a second answer
   * computed here is a second place that can disagree with it.
   */
  const groupOf = new Map(
    props.groupedLines.flatMap((group) => group.lines.map((line) => [line.key, group.id] as const)),
  );

  /**
   * File an item under a group, or take it out of one.
   *
   * The key sent back is the one the list rendered — this screen never derives it, and neither
   * does the route, so `consolidate` stays the only thing that decides what merges with what.
   */
  async function fileItem(line: ShoppingLine, choice: { groupId?: string; groupName?: string }) {
    const ok = await call(`group-${line.key}`, "/api/shopping-item-groups", "PUT", {
      itemKey: line.key,
      ...choice,
    });
    // the line moves between sections, so the list itself changes — re-read rather than guess
    if (ok) router.refresh();
  }

  async function togglePantry(line: ShoppingLine) {
    const held = props.pantry.find((item) => item.name.toLowerCase() === line.label.toLowerCase());
    const ok = held
      ? await call(`pantry-${line.key}`, "/api/pantry", "DELETE", { id: held.id })
      : await call(`pantry-${line.key}`, "/api/pantry", "POST", { name: line.label });
    // the list itself changes — a pantry item can remove a line's need entirely — so re-read
    if (ok) router.refresh();
  }

  /*
   * Everything there is to buy, grouped sections included — the figure says "7 items" and a
   * person can count the rows. A total that silently excluded a section would be a number nobody
   * can check against the screen under it.
   */
  const groupedTotal = props.groupedLines.reduce((sum, group) => sum + group.lines.length, 0);
  const total = props.byAisle.reduce((sum, group) => sum + group.lines.length, 0) + groupedTotal;

  /*
   * ---------------------------------------------------------------------------
   * "Pantry · check before you go" is §73's unresolved case, not every pantry line
   * ---------------------------------------------------------------------------
   *
   * `inPantry` alone cannot decide this, and splitting on it would hide a real shortfall from the
   * buy list. §73 drew the distinction that matters: a pantry entry **with** an amount reduces
   * `needed`, so what is left on the line is the shortfall and it belongs in its aisle. One typed
   * **without** an amount — "we have some rice" — is flagged and subtracted from nothing, which
   * means *we do not know whether to buy at all*.
   *
   * That second case is exactly what a dashed checkbox says. The primitive's three states were
   * written with the dashed one meaning **unresolved** rather than unchecked, and this is the
   * first screen where a genuinely unresolved thing exists to put in it.
   */
  const toCheck = props.byAisle.flatMap((group) =>
    group.lines.filter((line) => line.inPantry && !line.pantryDeducted),
  );
  const checkKeys = new Set(toCheck.map((line) => line.key));
  const aisles = props.byAisle
    .map((group) => ({ ...group, lines: group.lines.filter((line) => !checkKeys.has(line.key)) }))
    .filter((group) => group.lines.length > 0);
  const meals = byMeal(aisles);

  /*
   * What the share sheet gets: the aisle view as text, which is the view that answers "what do I
   * buy". Package decisions included, because they are the point — and the household's own item
   * names only, no recipe titles and nothing about who likes what.
   */
  const shareText = [
    `Shopping · ${total} ${total === 1 ? "item" : "items"}`,
    ...aisles.flatMap((group) => [
      "",
      group.aisle.toUpperCase(),
      ...group.lines.map((line) => `- ${line.packagesDisplay ?? line.neededDisplay ?? ""} ${line.label}`.trim()),
    ]),
  ].join("\n");

  /*
   * `isIsoDate`, not `Boolean(date)`. A `groupKey` is typed `string | number` and only a planned
   * meal's is a date — an entry somebody typed carries none, and one carrying any other string
   * used to reach `weekdayName`, which answered `undefined` and took the screen down with
   * `.slice` of nothing. Guarding the *type* was the mistake; this guards the shape.
   */
  const day = (date: unknown) =>
    typeof date === "string" && isIsoDate(date) ? weekdayName(date).slice(0, 3) : null;

  /*
   * ---------------------------------------------------------------------------
   * What a line with nothing to buy says, and the two zeros that are not the same
   * ---------------------------------------------------------------------------
   *
   * It said **"0 spinach"**. Measured rather than assumed: `formatCountable(0, "spinach")` is
   * `"0 spinach"` and `formatMeasure(0, "volume", "us")` is `"0 tsp"`, and **118 of 1407 live
   * ingredient lines carry no amount** — `pineapple slices`, `cooked rice`, `shredded lettuce` —
   * so any week planning one of those rendered a zero above the item.
   *
   * `formatCountable` already returns the bare noun for `null`, so the formatter was never the
   * problem: `needed` is a number and arrives as `0`, which is a different fact from absent.
   *
   * **And zero does legitimately mean zero, which is why this is not one branch.** `consolidate`
   * computes `needed = max(0, needed - onHand)` when the pantry carries an amount (§73), so a
   * line can reach zero *because the household already has enough* — and rendering the bare name
   * there would read as "buy spinach" when the answer is "do not". The data tells them apart:
   * `pantryDeducted` is true only when an amount was actually subtracted.
   *
   *   needed > 0                        the quantity, as before
   *   needed === 0 && pantryDeducted    you have enough — say so, do not print a zero
   *   needed === 0 && !pantryDeducted   the paper never said how much; the bare name
   *
   * The third is the common case and will be most of a photographed list.
   */
  const buyAmount = (line: ShoppingLine, { packages = true } = {}) => {
    if (packages && line.packagesDisplay) return line.packagesDisplay;
    if (line.needed > 0) {
      return line.dimension === "count"
        ? formatCountable(line.needed, line.label)
        : line.neededDisplay || "";
    }
    if (line.pantryDeducted) return "Enough already";
    /*
     * Nothing was ever stated, so the amount slot is **empty** — not the name again.
     *
     * `formatCountable(null, label)` returns the bare noun, which was the first fix and looked
     * right in the diff: the row then rendered "spinach   spinach", the name in its own column and
     * the name again where the quantity goes. Only the screenshot showed it. The name already has
     * a column; what this slot has to say is "no number was given", and the day chips beneath
     * already say "Mon · some".
     */
    return "";
  };

  const lineRow = (line: ShoppingLine) => {
    const isTicked = ticked.has(line.key);
    const inPantry = line.inPantry;
    return (
      <div className={isTicked ? "h-buy is-ticked" : "h-buy"} key={line.key}>
        {/*
          * The checkbox *wraps* what is being crossed off, because `Checkbox` is a `<label>` —
          * so the whole name-and-amount block is the hit target, which is what a thumb in aisle
          * four needs. "Have it" stays outside it: a button nested in a label would toggle the
          * tick as well as itself.
          *
          * `onToggle` omitted rather than a `disabled` prop, which is this primitive's API — it
          * disables the real input when nothing can happen.
          */}
        <Checkbox
          state={isTicked ? "have" : "need"}
          {...(busy === null ? { onToggle: () => void toggleTick(line) } : {})}
          label={`Got ${line.label}`}
        >
        <div className="h-buy-what">
          <div className="h-buy-top">
            <span className="h-buy-name">{line.label}</span>
            {/*
              * The package decision, on the right and loud (§4.5). It is the product: "1 pint"
              * beside "Tue ½ cup, Fri 1 cup" is one pint bought instead of two half-pints.
              *
              * Catalog names are singular and core pluralises, so the two branches ask for
              * different forms rather than sharing a string — "a bag of potatoes" is plural
              * whatever the count, while a bare quantity agrees with its number.
              */}
            <strong className="h-buy-amount">{buyAmount(line)}</strong>
          </div>

          {line.packagesDisplay && (
            <p className="h-buy-of">of {pluralise(line.label)}</p>
          )}

          {/* each meal's portion, and what survives — clay, which is the planned tint (§4.5) */}
          {(line.uses.length > 0 || line.leftoverDisplay) && (
            <div className="h-buy-split">
              {line.uses.map((use, index) => (
                /*
                 * The day, which is what §4.5 asks for and what a shop actually needs. The
                 * recipe name moves to "By meal" rather than being dropped — that is what the
                 * segmented control is *for*, and it is the thing that makes this trade safe
                 * instead of a loss. `title` on the wrapper covers a desktop hover; the By-meal
                 * view covers everybody else.
                 */
                <span key={index} title={`${use.label} takes ${use.display || "some"}`}>
                  <Chip tone="clay">
                    {day(use.groupKey) ?? use.label}
                    {" · "}
                    {use.display || "some"}
                  </Chip>
                </span>
              ))}
              {line.leftoverDisplay && <Chip tone="sage">{line.leftoverDisplay} spare</Chip>}
            </div>
          )}

          {line.otherDimensions.length > 0 && (
            <p className="h-buy-of">also {line.otherDimensions.map((other) => other.display).join(", ")}</p>
          )}
        </div>
        </Checkbox>

        <button
          type="button"
          className="h-chip"
          disabled={busy !== null}
          title={inPantry ? "Take it out of the pantry" : "I already have this"}
          onClick={() => togglePantry(line)}
        >
          {inPantry ? "Not in pantry" : "Have it"}
        </button>

        {/*
          * Where this item is bought, on **every** line.
          *
          * A group is a property of the item, not of one request for it, so a recipe-derived line
          * is as groupable as a typed one — which is the whole reason the assignment is keyed on
          * the consolidated line key rather than stored on `shopping_extras`. On the week this was
          * measured that is the difference between a control on 36 lines and a control on all 75.
          *
          * Closed until asked for, because a picker on every row of a fifty-line list is a wall of
          * dropdowns between somebody and their shopping.
          */}
        <LineGroup
          line={line}
          groups={props.groups}
          current={groupOf.get(line.key) ?? ""}
          busy={busy !== null}
          onFile={(choice) => fileItem(line, choice)}
        />
      </div>
    );
  };

  return (
    <>
      {error && <p className="error">{error}</p>}

      <div className="h-shop-head">
        <div>
          <Eyebrow>Shopping</Eyebrow>
          <p className="h-shop-count">
            {/*
              * "from 0 meals" is not a sentence anybody writes. The list renders with nothing
              * planned now — a typed item is enough — so the clause that counts meals only
              * appears when there are some.
              */}
            {total} {total === 1 ? "item" : "items"}
            {props.plannedCount > 0
              ? ` from ${props.plannedCount} ${props.plannedCount === 1 ? "meal" : "meals"}`
              : ""}{" "}
            · {ticked.size} in the trolley
          </p>
        </div>
        <ShareList text={shareText} />
      </div>

      <div className="h-shop-views">
        <SegmentedControl
          segments={[
            { value: "aisle", label: "By aisle" },
            { value: "meal", label: "By meal" },
          ]}
          value={view}
          onChange={setView}
          label="How to read the list"
        />
      </div>

      {/*
        * By meal shows portions and **never a package**, because the pint belongs to the week
        * rather than to any one dinner — see `lib/by-meal.ts`. The tick is keyed on the
        * consolidated line, so crossing cream off under Tuesday crosses it off under Friday: you
        * bought the cream once.
        */}
      {view === "meal" ? (
        meals.length === 0 ? (
          <p className="meta">Nothing planned this week, so there is nothing to read by meal.</p>
        ) : (
          meals.map((group) => (
            <section key={`${group.date ?? ""}-${group.meal}`} className="h-meal">
              <Eyebrow>
                {group.date ? `${weekdayName(group.date)} · ` : ""}
                {group.meal}
              </Eyebrow>
              <ul className="h-meal-items">
                {group.items.map((item) => (
                  <li key={`${item.key}-${item.portion}`} className={ticked.has(item.key) ? "is-ticked" : undefined}>
                    <span>
                      {item.label}
                      {item.inPantry && <span className="h-buy-of"> · in the pantry</span>}
                    </span>
                    <strong>{item.portion}</strong>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )
      ) : (
        aisles.map((group) => (
        <section key={group.aisle} className="h-aisle">
          <Eyebrow>{group.aisle}</Eyebrow>
          {group.lines.map((line) => lineRow(line))}
        </section>
      )))}

      {/*
        * The household's own groups, as sections of the list rather than a box at the bottom.
        *
        * **A group is where something is bought, so it has to be shoppable** — tick boxes, package
        * advice, the same row as everything else. The first version of this put the grouping in the
        * "Anything else you need" panel, which lists what was *typed*; a person standing in Costco
        * needs the list, not the log of requests. And a thing in a group is deliberately not also
        * in an aisle above, which is how the handwritten lists do it: one line, under its header.
        *
        * Shown in both views. "By meal" answers "what is this for", and the honest answer for one
        * of these is "nothing, somebody asked for it" — leaving them out of that view would make
        * them vanish on a tab change, which is the silent-drop shape (§80).
        */}
      {props.groupedLines.map((group) => (
        <section key={group.id} className="h-aisle h-shop-group">
          <Eyebrow>{group.name}</Eyebrow>
          {group.lines.map((line) => lineRow(line))}
        </section>
      ))}


      {/*
        * "Pantry · check before you go" (§4.5), and the dashed state is load-bearing here rather
        * than decorative.
        *
        * Every line in this section is §73's withheld case: a pantry entry with no recorded
        * amount, so the list genuinely **cannot know** whether to buy. Dashed means unresolved,
        * not unchecked, and this is the first screen where something truly unresolved exists.
        *
        * The live action is the one that already existed — take it out of the pantry and it goes
        * back on the buy list — so the checkbox says that in words rather than implying a
        * "confirmed" state nothing records. A control whose meaning a person has to guess is the
        * same failure as a figure they cannot check.
        */}
      {toCheck.length > 0 && view === "aisle" && (
        <section className="h-aisle h-check-pantry">
          <Eyebrow>Pantry · check before you go</Eyebrow>
          <p className="h-buy-of">
            You said you have these, without an amount — so the list has not decided for you.
            Look before you leave, and tick anything you have run out of to put it back on.
          </p>
          {toCheck.map((line) => (
            <div className="h-buy" key={line.key}>
              <Checkbox
                state="check-pantry"
                {...(busy === null ? { onToggle: () => void togglePantry(line) } : {})}
                label={`I have run out of ${line.label} — put it back on the list`}
              >
                <div className="h-buy-what">
                  <div className="h-buy-top">
                    <span className="h-buy-name">{line.label}</span>
                    {/*
                      * The pantry block, which shows no package on purpose — the question here is
                      * "do you still have it", not "what size to buy". The zero handling is shared
                      * rather than copied: a pantry line reaching zero is exactly the case where
                      * "Enough already" is the true answer rather than a bare name.
                      */}
                    <strong className="h-buy-amount">{buyAmount(line, { packages: false })}</strong>
                  </div>
                </div>
              </Checkbox>
            </div>
          ))}
        </section>
      )}

      {props.suggestions.length > 0 && (
        <section className="h-spare">
          <SectionHeader>Uses up the spare</SectionHeader>
          <p className="h-buy-of">
            {props.leftovers.map((line) => `${line.leftoverDisplay} ${line.label}`).join(" · ")}
          </p>
          <ul className="h-alongside-list">
            {props.suggestions.map((suggestion) => (
              <li key={suggestion.id}>
                <Link href={`/recipes/${suggestion.id}`}>{suggestion.title}</Link>
                {suggestion.uses.length > 0 && (
                  <span className="meta">uses the {suggestion.uses.join(", ")}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {props.pantry.length > 0 && (
        <section className="h-spare">
          <SectionHeader>Pantry</SectionHeader>
          <p className="h-buy-of">
            Things you already have. They stay on the list, marked, so you can see what a meal
            needs even when you are not buying it.
          </p>
          <ul className="h-pantry-chips">
            {props.pantry.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="h-chip"
                  disabled={busy !== null}
                  onClick={async () => {
                    if (await call(`pantry-${item.id}`, "/api/pantry", "DELETE", { id: item.id })) {
                      router.refresh();
                    }
                  }}
                >
                  {item.name} ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/**
 * The group control for one line: a chip until somebody taps it, then the picker.
 *
 * **The picker is `GroupPicker`, imported** — the same control the add box uses, feeding the same
 * `findOrCreateGroup`. A second picker with its own matching is how "costco" and "Costco" come
 * back as two groups, which is the fault the table was built to remove.
 *
 * The chip names the current group rather than saying "Group", because a row that is already filed
 * under Costco should say so where somebody is looking, and the same control then changes it.
 */
function LineGroup({
  line,
  groups,
  current,
  busy,
  onFile,
}: {
  line: ShoppingLine;
  groups: Array<{ id: string; name: string }>;
  current: string;
  busy: boolean;
  onFile: (choice: { groupId?: string; groupName?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState(current);
  const [named, setNamed] = useState("");

  if (!open) {
    const name = groups.find((group) => group.id === current)?.name;
    /*
     * **"Move", not the group's name.** A filed line is rendered inside that group's own section,
     * so a chip repeating "Costco" under a COSTCO heading says nothing — it was noise on every row
     * of the section, which only the screenshot showed. The heading says where it is; the control
     * says what can be done about it.
     *
     * And quiet rather than a filled chip: `.h-chip` on a button takes the primary fill, so this
     * rendered as loud as "Have it" on every line of a fifty-line list. It is a utility, not the
     * row's action.
     */
    return (
      <button
        type="button"
        className="h-buy-where"
        disabled={busy}
        title={name ? `Bought at ${name} — tap to move it` : "Say where this is bought"}
        onClick={() => { setChoice(current); setNamed(""); setOpen(true); }}
      >
        {name ? "Move" : "Where?"}
      </button>
    );
  }

  const naming = choice === NEW_GROUP;
  return (
    /* `min-width: 0` on the strip: it holds a select and two buttons in a flex row (§81) */
    <span className="h-line-group" style={{ minWidth: 0 }}>
      <GroupPicker
        groups={groups}
        value={choice}
        onChange={setChoice}
        disabled={busy}
        label={`Where ${line.label} is bought`}
      />
      {naming && <NewGroupField value={named} onChange={setNamed} disabled={busy} />}
      <button
        type="button"
        className="h-secondary"
        disabled={busy || (naming && named.trim().length === 0)}
        onClick={() => {
          onFile(naming ? { groupName: named.trim() } : choice ? { groupId: choice } : {});
          setOpen(false);
        }}
      >
        Save
      </button>
      <button type="button" className="h-chip" disabled={busy} onClick={() => setOpen(false)}>
        Cancel
      </button>
    </span>
  );
}
