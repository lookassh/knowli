import type { Database } from "./db/client";
import type {
  ImageProvider,
  LlmProvider,
  PronunciationProvider,
  SttProvider,
  TtsProvider,
} from "./ports/ai";
import type { MediaStore } from "./ports/media";
import { createAzurePronunciationProvider } from "./providers/azure/pronunciation";
import { createAzureSttProvider } from "./providers/azure/stt";
import { createProductionSubjectRegistry } from "./domain/lessons/subjects";
import type { SubjectRegistry } from "./domain/lessons/registry";

/** Zegar jako zależność — domena i moduły nie wołają Date.now() bezpośrednio. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/**
 * Tożsamość ustawień medialnych używana w fingerprintach. Samo nazewnictwo
 * providerów/modeli nie jest sekretem; klucze API żyją w adapterach.
 */
export interface MediaSettings {
  tts: { provider: string; model: string; voice: string; format: "mp3" };
  image: { provider: string; model: string; size: string; quality: string; format: string };
}

/** Domyślnie low+webp: karty dziecka wyświetlają obraz ~300 px, high/png
 *  kosztowało ~0,17 USD/szt. (pełny zestaw ~5 USD) przy znikomej korzyści. */
export const defaultMediaSettings: MediaSettings = {
  tts: { provider: "openai", model: "gpt-4o-mini-tts", voice: "alloy", format: "mp3" },
  image: { provider: "openai", model: "gpt-image-1", size: "1024x1024", quality: "low", format: "webp" },
};

/** Nadpisywalne zmiennymi środowiskowymi (nazwy, nie sekrety). */
export function mediaSettingsFromEnv(env: Record<string, string | undefined>): MediaSettings {
  return {
    tts: {
      provider: env.UMIEM_TTS_PROVIDER ?? defaultMediaSettings.tts.provider,
      model: env.UMIEM_TTS_MODEL ?? defaultMediaSettings.tts.model,
      voice: env.UMIEM_TTS_VOICE ?? defaultMediaSettings.tts.voice,
      format: "mp3",
    },
    image: {
      provider: env.UMIEM_IMAGE_PROVIDER ?? defaultMediaSettings.image.provider,
      model: env.UMIEM_IMAGE_MODEL ?? defaultMediaSettings.image.model,
      size: env.UMIEM_IMAGE_SIZE ?? defaultMediaSettings.image.size,
      quality: env.UMIEM_IMAGE_QUALITY ?? defaultMediaSettings.image.quality,
      format: env.UMIEM_IMAGE_FORMAT ?? defaultMediaSettings.image.format,
    },
  };
}

/** Zależności wykonywania generacji: tylko worker (i testy) je posiadają. */
export interface GenerationDeps {
  llm: LlmProvider;
  tts: TtsProvider;
  image: ImageProvider;
  mediaStore: MediaStore;
}

/**
 * Zależności ścieżki mowy (arch §11): krótkie żądanie web → provider, bez
 * kolejki i bez trwałego audio. `analysisTimeoutMs` pozwala testom skrócić
 * 30-sekundowy deadline produkcyjny.
 */
export interface SpeechDeps {
  stt: SttProvider;
  pronunciation: PronunciationProvider;
  analysisTimeoutMs?: number;
}

/**
 * Zależności serwowe przekazywane do przypadków użycia. `media` pozwala webowi
 * uzgadniać zasoby w transakcji edycji; `generation` wykonuje pracę w tle;
 * `mediaStore` służy webowi do wydawania gotowych zasobów (podgląd rodzica);
 * `speech` obsługuje odpowiedzi ustne dziecka.
 */
export interface Services {
  db: Database;
  clock: Clock;
  media?: MediaSettings;
  generation?: GenerationDeps;
  mediaStore?: MediaStore;
  speech?: SpeechDeps;
  /**
   * Rejestr przedmiotów lekcji (zadanie 9). Wstrzykiwany jako wartość, nie
   * importowany globalnie w modułach — `createServices` nadaje mu produkcyjną
   * domyślkę `createProductionSubjectRegistry()`, więc żaden wywołujący nie
   * musi go dostarczać, a testy mogą podmienić rejestr. Czysta, deterministyczna
   * zależność bez env/sekretów, więc zawsze obecna (inaczej niż media/speech).
   */
  subjects: SubjectRegistry;
}

export function createServices(
  input: {
    db: Database;
    clock?: Clock;
    media?: MediaSettings;
    generation?: GenerationDeps;
    mediaStore?: MediaStore;
    speech?: SpeechDeps;
    subjects?: SubjectRegistry;
  },
): Services {
  return {
    db: input.db,
    clock: input.clock ?? systemClock,
    subjects: input.subjects ?? createProductionSubjectRegistry(),
    ...(input.media ? { media: input.media } : {}),
    ...(input.generation ? { generation: input.generation } : {}),
    ...(input.mediaStore ? { mediaStore: input.mediaStore } : {}),
    ...(input.speech ? { speech: input.speech } : {}),
  };
}

/**
 * Providerzy mowy ze zmiennych środowiskowych. Azure jest pierwszym kandydatem
 * (arch §11); bez kluczy zależność pozostaje nieobecna i próby ustne kończą
 * się wynikiem technicznym zamiast udawanej oceny.
 */
export function speechFromEnv(env: Record<string, string | undefined>): SpeechDeps | undefined {
  const subscriptionKey = env.AZURE_SPEECH_KEY;
  const region = env.AZURE_SPEECH_REGION;
  if (!subscriptionKey || !region) {
    return undefined;
  }
  return {
    stt: createAzureSttProvider({ subscriptionKey, region }),
    pronunciation: createAzurePronunciationProvider({ subscriptionKey, region }),
  };
}
