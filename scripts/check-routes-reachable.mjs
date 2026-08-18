#!/usr/bin/env node
/**
 * Every page must be linked from somewhere other than itself.
 *
 * Four features have now shipped unreachable — caption paste, the screenshot upload, the photo
 * control, and browse — and every one was found by a person going looking rather than by anything
 * automated. "The endpoint answers" and "the tests pass" were true each time.
 *
 * A route only its own page links to is the specific case this catches: browse had a "← Browse"
 * back-link inside itself, so a naive grep for the path found a hit and reported it reachable.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const APP = "apps/web/app";
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.tsx?$/.test(path)) files.push(path);
  }
})(APP);

const routeOf = (file) =>
  "/" + relative(APP, file).replace(/\/page\.tsx$/, "").replace(/^page\.tsx$/, "");

const pages = files.filter((f) => f.endsWith("/page.tsx") || f === join(APP, "page.tsx"));
const orphans = [];

for (const page of pages) {
  const route = routeOf(page).replace(/\/$/, "") || "/";
  // dynamic segments are reached by construction, and the root is the entry point
  if (route === "/" || route.includes("[")) continue;

  const linkedElsewhere = files.some(
    // only the page itself is excluded, not its directory: a sibling component rendered by
    // another page is a real way in, and excluding the folder would miss it
    (file) => file !== page &&
      new RegExp(`["\`]${route}(["\`?#]|$)`, "m").test(readFileSync(file, "utf8")),
  );
  if (!linkedElsewhere) orphans.push(route);
}

if (orphans.length > 0) {
  console.error("these routes are not linked from anywhere but themselves:");
  for (const route of orphans) console.error(`  ${route}`);
  console.error("\nA feature nobody can navigate to is not shipped. Link it, or delete it.");
  process.exit(1);
}

console.log(`every page route is linked from elsewhere (${pages.length} pages).`);
