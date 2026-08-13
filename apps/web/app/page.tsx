import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase-server";

export default async function Home() {
  const supabase = await userClient();
  const { data } = await supabase.auth.getUser();
  redirect(data.user ? "/recipes" : "/sign-in");
}
