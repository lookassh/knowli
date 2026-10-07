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
  return {
    llm: createOpenAiLlmProvider({ apiKey }),
    tts: createOpenAiTtsProvider({ apiKey }),
    image: createOpenAiImageProvider({ apiKey }),
    mediaStore,
  };
}
