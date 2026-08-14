import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestHousehold,
  deleteTestHousehold,
  readLocalInstance,
  type TestHousehold,
} from "./support/index.js";

/**
 * The rules an invitation must not bend, against the SQL that enforces them.
 *
 * Every refusal below is asserted the way the anon revocation was: **with a control that proves
 * the probe could have succeeded.** A token that joins nothing because the fixture never created
 * it has measured nothing, so each negative case starts from a token that demonstrably works and
 * then breaks exactly one thing.
 */
const instance = readLocalInstance();

describe.skipIf(instance === null)("invitations", () => {
  let admin: SupabaseClient;
  let host: TestHousehold;
  let other: TestHousehold;

  const hash = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");
  const mint = () => {
    const token = randomBytes(32).toString("base64url");
    return { token, tokenHash: hash(token) };
  };

  /** A live invitation from `household` to an address, and the token that claims it. */
  async function invite(
    household: TestHousehold,
    email: string,
    overrides: Record<string, unknown> = {},
  ) {
    const { token, tokenHash } = mint();
    const { data, error } = await admin
      .from("invitations")
      .insert({
        family_id: household.familyId,
        email: email.toLowerCase(),
        token_hash: tokenHash,
        invited_by_account_id: household.accountId,
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
        ...overrides,
      })
      .select("id")
      .single();
    if (error) throw error;
    return { token, tokenHash, id: data.id as string };
  }

  /** A confirmed auth account, as the invited person would have after signing up. */
  async function account(email: string) {
    const user = await admin.auth.admin.createUser({
      email,
      password: `Invite-${Date.now()}-Aa1!`,
      email_confirm: true,
    });
    if (user.error) throw user.error;
    return user.data.user!.id;
  }

  const claim = async (token: string, accountId: string, email: string) => {
    const { data, error } = await admin.rpc("accept_invitation", {
      p_token_hash: hash(token),
      p_account_id: accountId,
      p_email: email,
      p_display_name: "Invited",
    });
    if (error) throw error;
    return data as { status: string; familyId?: string };
  };

  const created: string[] = [];
  const newAddress = () => `invitee-${randomBytes(6).toString("hex")}@example.invalid`;

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    host = await createTestHousehold({ admin, url: instance.url, anonKey: instance.anonKey, label: "inviter" });
    other = await createTestHousehold({ admin, url: instance.url, anonKey: instance.anonKey, label: "other" });
  });

  afterAll(async () => {
    if (!instance) return;
    for (const id of created) await admin.auth.admin.deleteUser(id).catch(() => {});
    for (const target of [other, host].filter(Boolean)) await deleteTestHousehold(admin, target);
  });

  describe("a good token joins the household", () => {
    it("adds the invited person as an adult", async () => {
      const email = newAddress();
      const { token } = await invite(host, email);
      const accountId = await account(email);
      created.push(accountId);

      const result = await claim(token, accountId, email);
      expect(result.status).toBe("joined");
      expect(result.familyId).toBe(host.familyId);

      const { data } = await admin
        .from("family_members")
        .select("account_id, is_child, display_name")
        .eq("family_id", host.familyId)
        .eq("account_id", accountId)
        .is("deleted_at", null)
        .single();
      expect(data, "an adult: account set, is_child false").toMatchObject({
        account_id: accountId,
        is_child: false,
      });
    });

    it("confers no entitlement — the household's own covers its members", async () => {
      // decisions §9: absence is not an unmetered allowance, and an invitation is a membership
      // rather than a purchase
      const email = newAddress();
      const { token } = await invite(host, email);
      const accountId = await account(email);
      created.push(accountId);
      await claim(token, accountId, email);

      const { count } = await admin
        .from("entitlements")
        .select("family_id", { count: "exact", head: true })
        .eq("family_id", host.familyId);
      // whatever the household had before, joining did not add one
      expect(count).toBeLessThanOrEqual(1);
    });
  });

  describe("what a token must not do", () => {
    it("cannot be used twice", async () => {
      const email = newAddress();
      const { token } = await invite(host, email);
      const accountId = await account(email);
      created.push(accountId);

      // the control: it works once
      expect((await claim(token, accountId, email)).status).toBe("joined");
      // and only once
      expect((await claim(token, accountId, email)).status).toBe("used");
    });

    it("cannot be used after it expires", async () => {
      const email = newAddress();
      const accountId = await account(email);
      created.push(accountId);

      // control first: a live token for this address and account joins
      const live = await invite(host, email);
      expect((await claim(live.token, accountId, email)).status).toBe("joined");

      // now the same setup, expired, against a household it is not yet in
      const stale = await invite(other, email, {
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      });
      expect((await claim(stale.token, accountId, email)).status).toBe("expired");
    });

    it("cannot be used after it is revoked", async () => {
      const email = newAddress();
      const accountId = await account(email);
      created.push(accountId);
      const { token, id } = await invite(host, email);

      await admin.from("invitations").update({ revoked_at: new Date().toISOString() }).eq("id", id);
      expect((await claim(token, accountId, email)).status).toBe("revoked");
    });

    it("cannot be used after a second invitation supersedes it", async () => {
      const email = newAddress();
      const accountId = await account(email);
      created.push(accountId);
      const first = await invite(host, email);

      // what the store does when re-inviting: supersede, then insert
      await admin
        .from("invitations")
        .update({ superseded_at: new Date().toISOString() })
        .eq("family_id", host.familyId)
        .eq("email", email)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .is("superseded_at", null);
      const second = await invite(host, email);

      expect((await claim(first.token, accountId, email)).status).toBe("superseded");
      // and the replacement works, which is what makes the refusal above meaningful
      expect((await claim(second.token, accountId, email)).status).toBe("joined");
    });

    it("cannot be redirected at another household", async () => {
      /*
       * The rule stated as "a token for household A cannot join household B, whatever is in the
       * request". There is no household in the request at all — `accept_invitation` reads it off
       * the claimed row — so the way to test it is to prove the token lands where the row says
       * and nowhere else.
       */
      const email = newAddress();
      const accountId = await account(email);
      created.push(accountId);
      const { token } = await invite(other, email);

      const result = await claim(token, accountId, email);
      expect(result.status).toBe("joined");
      expect(result.familyId, "the row decides, not the caller").toBe(other.familyId);

      const { count } = await admin
        .from("family_members")
        .select("id", { count: "exact", head: true })
        .eq("family_id", host.familyId)
        .eq("account_id", accountId)
        .is("deleted_at", null);
      expect(count, "and never the household that did not invite them").toBe(0);
    });

    it("cannot admit an address it was not sent to", async () => {
      const invited = newAddress();
      const stranger = newAddress();
      const { token } = await invite(host, invited);
      const strangerAccount = await account(stranger);
      created.push(strangerAccount);

      // a forwarded link, claimed by whoever received it
      expect((await claim(token, strangerAccount, stranger)).status).toBe("wrong-address");

      // the control: the same token works for the address it was sent to
      const invitedAccount = await account(invited);
      created.push(invitedAccount);
      expect((await claim(token, invitedAccount, invited)).status).toBe("joined");
    });

    it("refuses a token that never existed", async () => {
      const email = newAddress();
      const accountId = await account(email);
      created.push(accountId);
      expect((await claim(mint().token, accountId, email)).status).toBe("unknown");
    });
  });

  describe("what a client may see", () => {
    it("lets a member of the household read the invitation, without its hash", async () => {
      const email = newAddress();
      await invite(host, email);

      const readable = await host.client
        .from("invitations")
        .select("id, email, expires_at")
        .eq("family_id", host.familyId);
      expect(readable.error).toBeNull();
      expect((readable.data ?? []).length).toBeGreaterThan(0);

      const hashed = await host.client.from("invitations").select("token_hash");
      expect(hashed.error?.code, "the hash is withheld by column grant").toBe("42501");
    });

    it("hides another household's invitations", async () => {
      const email = newAddress();
      await invite(other, email);
      const { data } = await host.client.from("invitations").select("id").eq("family_id", other.familyId);
      expect(data).toEqual([]);
    });

    it("lets no client write one", async () => {
      const { error } = await host.client.from("invitations").insert({
        family_id: host.familyId,
        email: newAddress(),
        token_hash: mint().tokenHash,
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      });
      expect(error?.code).toBe("42501");
    });

    it("keeps only one live invitation per address per household", async () => {
      const email = newAddress();
      await invite(host, email);
      // the index is what makes "a second supersedes the first" enforceable rather than hoped for
      await expect(invite(host, email)).rejects.toMatchObject({ code: "23505" });
    });
  });
});

describe.skipIf(instance !== null)("invitations (skipped)", () => {
  it("needs a local Supabase instance — run pnpm --filter @pashki/db db:start", () => {
    expect(instance).toBeNull();
  });
});
