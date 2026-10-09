/**
 * The migration this build was written against.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 *
 * `git push` deploys automatically. `db:push` is remembered by a person. That asymmetry has now
 * put code in production ahead of its schema **four times** — the recipe list, browse, the photo
 * upload path, and /household — and each one surfaced as a server-side exception on a page rather
 * than as anything a deploy would notice.
 *
 * A rule that has failed four times against people who know it is not a rule. So the deployment
 * is asked to say what schema it has, and to name what it is missing.
 *
 * ---------------------------------------------------------------------------
 * How it is maintained
 * ---------------------------------------------------------------------------
 *
 * **It is still a string, and `scripts/check-schema-version.mjs` now proves it is the right one.**
 *
 * This comment used to argue against deriving it: *"computing it from the migrations directory
 * would make it always correct and therefore never informative"*. That was wrong, and it cost a
 * fifth instance of the failure it was written to prevent — two migrations landed, the seam grew
 * a column hosted did not have, every provisioning request 500'd, and `schema` reported **ok**
 * the whole time because the stamp had not been turned.
 *
 * The error in the reasoning: this constant describes **the build**, and the comparison is
 * against **the database**. Deriving it makes it always correct about the build and leaves the
 * interesting question exactly as open as before. What the old argument actually protected
 * against was a migration no code depends on raising a warning — a *false alarm*, where the
 * alternative is a *false ok*. One costs a `db:push`; the other costs production.
 *
 * So it stays a literal, because a serverless bundle that has to read the migrations directory
 * at runtime is the file-tracing hazard this project has already paid for — and a build guard
 * asserts it against the directory instead. `pnpm check` fails if it is stale, which is what a
 * rule that has failed five times against people who know it actually needs.
 */
export const REQUIRED_MIGRATION = "20261009120000_household_allergens";
