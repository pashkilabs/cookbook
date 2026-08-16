import Link from "next/link";
import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase-server";
import { ImportFlow } from "./import-flow";
import { BatchFlow } from "./batch-flow";
import { PasteFlow } from "./paste-flow";

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ many?: string; tab?: string }>;
}) {
  const supabase = await userClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/sign-in");

  const params = await searchParams;
  const many = params.many === "1";
  /*
   * The photograph channel is visible in development and not in production.
   *
   * It has never read a real input: the only images tried are reel screenshots, which are the
   * hardest case and not the one it is for — a card, a clipping, a page from a book. Removing it
   * meant nobody could run the test that decides whether it works, which is worse than showing it
   * to the one person who can. `NODE_ENV` rather than a flag because it is the smallest thing
   * that says exactly this: on for whoever is running it locally, off for everybody else.
   */
  const photographs = process.env.NODE_ENV !== "production";
  const tab =
    params.tab === "text" ? "text" : params.tab === "photos" && photographs ? "photos" : null;

  return (
    <main>
      <p className="subtitle" style={{ marginBottom: "0.75rem" }}>
        <Link href="/recipes">← Recipes</Link>
      </p>
      <h1>Import a recipe</h1>
      <p className="subtitle">
        {tab === "text"
          ? "Paste the caption itself — this is what to use when a link will not resolve."
          : tab === "photos"
            ? "A photograph of a recipe on paper. Still being tested — check every line."
            : many
              ? "Paste as many links as you like. Nothing is saved until you have looked at it."
              : "Paste a link. Nothing is saved until you have looked at it."}
      </p>

      {/* links rather than client state: a half-finished batch survives coming back to it */}
      <div className="chips" style={{ marginBottom: "1.5rem" }}>
        <Link className={`chip${many ? "" : " on"}`} href="/recipes/import">
          One link
        </Link>
        <Link className={`chip${many ? " on" : ""}`} href="/recipes/import?many=1">
          A whole folder
        </Link>
        <Link className={`chip${tab === "text" ? " on" : ""}`} href="/recipes/import?tab=text">
          Paste text
        </Link>
        {photographs && (
          <Link className={`chip${tab === "photos" ? " on" : ""}`} href="/recipes/import?tab=photos">
            Photograph
          </Link>
        )}
      </div>

      {tab === "text" ? (
        <PasteFlow mode="text" />
      ) : tab === "photos" ? (
        <PasteFlow mode="photos" />
      ) : many ? (
        <BatchFlow />
      ) : (
        <ImportFlow />
      )}
    </main>
  );
}
