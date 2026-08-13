import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/**
 * The signed-in person's own client, on the server, carrying their session cookie.
 *
 * This is the one that reads recipes — as `authenticated`, so row-level security decides
 * which rows come back. The alternative, reading with the service role and filtering by
 * `family_id` in application code, is the shape decisions §5 rejected: it would work
 * until the day somebody forgot the filter.
 */
export async function userClient() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (written: Array<{ name: string; value: string; options: CookieOptions }>) => {
          // a Server Component cannot set cookies; middleware and route handlers can.
          // Swallowing here keeps a read-only render from throwing on a refresh attempt.
          try {
            for (const { name, value, options } of written) store.set(name, value, options);
          } catch {
            /* read-only context */
          }
        },
      },
    },
  );
}
