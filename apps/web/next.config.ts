import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@learning/contracts", "@learning/server", "@learning/kid-ui"],
  experimental: {
    optimizePackageImports: ["@mantine/core", "@mantine/hooks"],
  },
  serverExternalPackages: ["pg"],
  // tylko `next dev`: E2E (UMIEM_E2E_WEB_MODE=dev) otwiera aplikację pod
  // 127.0.0.1, a Next 16 domyślnie przepuszcza do /_next/* (w tym HMR)
  // wyłącznie localhost — bez tego strona się nie hydratuje i testy wiszą
  allowedDevOrigins: ["127.0.0.1"],
  // samodzielny serwer (standalone) tylko w obrazie produkcyjnym — Dockerfile
  // ustawia NEXT_STANDALONE=1; lokalny build na Windows nie może tworzyć
  // symlinków, których wymaga pakowanie standalone
  ...(process.env.NEXT_STANDALONE === "1" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
