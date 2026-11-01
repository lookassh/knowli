import {
  createDatabase,
  createGenerationDepsFromEnv,
  createServices,
  mediaSettingsFromEnv,
  type Services,
  withConfigDefaults,
} from "@learning/server";

type WorkerPool = ReturnType<typeof createDatabase>["pool"];

/**
 * Składanie zależności workera: baza + adaptery providerów wg env
 * (UMIEM_FAKE_PROVIDERS=1 dla środowisk bez kluczy) i lokalny wolumen mediów.
 */
export function buildWorkerServices(): { services: Services; pool: WorkerPool } {
  // domyślna konfiguracja z repo pod spodem, .env nadpisuje (config-defaults.ts)
  const env = withConfigDefaults(process.env);
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }
  const generation = createGenerationDepsFromEnv(env);
  if (!generation) {
    throw new Error("OPENAI_API_KEY is not configured (obrazy; LLM i TTS biorą OPENROUTER_API_KEY) — albo ustaw UMIEM_FAKE_PROVIDERS=1");
  }
  const { db, pool } = createDatabase(databaseUrl);
  const services = createServices({
    db,
    media: mediaSettingsFromEnv(env),
    generation,
  });
  return { services, pool };
}
