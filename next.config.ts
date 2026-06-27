import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  serverExternalPackages: ["@dataform/cli", "@google-cloud/bigquery"],
};

export default nextConfig;
