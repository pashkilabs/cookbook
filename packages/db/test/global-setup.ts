import {
  readStatus,
  stackContainerExists,
  writeCache,
  type LocalInstance,
  type LocalStack,
} from "./local-instance.js";

/** Patience for a stack that exists but is still coming up, in seconds. */
const READY_TIMEOUT_SECONDS = 90;

/**
 * Wait for the local stack once, before any test file loads.
 *
 * This is the piece that makes patience affordable. Vitest isolates modules per test file,
 * so anything a test file memoises is memoised for that file alone — waiting there
 * multiplies the wait by the number of files, which is how a nine-second retry turned into
 * a ten-minute hang on the first attempt at this fix. Global setup runs once per run, in
 * the main process, and leaves the answer where every file can read it.
 *
 * Registered by `packages/db`, `packages/platform-client` and `packages/import`, because
 * all three have suites that talk to the real database.
 *
 * A stack that is present but unreachable fails **here**, before a single test runs, with
 * one clear message — rather than a scatter of connection errors, or worse, a suite that
 * quietly skips its integration tests and reports green.
 */
export async function setup(): Promise<void> {
  const stack = await resolveStack();
  writeCache(stack);

  if (stack.status === "unreachable") {
    throw new Error(
      `A local Supabase stack is running but never became reachable within ` +
        `${READY_TIMEOUT_SECONDS}s (${stack.detail}). Refusing to run: the integration ` +
        `tests would skip themselves and the run would look clean. Wait for the stack to ` +
        `settle, or stop it to run without them.`,
    );
  }

  if (stack.status === "absent") {
    // said out loud, because "no integration tests ran" is worth knowing about a green run
    console.info(
      "[pashki] no local Supabase stack — integration tests will skip. Run `pnpm --filter @pashki/db db:start` for the full suite.",
    );
  }
}

async function resolveStack(): Promise<LocalStack> {
  const deadline = Date.now() + READY_TIMEOUT_SECONDS * 1000;
  let detail = "no attempt completed";

  for (;;) {
    const instance = readStatus();
    if (instance) {
      const notServing = await unreachableBecause(instance);
      if (!notServing) return { status: "ready", instance };
      detail = notServing;
    } else {
      detail = "supabase status did not report a usable API";
      // Nothing running and nothing on the way up: skip now rather than making a machine
      // without Docker wait a minute and a half to find that out.
      if (!stackContainerExists()) return { status: "absent" };
    }

    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  // A container exists, so this was measurable and was not measured.
  return stackContainerExists() ? { status: "unreachable", detail } : { status: "absent" };
}

/**
 * Null when the API answers, otherwise why it did not.
 *
 * Both services, because they fail independently: PostgREST can be serving while GoTrue is
 * still starting, and a sign-in against a half-started GoTrue is what produced a session
 * that behaved as though it belonged to no household.
 *
 * A 4xx counts as reachable — the service is up and dislikes the request. Only a 5xx or a
 * refused connection means it is not there yet.
 */
async function unreachableBecause(instance: LocalInstance): Promise<string | null> {
  const auth = { apikey: instance.anonKey, Authorization: `Bearer ${instance.anonKey}` };
  for (const [path, headers] of [
    ["/auth/v1/health", {}],
    ["/rest/v1/", auth],
  ] as const) {
    try {
      const response = await fetch(`${instance.url}${path}`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      if (response.status >= 500) return `${path} answered ${response.status}`;
    } catch (error) {
      return `${path}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return null;
}
