/**
 * Thirty recipes, hand-labelled into components.
 *
 * ---------------------------------------------------------------------------
 * Why one set and not two
 * ---------------------------------------------------------------------------
 *
 * The obvious design was two sets — recipes with declared sections and recipes without — scored
 * separately, to learn what a section is worth. It is not available and it would not answer the
 * question if it were. **The corpus contains exactly one recipe with real ingredient sections**
 * (`instagram-cinnamon-rolls`, with `(dough)`, `(filling)`, `(caramel for baking dish)`), so the
 * "with sections" set would be n=1. And two different sets confound section presence with recipe
 * difficulty: the sectioned recipes are baking, the unsectioned ones are skillet dinners, and any
 * gap measured would be partly the cuisine.
 *
 * So: **one set, two conditions.** The same thirty recipes are inferred twice — once from
 * ingredients alone, once with the true section names supplied — which isolates what sections are
 * worth as an upper bound. If perfect sections do not help much, the inference has to carry it.
 *
 * ---------------------------------------------------------------------------
 * Labelled from ingredients, in order
 * ---------------------------------------------------------------------------
 *
 * Positions are inclusive and every ingredient belongs to exactly one component — a partition,
 * not a tagging. Boundaries were read from three things a recipe gives away: order (a recipe
 * lists what is cooked together, together), **repeated staples** (`sea salt flakes` appears four
 * times in the taco bowl because four things are seasoned separately), and a change of role.
 *
 * **Eleven of the thirty are single-component on purpose.** A one-pan skillet is one thing, and
 * the failure that matters most is inventing structure in a recipe that has none — a blend built
 * on a component that was never a component. A set of only complex recipes would never catch it.
 *
 * Two labels are uncomfortable and left that way rather than forced. `Peach Posset` is a dessert,
 * and none of protein/carbohydrate/sauce/vegetable/garnish describes a posset; it is filed as
 * `sauce` because that is the closest, and the discomfort is the finding. `Jalapeño Lime
 * Marinade` is a whole recipe that is one component — a marinade — which the role list handles
 * only by accident.
 */
export interface LabelledComponent {
  name: string;
  /** inclusive ingredient positions */
  from: number;
  to: number;
  role: "protein" | "carbohydrate" | "sauce" | "vegetable" | "garnish";
}

export interface LabelledRecipe {
  id: string;
  title: string;
  ingredientCount: number;
  components: LabelledComponent[];
}

export const COMPONENT_LABELS: LabelledRecipe[] = [
  { id: "e83f6309-5b84-4f0d-825e-9e08bd0601e6", title: "Loaded Potato Taco Bowl", ingredientCount: 32, components: [{ name: "potatoes", from: 0, to: 5, role: "carbohydrate" }, { name: "spiced beef", from: 6, to: 17, role: "protein" }, { name: "guacamole", from: 18, to: 23, role: "sauce" }, { name: "salsa", from: 24, to: 29, role: "sauce" }, { name: "to serve", from: 30, to: 31, role: "garnish" }] },
  { id: "721228ef-6493-4e0a-b225-b1c6b7123498", title: "Baja Fish Tacos Recipe", ingredientCount: 26, components: [{ name: "seasoned cod", from: 0, to: 7, role: "protein" }, { name: "tortillas", from: 8, to: 9, role: "carbohydrate" }, { name: "slaw", from: 10, to: 16, role: "vegetable" }, { name: "avocado sauce", from: 17, to: 25, role: "sauce" }] },
  { id: "d281fc2e-d613-4c72-8a7f-04c84a85104c", title: "Hawaiian Chicken Poke Bowl", ingredientCount: 23, components: [{ name: "spicy mayo", from: 0, to: 2, role: "sauce" }, { name: "glazed chicken", from: 3, to: 13, role: "protein" }, { name: "rice", from: 14, to: 14, role: "carbohydrate" }, { name: "bowl toppings", from: 15, to: 22, role: "vegetable" }] },
  { id: "68516fdf-3898-4c2c-bb11-765158fba491", title: "Creamy Crockpot White Chicken Chili", ingredientCount: 22, components: [{ name: "the chili", from: 0, to: 13, role: "protein" }, { name: "creamy finish", from: 14, to: 15, role: "sauce" }, { name: "toppings", from: 16, to: 21, role: "garnish" }] },
  { id: "099ecacc-e859-46a4-8030-ebc66b3c1e19", title: "Braised Short Ribs", ingredientCount: 19, components: [{ name: "short ribs", from: 0, to: 12, role: "protein" }, { name: "mash", from: 13, to: 18, role: "carbohydrate" }] },
  { id: "8e4ded1b-0b58-48f3-ac5e-0b3f714de561", title: "Italian Chopped Salad", ingredientCount: 19, components: [{ name: "the salad", from: 0, to: 9, role: "vegetable" }, { name: "dressing", from: 10, to: 18, role: "sauce" }] },
  { id: "e3a7bfa0-1ea3-4fba-aecc-1b9708b4ff53", title: "PAN SEARED CHICKEN W/COCONUT CURRY BROTHY RICE", ingredientCount: 18, components: [{ name: "seared chicken", from: 0, to: 3, role: "protein" }, { name: "coconut curry broth", from: 4, to: 12, role: "sauce" }, { name: "rice", from: 13, to: 13, role: "carbohydrate" }, { name: "garnish", from: 14, to: 17, role: "garnish" }] },
  { id: "4d0f8604-6d75-4686-8d80-a7416c66021a", title: "Bang Bang Chicken Bowl", ingredientCount: 17, components: [{ name: "bang bang sauce", from: 0, to: 3, role: "sauce" }, { name: "chicken", from: 4, to: 9, role: "protein" }, { name: "rice", from: 10, to: 10, role: "carbohydrate" }, { name: "toppings", from: 11, to: 16, role: "vegetable" }] },
  { id: "9fd9c142-1664-4882-99ae-9015fef1ca04", title: "Chicken Pad Thai", ingredientCount: 17, components: [{ name: "chicken and vegetables", from: 0, to: 8, role: "protein" }, { name: "sauce", from: 9, to: 13, role: "sauce" }, { name: "noodles", from: 14, to: 16, role: "carbohydrate" }] },
  { id: "ad141281-0140-43b5-a2a3-4ce76c0d1408", title: "Greek Chicken Bowl", ingredientCount: 16, components: [{ name: "marinade", from: 0, to: 8, role: "sauce" }, { name: "quinoa", from: 9, to: 9, role: "carbohydrate" }, { name: "chicken", from: 10, to: 10, role: "protein" }, { name: "salad", from: 11, to: 15, role: "vegetable" }] },
  { id: "842e68e5-ce5b-48f3-8c31-eefe656bab2a", title: "Jerk Chicken", ingredientCount: 16, components: [{ name: "jerk chicken", from: 0, to: 14, role: "protein" }, { name: "rice", from: 15, to: 15, role: "carbohydrate" }] },
  { id: "eef8dc2b-b6e8-475a-8cfe-c67ac8a98e6b", title: "Crispy Hot Honey Chicken Wrap \ud83e\udd24", ingredientCount: 15, components: [{ name: "cornflake chicken", from: 0, to: 6, role: "protein" }, { name: "chilli mayo", from: 7, to: 8, role: "sauce" }, { name: "hot honey", from: 9, to: 10, role: "sauce" }, { name: "the wrap", from: 11, to: 14, role: "carbohydrate" }] },
  { id: "1d0cfffd-e0da-4ce1-a374-b6c828caed20", title: "Hibachi Steak Bowls", ingredientCount: 14, components: [{ name: "steak", from: 0, to: 7, role: "protein" }, { name: "vegetables", from: 8, to: 11, role: "vegetable" }, { name: "to serve", from: 12, to: 13, role: "carbohydrate" }] },
  { id: "75259bb2-6058-4366-b607-7680d003b93e", title: "Huli Huli Chicken (Tropical Hawaiian chicken)", ingredientCount: 14, components: [{ name: "chicken", from: 0, to: 1, role: "protein" }, { name: "huli huli sauce", from: 2, to: 11, role: "sauce" }, { name: "garnish", from: 12, to: 13, role: "garnish" }] },
  { id: "cf54df82-ac65-4486-9a9d-c1a436d04a53", title: "Creamy Potato & Sausage Soup", ingredientCount: 14, components: [{ name: "the soup", from: 0, to: 13, role: "protein" }] },
  { id: "e17281b9-3554-4498-83ec-4208ca6e6b06", title: "Asian Lettuce Rolls", ingredientCount: 14, components: [{ name: "filling", from: 0, to: 3, role: "protein" }, { name: "dressing", from: 4, to: 8, role: "sauce" }, { name: "to assemble", from: 9, to: 13, role: "vegetable" }] },
  { id: "ea388c87-4a3f-42f5-a597-ffa7498f6008", title: "MARRY ME ITALIAN SAUSAGE SOUP", ingredientCount: 14, components: [{ name: "the soup", from: 0, to: 13, role: "protein" }] },
  { id: "7ca486d6-192b-43b8-a732-0caac8d7795b", title: "Sausage and Rice Skillet", ingredientCount: 14, components: [{ name: "the skillet", from: 0, to: 13, role: "protein" }] },
  { id: "c7a2b0f7-f7ea-4bb2-9bc7-52fa5d31dba6", title: "Creamy Parmesan Italian Sausage Soup", ingredientCount: 14, components: [{ name: "the soup", from: 0, to: 13, role: "protein" }] },
  { id: "c881be14-8758-42e8-836a-cf6762b376f6", title: "Creamy Garlic Shrimp", ingredientCount: 14, components: [{ name: "the pan", from: 0, to: 13, role: "protein" }] },
  { id: "c934b3ea-410c-473f-bff8-3659209f85ac", title: "Grandma Overtons Rolls", ingredientCount: 13, components: [{ name: "dough", from: 0, to: 8, role: "carbohydrate" }, { name: "cinnamon filling", from: 9, to: 11, role: "sauce" }, { name: "frosting", from: 12, to: 12, role: "sauce" }] },
  { id: "7122acf8-c53b-4e52-9dd1-6ad17c896972", title: "Chicken & Wild Rice Salad", ingredientCount: 13, components: [{ name: "dressing", from: 0, to: 4, role: "sauce" }, { name: "the salad", from: 5, to: 9, role: "protein" }, { name: "to serve", from: 10, to: 12, role: "garnish" }] },
  { id: "ecb35a4f-386f-4b6b-8b1e-b4289c264cb0", title: "Peach Posset", ingredientCount: 7, components: [{ name: "posset", from: 0, to: 4, role: "sauce" }, { name: "to serve", from: 5, to: 6, role: "garnish" }] },
  { id: "fc3c3f01-56d7-48e5-a4ab-80870c5451f8", title: "Jalape\u00f1o Lime Marinade", ingredientCount: 7, components: [{ name: "marinade", from: 0, to: 6, role: "sauce" }] },
  { id: "a3e80430-a8e6-4edd-929d-d28cc58e2098", title: "Easy Fried Rice", ingredientCount: 7, components: [{ name: "fried rice", from: 0, to: 6, role: "carbohydrate" }] },
  { id: "34e4f5b4-ef08-488b-ba20-5f5df9fe47bb", title: "Chicken traybake", ingredientCount: 6, components: [{ name: "traybake", from: 0, to: 5, role: "protein" }] },
  { id: "8087ac51-294c-499e-b328-72c720234c0e", title: "Creamy mushroom pasta", ingredientCount: 6, components: [{ name: "mushroom sauce", from: 0, to: 1, role: "sauce" }, { name: "pasta", from: 2, to: 5, role: "carbohydrate" }] },
  { id: "f1a025f7-99bb-4eb9-a458-34d6d154e085", title: "Weeknight dal", ingredientCount: 6, components: [{ name: "dal", from: 0, to: 5, role: "protein" }] },
  { id: "ce44387c-33f8-4a37-a0af-5c8e9315e8d6", title: "Easy Homemade Pizza Dough", ingredientCount: 6, components: [{ name: "dough", from: 0, to: 5, role: "carbohydrate" }] },
  { id: "99c35758-4593-4b1d-b757-57315e792751", title: "Lemon-Pepper Marinade", ingredientCount: 6, components: [{ name: "marinade", from: 0, to: 5, role: "sauce" }] },];

/** the positions a component covers */
const spread = (c: { from: number; to: number }) => {
  const out = new Set<number>();
  for (let i = c.from; i <= c.to; i += 1) out.add(i);
  return out;
};

const overlap = (a: Set<number>, b: Set<number>) => {
  let shared = 0;
  for (const n of a) if (b.has(n)) shared += 1;
  return shared / Math.max(a.size, b.size);
};

/**
 * How well a proposal matches the labels — three outcomes, never two (§54a).
 *
 * `declined` is the model returning nothing, and it is scored apart from `wrong` because the two
 * move the prompt in opposite directions: a decline needs less caution, a wrong answer needs
 * more. Averaging them moves it one way while the other gets worse and nothing shows it.
 *
 * A component matches when it shares at least `AGREEMENT` of its positions with a labelled one.
 * Exact set equality would be brittle — one ingredient placed either side of a boundary is not a
 * different reading of the recipe — and anything much looser stops meaning "the same component".
 */
export const AGREEMENT = 0.7;

export type ComponentVerdict = "right" | "wrong" | "declined";

export interface ComponentScore {
  verdict: ComponentVerdict;
  /** did it propose the right number of components at all */
  countExpected: number;
  countProposed: number;
  /** of the labelled components, how many were found within AGREEMENT */
  matched: number;
  /** of those matched, how many carried the right role */
  rolesRight: number;
}

export function scoreComponents(
  labelled: readonly LabelledComponent[],
  proposed: readonly { from: number; to: number; role?: string | null }[] | null,
): ComponentScore {
  if (proposed === null) {
    return { verdict: "declined", countExpected: labelled.length, countProposed: 0, matched: 0, rolesRight: 0 };
  }

  const taken = new Set<number>();
  let matched = 0;
  let rolesRight = 0;

  for (const truth of labelled) {
    const want = spread(truth);
    let best = -1;
    let bestScore = 0;
    proposed.forEach((candidate, index) => {
      if (taken.has(index)) return;
      const score = overlap(want, spread(candidate));
      if (score > bestScore) {
        bestScore = score;
        best = index;
      }
    });
    if (best >= 0 && bestScore >= AGREEMENT) {
      taken.add(best);
      matched += 1;
      if (proposed[best]!.role === truth.role) rolesRight += 1;
    }
  }

  // right means the whole partition is right: every component found, and none invented
  const verdict: ComponentVerdict =
    matched === labelled.length && proposed.length === labelled.length ? "right" : "wrong";

  return { verdict, countExpected: labelled.length, countProposed: proposed.length, matched, rolesRight };
}
