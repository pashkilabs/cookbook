/**
 * What the household actually likes — as counts of people, and nothing else.
 *
 * ---------------------------------------------------------------------------
 * Why there is no score in here
 * ---------------------------------------------------------------------------
 *
 * §71's rule is that the only figure on this screen is **a number of people a person could
 * verify by looking round the table**. §61 and §75 each measured, separately, that this app has
 * no confidence signal to offer — so a rank, a percentage or a star average would be a precision
 * it cannot support, and the average is the actively harmful one: **3.8 out of 5 hides that
 * Hazel will not eat it**, which is the only fact that changes what gets cooked at 5pm.
 *
 * So every field below is a count or a name. There is deliberately no `score`, no `average` and
 * no single ordering number — `rank` is the array index and nothing more.
 *
 * ---------------------------------------------------------------------------
 * Untried is not disliked, and the library is mostly untried
 * ---------------------------------------------------------------------------
 *
 * Measured on the real household: **46 ratings across 10 recipes of 66**. So 56 recipes have no
 * opinion attached at all, and a leaderboard that read silence as dislike would be wrong about
 * 85% of the library. Unrated recipes are therefore **absent** rather than ranked last: a row
 * saying "5 haven't tried it" and nothing else is noise, and fifty-six of them is a wall.
 *
 * The honest wording of a low rating took a correction from the data. The spec said a member who
 * rated below 4 is shown as *"<Name> said no"* — but the lowest score anybody in this household
 * has ever given is a **3** (the spread is 11 threes, 16 fours, 19 fives), and calling a 3 "said
 * no" overstates it into a refusal nobody made. This reports **what was rated**, the way the
 * planner's warnings do — "Ada has rated 8 fish dishes low" rather than "Ada does not like fish"
 * — because an observation a person can weigh beats a verdict they can only accept or ignore.
 */

export interface Rating {
  recipeId: string;
  memberId: string;
  score: number;
}

export interface LeaderboardRecipe {
  id: string;
  title: string;
  timesMade: number;
}

export interface LeaderboardRow {
  id: string;
  title: string;
  /** members who rated it 4 or more */
  liked: number;
  /** members who rated it at all — the denominator, so "3 of 5" is checkable */
  rated: number;
  /** members in the household with no rating for it */
  untried: number;
  /** named, with the score they gave, for anybody below 4 */
  lukewarm: Array<{ name: string; score: number }>;
  /** only shown above zero; a recipe made no times says so by omission */
  timesMade: number;
}

/** 4 of 5 is "liked"; below that is an observation rather than an endorsement */
export const LIKED_FROM = 4;

export function leaderboard(
  recipes: readonly LeaderboardRecipe[],
  ratings: readonly Rating[],
  members: ReadonlyArray<{ id: string; displayName: string }>,
): LeaderboardRow[] {
  const nameFor = new Map(members.map((member) => [member.id, member.displayName]));
  const byRecipe = new Map<string, Rating[]>();
  for (const rating of ratings) {
    /*
     * A rating from somebody no longer in the household counts for nothing. It is not deleted —
     * ratings outlive a member leaving — but it cannot be *named*, and an unnamed "somebody rated
     * it 3" is the unverifiable figure this whole file exists to avoid.
     */
    if (!nameFor.has(rating.memberId)) continue;
    byRecipe.set(rating.recipeId, [...(byRecipe.get(rating.recipeId) ?? []), rating]);
  }

  const rows: LeaderboardRow[] = [];
  for (const recipe of recipes) {
    const mine = byRecipe.get(recipe.id);
    // no opinion attached is no row: see the header for the 10-of-66 measurement
    if (!mine || mine.length === 0) continue;

    /*
     * One rating per member per recipe is a partial unique index, not a guarantee this function
     * can lean on — so count distinct members rather than rows. Two rows for one member would
     * otherwise report "6 of 5 liked it", which is both wrong and unverifiable.
     */
    const latest = new Map<string, number>();
    for (const rating of mine) latest.set(rating.memberId, rating.score);

    const liked = [...latest.values()].filter((score) => score >= LIKED_FROM).length;
    const lukewarm = [...latest.entries()]
      .filter(([, score]) => score < LIKED_FROM)
      .map(([memberId, score]) => ({ name: nameFor.get(memberId)!, score }))
      .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));

    rows.push({
      id: recipe.id,
      title: recipe.title,
      liked,
      rated: latest.size,
      untried: Math.max(0, members.length - latest.size),
      lukewarm,
      timesMade: recipe.timesMade,
    });
  }

  /*
   * Most people who liked it, then most often made. Both are counts, so the ordering is as
   * checkable as the chips — and `times_made` breaking the tie means a thing the household keeps
   * cooking beats a thing they agreed about once.
   */
  return rows.sort((a, b) => b.liked - a.liked || b.timesMade - a.timesMade || a.title.localeCompare(b.title));
}
