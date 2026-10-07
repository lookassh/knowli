import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@learning/contracts", "@learning/server"],
  serverExternalPackages: ["pg"],
};

export default nextConfig;
