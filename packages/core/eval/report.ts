import type { EvalReport, FixtureOutcome, Tally } from "./runner.js";
import type { EvalIngredient } from "./types.js";
import { MISSING } from "./score.js";
import { formatAsWritten } from "../src/format.js";
import { formatQuantity } from "../src/text.js";

/**
 * Render a report as plain text. No colour and no timing, so two runs of the
 * same fixtures produce identical output and a diff between them is meaningful.
 *
 * The failure section is the point of the whole harness. A percentage tells you
 * a model got worse; the diffs tell you what to do about it.
 */
export function formatReport(report: EvalReport): string {
  const out: string[] = [];

  out.push(`eval — ${report.label}`);
  out.push(
    [
      `${report.fixtures} ${plural(report.fixtures, "fixture")}`,
      `${report.scored} scored`,
      `${report.skipped} skipped`,
      `${report.errored} errored`,
    ].join(" · "),
  );

  if (report.placeholders > 0) {
    out.push("");
    out.push(
      report.placeholders === report.fixtures
        ? `!! every fixture is a placeholder. These numbers demonstrate the harness;\n   they measure nothing. Real fixtures go in eval/fixtures/.`
        : `!! ${report.placeholders} of ${report.fixtures} fixtures are placeholders, so the totals are diluted.`,
    );
  }

  out.push("");
  out.push(
    ...accuracyTable([
      ["title", report.byField.title],
      ["servings", report.byField.servings],
      ["time", report.byField.totalMinutes],
      ["amount", report.byField.amount],
      ["unit", report.byField.unit],
      ["item", report.byField.item],
      ["overall", report.overall],
    ]),
  );

  const { expected, found, spurious } = report.ingredients;
  out.push("");
  out.push(
    `ingredients  ${expected} expected · ${found} found · ${spurious} spurious` +
      `   (recall ${percent({ correct: found, total: expected })}, ` +
      `precision ${percent({ correct: found, total: found + spurious })})`,
  );
  out.push(`cost         ${formatCost(report.cost)}`);

  const skipped = report.outcomes.filter((o) => o.status === "skipped");
  if (skipped.length > 0) {
    out.push("");
    out.push("skipped — the extractor does not handle these inputs");
    for (const outcome of skipped) {
      out.push(`  ${outcome.fixture.id} (${outcome.fixture.input.kind})`);
    }
  }

  const failures = report.outcomes.filter(
    (o) => o.status === "errored" || (o.score && o.score.correct < o.score.total),
  );
  out.push("");
  if (failures.length === 0) {
    out.push(`no failures across ${report.scored} scored ${plural(report.scored, "fixture")}`);
  } else {
    out.push(`failures — ${failures.length} of ${report.scored} scored`);
    for (const outcome of failures) {
      out.push("─".repeat(64));
      out.push(...formatFailure(outcome));
    }
  }

  out.push("");
  out.push(
    "overall counts every check once: three recipe fields per fixture, three\n" +
      "per expected ingredient, and one per spurious line. A missing ingredient\n" +
      "fails all three of its checks. Skipped fixtures are excluded entirely.\n" +
      `${MISSING} means the extractor never mentioned the field; "none" means it\n` +
      "said there is none. Those are different answers and score differently.",
  );

  return out.join("\n");
}

/**
 * One line of a diff. `expected` is absent for a line that only exists on one
 * side — an ingredient nobody found, or one nobody asked for — where an
 * "expected — got x" framing would be noise around the only real information.
 */
interface DiffRow {
  label: string;
  expected?: string;
  actual: string;
}

function formatFailure(outcome: FixtureOutcome): string[] {
  const { fixture, score } = outcome;
  const lines: string[] = [];
  const header = `${fixture.id} (${fixture.input.kind})`;
  lines.push(score ? `${header}   ${score.correct}/${score.total} checks` : header);
  if (fixture.source) lines.push(`  source: ${fixture.source}`);
  if (outcome.status === "errored") lines.push(`  ERROR: ${outcome.error ?? "unknown"}`);
  if (!score) return lines;

  const rows: DiffRow[] = [];
  for (const field of score.fields) {
    if (field.correct) continue;
    rows.push({
      label: labelFor(field.field),
      expected: quoteIfText(field.field, field.expected),
      actual: quoteIfText(field.field, field.actual),
    });
  }
  const missing: DiffRow[] = [];
  for (const result of score.ingredients) {
    if (!result.actual) {
      missing.push({ label: "missing", actual: describe(result.expected) });
      continue;
    }
    if (result.amountCorrect && result.unitCorrect && result.itemCorrect) continue;
    const wrong = [
      !result.itemCorrect ? "item" : null,
      !result.amountCorrect ? "amount" : null,
      !result.unitCorrect ? "unit" : null,
    ].filter((x): x is string => x !== null);
    rows.push({
      label: wrong.join("+"),
      expected: describe(result.expected),
      actual: describe(result.actual),
    });
  }
  rows.push(...missing);
  for (const extra of score.spurious) {
    rows.push({ label: "spurious", actual: describe(extra) });
  }

  const labelWidth = rows.reduce((max, row) => Math.max(max, row.label.length), 0);
  const expectedWidth = rows.reduce(
    (max, row) => Math.max(max, row.expected?.length ?? 0),
    0,
  );
  for (const row of rows) {
    lines.push(
      row.expected === undefined
        ? `  ${pad(row.label, labelWidth)}  ${row.actual}`
        : `  ${pad(row.label, labelWidth)}  expected ${pad(row.expected, expectedWidth)}  got ${row.actual}`,
    );
  }
  return lines;
}

/**
 * `1½ cup (1.5) "heavy cream"` — the amount, unit and item as one phrase. The
 * exact value follows the cook-readable one wherever they differ, because ⅓ and
 * 0.3 render identically as glyphs but are not the same answer.
 */
function describe(ingredient: EvalIngredient): string {
  const written = formatAsWritten(ingredient.amount, ingredient.unit) || MISSING;
  const exact = ingredient.amount == null ? "" : trimFloat(ingredient.amount);
  const suffix = exact && exact !== formatQuantity(ingredient.amount) ? ` (${exact})` : "";
  return `${written}${suffix} "${ingredient.item}"`;
}

/** Four decimals is past any tolerance that matters and short enough to read. */
function trimFloat(value: number): string {
  return String(Math.round(value * 10000) / 10000);
}

function labelFor(field: "title" | "servings" | "totalMinutes"): string {
  return field === "totalMinutes" ? "time" : field;
}

function quoteIfText(field: string, value: string): string {
  return field === "title" && value !== MISSING ? `"${value}"` : value;
}

/** Numbers right-aligned, so the column can be read down rather than across. */
function accuracyTable(rows: Array<[string, Tally]>): string[] {
  const labelWidth = rows.reduce((max, [label]) => Math.max(max, label.length), 0);
  const counts = rows.map(([, value]) => `${value.correct}/${value.total}`);
  const countWidth = counts.reduce((max, count) => Math.max(max, count.length), 0);
  const percents = rows.map(([, value]) => percent(value));
  const percentWidth = percents.reduce((max, value) => Math.max(max, value.length), 0);

  return rows.map(([label], index) => {
    const count = padStart(counts[index] ?? "", countWidth);
    const share = padStart(percents[index] ?? "", percentWidth);
    return `${pad(label, labelWidth)}  ${count}  ${share}`;
  });
}

export function percent(value: Tally): string {
  if (value.total === 0) return MISSING;
  return `${((value.correct / value.total) * 100).toFixed(1)}%`;
}

function formatCost(cost: EvalReport["cost"]): string {
  if (!cost.reported) return "not reported (no extractor declared usage)";
  const parts = [`$${cost.usd.toFixed(4)}`];
  if (cost.inputTokens || cost.outputTokens) {
    parts.push(`${cost.inputTokens} in / ${cost.outputTokens} out tokens`);
  }
  if (cost.models.length) parts.push(cost.models.join(", "));
  return parts.join(" · ");
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function padStart(value: string, width: number): string {
  return value.length >= width ? value : " ".repeat(width - value.length) + value;
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}
