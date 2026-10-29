import type { GenerationDeps } from "../config";
import { fakeGenerationDeps } from "./fake";
import { createLocalMediaStore } from "./media/local";
import { createOpenAiImageProvider } from "./images/openai";
import { createOpenAiLlmProvider } from "./openai/llm";
import { chatRequestExtrasFromEnv } from "./chat-request-options";
import { createOpenAiTtsProvider } from "./openai/tts";
import { lessonGenerationPolicyFromEnv } from "../modules/materials/lessons/lesson-generation-policy";

/** Opcjonalny provider obrazów dla procesu web; nie wymaga LLM ani TTS. */
export function imageProviderFromEnv(env: Record<string, string | undefined>) {
  if (env.UMIEM_FAKE_PROVIDERS === "1") return fakeGenerationDeps(createLocalMediaStore(env.MEDIA_ROOT ?? "./data/media")).image;
  const apiKey = env.OPENAI_API_KEY;
  return apiKey ? createOpenAiImageProvider({ apiKey }) : undefined;
}

/**
 * Składanie zależności generacji ze zmiennych środowiskowych (worker, E2E):
 * UMIEM_FAKE_PROVIDERS=1 wyłącza sieciowe adaptery; bez klucza API wynik jest
 * undefined i proces wykonawczy nie wystartuje. Nazwy providerów w env muszą
 * zgadzać się z faktycznymi adapterami, bo wchodzą do fingerprintów mediów.
 *
 * LLM (materiał: zestawy słówek i pule ćwiczeń lekcji) konfigurują opcjonalne,
 * niezależne `UMIEM_LLM_MODEL`/`UMIEM_LLM_BASE_URL`/`UMIEM_LLM_API_KEY` z
 * fallbackami do wartości domyślnych adaptera i `OPENAI_API_KEY` — wzorzec jak
 * przy `UMIEM_TTS_*`/`UMIEM_IMAGE_*`, bo LLM jest obowiązkową zależnością
 * workera (nie opcjonalnym feature'em jak grader). `OPENAI_API_KEY` pozostaje
 * wymagany, bo TTS i obrazy dalej używają tylko jego. Puste wartości traktowane
 * są jak nieustawione. BASE_URL dostaje klucz w nagłówku Authorization, więc
 * poza NODE_ENV test/development wymaga `https://` (jak UMIEM_GRADER_BASE_URL).
 */
export function createGenerationDepsFromEnv(env: Record<string, string | undefined>): GenerationDeps | undefined {
  const mediaRoot = env.MEDIA_ROOT ?? "./data/media";
  const mediaStore = createLocalMediaStore(mediaRoot);
  const lessonExecution = lessonGenerationPolicyFromEnv(env);
  if (env.UMIEM_FAKE_PROVIDERS === "1") {
    const delayMs = Number(env.UMIEM_FAKE_DELAY_MS ?? 0);
    const lessonDelayMs = Number(env.UMIEM_FAKE_LESSON_DELAY_MS ?? env.UMIEM_FAKE_DELAY_MS ?? 0);
    return {
      ...fakeGenerationDeps(mediaStore, {
        delayMs: Number.isFinite(delayMs) ? delayMs : 0,
        lessonDelayMs: Number.isFinite(lessonDelayMs) ? lessonDelayMs : 0,
      }),
      lessonExecution,
    };
  }
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    return undefined;
  }
  const llmBaseUrl = env.UMIEM_LLM_BASE_URL === "" ? undefined : env.UMIEM_LLM_BASE_URL;
  if (llmBaseUrl !== undefined) {
    const nodeEnv = env.NODE_ENV ?? "production";
    const insecureAllowed = nodeEnv === "test" || nodeEnv === "development";
    if (!llmBaseUrl.startsWith("https://") && !(insecureAllowed && llmBaseUrl.startsWith("http://"))) {
      throw new Error("UMIEM_LLM_BASE_URL must use https:// outside test/development");
    }
  }
  return {
    llm: createOpenAiLlmProvider({
      apiKey: (env.UMIEM_LLM_API_KEY === "" ? undefined : env.UMIEM_LLM_API_KEY) ?? apiKey,
      model: env.UMIEM_LLM_MODEL === "" ? undefined : env.UMIEM_LLM_MODEL,
      baseUrl: llmBaseUrl,
      lessonRequestTimeoutMs: lessonExecution.requestTimeoutMs,
      requestExtras: chatRequestExtrasFromEnv(env, "UMIEM_LLM"),
    }),
    tts: createOpenAiTtsProvider({ apiKey }),
    image: createOpenAiImageProvider({ apiKey }),
    mediaStore,
    lessonExecution,
  };
}
