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
  withConfigDefaults,
} from "@learning/server";

let current: { services: Services; pool: Pool } | undefined;

/** Złożenie zależności serwerowych dla web; singleton na czas życia procesu. */
export function getServerServices(): Services {
  current ??= initialize();
  return current.services;
}

function initialize(): { services: Services; pool: Pool } {
  // domyślna konfiguracja z repo pod spodem, .env nadpisuje (config-defaults.ts)
  const env = withConfigDefaults(process.env);
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }
  const { db, pool } = createDatabase(databaseUrl);
  // Tryb fake (E2E/smoke bez kluczy) ma pierwszeństwo: nagrania i odpowiedzi
  // nie wychodzą do sieci, nawet gdy w środowisku jest klucz.
  const fake = env.UMIEM_FAKE_PROVIDERS === "1";
  // odpowiedzi ustne przechodzą w trybie fake pełny cykl na deterministycznych
  // providerach zamiast kończyć się wynikiem technicznym
  const speech = fake ? fakeSpeechDeps() : speechFromEnv(env);
  // dyktowanie odpowiedzi lekcji (Etap 3 szkoły): osobny STT bez oceny wymowy
  const lessonSpeech = fake ? fakeLessonSpeechDeps() : lessonSpeechFromEnv(env);
  // model oceniający: z env (produkcja) albo fake (routing po słowach kluczowych
  // w odpowiedzi: „almost” → almost, „wrong” → incorrect, inaczej correct)
  const grader = fake
    ? fakeGraderDeps({ provider: new FakeAnswerGrader({ keywordRouting: true }) })
    : graderFromEnv(env);
  // Ocena aktywności sesji współdzieli połączenie UMIEM_GRADER_*; w trybie fake
  // deterministiczny reviewer (heurystyka „aaa” → wykluczenie zadania).
  const sessionActivity = fake
    ? fakeSessionActivityDeps({ provider: new FakeSessionActivityReviewer() })
    : sessionActivityFromEnv(env);
  const imageProvider = imageProviderFromEnv(env);
  return {
    services: createServices({
      db,
      clock: systemClock,
      media: mediaSettingsFromEnv(env),
      ...(imageProvider ? { imageProvider } : {}),
      // web generuje wyłącznie jawne propozycje okładek rodzica; generację mediów kart wykonuje worker
      mediaStore: createLocalMediaStore(env.MEDIA_ROOT ?? "./data/media"),
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
