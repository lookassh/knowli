import { SessionActivityResultDtoSchema, kidApiContract } from "@learning/contracts";
import {
  authorizeFeedbackAudio,
  listKidDecks,
  listKidProfiles,
  mockTestKindOfSession,
  readAttempt,
  readLessonMockTestSummary,
  readMockTestSummary,
  readSessionActivityResult,
  readUiAudio,
} from "@learning/server";
import { implement, type Router } from "@orpc/server";
import { appErrorMiddleware, sameOriginMiddleware, type ORpcContext } from "./base";

/**
 * Router oRPC Kid API montowany w catch-all `/api/v1/kid/[...path]` z priorytetem
 * nad legacy `handleKidApi` (wzorzec strangler, migracja oRPC v2). Ten plik
 * implementuje wyłącznie odczyty (GET) + odsłuch feedbacku; brak dopasowania
 * (POST sesji/zadań) spada do routera legacy, dopóki kolejne zadania migracji
 * nie przejmą reszty kontraktu `kidApiContract`.
 *
 * Kompozycja wg spike'u v2: `implement()` nie przyjmuje buildera — middlewares
 * dokleja się na implementerze; implementuje się tylko zaimplementowane
 * poddrzewa kontraktu, więc `os.router()` wymaga kompletu wybranych gałęzi.
 */

/** Odpowiedź 200 z wymuszonym brakiem cache (regresja R04). */
function noStore<T>(body: T): { headers: { "cache-control": "no-store" }; body: T } {
  return { headers: { "cache-control": "no-store" }, body };
}

const kidGetOs = implement({
  uiAudio: kidApiContract.uiAudio,
  profiles: kidApiContract.profiles,
  decks: kidApiContract.decks,
  sessions: {
    activityResult: kidApiContract.sessions.activityResult,
    mockTestSummary: kidApiContract.sessions.mockTestSummary,
  },
  attempts: {
    get: kidApiContract.attempts.get,
    feedbackAudio: kidApiContract.attempts.feedbackAudio,
  },
})
  .$context<ORpcContext>()
  .use(appErrorMiddleware);

const uiAudio = kidGetOs.uiAudio.handler(async ({ context }) =>
  noStore(await readUiAudio(context.services)),
);

const profiles = kidGetOs.profiles.handler(async ({ context }) =>
  noStore(await listKidProfiles(context.services)),
);

const decks = kidGetOs.decks.handler(async ({ context, input }) =>
  noStore(
    await listKidDecks(context.services, input.childId, {
      ...(input.microphoneEnabled === undefined ? {} : { microphoneEnabled: input.microphoneEnabled }),
    }),
  ),
);

const activityResult = kidGetOs.sessions.activityResult.handler(async ({ context, input }) => {
  const result = await readSessionActivityResult(context.services, input.sessionId);
  // Brak trwałego wyniku oznacza jedynie oczekującą ocenę — nie ujawniamy
  // danych oceny poza małym DTO dla dziecka (paritet z kid-router.ts).
  return noStore(
    SessionActivityResultDtoSchema.parse(
      result ?? { status: "already_started", pointsAwarded: 0, errorCode: null },
    ),
  );
});

const mockTestSummary = kidGetOs.sessions.mockTestSummary.handler(async ({ context, input }) => {
  // Lekcja → omówienie per cel; słówka → omówienie słówkowe (arch §12).
  const kind = await mockTestKindOfSession(context.services.db, input.sessionId);
  const summary =
    kind === "lesson"
      ? await readLessonMockTestSummary(context.services, input.sessionId)
      : await readMockTestSummary(context.services, input.sessionId);
  return noStore(summary);
});

const getAttempt = kidGetOs.attempts.get.handler(async ({ context, input }) =>
  readAttempt(context.services, input.attemptId),
);

/** Mutacja (POST): kontrola Origin/CSRF jak w legacy `assertSameOrigin`. */
const feedbackAudio = kidGetOs.attempts.feedbackAudio
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) =>
    noStore(await authorizeFeedbackAudio(context.services, input.attemptId)),
  );

export const kidRouter: Router<ORpcContext> = kidGetOs.router({
  uiAudio,
  profiles,
  decks,
  sessions: { activityResult, mockTestSummary },
  attempts: { get: getAttempt, feedbackAudio },
});
