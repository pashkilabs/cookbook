/**
 * `run.ts` is the only file in this package that talks to a terminal. Declaring
 * the two globals it needs keeps `@types/node` out of `packages/core` — without
 * those types, an `import "node:fs"` anywhere in `src/` fails to typecheck,
 * which is a free guard on the rule that core stays pure.
 *
 * If `@types/node` is ever added here, delete this file; the declarations will
 * collide.
 */
declare const console: { log(...args: unknown[]): void };
declare const process: { exitCode: number };
