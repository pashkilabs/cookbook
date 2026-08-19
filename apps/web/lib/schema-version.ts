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
 * A hand-maintained string, like `EXTRACTOR_VERSION`, and for the same reason: computing it from
 * the migrations directory would make it always correct and therefore never informative — it
 * would match whatever the build contains, which is exactly the thing that is not in question.
 * What matters is whether the *database* has caught up.
 *
 * Bump it when a migration is added that application code depends on. Bumping unnecessarily costs
 * a check; forgetting costs a page that 500s for whoever opens it.
 */
export const REQUIRED_MIGRATION = "20260820120000_applied_migrations_rpc";
