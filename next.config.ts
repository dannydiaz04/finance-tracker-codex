import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  serverExternalPackages: ["@google-cloud/bigquery"],
};

export default nextConfig;
