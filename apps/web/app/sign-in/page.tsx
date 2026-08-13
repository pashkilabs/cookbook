import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase-server";
import { SignInForm } from "./form";

export default async function SignInPage() {
  const supabase = await userClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect("/recipes");

  return (
    <main>
      <h1>Pashki Recipes</h1>
      <p className="subtitle">One subscription, a household that eats well.</p>
      <SignInForm />
    </main>
  );
}
