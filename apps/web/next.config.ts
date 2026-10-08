import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@learning/contracts", "@learning/server", "@learning/kid-ui"],
  serverExternalPackages: ["pg"],
  // samodzielny serwer (standalone) tylko w obrazie produkcyjnym — Dockerfile
  // ustawia NEXT_STANDALONE=1; lokalny build na Windows nie może tworzyć
  // symlinków, których wymaga pakowanie standalone
  ...(process.env.NEXT_STANDALONE === "1" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
