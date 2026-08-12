import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface LocalInstance {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * Connection details for the running local stack, or null if there isn't one.
 *
 * Null makes the isolation suite skip rather than fail. That is deliberate:
 * `pnpm check` has to pass on a machine with no Docker, and these particular
 * tests cannot be faked usefully. Row-level security is enforced by Postgres
 * against a real JWT — a mocked version would assert that our mock filters rows,
 * which proves nothing about whether another household's data is reachable.
 */
export function readLocalInstance(attempts = 3): LocalInstance | null {
  let raw = "";
  // `db reset` ends by restarting containers, so a suite started straight after it
  // asks a stack that is briefly gone. Without the retry the whole integration suite
  // skips itself and reports green having tested nothing — silence reading as success,
  // which is the same trap the mutation harness had.
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      raw = execFileSync("npx", ["supabase", "status", "-o", "json"], {
        cwd: packageRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 120_000,
      });
      break;
    } catch {
      if (attempt === attempts - 1) return null;
      // a container restart takes a few seconds; a genuinely absent stack fails all
      // three and still skips
      execFileSync("sleep", ["3"]);
    }
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
