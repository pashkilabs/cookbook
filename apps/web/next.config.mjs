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
 */
/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ["@pashki/platform-client", "@pashki/core"],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};
