import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // OpenNext's uncached static shell avoids Cache Components hanging in workerd.
  cacheComponents: process.env.DRAWCOVER_CLOUDFLARE_BUILD !== "true",
  partialPrefetching: process.env.DRAWCOVER_CLOUDFLARE_BUILD !== "true",
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
