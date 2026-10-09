/**
 * Resolving what a household wants: stated beats inferred, and nothing blends (§71).
 *
 * ---------------------------------------------------------------------------
 * Four steps, in order, with no arithmetic between them
 * ---------------------------------------------------------------------------
 *
 *   excluded by an allergy  →  stated dislike  →  stated like  →  inferred
 *
 * A stated dislike overrides an inferred like, because an inference nobody can correct goes wrong
 * permanently — the reason the classification fields are editable. And the steps do not combine:
 * there is no sum in which a strong inferred like outweighs somebody saying no.
 *
 * ---------------------------------------------------------------------------
 * Why a count and not a score
 * ---------------------------------------------------------------------------
 *
 * The one number this produces is **how many members a recipe satisfies**. "3 of 4" is checkable
 * by looking at four people; a weighted score is not, and §67 measured that a single rank mixing a
 * certainty, a guess and a thin statistic yields a number nobody can read, while §61 measured that
 * no confidence signal exists to build one on.
 *
 * So `satisfies` is a count of people and `reasons` names them. A caller that wants an order uses
 * the count; a caller that wants to explain itself uses the names. Neither needs a weight, and
 * `member_preferences` has a database invariant refusing one.
 *
 * ---------------------------------------------------------------------------
 * Silence is an answer, and a different one from agreement
 * ---------------------------------------------------------------------------
 *
 * `nobodyHasSaid` is reported separately from `noObjection`. A household that has stated nothing
 * looks identical to one that has approved everything unless the distinction is carried, and the
 * screen has to say which — "nobody has said" invites stating something, "nobody objects" does
 * not.
 */
import type { Allergen, AllergenVerdict } from "./allergens.js";

export type Stance = "like" | "dislike";
export type SubjectKind = "ingredient" | "cuisine" | "dish_form" | "course";

export interface StatedPreference {
  memberId: string;
  stance: Stance;
  subjectKind: SubjectKind;
  /** the catalog key for an ingredient, or the classification value */
  subject: string;
}

/** what the ratings already imply, from `readTastes` — never mixed with the above */
export interface InferredPreference {
  memberId: string;
  subjectKind: SubjectKind;
  subject: string;
  stance: Stance;
}

export interface RecipeSubjects {
  /** catalog keys, or written names where nothing resolved */
  ingredients: readonly string[];
  cuisine?: string | null;
  dishForm?: string | null;
  course?: string | null;
}

/** one member's reading of one recipe — an observation with its reason, never a number */
export interface MemberReading {
  memberId: string;
  outcome: "excluded" | "disliked" | "liked" | "inferred-dislike" | "inferred-like" | "nothing-said";
  /** the subject that decided it, so a screen can say *why* rather than asserting a verdict */
  because: string | null;
  /** set only for `excluded`: which allergen, and how certain the reading was */
  allergen?: { allergen: Allergen; verdict: AllergenVerdict };
}

const subjectsOf = (recipe: RecipeSubjects): Array<{ kind: SubjectKind; value: string }> => [
  ...recipe.ingredients.map((value) => ({ kind: "ingredient" as const, value })),
  ...(recipe.cuisine ? [{ kind: "cuisine" as const, value: recipe.cuisine }] : []),
  ...(recipe.dishForm ? [{ kind: "dish_form" as const, value: recipe.dishForm }] : []),
  ...(recipe.course ? [{ kind: "course" as const, value: recipe.course }] : []),
];

const match = (
  preferences: readonly { subjectKind: SubjectKind; subject: string; stance: Stance }[],
  recipe: RecipeSubjects,
  stance: Stance,
): string | null => {
  const subjects = subjectsOf(recipe);
  for (const preference of preferences) {
    if (preference.stance !== stance) continue;
    const hit = subjects.find(
      (subject) =>
        subject.kind === preference.subjectKind &&
        subject.value.toLowerCase() === preference.subject.toLowerCase(),
    );
    if (hit) return hit.value;
  }
  return null;
};

/**
 * One member against one recipe.
 *
 * `excluded` is passed in rather than computed: the allergen reading needs the written ingredient
 * lines and this works on resolved subjects, and more to the point an allergy is a **hard**
 * exclusion whose evaluation must not be reachable through the same code path that handles
 * preferences — a bug in preference matching must not be able to turn an exclusion into a weight.
 */
export function readForMember(
  memberId: string,
  recipe: RecipeSubjects,
  stated: readonly StatedPreference[],
  inferred: readonly InferredPreference[],
  excluded?: { allergen: Allergen; verdict: AllergenVerdict },
): MemberReading {
  if (excluded) {
    return { memberId, outcome: "excluded", because: excluded.allergen, allergen: excluded };
  }

  const mine = stated.filter((preference) => preference.memberId === memberId);
  const dislikes = match(mine, recipe, "dislike");
  if (dislikes) return { memberId, outcome: "disliked", because: dislikes };
  const likes = match(mine, recipe, "like");
  if (likes) return { memberId, outcome: "liked", because: likes };

  // only now, and never added to anything above
  const theirs = inferred.filter((preference) => preference.memberId === memberId);
  const inferredDislike = match(theirs, recipe, "dislike");
  if (inferredDislike) return { memberId, outcome: "inferred-dislike", because: inferredDislike };
  const inferredLike = match(theirs, recipe, "like");
  if (inferredLike) return { memberId, outcome: "inferred-like", because: inferredLike };

  return { memberId, outcome: "nothing-said", because: null };
}

export interface HouseholdReading {
  readings: MemberReading[];
  /** the only number here: how many members this suits, which a person can check by looking */
  satisfies: number;
  /** anybody for whom this is excluded outright — not a demotion */
  excludedFor: string[];
  /** stated objections, which outrank every inference */
  dislikedBy: string[];
  /** nobody has stated or rated anything about this recipe. NOT the same as nobody objecting. */
  nobodyHasSaid: boolean;
}

/**
 * A whole household against one recipe.
 *
 * `satisfies` counts stated likes **and** inferred likes, because both are a reason to cook
 * something — but the readings keep them apart so a screen can say which, and a household with no
 * stated preferences gets a count built entirely from inference *and is told so*.
 *
 * An exclusion is never counted as a dissatisfaction. It removes the recipe, and a count of people
 * it suits is not the right instrument for saying so (§71): the caller drops anything with a
 * non-empty `excludedFor` and states the count it hid.
 */
export function readForHousehold(
  memberIds: readonly string[],
  recipe: RecipeSubjects,
  stated: readonly StatedPreference[],
  inferred: readonly InferredPreference[],
  excluded: ReadonlyMap<string, { allergen: Allergen; verdict: AllergenVerdict }> = new Map(),
): HouseholdReading {
  const readings = memberIds.map((memberId) =>
    readForMember(memberId, recipe, stated, inferred, excluded.get(memberId)),
  );
  return {
    readings,
    satisfies: readings.filter(
      (reading) => reading.outcome === "liked" || reading.outcome === "inferred-like",
    ).length,
    excludedFor: readings.filter((r) => r.outcome === "excluded").map((r) => r.memberId),
    dislikedBy: readings.filter((r) => r.outcome === "disliked").map((r) => r.memberId),
    nobodyHasSaid: readings.every((reading) => reading.outcome === "nothing-said"),
  };
}
