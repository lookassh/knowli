import type { GenerationDeps } from "../config";
import { fakeGenerationDeps } from "./fake";
import { createLocalMediaStore } from "./media/local";
import { createOpenAiImageProvider } from "./images/openai";
import { createOpenAiLlmProvider } from "./openai/llm";
import { createOpenAiTtsProvider } from "./openai/tts";

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
  if (env.UMIEM_FAKE_PROVIDERS === "1") {
    const delayMs = Number(env.UMIEM_FAKE_DELAY_MS ?? 0);
    return fakeGenerationDeps(mediaStore, { delayMs: Number.isFinite(delayMs) ? delayMs : 0 });
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
    }),
    tts: createOpenAiTtsProvider({ apiKey }),
    image: createOpenAiImageProvider({ apiKey }),
    mediaStore,
  };
}
