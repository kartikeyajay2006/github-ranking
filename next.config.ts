import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for the Docker image (node .next/standalone/server.js).
  output: "standalone",
  poweredByHeader: false,
  experimental: {
    // Application documents (PDF, Word, Excel) are uploaded through a server action.
    serverActions: { bodySizeLimit: "26mb" },
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "avatars.githubusercontent.com" }],
  },
};

export default config;
