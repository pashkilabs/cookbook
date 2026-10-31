import { beforeEach, describe, expect, it, vi } from "vitest";

const issueEntitlement = vi.fn();
const findEntitlement = vi.fn();

vi.mock("@/lib/platform", () => ({
  platformStore: () => ({ issueEntitlement, findEntitlement }),
}));

const { FOUNDING, issueFoundingEntitlement } = await import("@/lib/founding-entitlement");

/**
 * The entitlement a household is founded with (§100).
 *
 * It was gated on `PASHKI_DEV_ISSUE_ENTITLEMENT`, so every household created through public
 * signup was read-only from its first second — a meter gating nothing, since there is nothing
 * to sell yet.
 */
describe("the entitlement a new household is founded with", () => {
  beforeEach(() => {
    issueEntitlement.mockReset().mockResolvedValue({});
    findEntitlement.mockReset().mockResolvedValue(null);
  });

  it("lets a brand-new household write, which is the whole point", async () => {
    const result = await issueFoundingEntitlement("fam-1");
    expect(result.entitled).toBe(true);
    expect(issueEntitlement).toHaveBeenCalledOnce();
    const sent = issueEntitlement.mock.calls[0]![0];
    expect(sent.familyId).toBe("fam-1");
    expect(sent.appKey).toBe("recipes");
  });

  it("opens a window nobody will live to see the end of, because billing does not exist yet", async () => {
    await issueFoundingEntitlement("fam-1");
    const sent = issueEntitlement.mock.calls[0]![0];
    // unbounded, and both ends of the window agree — the CHECK requires grace >= valid
    expect(sent.validUntil).toBe(FOUNDING.unboundedUntil);
    expect(sent.graceUntil).toBe(FOUNDING.unboundedUntil);
    expect(Date.parse(sent.validUntil)).toBeGreaterThan(Date.now() + 50 * 365 * 86400000);
  });

  /*
   * regression: `platform_spend_quota` rolls over only `if resets is not null and now() > resets`,
   * and every entitlement ever issued here carried `resetsAt: null` beside `periodDays: 30` — 98
   * of 98 on the hosted project. A period with no anchor never elapses, so all of them were
   * one-off allowances wearing a monthly label. Nothing noticed because nothing had run out.
   */
  it("anchors the first period, so the monthly allowance can actually roll over", async () => {
    const now = new Date("2026-11-01T00:00:00.000Z");
    await issueFoundingEntitlement("fam-1", now);
    const counter = issueEntitlement.mock.calls[0]![0].quota.imports;

    expect(counter.resetsAt, "a null resetsAt never rolls over").not.toBeNull();
    expect(counter.periodDays).toBe(FOUNDING.periodDays);
    expect(counter.used).toBe(0);
    expect(Date.parse(counter.resetsAt)).toBe(now.getTime() + FOUNDING.periodDays * 86400000);
  });

  /*
   * regression: `provisionForConfirmedAccount` runs on EVERY confirmed sign-in, and
   * `issueEntitlement` is an upsert that replaces `quota_json` wholesale. Issuing unconditionally
   * would hand a household its monthly imports back every time somebody signed in, so the meter
   * would read as present and enforce nothing.
   */
  it("leaves an existing entitlement alone, so signing in does not refill the meter", async () => {
    findEntitlement.mockResolvedValue({
      familyId: "fam-1", appKey: "recipes", tier: "full",
      quota: { imports: { limit: 50, used: 49, resetsAt: null, periodDays: 30 } },
      validUntil: FOUNDING.unboundedUntil, graceUntil: FOUNDING.unboundedUntil,
    });

    const result = await issueFoundingEntitlement("fam-1");
    expect(result.entitled).toBe(true);
    expect(issueEntitlement, "an existing entitlement was overwritten").not.toHaveBeenCalled();
  });

  /*
   * A bounded window an operator chose with `issue:entitlement --days 30` is theirs to end. This
   * must not renew it — and must not then claim the household can write, which is why the field
   * is `entitled` (the outcome) rather than `issued` (the action). Named after the action it
   * reported `true` for a lapsed household and the route echoed `canWrite: true`.
   */
  it("does not renew an operator's lapsed window, and does not pretend it can write", async () => {
    const lapsed = new Date("2026-01-01T00:00:00.000Z").toISOString();
    findEntitlement.mockResolvedValue({
      familyId: "fam-1", appKey: "recipes", tier: "full",
      quota: { imports: { limit: 50, used: 0, resetsAt: null, periodDays: 30 } },
      validUntil: lapsed, graceUntil: lapsed,
    });

    const result = await issueFoundingEntitlement("fam-1", new Date("2026-11-01T00:00:00.000Z"));
    expect(issueEntitlement, "an operator's deliberate window was renewed").not.toHaveBeenCalled();
    expect(result.entitled, "a lapsed household was reported as able to write").toBe(false);
  });

  /*
   * A household with no entitlement can read and not write, which is a legitimate state — so a
   * failure to issue must not fail a sign-up. It is reported rather than thrown, and the caller
   * surfaces it as `canWrite`.
   */
  it("reports a failure instead of failing the sign-up it is part of", async () => {
    issueEntitlement.mockRejectedValue(new Error("the platform is down"));
    const result = await issueFoundingEntitlement("fam-1");
    expect(result.entitled).toBe(false);
    expect(result.reason).toContain("the platform is down");
  });

  /*
   * The import cap is the one meter that stays, because it is a cost guard rather than a tier:
   * an import costs an inference call and signup is public. 50 is measured — the busiest real
   * household-month on the hosted project is 40 imports, and 25 (the old development value)
   * would have refused that household mid-collection.
   */
  it("keeps a renewing import cap above the busiest month anybody has had", async () => {
    await issueFoundingEntitlement("fam-1");
    const counter = issueEntitlement.mock.calls[0]![0].quota.imports;
    expect(counter.limit).toBe(50);
    expect(counter.limit).toBeGreaterThan(40);
  });
});
