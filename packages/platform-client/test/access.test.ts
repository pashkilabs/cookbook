import { describe, expect, it } from "vitest";
import { DEFAULT_GRACE_DAYS, evaluateAccess, graceUntilFor } from "../src/access.js";

const validUntil = "2026-09-11T00:00:00.000Z";
const graceUntil = "2026-09-18T00:00:00.000Z";
const window = { validUntil, graceUntil };

const at = (iso: string) => evaluateAccess(window, new Date(iso));
const ms = (iso: string, delta: number) => new Date(Date.parse(iso) + delta).toISOString();

describe("the validity window", () => {
  it("is full access well before expiry", () => {
    expect(at("2026-08-11T00:00:00.000Z")).toEqual({
      level: "full",
      canRead: true,
      canWrite: true,
      shouldRenew: false,
    });
  });

  it("is still full at exactly validUntil", () => {
    // valid *until* means the instant itself is included; the other convention
    // expires a subscription a moment early and generates support mail
    expect(at(validUntil).level).toBe("full");
  });

  it("enters grace one millisecond after validUntil", () => {
    expect(at(ms(validUntil, 1)).level).toBe("grace");
  });

  it("keeps writing during grace, and asks to renew", () => {
    expect(at("2026-09-14T00:00:00.000Z")).toEqual({
      level: "grace",
      canRead: true,
      canWrite: true,
      shouldRenew: true,
    });
  });

  it("is still grace at exactly graceUntil", () => {
    expect(at(graceUntil).level).toBe("grace");
  });

  it("degrades one millisecond after graceUntil", () => {
    expect(at(ms(graceUntil, 1)).level).toBe("read-only");
  });
});

describe("after grace", () => {
  it("degrades to read-only, never to locked", () => {
    // decisions §9: a family must not lose access to their own recipes because a
    // card expired mid-shop
    const access = at("2027-01-01T00:00:00.000Z");
    expect(access).toEqual({
      level: "read-only",
      canRead: true,
      canWrite: false,
      shouldRenew: true,
    });
  });

  it("never produces a state that denies reading, at any point on the timeline", () => {
    const probes = [
      "2020-01-01T00:00:00.000Z",
      validUntil,
      ms(validUntil, 1),
      graceUntil,
      ms(graceUntil, 1),
      "2099-01-01T00:00:00.000Z",
    ];
    for (const probe of probes) {
      expect(at(probe).canRead, probe).toBe(true);
    }
  });

  it("fails to read-only rather than to full access on an unparseable window", () => {
    const broken = evaluateAccess({ validUntil: "not a date", graceUntil }, new Date());
    expect(broken.level).toBe("read-only");
    expect(broken.canWrite).toBe(false);
    expect(broken.canRead).toBe(true);
  });
});

describe("graceUntilFor", () => {
  it("adds the grace period to the validity date", () => {
    expect(graceUntilFor(validUntil, 7)).toBe(graceUntil);
  });

  it("defaults to a week", () => {
    expect(graceUntilFor(validUntil, DEFAULT_GRACE_DAYS)).toBe(graceUntil);
  });

  it("refuses a validity date it cannot read rather than inventing one", () => {
    expect(() => graceUntilFor("nonsense", 7)).toThrow(/not a date/);
  });
});
