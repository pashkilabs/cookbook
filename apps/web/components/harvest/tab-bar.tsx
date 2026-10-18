import Link from "next/link";

/**
 * The five tabs, docked (§3, §4).
 *
 * **"Today" points at `/recipes`.** That screen already answers the question — the Tonight banner
 * is the first thing on it — so a sixth route would be a second door onto the same shelf, which is
 * what `/recipes/browse` was deleted for.
 *
 * `aria-current="page"` rather than colour alone: the active tab is terracotta at 2.2 stroke and
 * the rest are loam at 1.8, and a difference that is only colour and line weight is not a
 * difference to anybody who cannot see it.
 *
 * Icons are inline rather than a sprite or a library. Five line icons at 24px is less markup than
 * the loader for them, and the CDN allow-list this project runs under would refuse an icon package
 * anyway.
 */
export type TabKey = "today" | "week" | "recipes" | "shopping" | "household";

const TABS: ReadonlyArray<{ key: TabKey; label: string; href: string }> = [
  // Today and Recipes are the same screen; the key differs so the caller can say which it is
  { key: "today", label: "Today", href: "/today" },
  { key: "week", label: "Week", href: "/planner" },
  { key: "recipes", label: "Recipes", href: "/recipes" },
  { key: "shopping", label: "Shopping", href: "/shopping" },
  { key: "household", label: "Household", href: "/household" },
];

function Icon({ tab }: { tab: TabKey }) {
  const common = {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (tab) {
    case "today":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      );
    case "week":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="16" rx="3" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      );
    case "recipes":
      return (
        <svg {...common}>
          <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
          <path d="M5 17a3 3 0 0 1 3-3h11" />
        </svg>
      );
    case "shopping":
      return (
        <svg {...common}>
          <path d="M3 9h18l-2 11H5z" />
          <path d="M8 9l4-6 4 6" />
        </svg>
      );
    case "household":
      return (
        <svg {...common}>
          <path d="M3 11l9-7 9 7" />
          <path d="M5 10v10h14V10" />
        </svg>
      );
  }
}

export function TabBar({ current }: { current: TabKey }) {
  return (
    <nav aria-label="Main" className="h-tabbar">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={tab.key === current ? "is-current" : ""}
          {...(tab.key === current ? { "aria-current": "page" as const } : {})}
        >
          <Icon tab={tab.key} />
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
