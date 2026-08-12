import { describe, expect, it } from "vitest";
import { absoluteUrl, blockedPlatform, hashUrl, normaliseUrl } from "../src/index.js";

const href = (input: string): string => {
  const result = normaliseUrl(input);
  if ("kind" in result) throw new Error(`expected a URL, got ${result.kind}`);
  return result.href;
};

describe("normalising for cache hits", () => {
  it("strips tracking parameters, so four shares are one cache entry", () => {
    const shares = [
      "https://example.com/pie",
      "https://example.com/pie?utm_source=facebook&utm_medium=social",
      "https://example.com/pie?fbclid=abc123",
      "https://www.example.com/pie/",
    ];
    const hashes = new Set(shares.map((share) => hashUrl(href(share))));
    expect(hashes.size).toBe(1);
  });

  it("keeps parameters that identify the page", () => {
    // ?p=123 is the page on plenty of sites; dropping it would collapse a whole blog
    // into one cache entry
    expect(href("https://example.com/?p=123")).not.toBe(href("https://example.com/?p=456"));
  });

  it("orders surviving parameters, so argument order does not matter", () => {
    expect(href("https://example.com/r?b=2&a=1")).toBe(href("https://example.com/r?a=1&b=2"));
  });

  it("drops the fragment, which never reaches the server", () => {
    expect(href("https://example.com/pie#jump-to-recipe")).toBe(href("https://example.com/pie"));
  });

  it("treats http and https as one page", () => {
    expect(href("http://example.com/pie")).toBe(href("https://example.com/pie"));
  });

  it("keeps a trailing slash on the root but not on a path", () => {
    expect(href("https://example.com")).toBe(href("https://example.com/"));
    expect(href("https://example.com/pie/")).toBe(href("https://example.com/pie"));
  });

  it("refuses things that are not fetchable web pages", () => {
    for (const bad of ["", "   ", "not a url", "javascript:alert(1)", "file:///etc/passwd"]) {
      const result = normaliseUrl(bad);
      expect("kind" in result && result.kind, bad).toBe("invalid-url");
    }
  });

  it("hashes rather than storing the URL, at a fixed length", () => {
    const hash = hashUrl(href("https://example.com/pie"));
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(hash).not.toContain("example.com");
  });
});

describe("platforms that never resolve", () => {
  it("rejects them up front rather than after four doomed attempts", () => {
    const cases: Array<[string, string, string]> = [
      ["www.facebook.com", "Facebook", "screenshot"],
      ["m.facebook.com", "Facebook", "screenshot"],
      ["fb.watch", "Facebook", "screenshot"],
      ["www.instagram.com", "Instagram", "screenshot"],
      ["instagram.com", "Instagram", "screenshot"],
      ["vm.tiktok.com", "TikTok", "video"],
    ];
    for (const [host, platform, useInstead] of cases) {
      const blocked = blockedPlatform(host);
      expect(blocked?.kind, host).toBe("blocked-platform");
      expect(blocked, host).toMatchObject({ platform, useInstead });
    }
  });

  it("does not reject a site that merely mentions one", () => {
    for (const host of ["facebook-recipes.com", "notinstagram.org", "example.com"]) {
      expect(blockedPlatform(host), host).toBeNull();
    }
  });
});

describe("resolving relative URLs", () => {
  it("resolves against the page it was found on", () => {
    expect(absoluteUrl("/images/pie.jpg", "https://example.com/recipes/pie")).toBe(
      "https://example.com/images/pie.jpg",
    );
  });

  it("leaves an absolute URL alone", () => {
    expect(absoluteUrl("https://cdn.example.com/pie.jpg", "https://example.com/")).toBe(
      "https://cdn.example.com/pie.jpg",
    );
  });

  it("refuses a scheme that is not fetchable", () => {
    expect(absoluteUrl("data:image/png;base64,AAAA", "https://example.com/")).toBeNull();
    expect(absoluteUrl("", "https://example.com/")).toBeNull();
  });
});
