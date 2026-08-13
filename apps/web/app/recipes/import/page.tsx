import Link from "next/link";
import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase-server";
import { ImportFlow } from "./import-flow";

export default async function ImportPage() {
  const supabase = await userClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/sign-in");

  return (
    <main>
      <p className="subtitle" style={{ marginBottom: "0.75rem" }}>
        <Link href="/recipes">← Recipes</Link>
      </p>
      <h1>Import a recipe</h1>
      <p className="subtitle">
        Paste a link. Nothing is saved until you have looked at it.
      </p>
      <ImportFlow />
    </main>
  );
}
