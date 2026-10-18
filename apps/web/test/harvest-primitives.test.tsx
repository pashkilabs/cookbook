import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
}));

import {
  Checkbox, Chip, DayCircle, DockedActionBar, Eyebrow,
  IconButton, IconLink, PrimaryButton, PrimaryLink,
  SecondaryButton, SectionHeader, TabBar,
} from "../components/harvest";

const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);

/**
 * The primitives' **structure and accessibility**, which is what a static render can see.
 *
 * Appearance is not asserted here and is not claimed: colour, size and the focus ring are CSS, and
 * CSS is verified in a browser against a screen that uses them — Phase 2. What this pins is the
 * part that is wrong in markup rather than in a stylesheet, and that no visual check would notice:
 * a clickable div, an icon with no name, a tab with no current state, a styled span standing in
 * for a checkbox.
 */
describe("real elements, not clickable divs", () => {
  it("renders a button as a button and a link as an anchor", () => {
    expect(html(<PrimaryButton>Cook now</PrimaryButton>)).toContain("<button");
    expect(html(<PrimaryLink href="/x">Cook now</PrimaryLink>)).toContain("<a");
    expect(html(<SecondaryButton>Swap</SecondaryButton>)).toContain("<button");
  });

  it("gives every button an explicit type, so it cannot submit a form it sits inside", () => {
    expect(html(<PrimaryButton>Go</PrimaryButton>)).toContain('type="button"');
    expect(html(<SecondaryButton>Go</SecondaryButton>)).toContain('type="button"');
  });
});

describe("an icon-only control always has a name", () => {
  // `label` is a required prop rather than an optional one, so the compiler asks
  it("puts the label on aria-label", () => {
    expect(html(<IconButton label="Filters"><svg /></IconButton>)).toContain('aria-label="Filters"');
    expect(html(<IconLink label="Back" href="/x"><svg /></IconLink>)).toContain('aria-label="Back"');
  });
});

describe("the checkbox is a real checkbox", () => {
  it("renders an input, not a styled span", () => {
    const out = html(<Checkbox state="need" onToggle={() => {}}>Heavy cream</Checkbox>);
    expect(out).toContain('type="checkbox"');
  });

  it("reflects the three states distinctly in the class, so CSS can tell them apart", () => {
    expect(html(<Checkbox state="need">x</Checkbox>)).toContain("is-need");
    expect(html(<Checkbox state="have">x</Checkbox>)).toContain("is-have");
    expect(html(<Checkbox state="check-pantry">x</Checkbox>)).toContain("is-check-pantry");
  });

  it("marks the input checked only when the state is have", () => {
    expect(html(<Checkbox state="have">x</Checkbox>)).toContain("checked");
    expect(html(<Checkbox state="check-pantry">x</Checkbox>)).not.toContain("checked");
  });

  it("disables the input when nothing can be toggled, rather than looking live", () => {
    expect(html(<Checkbox state="check-pantry">x</Checkbox>)).toContain("disabled");
  });

  it("hides the decorative box from the accessibility tree", () => {
    // the real control is announced; the drawn square must not be announced twice
    expect(html(<Checkbox state="have">x</Checkbox>)).toContain('aria-hidden="true"');
  });
});

describe("the day circle says the whole thing once", () => {
  it("names the date for a screen reader and hides the letter", () => {
    const out = html(<DayCircle letter="M" date={19} state="planned" name="Monday 19, planned" onSelect={() => {}} />);
    expect(out).toContain('aria-label="Monday 19, planned"');
    // "M" read before "19" is noise
    expect(out).toContain('aria-hidden="true"');
  });

  it("is a button when it can be chosen and not a button when it cannot", () => {
    expect(html(<DayCircle letter="M" date={19} state="open" name="Monday 19" onSelect={() => {}} />)).toContain("<button");
    expect(html(<DayCircle letter="M" date={19} state="open" name="Monday 19" />)).not.toContain("<button");
  });

  it("reports planned through aria-pressed, not colour alone", () => {
    expect(html(<DayCircle letter="T" date={20} state="planned" name="Tuesday 20, planned" onSelect={() => {}} />))
      .toContain('aria-pressed="true"');
  });
});

describe("the tab bar", () => {
  it("marks the current tab for a screen reader, not only in terracotta", () => {
    const out = html(<TabBar current="shopping" />);
    expect(out).toContain('aria-current="page"');
    expect((out.match(/aria-current/g) ?? []).length).toBe(1);
  });

  it("is a nav with a name, and gives Today and Recipes separate destinations", () => {
    /*
     * Today pointed at `/recipes` while there was nothing else to point at, and the comment here
     * defended that as avoiding "a second door on one shelf". The shelf argument was right and
     * the premise expired: §82 gave Today its own screen — what is planned, and what the
     * household likes — so two tabs sharing one destination is now the oddity rather than the
     * economy. Five tabs, five routes.
     */
    const out = html(<TabBar current="today" />);
    expect(out).toContain('aria-label="Main"');
    expect((out.match(/href="\/today"/g) ?? []).length).toBe(1);
    expect((out.match(/href="\/recipes"/g) ?? []).length).toBe(1);
  });

  it("offers all five tabs", () => {
    const out = html(<TabBar current="week" />);
    for (const label of ["Today", "Week", "Recipes", "Shopping", "Household"]) {
      expect(out, label).toContain(label);
    }
  });
});

describe("headings and chips", () => {
  it("lets a heading's rank be set, because rank is structure and not size", () => {
    expect(html(<SectionHeader level={1}>Shopping</SectionHeader>)).toContain("<h1");
    expect(html(<SectionHeader>Ingredients</SectionHeader>)).toContain("<h2");
  });

  it("renders an eyebrow as a plain div, because it labels rows rather than opening a section", () => {
    const out = html(<Eyebrow>Dairy</Eyebrow>);
    expect(out).not.toMatch(/<h[1-6]/);
  });

  it("renders a chip as a span, so nothing looks tappable that is not", () => {
    const out = html(<Chip tone="clay">Tonight · planned</Chip>);
    expect(out).toContain("<span");
    expect(out).not.toContain("<button");
  });

  it("carries the tone in the class so the token pair decides the colours", () => {
    for (const tone of ["sage", "clay", "turmeric"] as const) {
      expect(html(<Chip tone={tone}>x</Chip>), tone).toContain(`is-${tone}`);
    }
  });
});

describe("the docked bar", () => {
  it("renders its children in order, secondary then primary", () => {
    const out = html(
      <DockedActionBar>
        <SecondaryButton>Add 7 to list</SecondaryButton>
        <PrimaryButton>Cook now</PrimaryButton>
      </DockedActionBar>,
    );
    expect(out.indexOf("Add 7 to list")).toBeLessThan(out.indexOf("Cook now"));
  });
});
