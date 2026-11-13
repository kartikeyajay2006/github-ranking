import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
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
