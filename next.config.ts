import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["mupdf"],
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
