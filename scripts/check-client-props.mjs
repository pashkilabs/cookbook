#!/usr/bin/env node
/**
 * A client component's props must be data. A function crossing that boundary is a runtime 500.
 *
 * "Functions cannot be passed directly to Client Components unless you explicitly expose it by
 * marking it with 'use server'." It is **not a type error**, so `tsc` passes and `pnpm check`
 * goes green — and the page 500s for every household the moment somebody opens it. The planner
 * shipped that way and `pnpm smoke` did not catch it, because smoke calls routes and this is a
 * render.
 *
 * It happened twice in one day: `continueTo` in the blend picker, caught before shipping, with a
 * comment written next to it saying a function cannot cross the boundary — and then `membersFor`
 * on the planner, which shipped. Knowing the rule did not stop the repeat, so the rule becomes a
 * check.
 *
 * **What it looks for:** a prop type in a `"use client"` file whose annotation is a function
 * type — `(x: T) => U`. Event handlers are exempt: React's own `onClick`-shaped props are
 * functions the framework owns, and they are declared as `() => void` on an intrinsic element
 * rather than on a component's own prop object.
 *
 * Deliberately narrow. It reads prop-type annotations, not call sites, so it cannot see a
 * function smuggled inside an object. That is a real limit, and the failure it does catch is the
 * one that has actually happened twice.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "apps/web";

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name === ".next") return [];
    return statSync(path).isDirectory() ? walk(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

/** an `onThing` prop is a callback the client owns and never crosses from a server component */
const isHandler = (name) => /^on[A-Z]/.test(name);

const offenders = [];

for (const path of walk(ROOT)) {
  const source = readFileSync(path, "utf8");
  if (!source.includes('"use client"')) continue;

  /*
   * Prop declarations look like `name: (args) => Return;` inside a props object. Matched line by
   * line so a multi-line function type is missed rather than mis-reported — a false negative
   * here costs a 500 that the next run catches; a false positive costs trust in the check.
   */
  source.split("\n").forEach((line, index) => {
    const match = /^\s{2,}(\w+)(\??):\s*\(([^)]*)\)\s*=>/.exec(line);
    if (!match) return;
    const [, name] = match;
    if (isHandler(name)) return;
    // a bare `() => void` with no arguments is almost always a handler by another name
    if (match[3].trim() === "" && /=>\s*void/.test(line)) return;
    offenders.push({ path, name, line: index + 1, text: line.trim() });
  });
}

if (offenders.length > 0) {
  console.error("a client component declares a function prop, which cannot cross from a server component:");
  for (const o of offenders) console.error(`  ${o.path}:${o.line}  ${o.name}  — ${o.text}`);
  console.error("\nPass data instead — a plain object, an array, a string. React refuses a");
  console.error("function at runtime, not at compile time, so this is a 500 with a green build.");
  console.error("If it really is a client-side callback, name it onSomething.");
  process.exit(1);
}

console.log(`client components pass data, not functions (${ROOT}).`);
