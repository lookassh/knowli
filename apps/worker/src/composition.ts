import {
  createDatabase,
  createLocalMediaStore,
  createOpenAiImageProvider,
  createOpenAiLlmProvider,
  createOpenAiTtsProvider,
  createServices,
  mediaSettingsFromEnv,
  type Services,
} from "@learning/server";

type WorkerPool = ReturnType<typeof createDatabase>["pool"];

/** Składanie zależności workera: baza, adaptery OpenAI i lokalny wolumen mediów. */
export function buildWorkerServices(): { services: Services; pool: WorkerPool } {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  const { db, pool } = createDatabase(databaseUrl);
  const services = createServices({
    db,
    media: mediaSettingsFromEnv(process.env),
    generation: {
      llm: createOpenAiLlmProvider({ apiKey }),
      tts: createOpenAiTtsProvider({ apiKey }),
      image: createOpenAiImageProvider({ apiKey }),
      mediaStore: createLocalMediaStore(process.env.MEDIA_ROOT ?? "./data/media"),
    },
  });
  return { services, pool };
}
