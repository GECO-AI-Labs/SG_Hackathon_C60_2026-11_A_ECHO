import type { NextConfig } from "next";

// Every ECHO page is per-user and reads live data, so Next's static caching
// features (cacheComponents, partial prefetching) are off to keep things simple.
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  experimental: {
    serverActions: { bodySizeLimit: "12mb" }, // library uploads up to 10 MB
  },
};

export default nextConfig;
