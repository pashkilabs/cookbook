import Link from "next/link";
import { notFound } from "next/navigation";
import { TabBar, Eyebrow, ChapterIcon } from "@/components/harvest";
import { chapterData, photosFor } from "@/lib/chapter-data";
import { chapterBySlug, counted, subdivision, chapterHref, type Classified } from "@/lib/chapters";
import { andList } from "@/lib/energy";
import { Tile } from "../../tile";

/**
 * One chapter of the recipe book.
 *
 * A **real route**, server-rendered, not client state. A layout chosen after hydration flips under
 * the reader — §84 cost us that once on the Today screen's hour-of-day default — and a chapter you
 * cannot link to or come back to with the back button is not a chapter of a book.
 *
 * Two shapes, decided by `subdivision()` rather than here: a chapter with an axis and more than
 * seven recipes becomes a screen of chapters (Mains, into six protein groups); everything else
 * lists its recipes. Only Mains has an axis at all, so only Mains ever divides — see `chapters.ts`
 * for why Soups does not, which is the question the next reader will ask.
 */
export default async function ChapterPage({ params }: { params: Promise<{ chapter: string }> }) {
  const { chapter: slug } = await params;
  const chapter = chapterBySlug(slug);
  // an unknown slug is a 404, never a silent fall back to Mains — a wrong chapter that renders
  // is worse than one that admits it is not there
  if (!chapter) notFound();

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

  const mine = data.hits.filter(({ recipe }) => chapter.holds(recipe as unknown as Classified));
  const parts = subdivision(chapter, mine.length);

  /* only the groups that hold something: Lamb, Eggs and Meat-free are all 0 today, and an empty
     tile is a door onto nothing */
  const groups = parts ? counted(mine.map(({ recipe }) => recipe as unknown as Classified), parts) : [];

  const photoFor = parts
    ? new Map<string, string>()
    : await photosFor(data.supabase, data.familyId, mine.map(({ recipe }) => recipe.id));

  /*
   * The other chapters that actually hold something.
   *
   * Counted over the whole library rather than listed from `TOP_LEVEL`, because Snacks is 0 on
   * this library and a link to an empty chapter is the same door onto nothing an empty tile would
   * have been. The contents page drops it; this list has to drop it for the same reason.
   */
  const others = counted(data.hits.map(({ recipe }) => recipe as unknown as Classified)).filter(
    (entry) => entry.chapter.slug !== chapter.slug,
  );

  return (
    <div className="h-docked-page">
      <main>
        <div className="h-contents">
          <p className="meta" style={{ margin: 0 }}>
            <Link href="/recipes">&lsaquo; The Lundall Recipe Book</Link>
          </p>

          <div className="h-chapter-hero">
            <ChapterIcon icon={chapter.icon} size={52} />
            <h1 className="h-chapter-hero-title">{chapter.label}</h1>
            <p className="h-chapter-tally">
              {mine.length} {mine.length === 1 ? "recipe" : "recipes"}
              {groups.length > 0 ? `, in ${groups.length} parts` : ""}
            </p>
          </div>

          {data.error && <p className="error">Could not read recipes: {data.error}</p>}

          {/* stated, not silent: a filter that quietly shortens a list is indistinguishable from a
              household that owns fewer recipes */}
          {data.hiddenByAllergen > 0 && (
            <p className="meta">
              {data.hiddenByAllergen} hidden:{" "}
              {andList(data.avoidedAllergens.map((a) => (a === "tree-nut" ? "tree nuts" : a)))} written in
              the ingredients. <Link href="/household">Change what you avoid</Link>.
            </p>
          )}

          {mine.length === 0 && (
            <p className="meta">
              Nothing in this chapter yet. A recipe lands here when it is {chapter.source}.
            </p>
          )}

          {/* divided: a screen of chapters, because 32 is still 32 once you have tapped Mains */}
          {groups.length > 0 && (
            <div className="h-mains-grid">
              {groups.map(({ chapter: part, count }) => (
                <Link className="h-chapter-tile" key={part.slug} href={chapterHref(part.slug, chapter.slug)}>
                  <ChapterIcon icon={part.icon} size={52} />
                  <span className="h-chapter-name">{part.label}</span>
                  <span className="h-chapter-tally">{count}</span>
                </Link>
              ))}
            </div>
          )}

          {/* a leaf: the recipes themselves, all of them — search and the list's own filters are
              the way through a long one, on every layout rather than being one */}
          {groups.length === 0 && mine.length > 0 && (
            <div className="h-layout-grid">
              {mine.map(({ recipe }) => (
                <Tile key={recipe.id} id={recipe.id} title={recipe.title} photo={photoFor.get(recipe.id)} />
              ))}
            </div>
          )}

          {/* the other chapters, so this is a book rather than a dead end */}
          {others.length > 0 && (
            <>
              <div className="h-chapter-head" style={{ marginTop: "var(--space-xxl)" }}>
                <Eyebrow>Other chapters</Eyebrow>
              </div>
              <p className="meta" style={{ marginTop: "var(--space-xs)" }}>
                {others.map(({ chapter: other, count }, index) => (
                  <span key={other.slug}>
                    {index > 0 && " · "}
                    <Link href={chapterHref(other.slug)}>
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
