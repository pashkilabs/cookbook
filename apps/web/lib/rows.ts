/**
 * A Supabase result, or an exception. Never a silent empty.
 *
 * ---------------------------------------------------------------------------
 * Why a helper rather than a rule
 * ---------------------------------------------------------------------------
 *
 * `const { data } = await supabase.from(…)` discards `error`, and `data ?? []` then turns a
 * failed query into an empty list. Three silent failures came from that shape in a fortnight:
 *
 *   - the browse screen queried columns that did not exist on the deployed database and rendered
 *     "Nothing here yet" — a broken page wearing an empty one's clothes;
 *   - classification selected `raw_text`, which is `item_text`, so every recipe in the corpus was
 *     classified from its title alone with no ingredients;
 *   - a recipe list rendered empty rather than reporting why.
 *
 * Each was written by someone who knew the rule. "Always check `error`" has now failed three
 * times against people who agreed with it, so the fix is not a fourth reminder — it is making the
 * unchecked version harder to write than the checked one.
 *
 * ---------------------------------------------------------------------------
 * What it does not cover
 * ---------------------------------------------------------------------------
 *
 * `auth.getUser()` keeps its bare destructure. A null user there is not a failure — it is the
 * answer, and every call site already redirects on it. Wrapping it would add noise around a
 * case that is genuinely handled, and a helper applied where it is not needed is how helpers
 * come to be ignored where they are.
 */
/*
 * `data: T` rather than `data: T | null`.
 *
 * A Supabase response is a *union* of a success shape and a failure shape, so inferring T from
 * `T | null` leaves TypeScript solving against both members and it settles on `never`. Taking the
 * data type whole and letting the caller keep its nullability is the version that infers.
 */
type Result<T> = { data: T; error: { message: string } | null };

export function rows<T>(result: Result<T[] | null>, what: string): T[] {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data ?? [];
}

/**
 * The same, for a query expected to return one row or none.
 *
 * `null` is a real answer here — "no such recipe" — so it is returned rather than thrown. The
 * distinction the helper preserves is **absent versus broken**, which is the whole point:
 * `maybeSingle()` returns null for both, and only one of them is news.
 */
export function maybeRow<T>(result: Result<T>, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}
