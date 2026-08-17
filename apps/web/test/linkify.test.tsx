import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { linkify } from "../app/recipes/[id]/linkify";

const html = (text: string) => renderToStaticMarkup(<>{linkify(text)}</>);

/**
 * A step is plain text and some of it came from a model reading a stranger's caption. Linking the
 * URLs in it must never mean rendering it as markup.
 */
describe("linking the URLs in a step", () => {
  it("links a URL and leaves the words around it alone", () => {
    const out = html("Bake as at https://example.com/guide until golden.");
    expect(out).toContain('href="https://example.com/guide"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain("until golden");
  });

  it("escapes a script tag rather than rendering it", () => {
    // the bug this exists to prevent: a recipe whose step contains markup
    const out = html('Mix well <script>alert("x")</script> then rest.');
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("does not turn an angle bracket in a URL into an element", () => {
    const out = html("See https://example.com/a<b>c for more");
    expect(out).not.toContain("<b>");
  });

  it("leaves text with no URL as a single string", () => {
    expect(html("Simmer for 20 minutes.")).toBe("Simmer for 20 minutes.");
  });

  it("stops the link before trailing punctuation", () => {
    const out = html("Full method at https://example.com/method.");
    expect(out).toContain('href="https://example.com/method"');
    expect(out).toContain(".");
  });

  it("links more than one URL in a step", () => {
    const out = html("Either https://a.test/x or https://b.test/y works");
    expect(out.match(/<a /g)).toHaveLength(2);
  });

  it("does not link a bare domain, which is as likely to be an ingredient brand", () => {
    expect(html("Use King Arthur flour")).toBe("Use King Arthur flour");
  });
});

import { Substitution } from "../app/recipes/[id]/substitution";
import { SUBSTITUTIONS, createSubstitutions } from "@pashki/core";

/**
 * The substitution disclosure (decisions §51). Read-only, no model, no quota — and the caveat is
 * the part that must not be hidden.
 */
describe("no buttermilk?", () => {
  const table = createSubstitutions(SUBSTITUTIONS);
  const render = (name: string) =>
    renderToStaticMarkup(<Substitution entry={table.find(name)!} />);

  it("shows what to use, in what ratio, and what it costs", () => {
    const out = render("buttermilk");
    expect(out).toContain("no buttermilk?");
    expect(out).toMatch(/lemon juice|vinegar/i);
    expect(out).toContain("1 tbsp");
    expect(out).toMatch(/None worth minding/i);
  });

  it("puts notFor in the open, not behind a further tap", () => {
    /*
     * The most valuable line in the table is the one saying a substitution is actively wrong.
     * Hiding it a level deeper than the substitution it qualifies would be the same fault as a
     * calorie total that omits the chorizo: the encouraging half visible, the warning a click away.
     */
    const out = render("sour cream");
    expect(out).toMatch(/Not for .*baking/i);
    // one <details> only — the warning is inside it, not inside another
    expect(out.match(/<details/g)).toHaveLength(1);
  });

  it("names the ratio for the one where the ratio is load-bearing", () => {
    expect(render("self-raising flour")).toMatch(/2 tsp baking powder/i);
  });
});
