import { afterEach, describe, expect, it } from "vitest";
import { siteUrl } from "../lib/site-url";

/**
 * Where a confirmation link points, and why a preview deployment refuses to guess.
 *
 * The value is mailed to strangers, so every branch here is about not sending somebody a link
 * to a place we did not mean.
 */
const original = { site: process.env.NEXT_PUBLIC_SITE_URL, vercel: process.env.VERCEL_ENV };

afterEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = original.site;
  process.env.VERCEL_ENV = original.vercel;
});

describe("the site URL", () => {
  it("is whatever configuration says", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://cookbook.pashki.com";
    expect(siteUrl()).toBe("https://cookbook.pashki.com");
  });

  it("drops a trailing slash, so the caller can append a path", () => {
    // both routes build `${siteUrl()}/sign-in`, and GoTrue matches the whole redirect
    process.env.NEXT_PUBLIC_SITE_URL = "https://cookbook.pashki.com/";
    expect(siteUrl()).toBe("https://cookbook.pashki.com");
  });

  it("refuses rather than falling back to a request header", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.VERCEL_ENV;
    expect(() => siteUrl()).toThrow(/required/);
  });

  it("explains itself on a preview deployment instead of reporting a missing variable", () => {
    // scoped to Production on purpose: a preview that guessed would either mail a link to
    // production or need vercel.app in GoTrue's redirect allow list
    delete process.env.NEXT_PUBLIC_SITE_URL;
    process.env.VERCEL_ENV = "preview";
    expect(() => siteUrl()).toThrow(/Production-only/);
    expect(() => siteUrl()).toThrow(/docs\/deployment\.md/);
  });

  it("does not treat production as a preview", () => {
    process.env.VERCEL_ENV = "production";
    process.env.NEXT_PUBLIC_SITE_URL = "https://cookbook.pashki.com";
    expect(siteUrl()).toBe("https://cookbook.pashki.com");
  });
});
