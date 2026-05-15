import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output bundles everything needed to run the app in a container
  // without node_modules — required for the Cloud Run Dockerfile.
  output: "standalone",

  // Silence the Turbopack workspace-root warning in Cloud Run where
  // there is no monorepo root package-lock.json.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
