import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@learning/contracts", "@learning/server", "@learning/kid-ui"],
  serverExternalPackages: ["pg"],
};

export default nextConfig;
