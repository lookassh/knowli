import {
  MockTestSummaryDtoSchema,
  UiAudioCatalogDtoSchema,
  KidValidationReasonSchema,
  LessonMockTestSummaryDtoSchema,
  AttemptDtoSchema,
  DisclosureDtoSchema,
  FeedbackAudioDtoSchema,
  KidDeckDtoSchema,
  KidProfileDtoSchema,
  PresentationCompletionDtoSchema,
  SessionDtoSchema,
  SessionSummaryDtoSchema,
  SessionActivityResultDtoSchema,
  TaskDtoSchema,
  kidApiContract,
  type AttemptDto,
  type AttemptInput,
  type DisclosureDto,
  type EventInput,
  type FeedbackAudioDto,
  type KidDeckDto,
  type KidProfileDto,
  type KidValidationReason,
  type PresentationCompletionDto,
  type SessionActivityReport,
  type SessionActivityResultDto,
  type SessionDto,
  type SessionInput,
  type SessionSummaryDto,
  type TaskDto,
} from "@learning/contracts";
import { createORPCClient, MalformedResponseError, ORPCError, type AnyORPCError } from "@orpc/client";
import type { RouterContractClient } from "@orpc/contract";
import { OpenAPILink } from "@orpc/openapi/fetch";
import type { JsonifiedClient } from "@orpc/openapi";
import type { RecordedAudio } from "../media/platform";
import type { KidApi } from "./KidApi";

/** Błąd API z kodem współdzielonego formatu {code, message, retryable}. */
export class KidApiError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly reason?: KidValidationReason,
  ) {
    super(`kid api error: ${code}`);
    this.name = "KidApiError";
  }
}

/** Awaria transportu (brak sieci) — fetch rzuca wtedy TypeError. */
export function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}

export interface KidClientOptions {
  /** Współdzielone pochodzenie domyślnie; host Capacitor poda własne. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** Typowany klient z kontraktu kid API (wartości jak na wire, czyli JSON). */
type KidContractClient = JsonifiedClient<RouterContractClient<typeof kidApiContract>>;

/** Szczegółowa odpowiedź HTTP procedury z outputStructure: "detailed". */
type Detailed<T> = { status: number; headers: unknown; body: T };

/**
 * Klient HTTP Kid API na `OpenAPILink` (oRPC v2). Adresy, metody i ciała buduje
 * wyłącznie kontrakt `kidApiContract` z `@learning/contracts`; klient waliduje
 * odpowiedzi schematami kontraktów na granicy, błędy sieci pozostają TypeError
 * (obsługa trybu offline), a błędy aplikacji stają się KidApiError z kodem do
 * katalogu komunikatów.
 */
export function createKidApiClient(options: KidClientOptions = {}): KidApi {
  const base = (options.baseUrl ?? "").replace(/\/+$/, "");
  const doFetch = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

  /**
   * Budżet pojedynczego żądania przez AbortController we wstrzykniętym fetch.
   * Koniec sesji z raportem czeka na jedną ocenę modelu (termin 20 s), więc
   * limit żądania musi go przewyższać (design §6); reszta dostaje 30 s.
   */
  function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const timeoutMs = url.endsWith("/end") ? 45_000 : 30_000;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new TypeError("Kid API request timed out"));
        controller.abort();
      }, timeoutMs);
    });
    const perform = doFetch(input, { ...init, signal: controller.signal });
    return Promise.race([perform, timeout]).finally(() => clearTimeout(timer));
  }

  /**
   * Koperta błędu serwera `{code, message, retryable, requestId, details?}`
   * mapowana na ORPCError — bez dekodera link zgłasza MalformedResponseError
   * (spike v2). Kod koperty przenosimy 1:1; dane = cała koperta.
   */
  // beta.45: dekoder zwraca AnyORPCError — klasa jest generyczna po kodzie/danych,
  // a kod koperty jest dowolnym stringiem (ORPCErrorCode przyjmuje każdy).
  const errorEnvelopeDecoder = (body: unknown): AnyORPCError | null => {
    if (typeof body === "object" && body !== null && typeof (body as { code?: unknown }).code === "string") {
      return new ORPCError((body as { code: string }).code, { data: body });
    }
    return null;
  };

  function toKidApiError(envelope: unknown): KidApiError {
    const apiError = envelope as { code?: string; retryable?: boolean; details?: unknown } | null;
    const details = apiError?.details as { reason?: unknown } | undefined;
    const parsed = KidValidationReasonSchema.safeParse(details?.reason);
    return new KidApiError(apiError?.code ?? "internal", apiError?.retryable ?? false, parsed.success ? parsed.data : undefined);
  }

  /**
   * Wspólne opakowanie wywołania oRPC: TypeError przechodzi (tryb offline),
   * ORPCError z kopertą staje się KidApiError, a odpowiedź spoza kontraktu
   * (np. proxy) spada do kodu internal bez ujawniania typu transportu.
   */
  async function call<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof TypeError) throw error;
      if (error instanceof KidApiError) throw error;
      if (error instanceof ORPCError) throw toKidApiError(error.data);
      if (error instanceof MalformedResponseError || error instanceof SyntaxError) {
        throw new KidApiError("internal", false);
      }
      throw error;
    }
  }

  /** Strukturalny kształt zodowego safeParse — bez zależności pakietu od zod. */
  function parseWith<T>(
    schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
  ): (body: unknown) => T {
    return (body: unknown) => {
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        throw new KidApiError("internal", false);
      }
      return parsed.data;
    };
  }

  const parseTask = parseWith(TaskDtoSchema);
  const parseAttempt = parseWith(AttemptDtoSchema);
  const parseSession = parseWith(SessionDtoSchema);
  const parseSummary = parseWith(SessionSummaryDtoSchema);
  const parseActivityResult = parseWith(SessionActivityResultDtoSchema);
  const parseDisclosure = parseWith(DisclosureDtoSchema);
  const parseFeedbackAudio = parseWith(FeedbackAudioDtoSchema);
  const parsePresentation = parseWith(PresentationCompletionDtoSchema);
  const parseCatalog = parseWith(UiAudioCatalogDtoSchema);
  const parseMockTestSummary = parseWith(MockTestSummaryDtoSchema);
  const parseLessonMockTestSummary = parseWith(LessonMockTestSummaryDtoSchema);
  const parseProfiles = parseWith(KidProfileDtoSchema.array());
  const parseDecks = parseWith(KidDeckDtoSchema.array());

  const link = new OpenAPILink(kidApiContract, {
    origin: base || undefined,
    url: "/api/v1/kid",
    fetch: fetchWithTimeout,
    customErrorResponseBodyDecoder: errorEnvelopeDecoder,
  });
  // beta.45: createORPCClient przyjmuje pojedynczy link (nie tablicę jak w v1)
  const client: KidContractClient = createORPCClient(link);

  return {
    readUiAudio() {
      return call(async () => parseCatalog((await client.uiAudio() as Detailed<unknown>).body));
    },
    readMockTestSummary(sessionId) {
      return call(async () => parseMockTestSummary((await client.sessions.mockTestSummary({ sessionId }) as Detailed<unknown>).body));
    },
    readLessonMockTestSummary(sessionId) {
      return call(async () => parseLessonMockTestSummary((await client.sessions.mockTestSummary({ sessionId }) as Detailed<unknown>).body));
    },
    readSessionActivityResult(sessionId: string): Promise<SessionActivityResultDto> {
      return call(async () => parseActivityResult((await client.sessions.activityResult({ sessionId }) as Detailed<unknown>).body));
    },
    listProfiles(): Promise<KidProfileDto[]> {
      return call(async () => parseProfiles((await client.profiles() as Detailed<unknown>).body));
    },
    listDecks(childId: string, options: { microphoneEnabled?: boolean } = {}): Promise<KidDeckDto[]> {
      // Query przychodzą jako stringi (spike v2), więc boolean musi pójść
      // na wire jako literal "true"/"false" — zgodnie z z.input stringbool.
      const query = options.microphoneEnabled === undefined
        ? { childId }
        : { childId, microphoneEnabled: String(options.microphoneEnabled) };
      return call(async () => parseDecks((await client.decks(query) as Detailed<unknown>).body));
    },
    startSession(input: SessionInput): Promise<SessionDto> {
      return call(async () => parseSession(await client.sessions.create(input)));
    },
    async nextTask(sessionId: string): Promise<TaskDto | null> {
      return call(async () => {
        const output = await client.sessions.next({ sessionId }) as Detailed<TaskDto | null | undefined>;
        // 204 = wyczerpany budżet sesji; ciało detailed nie niesie zadania.
        return output.status === 204 || output.body == null ? null : parseTask(output.body);
      });
    },
    submitAnswer(input: Exclude<AttemptInput, { modality: "audio" }>): Promise<AttemptDto> {
      return call(async () => parseAttempt((await client.tasks.attempts(input) as Detailed<unknown>).body));
    },
    async submitSpeech(taskId: string, clientAttemptId: string, audio: RecordedAudio): Promise<AttemptDto> {
      // bajty nagrania idą multipartem poza JSON (arch §11–12); File w polu
      // input każe serializatorowi linku zbudować FormData (nazwa pliku
      // trafia do Content-Disposition), a granicznik dodaje przeglądarka
      return call(async () => {
        const output = await client.tasks.attempts({
          taskId,
          clientAttemptId,
          audio: new File([audio.bytes as BlobPart], "recording.webm", { type: audio.mimeType }),
        }) as Detailed<unknown>;
        return parseAttempt(output.body);
      });
    },
    readAttempt(attemptId: string): Promise<AttemptDto> {
      return call(async () => parseAttempt(await client.attempts.get({ attemptId })));
    },
    authorizeDisclosure(taskId: string, kind: "audio" | "hint"): Promise<DisclosureDto> {
      return call(async () => parseDisclosure(await client.tasks.disclosures({ taskId, kind })));
    },
    authorizeFeedbackAudio(attemptId: string): Promise<FeedbackAudioDto> {
      return call(async () => parseFeedbackAudio((await client.attempts.feedbackAudio({ attemptId }) as Detailed<unknown>).body));
    },
    async completePresentation(taskId: string, clientCommandId?: string): Promise<PresentationCompletionDto> {
      return call(async () => parsePresentation(await client.tasks.completePresentation(
        clientCommandId === undefined ? { taskId } : { taskId, clientCommandId },
      )));
    },
    async recordObservation(input: EventInput): Promise<void> {
      await call(() => client.tasks.events(input));
    },
    endSession(sessionId: string, activityReport?: SessionActivityReport): Promise<SessionSummaryDto> {
      return call(async () => parseSummary(await client.sessions.end(
        activityReport === undefined ? { sessionId } : { sessionId, activityReport },
      )));
    },
    disableMicrophone(sessionId: string): Promise<SessionDto> {
      return call(async () => parseSession(await client.sessions.disableMicrophone({ sessionId })));
    },
    mediaUrl(assetId: string): string {
      return `${base}/api/v1/media/${assetId}`;
    },
  };
}
