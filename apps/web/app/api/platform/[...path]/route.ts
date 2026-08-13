import { platformRouter } from "@/lib/platform";
import { toFetchHandler } from "@pashki/platform-client";

/**
 * The seam's HTTP surface, mounted. That is all this file does.
 *
 * `createPlatformRouter` already decides the routes, the status codes, that authentication
 * happens before route matching, and — the property worth protecting — that the account is
 * resolved from the bearer token and from no parameter anywhere. `toFetchHandler` adapts it
 * to the Fetch API that Next.js speaks. Writing Next-shaped handlers instead would be a
 * second implementation of the one thing that must not be got wrong twice.
 *
 * Phase 3's Expo app calls these same routes, which is why the router was built
 * framework-agnostic before anything consumed it.
 *
 * **Built per request, not at module scope.** Next evaluates every route module while
 * collecting page data during a build, so a router constructed at import time made the *build*
 * require a service-role key — and a build that needs production secrets fails on any host that
 * does not hand them to it. `lib/platform.ts` already gives the same reasoning for the client
 * itself: something captured at import time outlives the environment it read its key from.
 */
const mount = (request: Request) =>
  toFetchHandler(platformRouter(), { basePath: "/api/platform" })(request);

export const GET = mount;
export const POST = mount;
