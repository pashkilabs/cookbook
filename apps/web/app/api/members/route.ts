import { userClient } from "@/lib/supabase-server";
import { platformClient } from "@/lib/platform";

/**
 * The household's roster: add a child, rename one, change a colour, remove one.
 *
 * **Three verbs on one route rather than three route files.** Each route file is a serverless
 * function, and this project has already had a deployment refused outright for exceeding the
 * host's twelve-function limit (§37). The id travels in the body rather than the path, which is
 * the cost of that; it is a smaller cost than an app that will not deploy.
 *
 * Every write goes through `packages/platform-client`. `family_members` is a platform table with
 * no client write policy at all — the only writer is the service role behind the seam, and
 * `check-platform-tables.mjs` fails the build on a direct query. The seam resolves the household
 * from the signed-in account, so **there is no familyId in any request body** for a caller to
 * substitute.
 */
async function caller() {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  return platformClient(auth.user.id);
}

const refuse = (error: unknown) => {
  const message = error instanceof Error ? error.message : "that did not work";
  // the seam's refusals are written to be read by a person, and none of them name another
  // household's data — "no such member in this household" is the same answer for a member that
  // does not exist and one that is not theirs
  const status = /no family/.test(message) ? 403 : /no such member/.test(message) ? 404 : 400;
  return Response.json({ error: message }, { status });
};

export async function POST(request: Request) {
  const client = await caller();
  if (!client) return Response.json({ error: "sign in first" }, { status: 401 });

  let body: { displayName?: unknown; colour?: unknown; birthYear?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  try {
    const member = await client.addChild({
      displayName: typeof body.displayName === "string" ? body.displayName : "",
      ...(typeof body.colour === "string" ? { colour: body.colour } : {}),
      ...(birthYearFrom(body.birthYear) === undefined ? {} : { birthYear: birthYearFrom(body.birthYear) }),
    });
    return Response.json({ member });
  } catch (error) {
    return refuse(error);
  }
}

/**
 * A year, or nothing. Empty means "not answered" and clears it, which is a real answer —
 * a household may have recorded it and want it gone.
 *
 * The range mirrors the column's CHECK so a typo is refused here rather than as a 500 from
 * Postgres. 1900 catches a dropped digit; the upper bound is generous on purpose.
 */
function birthYearFrom(value: unknown): number | null | undefined {
  if (value === null || value === "") return null;
  const year = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return undefined;
  return year;
}

export async function PATCH(request: Request) {
  const client = await caller();
  if (!client) return Response.json({ error: "sign in first" }, { status: 401 });

  let body: { id?: unknown; displayName?: unknown; colour?: unknown; birthYear?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }
  if (typeof body.id !== "string") {
    return Response.json({ error: "which member?" }, { status: 400 });
  }

  try {
    const member = await client.updateMember(body.id, {
      ...(typeof body.displayName === "string" ? { displayName: body.displayName } : {}),
      ...(typeof body.colour === "string" ? { colour: body.colour } : {}),
      ...("birthYear" in body ? { birthYear: birthYearFrom(body.birthYear) ?? null } : {}),
    });
    return Response.json({ member });
  } catch (error) {
    return refuse(error);
  }
}

export async function DELETE(request: Request) {
  const client = await caller();
  if (!client) return Response.json({ error: "sign in first" }, { status: 401 });

  let body: { id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }
  if (typeof body.id !== "string") {
    return Response.json({ error: "which member?" }, { status: 400 });
  }

  try {
    await client.removeMember(body.id);
    return Response.json({ removed: body.id });
  } catch (error) {
    return refuse(error);
  }
}
