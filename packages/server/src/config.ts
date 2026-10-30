import type { Database } from "./db/client";
import type {
  AnswerGraderProvider,
  ImageProvider,
  LlmProvider,
  PronunciationProvider,
  SessionActivityReviewer,
  SttProvider,
  TtsProvider,
} from "./ports/ai";
import type { MediaStore } from "./ports/media";
import { createAzurePronunciationProvider } from "./providers/azure/pronunciation";
import { createAzureSttProvider } from "./providers/azure/stt";
import { createOpenAiCompatibleGrader } from "./providers/openai-compatible/grader";
import { createOpenAiCompatibleSttProvider } from "./providers/openai-compatible/stt";
import { createOpenAiCompatibleSessionActivityReviewer } from "./providers/openai-compatible/session-activity";
import { chatRequestExtrasFromEnv } from "./providers/chat-request-options";
import { createProductionSubjectRegistry } from "./domain/lessons/subjects";
import type { SubjectRegistry } from "./domain/lessons/registry";
import type { LessonGenerationPolicy } from "./modules/materials/lessons/lesson-generation-policy";

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
  tts: {
    provider: string;
    model: string;
    /** Głos domyślny; `voices` nadpisuje go dla danego locale treści. */
    voice: string;
    /** Głos per locale (np. `en-GB` → głos brytyjski), z `UMIEM_TTS_VOICE_<LANG>_<REGION>`. */
    voices?: Readonly<Record<string, string>>;
    format: "mp3";
  };
  image: { provider: string; model: string; size: string; quality: string; format: string };
}

/** Domyślnie low+webp: karty dziecka wyświetlają obraz ~300 px, więc wyższa
 *  jakość i bezstratny format zwykle nie dają proporcjonalnej korzyści. */
export const defaultMediaSettings: MediaSettings = {
  tts: { provider: "openai", model: "gpt-4o-mini-tts", voice: "alloy", format: "mp3" },
  image: { provider: "openai", model: "gpt-image-2.5-sunburst", size: "1024x1024", quality: "low", format: "webp" },
};

/**
 * Głos TTS dla locale tekstu: głos przypisany do tego locale albo domyślny.
 * Głos wchodzi do fingerprintu i metadanych zasobu, więc słówka po angielsku
 * i polskie nagrania mają osobne nagrania (design szkoły §11.7).
 */
export function ttsVoiceFor(tts: MediaSettings["tts"], locale: string): string {
  return tts.voices?.[locale] ?? tts.voice;
}

/** `UMIEM_TTS_VOICE_EN_GB=…` → `{ "en-GB": … }`; puste wartości pomijane. */
function ttsVoicesFromEnv(env: Record<string, string | undefined>): Record<string, string> {
  const voices: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    const match = /^UMIEM_TTS_VOICE_([A-Z]{2})_([A-Z]{2})$/.exec(key);
    if (match && value) voices[`${match[1]!.toLowerCase()}-${match[2]}`] = value;
  }
  return voices;
}

/** Nadpisywalne zmiennymi środowiskowymi (nazwy, nie sekrety). */
export function mediaSettingsFromEnv(env: Record<string, string | undefined>): MediaSettings {
  return {
    // Puste UMIEM_TTS_* jak nieustawione — tak samo jak adapter TTS w workerze
    // (generation-env), żeby fingerprint opisywał faktycznie użyty model.
    tts: {
      provider: env.UMIEM_TTS_PROVIDER || defaultMediaSettings.tts.provider,
      model: env.UMIEM_TTS_MODEL || defaultMediaSettings.tts.model,
      voice: env.UMIEM_TTS_VOICE || defaultMediaSettings.tts.voice,
      ...(Object.keys(ttsVoicesFromEnv(env)).length > 0 ? { voices: ttsVoicesFromEnv(env) } : {}),
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
 * Rozpoznawanie mowy dla dyktowania odpowiedzi lekcji (design szkoły §5.2).
 * Osobne od `speech` słówek: odpowiedzi szkolne nie potrzebują oceny wymowy.
 * Nieobecność = lekcje bez mikrofonu.
 */
export interface LessonSpeechDeps {
  stt: SttProvider;
  /** Publiczna nazwa usługi dla panelu rodzica (model, nigdy URL ani klucz). */
  publicService: string;
  timeoutMs?: number;
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
 * Zależności oceny aktywności sesji (spec client-reward-time). Współdzieli
 * połączenie `UMIEM_GRADER_*` z graderem lekcji, ale ma osobny port, prompt i
 * deadline (domyślnie 20 s). Nieobecność = ocena wyłączona (zapis błędu, bez
 * punktów). Bez cache i bez limitu wywołań odpowiedzi lekcyjnych.
 */
export interface SessionActivityDeps {
  provider: SessionActivityReviewer;
  timeoutMs: number;
  /** Bezpieczna, publiczna nazwa hosta/modelu; nigdy URL z credentials ani klucz. */
  publicService?: string;
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
  /** Dyktowanie odpowiedzi otwartych lekcji (Etap 3 przedmiotów szkolnych). */
  lessonSpeech?: LessonSpeechDeps;
  /**
   * Model oceniający otwarte odpowiedzi lekcji (zadanie 15). Nieobecny =
   * ocena dowolnych odpowiedzi wyłączona (niedopasowanie → nieocenione);
   * `graderAvailable` selektora i modułu prób wynika WYŁĄCZNIE z jego obecności.
   */
  grader?: GraderDeps;
  /**
   * Ocena aktywności sesji (raport FE → wykluczenia zadań → punkty). Proces
   * web; nieobecność = polityka błędu bez punktów.
   */
  sessionActivity?: SessionActivityDeps;
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
    lessonSpeech?: LessonSpeechDeps;
    grader?: GraderDeps;
    sessionActivity?: SessionActivityDeps;
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
    ...(input.lessonSpeech ? { lessonSpeech: input.lessonSpeech } : {}),
    ...(input.grader ? { grader: input.grader } : {}),
    ...(input.sessionActivity ? { sessionActivity: input.sessionActivity } : {}),
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

/** Domyślny model dyktowania lekcji (spike 2026-10-29, design szkoły §5.2). */
export const DEFAULT_LESSON_STT_MODEL = "elevenlabs/scribe-v2";

/**
 * Dyktowanie lekcji ze zmiennych `UMIEM_LESSON_STT_BASE_URL`, `_API_KEY`
 * i opcjonalnego `_MODEL` (domyślnie {@link DEFAULT_LESSON_STT_MODEL}). Adres
 * i klucz razem albo wcale; https poza test/development jak dla gradera.
 */
export function lessonSpeechFromEnv(env: Record<string, string | undefined>): LessonSpeechDeps | undefined {
  const baseUrl = env.UMIEM_LESSON_STT_BASE_URL;
  const apiKey = env.UMIEM_LESSON_STT_API_KEY;
  const present = [baseUrl, apiKey].filter((v) => v !== undefined && v !== "").length;
  if (present === 0) {
    return undefined;
  }
  if (present < 2) {
    throw new Error("UMIEM_LESSON_STT_* requires both BASE_URL and API_KEY, or none");
  }
  const nodeEnv = env.NODE_ENV ?? "production";
  const insecureAllowed = nodeEnv === "test" || nodeEnv === "development";
  if (!baseUrl!.startsWith("https://") && !(insecureAllowed && baseUrl!.startsWith("http://"))) {
    throw new Error("UMIEM_LESSON_STT_BASE_URL must use https:// outside test/development");
  }
  const model = env.UMIEM_LESSON_STT_MODEL?.trim() || DEFAULT_LESSON_STT_MODEL;
  return {
    stt: createOpenAiCompatibleSttProvider({ baseUrl: baseUrl!, apiKey: apiKey!, model }),
    publicService: model,
  };
}

/** Domyślne limity gradera (design „Model oceniający”). */
export const DEFAULT_GRADER_TIMEOUT_MS = 8000;
export const DEFAULT_GRADER_MAX_CALLS_PER_SESSION = 20;

/** Termin asynchronicznej oceny; zostawia zapas przed finalizacją po 120 s. */
export const DEFAULT_SESSION_ACTIVITY_TIMEOUT_MS = 60_000;

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
    provider: createOpenAiCompatibleGrader({
      baseUrl: baseUrl!, apiKey: apiKey!, model: model!, requestExtras: chatRequestExtrasFromEnv(env, "UMIEM_GRADER"),
    }),
    maxCallsPerSession,
    timeoutMs,
  };
}

/**
 * Ocena aktywności sesji ze zmiennych środowiskowych. Świadomie współdzieli
 * `UMIEM_GRADER_BASE_URL/API_KEY/MODEL` z graderem lekcji (decyzja handoff.md
 * §4): brak konfiguracji gradera = ocena aktywności również wyłączona. Osobny
 * deadline `UMIEM_SESSION_ACTIVITY_TIMEOUT_MS` (domyślnie 60 s).
 */
export function sessionActivityFromEnv(env: Record<string, string | undefined>): SessionActivityDeps | undefined {
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
  // jak graderFromEnv — nie polegamy na tym, że kompozycja wywoła go wcześniej
  const nodeEnv = env.NODE_ENV ?? "production";
  const insecureAllowed = nodeEnv === "test" || nodeEnv === "development";
  if (!baseUrl!.startsWith("https://") && !(insecureAllowed && baseUrl!.startsWith("http://"))) {
    throw new Error("UMIEM_GRADER_BASE_URL must use https:// outside test/development");
  }
  const timeoutMs = positiveIntEnv(
    "UMIEM_SESSION_ACTIVITY_TIMEOUT_MS",
    env.UMIEM_SESSION_ACTIVITY_TIMEOUT_MS,
    DEFAULT_SESSION_ACTIVITY_TIMEOUT_MS,
  );
  return {
    provider: createOpenAiCompatibleSessionActivityReviewer({
      baseUrl: baseUrl!, apiKey: apiKey!, model: model!, requestExtras: chatRequestExtrasFromEnv(env, "UMIEM_GRADER"),
    }),
    timeoutMs,
    publicService: `${new URL(baseUrl!).host} · ${model}`,
  };
}
