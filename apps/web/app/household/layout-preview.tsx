/**
 * The abstract preview beside each option — the part of the wireframe that matters most.
 *
 * Picking a layout blind asks somebody to predict their own behaviour. A six-block diagram cannot
 * show what a layout *feels* like, but it shows the **shape**: a grid with two emphasised, a grid
 * with a band under it, one wide block above small ones. That is enough to tell them apart
 * without trying each one, which is the whole argument for having it.
 *
 * `aria-hidden`: the label and description carry the meaning, and "a small diagram of rectangles"
 * read aloud is noise before a sentence that already says it.
 */
export function LayoutPreview({ layout }: { layout: string }) {
  /* each row is a list of [flex, emphasised] — terracotta marks what the layout puts first */
  const rows: Array<Array<[number, boolean]>> =
    layout === "rotation"
      ? [[[1, true], [1, true]], [[1, false], [1, false]], [[1, false], [1, false]]]
      : layout === "browse"
        ? [[[1, false], [1, false]], [[1, false], [1, false]], [[1, false]]]
        : layout === "time"
          ? [[[1, true], [1, false], [1, false]], [[1, false], [1, false]], [[1, false], [1, false]]]
          : layout === "protein"
            ? [[[2, true], [1, false], [1, false]], [[1, false]], [[1, false]], [[1, false]]]
            : [[[1, true]], [[1, false], [1, false]]];

  return (
    <span className="h-preview" aria-hidden="true">
      {rows.map((row, y) => (
        <span className="h-preview-row" key={y}>
          {row.map(([grow, on], x) => (
            <span
              className={on ? "h-preview-block is-on" : "h-preview-block"}
              key={x}
              style={{ flexGrow: grow }}
            />
          ))}
        </span>
      ))}
    </span>
  );
}
