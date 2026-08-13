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
 * Sign-up sends a confirmation email and creates nothing else. The household waits for the
 * address to be proven — `/auth/confirm` provisions at the moment the link is followed, and
 * this form provisions again after a password sign-in, which is safe because provisioning is
 * idempotent and the second call is a read.
 *
 * The sign-up response is deliberately uninformative: it says the same thing whether the
 * address was new, already registered, or rate-limited, because a signup form that
 * distinguishes them tells a stranger who our customers are.
 */
export function SignInForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "up") {
        const response = await fetch("/api/signup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password, householdName, displayName }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        // a 400 is about the request — a missing field or a short password — and says nothing
        // about the address. Anything else is the one uninformative answer.
        if (!response.ok && response.status === 400) throw new Error(body.error ?? "sign-up failed");
        setSent(true);
        setNotice(body.message ?? "Check your email for a confirmation link.");
        return;
      }

      const { error: signIn } = await browserClient().auth.signInWithPassword({
        email,
        password,
      });
      if (signIn) throw new Error(signIn.message);

      // First confirmed sign-in provisions the household; every later one is a read.
      const { data } = await browserClient().auth.getSession();
      if (data.session) {
        await fetch("/api/household", {
          method: "POST",
          headers: { authorization: `Bearer ${data.session.access_token}` },
        });
      }

      // a full navigation, so the server components re-read the session cookie
      router.push("/recipes");
      router.refresh();
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/resend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      setNotice(body.message ?? "If that address needs confirming, a new link is on its way.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <>
        <div className="notice">{notice}</div>
        <p className="subtitle">
          The link expires in an hour. Nothing is created for <strong>{email}</strong> until it
          is followed.
        </p>
        <div className="tabs">
          <button type="button" className="quiet" disabled={busy} onClick={resend}>
            {busy ? "Sending…" : "Send it again"}
          </button>
          <button
            type="button"
            className="quiet"
            onClick={() => {
              setSent(false);
              setMode("in");
              setNotice(null);
            }}
          >
            Back to sign in
          </button>
        </div>
      </>
    );
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
          {busy ? "Working…" : mode === "in" ? "Sign in" : "Send confirmation email"}
        </button>
        {notice && <p className="subtitle">{notice}</p>}
        {error && (
          <>
            <p className="error">{error}</p>
            {/^email not confirmed$/i.test(error) && (
              <button type="button" className="quiet" disabled={busy} onClick={resend}>
                Send the confirmation email again
              </button>
            )}
          </>
        )}
      </form>
    </>
  );
}
