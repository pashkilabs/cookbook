/**
 * The prompts, fingerprinted — so changing one expires the answers it produced.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists
 * ---------------------------------------------------------------------------
 *
 * `promptKey` fingerprinted a recipe's title, lines and declared sections: every input the
 * *recipe* carries. It did not fingerprint the prompt, which is also an input — so changing the
 * component instructions left every key byte-identical and every stored partition was served
 * forever by a prompt that no longer existed.
 *
 * That shipped. Asking the component inference for a NAME instead of a category moved role-named
 * parts from 8 of 9 to 0 of 10 **in the eval**, and reached no household: the six stored
 * partitions in production were still named `protein`, `garnish`, `carbohydrate` — the exact
 * words the change removed. A report of "splitting extracts the protein and ignores the sauce"
 * was a report about a prompt that had been fixed a week earlier.
 *
 * ---------------------------------------------------------------------------
 * Derived, not stamped — which is what `promptKey` was already trying to be
 * ---------------------------------------------------------------------------
 *
 * `promptKey`'s own comment explains the hazard and then walks into it: *"Derived from the input
 * rather than bumped by hand, because a stamp only works if something turns it — and nobody
 * turned EXTRACTOR_VERSION for two releases."* Right about hand-stamps, wrong about which inputs
 * exist. The correction is not to add an integer somebody has to remember; it is to notice that
 * the prompt is text, and text can be fingerprinted like any other input.
 *
 * So there is nothing to turn. Edit an instruction, the digest moves, every key built from it
 * moves, and the next view recomputes. `EXTRACTOR_VERSION` governs the *import* cache and is
 * still hand-turned because its input is a code path rather than a string; nothing governed
 * these two caches at all.
 *
 * **One limit, stated rather than discovered later.** `fingerprint` lowercases, so a change that
 * only alters capitalisation does not move the digest. That is shared with every other use of
 * `fingerprint` and is not worth a second hash implementation — but a prompt edit whose whole
 * effect is emphasis (`NAME each component` → `name each component`) will not invalidate. Add a
 * word if it matters.
 */
import { fingerprint } from "@pashki/core";
import { COMPONENTS_INSTRUCTIONS, COMPONENTS_JSON_SCHEMA } from "./components.js";
import { PALATE_INSTRUCTIONS, PALATE_JSON_SCHEMA } from "./palate.js";

/*
 * The schema travels with the instructions because it is half the prompt.
 *
 * §54 and the trap above it: a schema field is not a request, and an *example* in a field's
 * description is a silent default — the component name example was itself the bug once. A change
 * to a description is a change to the prompt, so hashing the instructions alone would have
 * missed the edit that mattered most.
 */
const digest = (instructions: string, schema: unknown): string =>
  fingerprint([instructions, JSON.stringify(schema)]);

export const COMPONENTS_PROMPT_FINGERPRINT = digest(
  COMPONENTS_INSTRUCTIONS,
  COMPONENTS_JSON_SCHEMA,
);

export const PALATE_PROMPT_FINGERPRINT = digest(PALATE_INSTRUCTIONS, PALATE_JSON_SCHEMA);
