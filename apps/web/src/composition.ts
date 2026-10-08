import type { Pool } from "pg";
import {
  createDatabase,
  createLocalMediaStore,
  createServices,
  fakeSpeechDeps,
  mediaSettingsFromEnv,
  speechFromEnv,
  systemClock,
  type Services,
} from "@learning/server";

let current: { services: Services; pool: Pool } | undefined;

/** Złożenie zależności serwerowych dla web; singleton na czas życia procesu. */
export function getServerServices(): Services {
  current ??= initialize();
  return current.services;
}

function initialize(): { services: Services; pool: Pool } {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }
  const { db, pool } = createDatabase(databaseUrl);
  // tryb fake (E2E/smoke bez kluczy): odpowiedzi ustne przechodzą pełny cykl
  // na deterministycznych providerach zamiast kończyć się wynikiem technicznym
  const speech = speechFromEnv(process.env) ?? (process.env.UMIEM_FAKE_PROVIDERS === "1" ? fakeSpeechDeps() : undefined);
  return {
    services: createServices({
      db,
      clock: systemClock,
      media: mediaSettingsFromEnv(process.env),
      // web tylko wydaje gotowe zasoby (podgląd rodzica); generację wykonuje worker
      mediaStore: createLocalMediaStore(process.env.MEDIA_ROOT ?? "./data/media"),
      // ścieżka mowy to krótkie żądanie web → provider, bez kolejki (arch §11)
      ...(speech ? { speech } : {}),
    }),
    pool,
  };
}

/** Wyłącznie na potrzeby testów i graceful shutdown. */
export async function disposeServerServices(): Promise<void> {
  if (current) {
    await current.pool.end();
    current = undefined;
  }
}
