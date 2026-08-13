"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { browserClient } from "@/lib/supabase-browser";

/**
 * Sign in, or sign up and get a household.
 *
 * A client component, so it may hold only the anon key — importing the seam here would
 * fail `pnpm check:boundaries`, and rightly: it needs the service role.
 *
 * Sign-up is two steps on purpose. `POST /api/household` creates the auth user *and* the
 * account, household and membership rows, because those three are platform tables that no
 * client may write. Then the browser signs in normally. Doing it the other way round —
 * sign up client-side, then provision — leaves a real window where somebody is
 * authenticated with no household, and every screen has to handle it.
 */
export function SignInForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "up") {
        const response = await fetch("/api/household", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password, householdName, displayName }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `sign-up failed (${response.status})`);
        }
      }

      const { error: signIn } = await browserClient().auth.signInWithPassword({
        email,
        password,
      });
      if (signIn) throw new Error(signIn.message);

      // a full navigation, so the server components re-read the session cookie
      router.push("/recipes");
      router.refresh();
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="tabs">
        <button
          type="button"
          className={mode === "in" ? "" : "quiet"}
          onClick={() => setMode("in")}
        >
          Sign in
        </button>
        <button
          type="button"
          className={mode === "up" ? "" : "quiet"}
          onClick={() => setMode("up")}
        >
          Create a household
        </button>
      </div>

      <form className="stack" onSubmit={submit}>
        <div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === "up" ? "new-password" : "current-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {mode === "up" && (
          <>
            <div>
              <label htmlFor="household">Household name</label>
              <input
                id="household"
                required
                placeholder="The Lundalls"
                value={householdName}
                onChange={(event) => setHouseholdName(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="display">Your name in the household</label>
              <input
                id="display"
                required
                placeholder="Stephen"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </div>
          </>
        )}

        <button type="submit" disabled={busy}>
          {busy ? "Working…" : mode === "in" ? "Sign in" : "Create household"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </>
  );
}
