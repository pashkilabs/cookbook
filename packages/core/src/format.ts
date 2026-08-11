import type { Dimension } from "./types.js";
import { formatQuantity } from "./text.js";
import { UNITS } from "./units.js";

/** Millilitres in the unit a cook would say out loud. */
export function formatVolume(ml: number): string {
  if (ml >= UNITS.gallon!.toBase * 0.9) return `${formatQuantity(ml / UNITS.gallon!.toBase)} gal`;
  if (ml >= UNITS.quart!.toBase * 0.9) return `${formatQuantity(ml / UNITS.quart!.toBase)} qt`;
  if (ml >= 115) return `${formatQuantity(ml / UNITS.cup!.toBase)} cup`;
  if (ml >= UNITS.tbsp!.toBase * 0.9) return `${formatQuantity(ml / UNITS.tbsp!.toBase)} tbsp`;
  return `${formatQuantity(ml / UNITS.tsp!.toBase)} tsp`;
}

export function formatWeight(g: number): string {
  if (g >= UNITS.lb!.toBase * 0.9) return `${formatQuantity(g / UNITS.lb!.toBase)} lb`;
  if (g >= 25) return `${Math.round(g / UNITS.oz!.toBase)} oz`;
  return `${Math.round(g)} g`;
}

const COUNTABLE: Partial<Record<Dimension, [string, string]>> = {
  clove: ["clove", "cloves"],
  can: ["can", "cans"],
  bunch: ["bunch", "bunches"],
};

export function formatMeasure(amount: number, dimension: Dimension): string {
  if (dimension === "volume") return formatVolume(amount);
  if (dimension === "weight") return formatWeight(amount);
  const words = COUNTABLE[dimension];
  if (words) {
    const rounded = Math.round(amount * 100) / 100;
    return `${formatQuantity(amount)} ${rounded === 1 ? words[0] : words[1]}`;
  }
  return formatQuantity(amount);
}

/** How a recipe wrote it, e.g. `1½ cup` or `3`. */
export function formatAsWritten(amount: number | null, unit: string | null): string {
  const qty = formatQuantity(amount);
  if (!unit || unit === "count") return qty;
  return qty ? `${qty} ${unit}` : unit;
}

export function formatPackages(
  packages: Array<{ size: { label: string }; count: number }>,
): string | null {
  if (!packages.length) return null;
  if (packages.every((p) => p.size.label === "loose")) return null;
  return packages
    .map((p) =>
      p.size.label === "loose"
        ? `${p.count} more`
        : p.count > 1
          ? `${p.count} × ${p.size.label}`
          : p.size.label,
    )
    .join(" + ");
}
