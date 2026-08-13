import Link from "next/link";
import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase-server";
import { ImportFlow } from "./import-flow";
import { BatchFlow } from "./batch-flow";

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ many?: string }>;
}) {
  const supabase = await userClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/sign-in");

  const many = (await searchParams).many === "1";

  return (
    <main>
      <p className="subtitle" style={{ marginBottom: "0.75rem" }}>
        <Link href="/recipes">← Recipes</Link>
      </p>
      <h1>Import a recipe</h1>
      <p className="subtitle">
        {many
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
      </div>

      {many ? <BatchFlow /> : <ImportFlow />}
    </main>
  );
}
