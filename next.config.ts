import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for the Docker image only (node .next/standalone/server.js); local `npm start` uses next start.
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
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
