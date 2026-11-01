import type { NextConfig } from "next";

// Serwer stawiany przez testy E2E (tests/e2e/global-setup.ts ustawia UMIEM_E2E=1).
const e2e = process.env.UMIEM_E2E === "1";

const nextConfig: NextConfig = {
  transpilePackages: ["@learning/contracts", "@learning/server", "@learning/kid-ui"],
  experimental: {
    optimizePackageImports: ["@mantine/core", "@mantine/hooks"],
    // tylko `next dev` pod E2E: bez trwałej pamięci podręcznej Turbopacka
    // (.next/dev). Jej uszkodzony stan po wcześniejszych przebiegach dawał pętlę
    // „Compiled” → przeładowanie strony przy każdym wejściu i testy padały na
    // nawigacji; po usunięciu katalogu znikała. Kompilacja tras na żądanie i tak
    // trwa w E2E chwilę.
    ...(e2e ? { turbopackFileSystemCacheForDev: false } : {}),
  },
  serverExternalPackages: ["pg"],
  // tylko `next dev`: E2E (UMIEM_E2E_WEB_MODE=dev) otwiera aplikację pod
  // 127.0.0.1, a Next 16 domyślnie przepuszcza do /_next/* (w tym HMR)
  // wyłącznie localhost — bez tego strona się nie hydratuje i testy wiszą
  allowedDevOrigins: ["127.0.0.1"],
  // tylko `next dev` pod E2E: pływający wskaźnik deweloperski w lewym dolnym
  // rogu zasłaniał przyciski przy szerokości telefonu i przechwytywał kliknięcia
  ...(e2e ? { devIndicators: false as const } : {}),
  // samodzielny serwer (standalone) tylko w obrazie produkcyjnym — Dockerfile
  // ustawia NEXT_STANDALONE=1; lokalny build na Windows nie może tworzyć
  // symlinków, których wymaga pakowanie standalone
  ...(process.env.NEXT_STANDALONE === "1" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
