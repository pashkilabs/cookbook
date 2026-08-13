import Link from "next/link";
import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase-server";
import { RecipeForm } from "../recipe-form";

export default async function NewRecipePage() {
  const supabase = await userClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/sign-in");

  return (
    <main>
      <p className="subtitle" style={{ marginBottom: "0.75rem" }}>
        <Link href="/recipes">← Recipes</Link>
      </p>
      <h1>Add a recipe</h1>
      <p className="subtitle">
        Type the ingredients as you would say them — one per line. They go through the same
        parser an import uses.
      </p>
      <RecipeForm mode="create" />
    </main>
  );
}
