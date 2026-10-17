import type { Metadata } from "next";
import { Fraunces, Nunito_Sans } from "next/font/google";
import "./tokens.generated.css";
import "./globals.css";

/*
 * Webfonts, and this is a **reversal** of a recorded decision rather than a gap.
 *
 * `globals.css` chose system stacks for a stated reason: "no webfont to load, no layout shift, and
 * no external request from a page that is otherwise entirely first-party." Harvest names Fraunces
 * and Nunito Sans, and the identity rests on them.
 *
 * `next/font/google` self-hosts the files at build time, so **the external request the original
 * decision was about is gone** — nothing is fetched from Google at runtime, and `display: swap`
 * plus the generated fallback metrics keep the layout shift near zero. The remaining cost is
 * weight, and that is the price of the change rather than an oversight in it.
 *
 * Only the weights the tokens actually name: Fraunces 600, Nunito Sans 400/600/700. A fourth
 * weight nobody uses is bytes every household pays for.
 */
const display = Fraunces({
  subsets: ["latin"],
  weight: ["600"],
  variable: "--font-display-loaded",
  display: "swap",
});

const body = Nunito_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-body-loaded",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pashki Recipes",
  description: "Capture recipes from anywhere, plan a week, shop once.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
