/**
 * `transpilePackages` because the workspace packages ship TypeScript source rather than
 * build output — one fewer build step across the monorepo, and Next compiles them with
 * the app.
 *
 * `extensionAlias` because those sources import each other with `.js` specifiers, which is
 * what TypeScript's NodeNext resolution requires and what lets the same files run under
 * `tsx`, Vitest and Node without a build. Webpack takes the specifier literally and looks
 * for a `.js` file that was never written, so it needs telling that `./client.js` means
 * `./client.ts`.
 *
 * `serverExternalPackages` for **sharp**, which is a native Node addon. `transpilePackages`
 * makes webpack walk into `@pashki/import`, and walking into it means trying to bundle sharp's
 * `.node` binaries — which cannot be bundled. Locally that survives, because the darwin binary is
 * sitting in `node_modules` for Node to find anyway; on Vercel's linux runtime the module fails to
 * load and **every route that imports it, however indirectly, returns 500**.
 *
 * That is how it was found: five routes that transitively reached sharp returned 500 on the
 * deployed app while three that did not returned 401. A route asking for a bucket *name* was among
 * the five, which is why the constant moved out of that module as well — see
 * `@pashki/import/photo-bucket`.
 */
/** @type {import('next').NextConfig} */
export default {
  serverExternalPackages: ["sharp"],
  transpilePackages: ["@pashki/platform-client", "@pashki/core", "@pashki/db", "@pashki/import"],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};
