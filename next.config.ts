import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone with only the files and node_modules actually reached, which is
  // what keeps the container image small enough to redeploy quickly.
  output: "standalone",

  // playwright-core must stay a real require, not something the bundler rewrites: it loads
  // its own driver by path at runtime.
  serverExternalPackages: ["playwright-core"],

  // Tracing follows `require` calls, so it takes playwright-core's JS and leaves the data
  // files behind — and the package reads browsers.json on import. The result is a container
  // that boots fine and then dies on the first heal with MODULE_NOT_FOUND. Ship the package
  // whole instead.
  outputFileTracingIncludes: {
    "/api/inngest": ["./node_modules/playwright-core/**"],
  },
};

export default nextConfig;
