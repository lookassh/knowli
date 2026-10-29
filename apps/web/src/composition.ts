import type { Pool } from "pg";
import {
  createDatabase,
  createLocalMediaStore,
  createServices,
  fakeGraderDeps,
  FakeAnswerGrader,
  fakeSessionActivityDeps,
  FakeSessionActivityReviewer,
  fakeLessonSpeechDeps,
  fakeSpeechDeps,
  graderFromEnv,
  imageProviderFromEnv,
  lessonSpeechFromEnv,
  mediaSettingsFromEnv,
  sessionActivityFromEnv,
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
  // dyktowanie odpowiedzi lekcji (Etap 3 szkoły): osobny STT bez oceny wymowy
  const lessonSpeech = lessonSpeechFromEnv(process.env) ?? (process.env.UMIEM_FAKE_PROVIDERS === "1" ? fakeLessonSpeechDeps() : undefined);
  // model oceniający: z env (produkcja) albo fake w trybie E2E (routing po słowach
  // kluczowych w odpowiedzi: „almost” → almost, „wrong” → incorrect, inaczej correct)
  const grader =
    graderFromEnv(process.env) ??
    (process.env.UMIEM_FAKE_PROVIDERS === "1"
      ? fakeGraderDeps({ provider: new FakeAnswerGrader({ keywordRouting: true }) })
      : undefined);
  // Ocena aktywności sesji współdzieli połączenie UMIEM_GRADER_*; w trybie fake
  // deterministiczny reviewer (heurystyka „aaa” → wykluczenie zadania).
  const sessionActivity =
    sessionActivityFromEnv(process.env) ??
    (process.env.UMIEM_FAKE_PROVIDERS === "1"
      ? fakeSessionActivityDeps({ provider: new FakeSessionActivityReviewer() })
      : undefined);
  const imageProvider = imageProviderFromEnv(process.env);
  return {
    services: createServices({
      db,
      clock: systemClock,
      media: mediaSettingsFromEnv(process.env),
      ...(imageProvider ? { imageProvider } : {}),
      // web generuje wyłącznie jawne propozycje okładek rodzica; generację mediów kart wykonuje worker
      mediaStore: createLocalMediaStore(process.env.MEDIA_ROOT ?? "./data/media"),
      // ścieżka mowy to krótkie żądanie web → provider, bez kolejki (arch §11)
      ...(speech ? { speech } : {}),
      ...(lessonSpeech ? { lessonSpeech } : {}),
      ...(grader ? { grader } : {}),
      ...(sessionActivity ? { sessionActivity } : {}),
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
