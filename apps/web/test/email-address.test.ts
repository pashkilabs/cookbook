import { describe, expect, it } from "vitest";
import { normaliseEmail } from "../lib/email-address";

/**
 * regression: reported as "sign-in fails on email casing". It was not casing — GoTrue is already
 * case-insensitive. Signup normalised with trim().toLowerCase() and the sign-in form sent the
 * input box untouched, so an address with a leading space was stored one way and looked up
 * another, and the answer was "invalid credentials".
 */
describe("normaliseEmail", () => {
  it("strips the whitespace an autofill or a paste leaves behind", () => {
    expect(normaliseEmail(" stephen@example.com ")).toBe("stephen@example.com");
    expect(normaliseEmail("\tstephen@example.com\n")).toBe("stephen@example.com");
  });

  it("lower-cases, so a signed-up address and a signed-in one are the same string", () => {
    expect(normaliseEmail("Stephen@Example.COM")).toBe("stephen@example.com");
  });

  it("agrees with what signup stores, which is the whole point", () => {
    // the two doors must produce one value; a form and a route normalising differently is how
    // this broke in the first place
    const typed = "  Stephen@Example.com ";
    expect(normaliseEmail(typed)).toBe(normaliseEmail(normaliseEmail(typed)));
  });

  it("leaves an already-clean address alone", () => {
    expect(normaliseEmail("a@b.co")).toBe("a@b.co");
  });
});
