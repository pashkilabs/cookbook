import Link from "next/link";
import { notFound } from "next/navigation";
import { TabBar, Eyebrow, ChapterIcon } from "@/components/harvest";
import { chapterData, photosFor } from "@/lib/chapter-data";
import { chapterBySlug, counted, chapterHref, MAINS_BY_PROTEIN, type Classified } from "@/lib/chapters";
import { andList } from "@/lib/energy";
import { Tile } from "../../../tile";

/**
 * One protein within Mains — the leaf of the tree.
 *
 * Mains is the only chapter that divides, because `principal_protein` is the only axis that
 * exists. Measured inside Mains the column is named on **22 of 32**, which is why the subdivision
 * works here even though §85 refused a library-wide fridge layout on 25 of 67: Mains is where the
 * classifier succeeds, and the 10 it did not name are a group called "Everything else" rather than
 * 10 recipes that vanish.
 *
 * Two predicates, both applied: a recipe belongs here only if it is a main **and** carries this
 * protein. Dropping the first would quietly pull in a soup or a side that happens to be chicken,
 * and the count on the parent tile would stop matching the page it opens.
 */
export default async function ProteinPage({ params }: { params: Promise<{ protein: string }> }) {
  const { protein: slug } = await params;
  const part = chapterBySlug(slug, MAINS_BY_PROTEIN);
  if (!part) notFound();

  const mains = chapterBySlug("main");
  if (!mains) notFound();

  const data = await chapterData();
  if (!data) {
    return (
      <main>
        <div className="notice">
          This account has no household yet. Signing out and back in completes provisioning.
        </div>
      </main>
    );
  }

  const mine = data.hits.filter(({ recipe }) => {
    const row = recipe as unknown as Classified;
    return mains.holds(row) && part.holds(row);
  });

  const photoFor = await photosFor(
    data.supabase,
    data.familyId,
    mine.map(({ recipe }) => recipe.id),
  );

  /* the sibling groups, so somebody can move sideways without going back up twice */
  const siblings = counted(
    data.hits
      .map(({ recipe }) => recipe as unknown as Classified)
      .filter((row) => mains.holds(row)),
    MAINS_BY_PROTEIN,
  ).filter((entry) => entry.chapter.slug !== part.slug);

  return (
    <div className="h-docked-page">
      <main>
        <div className="h-contents">
          <p className="meta" style={{ margin: 0 }}>
            <Link href={chapterHref("main")}>&lsaquo; Mains</Link>
          </p>

          <div className="h-chapter-hero">
            <ChapterIcon icon={part.icon} size={52} />
            <h1 className="h-chapter-hero-title">{part.label}</h1>
            <p className="h-chapter-tally">
              {mine.length} {mine.length === 1 ? "main" : "mains"}
            </p>
          </div>

          {data.error && <p className="error">Could not read recipes: {data.error}</p>}

          {data.hiddenByAllergen > 0 && (
            <p className="meta">
              {data.hiddenByAllergen} hidden:{" "}
              {andList(data.avoidedAllergens.map((a) => (a === "tree-nut" ? "tree nuts" : a)))} written in
              the ingredients. <Link href="/household">Change what you avoid</Link>.
            </p>
          )}

          {mine.length === 0 && (
            <p className="meta">Nothing here yet. A main lands here when its protein is {part.source}.</p>
          )}

          {mine.length > 0 && (
            <div className="h-layout-grid">
              {mine.map(({ recipe }) => (
                <Tile key={recipe.id} id={recipe.id} title={recipe.title} photo={photoFor.get(recipe.id)} />
              ))}
            </div>
          )}

          {siblings.length > 0 && (
            <>
              <div className="h-chapter-head" style={{ marginTop: "var(--space-xxl)" }}>
                <Eyebrow>Other mains</Eyebrow>
              </div>
              <p className="meta" style={{ marginTop: "var(--space-xs)" }}>
                {siblings.map(({ chapter: other, count }, index) => (
                  <span key={other.slug}>
                    {index > 0 && " · "}
                    <Link href={chapterHref(other.slug, "main")}>
                      {other.label} {count}
                    </Link>
                  </span>
                ))}
              </p>
            </>
          )}
        </div>
      </main>
      <TabBar current="recipes" />
    </div>
  );
}
