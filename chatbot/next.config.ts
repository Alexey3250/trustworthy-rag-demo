import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  // Ensure the structured corpus is bundled with the API serverless
  // functions on Vercel. Without this, only files imported via TS would
  // be traced and the runtime fs.readFile would 404.
  outputFileTracingIncludes: {
    "/api/**": ["./corpus/**"],
  },
};

export default nextConfig;
