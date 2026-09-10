"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Which lines of this recipe are you taking?
 *
 * **The model proposes; the person confirms.** Choosing a part pre-ticks the lines that part
 * covers, and every line stays individually tickable afterwards. That is not a nicety: §61
 * measured the agreement number and found it separates a right partition from a wrong one at
 * 50/50, because three runs of one model at temperature zero are one opinion sampled three
 * times. There is no confidence signal to gate on, so nothing may stand between a person and
 * the selection they are blending from.
 *
 * It also matches where the model is actually good. It gets the *count* of parts right for 18
 * of the 19 recipes that genuinely have two or more, while matching only 47 of 71 individual
 * components — good at "this recipe is about three things", bad at "which line belongs to
 * which". So it draws the boundaries and a person moves them.
 *
 * Whether they moved is recorded (`adjusted`). Every correction is a hand label produced as a
 * side effect of somebody cooking, on exactly the recipes this household cares about.
 */
export interface PickerLine {
  index: number;
  measure: string;
  itemText: string;
  note: string;
  section: string | null;
}

export interface PickerPart {
  key: string;
  name: string;
  role: string | null;
  taken: "component" | "whole";
  lineIndexes: number[];
  agreement: number | null;
  readings: number | null;
}

export function PartPicker({
  lines,
  parts,
  onlyWholeBecause,
  continueBase,
  slot,
  heading,
  action,
}: {
  lines: PickerLine[];
  parts: PickerPart[];
  onlyWholeBecause: string | null;
  /*
   * The URL to continue to, as strings rather than a callback: a function cannot cross the
   * server/client boundary, and passing one is a runtime error rather than a type error.
   */
  continueBase: string;
  /** "" for the first source, "2" for the second — the query keys it writes */
  slot: "" | "2";
  heading: string;
  action: string;
}) {
  const router = useRouter();
  const first = parts[0]!;
  const [partKey, setPartKey] = useState(first.key);
  const [ticked, setTicked] = useState<number[]>(first.lineIndexes);
  const [touched, setTouched] = useState(false);

  const choose = (part: PickerPart) => {
    setPartKey(part.key);
    setTicked(part.lineIndexes);
    // choosing a different proposal is not an adjustment; moving its lines is
    setTouched(false);
  };

  const toggle = (index: number) => {
    setTouched(true);
    setTicked((was) =>
      was.includes(index) ? was.filter((n) => n !== index) : [...was, index].sort((a, b) => a - b),
    );
  };

  const chosenPart = parts.find((part) => part.key === partKey) ?? first;
  const lowAgreement =
    chosenPart.taken === "component" &&
    chosenPart.agreement !== null &&
    chosenPart.agreement < 0.7;

  return (
    <section>
      <h2>{heading}</h2>

      {parts.length > 1 ? (
        <div className="tabs" role="radiogroup" aria-label="which part">
          {parts.map((part) => (
            <button
              key={part.key}
              type="button"
              role="radio"
              aria-checked={part.key === partKey}
              className={part.key === partKey ? "button" : "button quiet"}
              onClick={() => choose(part)}
            >
              {part.taken === "whole" ? "The whole recipe" : part.name}
              {part.role && part.taken === "component" ? <span className="meta"> · {part.role}</span> : null}
            </button>
          ))}
        </div>
      ) : (
        // prose, not an absence: a screen showing nothing here looks like one that never looked
        <p className="meta">{onlyWholeBecause}</p>
      )}

      {lowAgreement && (
        <p className="meta">
          The readings disagreed about where this part ends, so treat the ticks as a starting
          point rather than an answer. Low agreement is a real signal; high agreement is not,
          which is why nothing here is decided for you.
        </p>
      )}

      <p className="meta">
        Tick the lines you are taking. These start where the split proposed them — nothing has
        checked that those boundaries are right, and you can see the recipe better than it can.
      </p>

      <ul className="ingredients">
        {lines.map((line, at) => {
          const previous = at === 0 ? undefined : lines[at - 1];
          const newSection = line.section && line.section !== (previous?.section ?? null);
          return (
            <li key={line.index} style={newSection ? { borderTop: "1px solid var(--line-strong)" } : undefined}>
              <label style={{ display: "flex", gap: "var(--s3)", alignItems: "baseline", width: "100%", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={ticked.includes(line.index)}
                  onChange={() => toggle(line.index)}
                />
                {line.measure && <span className="measure">{line.measure}</span>}
                <span>{line.itemText}</span>
                {line.note && <span className="meta"> — {line.note}</span>}
                {line.section && <span className="meta"> · {line.section}</span>}
              </label>
            </li>
          );
        })}
      </ul>

      <div className="tabs">
        <button
          type="button"
          className="button"
          disabled={ticked.length === 0}
          onClick={() => {
            const query = new URLSearchParams();
            query.set(`take${slot}`, chosenPart.key);
            query.set(`lines${slot}`, ticked.join(","));
            if (touched) query.set(`adj${slot}`, "1");
            router.push(`${continueBase}&${query.toString()}`);
          }}
        >
          {action}
        </button>
        {ticked.length === 0 && <span className="meta">Tick at least one line.</span>}
      </div>
    </section>
  );
}
