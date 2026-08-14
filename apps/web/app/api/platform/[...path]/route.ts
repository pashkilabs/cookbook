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
/**
 * A misconfigured seam says so, rather than returning 500 forever.
 *
 * `platformRouter()` builds the token signer, which parses `PASHKI_TOKEN_PRIVATE_KEY` as a PEM.
 * A key pasted with literal `\n` — which is how it is stored in `.env.local`, because dotenv
 * expands those and Vercel does not — makes `createPrivateKey` throw, and every route under
 * `/api/platform` answered 500 with a stock error page. It was invisible for days because
 * nothing else uses the signer: provisioning goes through the store, so a household could be
 * created on a deployment whose seam was entirely dead.
 *
 * 503 and a sentence is not a fix, but it is the difference between a misconfiguration you can
 * read and one you have to bisect. The message never contains key material — `createPrivateKey`
 * reports the parse failure, not the input.
 */
const mount = async (request: Request) => {
  let handler;
  try {
    handler = toFetchHandler(platformRouter(), { basePath: "/api/platform" });
  } catch (thrown) {
    const detail = thrown instanceof Error ? thrown.message : String(thrown);
    console.error(`[pashki] the platform seam could not start: ${detail}`);
    return Response.json(
      {
        error: {
          code: "seam-misconfigured",
          message:
            "The platform seam is not configured on this deployment. Check PASHKI_TOKEN_KEY_ID " +
            "and PASHKI_TOKEN_PRIVATE_KEY — the key must be a real multi-line PEM, not one with " +
            "literal \\n escapes.",
        },
      },
      { status: 503 },
    );
  }
  return handler(request);
};

export const GET = mount;
export const POST = mount;
