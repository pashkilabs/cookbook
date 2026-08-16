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
  const tab = params.tab === "text" ? "text" : null;

  return (
    <main>
      <p className="subtitle" style={{ marginBottom: "0.75rem" }}>
        <Link href="/recipes">← Recipes</Link>
      </p>
      <h1>Import a recipe</h1>
      <p className="subtitle">
        {tab === "text"
          ? "Paste the caption itself — this is what to use when a link will not resolve."
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
        {/*
          * Photos is hidden until an upload works end to end.
          *
          * A visible feature over a 500 is worse than an invisible one: it wastes somebody's
          * time and teaches them the app is unreliable. The tab returns when a screenshot has
          * been through it in a browser — the route and the flow both exist and are one
          * verified upload away.
          */}
      </div>

      {tab === "text" ? (
        <PasteFlow mode="text" />
      ) : many ? (
        <BatchFlow />
      ) : (
        <ImportFlow />
      )}
    </main>
  );
}
