import {
  SESSION_ACTIVITY_REPORT_MAX_BYTES,
  SESSION_ACTIVITY_REPORT_VERSION,
  SessionActivityResultDtoSchema,
  kidApiContract,
} from "@learning/contracts";
import {
  AppError,
  MAX_AUDIO_BYTES,
  MULTIPART_OVERHEAD_BYTES,
  authorizeDisclosure,
  authorizeFeedbackAudio,
  completePresentation,
  disableSessionMicrophone,
  endSession,
  listKidDecks,
  listKidProfiles,
  nextTask,
  readAttempt,
  readMockTestSummaryForSession,
  readSessionActivityResult,
  readUiAudio,
  recordEvent,
  startSession,
  submitAttempt,
  submitSpeechAttempt,
  dictateLessonAnswer,
} from "@learning/server";
import { implement, type Router } from "@orpc/server";
import { appErrorMiddleware, sameOriginMiddleware, type ORpcContext, type PassthroughMiddleware } from "./base";
import { assertDeclaredBodyCap, compactJsonBytes, payloadTooLargeError } from "./request-limits";

/**
 * Router oRPC Kid API montowany w catch-all `/api/v1/kid/[...path]` — po
 * dekomisji legacy routera (koniec migracji oRPC v2) jedyny serwer kontraktu.
 * Ten plik implementuje cały `kidApiContract`: odczyty (GET), mutacje sesji
 * (POST /sessions/*) i mutacje zadań (POST /tasks/*: events, disclosures,
 * complete-presentation, attempts z multipartem nagrań dziecka). Ścieżki
 * spoza kontraktu kończą się `not_found` na poziomie `route.ts`.
 *
 * Kompozycja wg spike'u v2: `implement()` nie przyjmuje buildera — middlewares
 * dokleja się na implementerze; implementuje się tylko zaimplementowane poddrzewa
 * kontraktu, więc `os.router()` wymaga kompletu wybranych gałęzi.
 */

/** Odpowiedź 200 z wymuszonym brakiem cache (regresja R04). */
function noStore<T>(body: T): { headers: { "cache-control": "no-store" }; body: T } {
  return { headers: { "cache-control": "no-store" }, body };
}

const kidOs = implement({
  uiAudio: kidApiContract.uiAudio,
  profiles: kidApiContract.profiles,
  decks: kidApiContract.decks,
  sessions: {
    // `end` jest w kontrakcie tego implementera wyłącznie po to, żeby router
    // zarejestrował jego ścieżkę OpenAPI (matcher chodzi po ukrytym kontrakcie
    // routera, nie po wdrażanych procedurach) — samą procedurę buduje poniższy
    // `kidSessionEndOs`, bo guard raportu musi działać przed walidacją inputu.
    create: kidApiContract.sessions.create,
    next: kidApiContract.sessions.next,
    end: kidApiContract.sessions.end,
    disableMicrophone: kidApiContract.sessions.disableMicrophone,
    activityResult: kidApiContract.sessions.activityResult,
    mockTestSummary: kidApiContract.sessions.mockTestSummary,
  },
  attempts: {
    get: kidApiContract.attempts.get,
    feedbackAudio: kidApiContract.attempts.feedbackAudio,
  },
  tasks: {
    events: kidApiContract.tasks.events,
    disclosures: kidApiContract.tasks.disclosures,
    completePresentation: kidApiContract.tasks.completePresentation,
    attempts: kidApiContract.tasks.attempts,
    dictation: kidApiContract.tasks.dictation,
  },
})
  .$context<ORpcContext>()
  .use(appErrorMiddleware);

/**
 * Guard raportu aktywności dla `sessions.end` — limity rozmiaru i wersja
 * formatu. Trzy ustalenia spike'u beta.45 decydują o kształcie:
 *
 * 1. Middleware z implementera (przez `implement(...).use(...)`) działa
 *    PRZED wbudowaną walidacją inputu, a `.use()` na procedurze — PO niej.
 *    Nieznana wersja raportu musiałaby więc zwrócić ogólny błąd walidacji
 *    bez `details.reason`; guard na implementerze przywraca semantykę legacy
 *    (powód `activity_report_update_required` dla klienta).
 * 2. Kodek oRPC buforuje i parsuje ciało przed łańcuchem procedury — surowy
 *    strumień jest niedostępny, więc pre-check `content-length` (nagłówki z
 *    kontekstu) uzupełnia pomiar rozmiarem kompaktowego JSON sparsowanego
 *    inputu (kompensata braku/kłamliwego content-length; globalny wtyczkowy
 *    limit body NIE jest per-ścieżka — ruling P2/finding C ze spike'u).
 * 3. Middleware z implementera wykonuje się dwa razy (brak deduplikacji v2)
 *    — guard jest czystą asercją, więc powtórne wykonanie jest niezmienne.
 */
const sessionEndReportGuard: PassthroughMiddleware =
  async ({ context, next }, input) => {
    assertDeclaredBodyCap(context.headers, SESSION_ACTIVITY_REPORT_MAX_BYTES);
    if (compactJsonBytes(input) > SESSION_ACTIVITY_REPORT_MAX_BYTES) {
      throw payloadTooLargeError();
    }
    const version = (input as { activityReport?: { version?: unknown } } | undefined)?.activityReport?.version;
    if (version !== undefined && version !== SESSION_ACTIVITY_REPORT_VERSION) {
      throw new AppError("validation", { details: { reason: "activity_report_update_required" } });
    }
    return next();
  };

// Osobny implementer wyłącznie dla `end`: guard musi iść przed walidacją
// inputu, a middlewares doklejone do głównego implementera objęłyby także
// odczyty GET, których guard dotyczyć nie powinien.
const kidSessionEndOs = implement({ end: kidApiContract.sessions.end })
  .$context<ORpcContext>()
  .use(appErrorMiddleware)
  .use(sessionEndReportGuard);

const uiAudio = kidOs.uiAudio.handler(async ({ context }) =>
  noStore(await readUiAudio(context.services)),
);

const profiles = kidOs.profiles.handler(async ({ context }) =>
  noStore(await listKidProfiles(context.services)),
);

const decks = kidOs.decks.handler(async ({ context, input }) =>
  noStore(
    await listKidDecks(context.services, input.childId, {
      ...(input.microphoneEnabled === undefined ? {} : { microphoneEnabled: input.microphoneEnabled }),
    }),
  ),
);

const activityResult = kidOs.sessions.activityResult.handler(async ({ context, input }) => {
  const result = await readSessionActivityResult(context.services, input.sessionId);
  // Brak trwałego wyniku oznacza jedynie oczekującą ocenę — nie ujawniamy
  // danych oceny poza małym DTO dla dziecka (paritet z kid-router.ts).
  return noStore(
    SessionActivityResultDtoSchema.parse(
      result ?? { status: "already_started", pointsAwarded: 0, errorCode: null },
    ),
  );
});

const mockTestSummary = kidOs.sessions.mockTestSummary.handler(async ({ context, input }) => {
  return noStore(await readMockTestSummaryForSession(context.services, input.sessionId));
});

const getAttempt = kidOs.attempts.get.handler(async ({ context, input }) =>
  readAttempt(context.services, input.attemptId),
);

/** Mutacja (POST): kontrola Origin/CSRF jak w legacy `assertSameOrigin`. */
const feedbackAudio = kidOs.attempts.feedbackAudio
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) =>
    noStore(await authorizeFeedbackAudio(context.services, input.attemptId)),
  );

const createSession = kidOs.sessions.create
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) => startSession(context.services, input));

const next = kidOs.sessions.next
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) => {
    const task = await nextTask(context.services, input.sessionId);
    // 204 nie może nieść ciała — fetch odrzuca body przy tym statusie (spike
    // v2), więc pomijamy `body`; wydane zadanie wraca jako 200 (regresja R05).
    return task === null ? { status: 204 as const } : { status: 200 as const, body: task };
  });

/** `end` z osobnego implementera — patrz `sessionEndReportGuard` wyżej. */
const end = kidSessionEndOs.end
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) =>
    endSession(context.services, input.sessionId, input.activityReport),
  );

const disableMicrophone = kidOs.sessions.disableMicrophone
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) =>
    disableSessionMicrophone(context.services, input.sessionId),
  );

/**
 * Pre-check deklarowanego rozmiaru multipartu z nagraniem dziecka (arch §11).
 * Limit = bajty nagrania + zapas na pola formularza i boundary — identycznie
 * jak strumień legacy `readCappedFormData`. Kodek oRPC parsuje ciało przed
 * łańcuchem procedury, więc ten check nie chroni przed buforowaniem przez
 * kodek — chroni przed PRZETWARZANIEM: nadmiarowe nagranie nigdy nie trafia
 * do `submitSpeechAttempt`. Resztkowe ryzyko (strumień bez content-length)
 * pochłania kodek przed tym guardem; twardy limit bajtów nagrania egzekwuje
 * nadal `normalizeAudioInput` wewnątrz przypadku użycia.
 */
const audioCapGuard: PassthroughMiddleware = async ({ context, next }) => {
  assertDeclaredBodyCap(
    context.headers,
    MAX_AUDIO_BYTES + MULTIPART_OVERHEAD_BYTES,
    "payload exceeds audio limit",
  );
  return next();
};

const events = kidOs.tasks.events
  .use(sameOriginMiddleware)
  // 204 bez ciała: sukces deklaruje successStatus w kontrakcie, output void.
  .handler(async ({ context, input }) => {
    await recordEvent(context.services, input);
  });

const disclosures = kidOs.tasks.disclosures
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) => authorizeDisclosure(context.services, input));

const completePresentationProcedure = kidOs.tasks.completePresentation
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) => completePresentation(context.services, input));

/**
 * Odpowiedź na zadanie: JSON (choice/text/…) albo multipart z nagraniem.
 * Forma rozstrzygnięta już przez Content-Type przy parsowaniu kodeka —
 * po walidacji unii pozostaje tylko rozróżnienie pola `audio`. Status musi
 * odpowiadać stanowi próby: 202 dopóki trwa analiza mowy, 200 po zakończeniu
 * (regresja R05). `signal` pochodzi z `request.signal` żądania (wtyczka
 * ~signal-sync robi sygnał pochodny, ale propagacja abortu działa) i pozwala
 * przerwać płatną analizę STT po zerwaniu połączenia.
 */
const attempts = kidOs.tasks.attempts
  .use(sameOriginMiddleware)
  .use(audioCapGuard)
  .handler(async ({ context, input, signal }) => {
    if ("audio" in input) {
      const attempt = await submitSpeechAttempt(
        context.services,
        { taskId: input.taskId, clientAttemptId: input.clientAttemptId },
        {
          bytes: new Uint8Array(await input.audio.arrayBuffer()),
          mimeType: input.audio.type || "application/octet-stream",
          locale: "en-GB",
        },
        signal,
      );
      return { status: attempt.state === "processing" ? 202 as const : 200 as const, body: attempt };
    }
    const attempt = await submitAttempt(context.services, input);
    return { status: attempt.state === "processing" ? 202 as const : 200 as const, body: attempt };
  });

/**
 * Dyktowanie odpowiedzi lekcji (design szkoły §5.4): nagranie → tekst do pola,
 * bez próby i oceny. Ten sam guard rozmiaru co próby mowy; `signal` przerywa
 * płatne STT po zerwaniu połączenia. Wynik nie jest cache'owany.
 */
const dictation = kidOs.tasks.dictation
  .use(sameOriginMiddleware)
  .use(audioCapGuard)
  .handler(async ({ context, input, signal }) => {
    const body = await dictateLessonAnswer(
      context.services,
      { taskId: input.taskId },
      {
        bytes: new Uint8Array(await input.audio.arrayBuffer()),
        mimeType: input.audio.type || "application/octet-stream",
        locale: "pl-PL",
      },
      signal,
    );
    return noStore(body);
  });

export const kidRouter: Router<ORpcContext> = kidOs.router({
  uiAudio,
  profiles,
  decks,
  sessions: { create: createSession, next, end, disableMicrophone, activityResult, mockTestSummary },
  attempts: { get: getAttempt, feedbackAudio },
  tasks: { events, disclosures, completePresentation: completePresentationProcedure, attempts, dictation },
});
