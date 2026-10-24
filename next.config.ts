import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Self-contained server for the Docker image (.next/standalone/server.js). Vercel ignores this.
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  // API routes read public/data/*.json from disk (src/lib/server/static-data.ts); ship them with the functions.
  outputFileTracingIncludes: { "/api/**": ["./public/data/**"] },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
