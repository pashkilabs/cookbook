import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface LocalInstance {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

/**
 * Three outcomes, not two.
 *
 * `absent` and `unreachable` look identical to a test and mean opposite things. No stack
 * means these tests cannot run, and skipping is correct. A stack that is present but not
 * answering means the tests *should* have run and did not, and reporting that as a skip
 * is how an unusable run reads as a clean one.
 */
export type LocalStack =
  | { status: "ready"; instance: LocalInstance }
  | { status: "absent" }
  | { status: "unreachable"; detail: string };

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * How long a resolved answer is reused.
 *
 * Long enough to cover a whole suite run, short enough that the next one re-checks.
 * Containers do not restart mid-run, and `global-setup.ts` refreshes this before every
 * run, so a hit inside that window describes the stack the run started against.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;

const cachePath = join(tmpdir(), "pashki-local-stack.json");

let inProcess: LocalStack | null = null;

/**
 * Connection details for the running local stack.
 *
 * `supabase db reset` ends by restarting containers, so a suite started straight after it
 * asks a stack that is briefly gone — and every integration test in the repo hangs off
 * this function. It used to ask three times over nine seconds and then return null, which
 * skipped the entire integration suite and reported green having tested nothing.
 *
 * Three things had to change together, and getting one of them wrong first is
 * instructive: adding patience *per test file* made it far worse, because vitest isolates
 * modules per file, so nothing was shared and the wait multiplied by the number of files.
 *
 * 1. **Resolved once per run.** `global-setup.ts` does the waiting before any test file
 *    loads, and leaves the answer here. Files read it.
 * 2. **Patient enough.** Ninety seconds, because a restart under load regularly exceeds
 *    nine and the CLI reports failure the whole time it is happening.
 * 3. **Loud when it cannot measure.** A stack that is present but unreachable throws.
 *    Only a genuinely absent stack skips.
 *
 * A healthy container is also not a serving one, so global setup waits for the API to
 * answer rather than for the CLI to stop complaining. Signing in against a half-started
 * auth container is the failure that produces a session behaving as though it has no
 * household.
 */
export function discoverLocalStack(): LocalStack {
  if (inProcess) return inProcess;

  const cached = readCache();
  if (cached) {
    inProcess = cached;
    return cached;
  }

  // No global setup ran — someone invoked vitest directly. One unverified look at the CLI,
  // which is what this did before any of it waited for anything.
  const instance = readStatus();
  const fallback: LocalStack = instance
    ? { status: "ready", instance }
    : stackContainerExists()
      ? { status: "unreachable", detail: "no global setup ran and the CLI reported no API" }
      : { status: "absent" };
  inProcess = fallback;
  return fallback;
}

/**
 * Connection details, or null when there is genuinely no stack.
 *
 * **Throws** when a stack is present but never became reachable. `pnpm check` must pass
 * on a machine with no Docker, and must not pass on a machine where Docker is running
 * Supabase and the suite could not talk to it.
 */
export function readLocalInstance(): LocalInstance | null {
  const stack = discoverLocalStack();
  if (stack.status === "ready") return stack.instance;
  if (stack.status === "absent") return null;
  throw new Error(
    `A local Supabase stack is running but never became reachable ` +
      `(${stack.detail}). This is deliberately a failure ` +
      `rather than a skip: the tests that need it did not run, and skipping would ` +
      `report that as success. Wait for the stack to settle, or stop it to run the ` +
      `suite without them.`,
  );
}

export function writeCache(stack: LocalStack): void {
  try {
    // written via rename so a file reading it never sees a half-written one
    const scratch = mkdtempSync(join(tmpdir(), "pashki-stack-"));
    const temporary = join(scratch, "stack.json");
    writeFileSync(temporary, JSON.stringify({ at: Date.now(), stack }), "utf8");
    renameSync(temporary, cachePath);
  } catch {
    // a cache that cannot be written costs speed, not correctness
  }
}

function readCache(): LocalStack | null {
  try {
    const parsed = JSON.parse(readFileSync(cachePath, "utf8")) as {
      at?: number;
      stack?: LocalStack;
    };
    if (typeof parsed.at !== "number" || !parsed.stack) return null;
    if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed.stack;
  } catch {
    return null;
  }
}

export function readStatus(): LocalInstance | null {
  let raw: string;
  try {
    raw = execFileSync("npx", ["supabase", "status", "-o", "json"], {
      cwd: packageRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 120_000,
    });
  } catch {
    return null;
  }

  let status: Record<string, unknown>;
  try {
    status = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  const read = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = status[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
    return null;
  };

  // the CLI renamed these once already, so accept both spellings rather than
  // breaking on the next rename
  const url = read("API_URL");
  const anonKey = read("ANON_KEY", "PUBLISHABLE_KEY");
  const serviceRoleKey = read("SERVICE_ROLE_KEY", "SECRET_KEY");
  if (!url || !anonKey || !serviceRoleKey) return null;

  return { url, anonKey, serviceRoleKey };
}

/**
 * Is a stack present at all?
 *
 * Asked of Docker rather than of the CLI, because the CLI derives its project id from the
 * working directory and answers "not running" for a stack that is running under another
 * name. The question here is only whether these tests are measurable.
 */
export function stackContainerExists(): boolean {
  try {
    const names = execFileSync(
      "docker",
      ["ps", "--filter", "name=supabase_db_", "--format", "{{.Names}}"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000 },
    );
    return names.trim().length > 0;
  } catch {
    // no Docker, or no permission to ask it: nothing to measure
    return false;
  }
}
