import type { Database } from "./db/client";
import type {
  AnswerGraderProvider,
  ImageProvider,
  LlmProvider,
  PronunciationProvider,
  SttProvider,
  TtsProvider,
} from "./ports/ai";
import type { MediaStore } from "./ports/media";
import { createAzurePronunciationProvider } from "./providers/azure/pronunciation";
import { createAzureSttProvider } from "./providers/azure/stt";
import { createOpenAiCompatibleGrader } from "./providers/openai-compatible/grader";
import { createProductionSubjectRegistry } from "./domain/lessons/subjects";
import type { SubjectRegistry } from "./domain/lessons/registry";
import type { LessonGenerationPolicy } from "./modules/lessons/lesson-generation-policy";

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

/** Domyślnie low+webp: karty dziecka wyświetlają obraz ~300 px, więc wyższa
 *  jakość i bezstratny format zwykle nie dają proporcjonalnej korzyści. */
export const defaultMediaSettings: MediaSettings = {
  tts: { provider: "openai", model: "gpt-4o-mini-tts", voice: "alloy", format: "mp3" },
  image: { provider: "openai", model: "gpt-image-2.5-sunburst", size: "1024x1024", quality: "low", format: "webp" },
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
  lessonExecution?: LessonGenerationPolicy;
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
 * Zależności modelu oceniającego odpowiedzi lekcji (design „Model oceniający”),
 * proces web. `maxCallsPerSession` ogranicza liczbę płatnych wywołań na sesję
 * (księgowane w `learning_sessions.context.graderCalls`); `timeoutMs` to łączny
 * deadline jednego wywołania. Nieobecność = model wyłączony (stan poprawny:
 * niedopasowana odpowiedź → nieocenione). Worker gradera nie potrzebuje.
 */
export interface GraderDeps {
  provider: AnswerGraderProvider;
  maxCallsPerSession: number;
  timeoutMs: number;
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
  /** Obraz provider dostępny w web dla jawnej propozycji okładki rodzica. */
  imageProvider?: ImageProvider;
  speech?: SpeechDeps;
  /**
   * Model oceniający otwarte odpowiedzi lekcji (zadanie 15). Nieobecny =
   * ocena dowolnych odpowiedzi wyłączona (niedopasowanie → nieocenione);
   * `graderAvailable` selektora i modułu prób wynika WYŁĄCZNIE z jego obecności.
   */
  grader?: GraderDeps;
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
    imageProvider?: ImageProvider;
    speech?: SpeechDeps;
    grader?: GraderDeps;
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
    ...(input.imageProvider ? { imageProvider: input.imageProvider } : {}),
    ...(input.speech ? { speech: input.speech } : {}),
    ...(input.grader ? { grader: input.grader } : {}),
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

/** Domyślne limity gradera (design „Model oceniający”). */
export const DEFAULT_GRADER_TIMEOUT_MS = 8000;
export const DEFAULT_GRADER_MAX_CALLS_PER_SESSION = 20;

/** Dodatnia liczba całkowita z env albo błąd (nazwa zmiennej w komunikacie). */
function positiveIntEnv(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

/**
 * Model oceniający ze zmiennych środowiskowych (proces web, design „Model
 * oceniający”). Walidacja: wszystkie trzy pierwsze (`BASE_URL`, `API_KEY`,
 * `MODEL`) albo żadna — częściowa konfiguracja to błąd konfiguracji, nie cichy
 * brak. `https://` wymagane poza `NODE_ENV` test/development. Liczby dodatnie.
 * Brak konfiguracji → undefined (model wyłączony to stan poprawny). Sekret
 * żyje tylko w adapterze; tu wyłącznie go przekazujemy.
 */
export function graderFromEnv(env: Record<string, string | undefined>): GraderDeps | undefined {
  const baseUrl = env.UMIEM_GRADER_BASE_URL;
  const apiKey = env.UMIEM_GRADER_API_KEY;
  const model = env.UMIEM_GRADER_MODEL;
  const present = [baseUrl, apiKey, model].filter((v) => v !== undefined && v !== "").length;
  if (present === 0) {
    return undefined;
  }
  if (present < 3) {
    throw new Error("UMIEM_GRADER_* requires all of BASE_URL, API_KEY and MODEL, or none");
  }
  const nodeEnv = env.NODE_ENV ?? "production";
  const insecureAllowed = nodeEnv === "test" || nodeEnv === "development";
  if (!baseUrl!.startsWith("https://") && !(insecureAllowed && baseUrl!.startsWith("http://"))) {
    throw new Error("UMIEM_GRADER_BASE_URL must use https:// outside test/development");
  }
  const timeoutMs = positiveIntEnv("UMIEM_GRADER_TIMEOUT_MS", env.UMIEM_GRADER_TIMEOUT_MS, DEFAULT_GRADER_TIMEOUT_MS);
  const maxCallsPerSession = positiveIntEnv(
    "UMIEM_GRADER_MAX_CALLS_PER_SESSION",
    env.UMIEM_GRADER_MAX_CALLS_PER_SESSION,
    DEFAULT_GRADER_MAX_CALLS_PER_SESSION,
  );
  return {
    provider: createOpenAiCompatibleGrader({ baseUrl: baseUrl!, apiKey: apiKey!, model: model! }),
    maxCallsPerSession,
    timeoutMs,
  };
}
