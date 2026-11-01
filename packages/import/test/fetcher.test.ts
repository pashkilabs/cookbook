import { afterAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { createHttpFetcher } from "../src/fetcher.js";

/**
 * The one module here that touches the network, and until now the only one with no test.
 *
 * That is not an oversight to tidy away — it is why the redirect hole lived: `redirect: "follow"`
 * is a single word, it is obviously correct for reaching a page, and nothing anywhere asked what
 * it reached. Android's share sheet makes wrappers the normal way a phone user sends themselves a
 * recipe, so following redirects went from incidental to load-bearing, and a load-bearing line
 * needs a test more than a convenient one does.
 *
 * Real servers on loopback rather than a stubbed `fetch`: the thing under test is what the
 * platform does with a `Location` header, and a stub would assert my model of that instead of it.
 * No outbound network, so this runs in CI.
 */
const servers: Server[] = [];

async function serve(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return `http://127.0.0.1:${port}`;
}

afterAll(() => {
  for (const server of servers) server.close();
});

const PAGE = "<html><head><title>a recipe</title></head><body>hello</body></html>";

/**
 * The tests about *following* a chain, and only those, permit loopback.
 *
 * Every server here is on `127.0.0.1`, which the shipped predicate refuses — correctly, and that
 * is what the two refusal tests below assert, constructing the fetcher with **no options** so they
 * exercise the real thing. Keeping the two groups apart is the point: if this constant appeared in
 * the refusal tests they would pass against a fetcher with no guard at all.
 */
const FOLLOWS_LOOPBACK = { timeoutMs: 5_000, refuseRedirectTo: () => false };

describe("the http fetcher follows a wrapper to the page", () => {
  it("reports the destination as the final URL, not the link that was asked for", async () => {
    const page = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(PAGE);
    });
    const wrapper = await serve((_req, res) => {
      res.writeHead(302, { location: `${page}/instant-pot-carrot-soup/` });
      res.end();
    });

    const fetched = await createHttpFetcher(FOLLOWS_LOOPBACK).page(`${wrapper}/CB96RGAg`);
    expect(fetched.finalUrl).toBe(`${page}/instant-pot-carrot-soup/`);
    expect(fetched.html).toContain("a recipe");
  });

  it("resolves a relative Location against the hop that sent it", async () => {
    const host = await serve((req, res) => {
      if (req.url === "/short") {
        // legal, and common on the sites that redirect to a canonical path
        res.writeHead(301, { location: "/the/real/page" });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end(PAGE);
    });

    const fetched = await createHttpFetcher(FOLLOWS_LOOPBACK).page(`${host}/short`);
    expect(fetched.finalUrl).toBe(`${host}/the/real/page`);
  });
});

describe("the http fetcher checks every hop, not just the one it was given", () => {
  it("refuses a redirect to a private address, naming the host", async () => {
    // regression: normaliseUrl refused 127.0.0.1 as input and `redirect: "follow"` reached it
    // through one hop anyway, returning the body — which is readable from import_jobs.result_json
    const internal = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body>INTERNAL ONLY</body></html>");
    });
    const wrapper = await serve((_req, res) => {
      res.writeHead(302, { location: `${internal}/latest/meta-data/` });
      res.end();
    });

    await expect(createHttpFetcher({ timeoutMs: 5_000 }).page(`${wrapper}/x`)).rejects.toThrow(
      /private address \(127\.0\.0\.1\)/,
    );
  });

  it("refuses a redirect to a scheme that is not http", async () => {
    const wrapper = await serve((_req, res) => {
      res.writeHead(302, { location: "file:///etc/passwd" });
      res.end();
    });

    await expect(createHttpFetcher({ timeoutMs: 5_000 }).page(`${wrapper}/x`)).rejects.toThrow(
      /unsupported scheme file:/,
    );
  });

  it("gives up on a loop rather than following it to the platform's limit", async () => {
    const host = await serve((req, res) => {
      res.writeHead(302, { location: `${req.url}x` });
      res.end();
    });

    await expect(
      createHttpFetcher({ ...FOLLOWS_LOOPBACK, maxRedirects: 3 }).page(`${host}/a`),
    ).rejects.toThrow(/more than 3 redirects/);
  });

  it("says how many redirects preceded a failure, so a chain is diagnosable", async () => {
    const dead = await serve((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    const wrapper = await serve((_req, res) => {
      res.writeHead(302, { location: `${dead}/gone` });
      res.end();
    });

    await expect(createHttpFetcher(FOLLOWS_LOOPBACK).page(`${wrapper}/x`)).rejects.toThrow(
      /HTTP 404 for .*\/gone \(via 1 redirect\)/,
    );
  });
});
