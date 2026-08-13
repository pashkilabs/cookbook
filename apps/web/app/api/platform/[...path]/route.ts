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
 */
const handler = toFetchHandler(platformRouter(), { basePath: "/api/platform" });

export const GET = handler;
export const POST = handler;
