import { readFileSync } from "node:fs";
import { cascadeFromEnv } from "../src/openai-compatible.js";
import { classifyRecipe } from "../src/classify.js";
import { CLASSIFY_PROMPT_FINGERPRINT } from "../src/prompt-version.js";

/**
 * Both directions of the rare-protein question, on a set where each has a known answer.
 *
 * ---------------------------------------------------------------------------
 * Why a known-zero measurement needed a companion
 * ---------------------------------------------------------------------------
 *
 * The real library has venison 0, goat 0, veal 0 and duck 0, so any use of those labels there is a
 * false positive **by definition** — no adjudication, no judgement. That is a genuinely strong
 * measurement and it can only fail in one direction. A naming bar that suppressed those labels
 * entirely, for every recipe including one that names the animal outright, would score exactly as
 * well as a bar that works, and the number would read as a pass.
 *
 * So the count on the 76 detects **over-assertion** and nothing detects **over-suppression**.
 * This is the other half: recipes that name the animal, where the right answer is that label.
 *
 * ---------------------------------------------------------------------------
 * Why these are not the screenshot fixture's four
 * ---------------------------------------------------------------------------
 *
 * The brief said to classify the four recipes added to `shot.mjs`, and that fixture cannot carry
 * the test. **Every recipe it creates has the same body** — `2 cups flour / 1 pint double cream /
 * spinach`, steps `Mix. Bake.` — because its ingredient list exists to put an amount-less line on
 * screen, and its protein is *written* by a PATCH rather than inferred. "Five-spice Duck Legs" is
 * flour and cream with `duck` stamped on the row.
 *
 * Asking a model about that would most likely still return `duck`, from the title alone, and the
 * control would have **passed while measuring something other than its claim** — title inference
 * rather than the naming condition. The bar's condition is "the recipe names that animal", so the
 * control's recipes name it the way a real one does: in the title and in the ingredient lines.
 *
 * The two fixtures stay separate on purpose. One exists to render a tile, the other to ask a
 * question, and a single list serving both would have to compromise one of them.
 *
 * ---------------------------------------------------------------------------
 * The decoys
 * ---------------------------------------------------------------------------
 *
 * The bar is one sentence with two clauses: name it only when the recipe names it, and do not
 * infer it from a cooking method, a cuisine or a rich or gamey description. The 76 test the second
 * clause only against the braises that happen to be in them, which are mild. So two recipes here
 * are written to be as tempting as the clause describes — a dark gamey wine braise and a
 * long-cooked curry — while naming beef and lamb respectively. Their right answer is what they
 * name, and a bar that reads "rich" as "venison" fails on them.
 */
const arg = (name: string): string | null =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? null;

const runs = Number(arg("runs") ?? "3");
const widePath = arg("wide");

interface Subject {
  title: string;
  ingredients: string[];
  steps: string[];
  expect: string;
  kind: "names the animal" | "decoy";
}

const SUBJECTS: Subject[] = [
  {
    title: "Five-spice Duck Legs",
    ingredients: ["4 duck legs", "2 tsp five-spice powder", "3 star anise", "2 tbsp soy sauce", "1 tbsp honey"],
    steps: ["Score the duck skin and rub with five-spice.", "Roast skin-side up for two hours until the fat renders."],
    expect: "duck",
    kind: "names the animal",
  },
  {
    title: "Veal Milanese",
    ingredients: ["4 veal cutlets, bone in", "2 eggs", "150 g breadcrumbs", "100 g butter", "1 lemon"],
    steps: ["Beat the veal thin between two sheets of paper.", "Crumb and fry in foaming butter."],
    expect: "veal",
    kind: "names the animal",
  },
  {
    title: "Venison Stew with Juniper",
    ingredients: ["1 kg venison shoulder, diced", "12 juniper berries", "2 carrots", "300 ml red wine", "2 bay leaves"],
    steps: ["Brown the venison in batches.", "Add the wine and juniper and cook low for three hours."],
    expect: "venison",
    kind: "names the animal",
  },
  {
    title: "Slow-cooked Goat Curry",
    ingredients: ["1.2 kg goat shoulder on the bone", "3 tbsp curry powder", "2 onions", "400 ml coconut milk", "4 garlic cloves"],
    steps: ["Marinate the goat overnight in the spices.", "Simmer for three hours until it falls from the bone."],
    expect: "goat",
    kind: "names the animal",
  },
  {
    title: "Dark Braised Short Ribs in Red Wine",
    ingredients: ["2 kg beef short ribs", "750 ml red wine", "12 juniper berries", "2 tbsp redcurrant jelly", "4 thyme sprigs"],
    steps: ["Brown the ribs hard until deeply coloured.", "Braise in the wine with juniper for four hours until gamey and rich."],
    expect: "beef",
    kind: "decoy",
  },
  {
    title: "Seven-hour Shoulder with Juniper and Gin",
    ingredients: ["1 lamb shoulder, bone in", "10 juniper berries", "50 ml gin", "6 garlic cloves", "2 rosemary sprigs"],
    steps: ["Stud the shoulder with garlic and rosemary.", "Cook at 140C for seven hours until the meat is dark and falling apart."],
    expect: "lamb",
    kind: "decoy",
  },
];

const cascade = cascadeFromEnv();
if (!cascade) {
  console.error("COULD NOT MEASURE: no inference cascade — check PASHKI_LLM_* in apps/web/.env.local");
  process.exit(3);
}

console.log(`${SUBJECTS.length} recipes, ${runs} run${runs === 1 ? "" : "s"}, prompt ${CLASSIFY_PROMPT_FINGERPRINT}, model ${cascade.models[0]!.model}`);
console.log("nothing is written: this asks the shipping classifier and scores the answer\n");

const answers = new Map<string, (string | null)[]>(SUBJECTS.map((s) => [s.title, []]));
let lost = 0;
for (let run = 0; run < runs; run += 1) {
  for (const subject of SUBJECTS) {
    // three attempts, because a skip infrastructure timing could have caused gets retried before
    // it is believed — and a lost reading here is a hole in a six-recipe denominator
    let read = null;
    for (let attempt = 0; attempt < 3 && !read; attempt += 1) {
      read = await classifyRecipe({
        provider: cascade.provider,
        model: cascade.models[0]!,
        recipe: { title: subject.title, ingredients: subject.ingredients, steps: subject.steps },
      });
    }
    if (!read) {
      lost += 1;
      answers.get(subject.title)!.push("READING FAILED" as string);
      process.stdout.write("!");
      continue;
    }
    answers.get(subject.title)!.push(read.classification.principalProtein);
    process.stdout.write(".");
  }
  console.log("");
}

if (lost) {
  console.log(`\nCOULD NOT MEASURE: ${lost} reading(s) never came back after three attempts`);
  process.exit(2);
}

const verdicts = SUBJECTS.map((subject) => {
  const got = answers.get(subject.title)!;
  const right = got.filter((g) => g === subject.expect).length;
  return { subject, got, right, all: right === runs };
});

console.log("\n=== over-suppression: does the permission half fire? ===");
for (const v of verdicts.filter((v) => v.subject.kind === "names the animal")) {
  console.log(
    `  ${v.all ? "ok  " : "FAIL"}  ${v.subject.title.padEnd(34)} want ${v.subject.expect.padEnd(8)} got ${v.got.map((g) => String(g)).join(" / ")}`,
  );
}
console.log("\n=== over-assertion: do the decoys stay what they name? ===");
for (const v of verdicts.filter((v) => v.subject.kind === "decoy")) {
  console.log(
    `  ${v.all ? "ok  " : "FAIL"}  ${v.subject.title.padEnd(34)} want ${v.subject.expect.padEnd(8)} got ${v.got.map((g) => String(g)).join(" / ")}`,
  );
}

const named = verdicts.filter((v) => v.subject.kind === "names the animal");
const decoys = verdicts.filter((v) => v.subject.kind === "decoy");
const namedOk = named.filter((v) => v.all).length;
const decoysOk = decoys.filter((v) => v.all).length;

/*
 * The two counts are printed together because neither means much alone — a zero on the library
 * with a zero here is a bar that has silenced the label, and that reads as a pass on the count
 * everybody looks at.
 */
console.log("\n=== both directions ===");
console.log(`  recipes naming the animal, right in all ${runs} runs:  ${namedOk}/${named.length}   (expected ${named.length})`);
console.log(`  decoys that stayed what they name, all ${runs} runs:   ${decoysOk}/${decoys.length}   (expected ${decoys.length})`);

const RARE = new Set(["venison", "goat", "veal", "duck"]);
if (widePath) {
  const wide = JSON.parse(readFileSync(widePath, "utf8")) as {
    label: string;
    prompt: string;
    runs: { title: string; got: string | null }[][];
  };
  const uses = wide.runs.flat().filter((r) => r.got && RARE.has(r.got));
  console.log(
    `  rare-protein uses across the real library (${wide.label}, prompt ${wide.prompt}): ` +
      `${uses.length}   (expected 0)`,
  );
  for (const u of uses) console.log(`      ${u.got} on ${u.title}`);
  if (wide.prompt !== CLASSIFY_PROMPT_FINGERPRINT) {
    console.log(
      `  NOTE: that run used prompt ${wide.prompt} and this one ${CLASSIFY_PROMPT_FINGERPRINT} — ` +
        `different prompts, so the two counts describe different systems`,
    );
  }
} else {
  console.log("  rare-protein uses across the real library: NOT MEASURED HERE — pass --wide=<measure-classification output>");
}

process.exit(namedOk === named.length && decoysOk === decoys.length ? 0 : 1);
