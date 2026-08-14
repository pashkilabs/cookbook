import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase-server";
import { ConfirmationFromFragment } from "./confirmation";
import { SignInForm } from "./form";

/**
 * A confirmation link lands here, with the session in the URL fragment — which the server
 * cannot read, so `ConfirmationFromFragment` completes it in the browser.
 *
 * Which means this page must not redirect a signed-in visitor away before that component has
 * run: at first render there is no session yet, only a fragment. The redirect below is for
 * somebody who already has a cookie, and the fragment case has none.
 */
export default async function SignInPage() {
  const supabase = await userClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect("/recipes");

  return (
    <main className="welcome">
      <p className="wordmark">Pashki</p>
      <h1>Every recipe you like, in one place</h1>
      <p className="subtitle">
        Save a recipe from anywhere, plan the week, and get a shopping list that adds up the
        ingredients across every meal — so you buy one pint of cream, not two halves.
      </p>
      <ConfirmationFromFragment />
      <SignInForm />
    </main>
  );
}
