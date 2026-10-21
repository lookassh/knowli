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
  type AttemptDto,
  type KidValidationReason,
  type AttemptInput,
  type DisclosureDto,
  type FeedbackAudioDto,
  type EventInput,
  type KidDeckDto,
  type KidProfileDto,
  type PresentationCompletionDto,
  type SessionActivityReport,
  type SessionActivityResultDto,
  type SessionDto,
  type SessionInput,
  type SessionSummaryDto,
  type TaskDto,
} from "@learning/contracts";
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

type JsonInit = { method: "GET" | "POST" | "PUT"; body?: string | FormData };

/**
 * Klient HTTP Kid API. Waliduje odpowiedzi schematami kontraktów na granicy
 * klienta; błędy sieci pozostają TypeError (obsługa trybu offline), a błędy
 * aplikacji stają się KidApiError z kodem do katalogu komunikatów.
 */
export function createKidApiClient(options: KidClientOptions = {}): KidApi {
  const base = (options.baseUrl ?? "").replace(/\/+$/, "");
  const doFetch = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

  async function request<T>(path: string, init: JsonInit, parse: (body: unknown) => T): Promise<T> {
    const controller = new AbortController();
    // Koniec sesji z raportem czeka na jedną ocenę modelu (termin 20 s),
    // więc limit żądania musi go przewyższać (design §6).
    const timeoutMs = path.endsWith("/end") ? 45_000 : 30_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new TypeError("Kid API request timed out"));
        controller.abort();
      }, timeoutMs);
    });
    const perform = async (): Promise<T> => {
      const response = await doFetch(base + path, { ...init, signal: controller.signal });
      if (response.status === 204) return undefined as T;
      const body = await response.json().catch(() => null);
      if (!response.ok) throw toKidApiError(body);
      return parse(body);
    };
    try { return await Promise.race([perform(), timeout]); }
    finally { clearTimeout(timer); }
  }

  function toKidApiError(body: unknown): KidApiError {
    const apiError = body as { code?: string; retryable?: boolean; details?: unknown } | null;
    const details = apiError?.details as { reason?: unknown } | undefined;
    const parsed = KidValidationReasonSchema.safeParse(details?.reason);
    return new KidApiError(apiError?.code ?? "internal", apiError?.retryable ?? false, parsed.success ? parsed.data : undefined);
  }

  function post<T>(path: string, payload: unknown, parse: (body: unknown) => T): Promise<T> {
    return request(path, { method: "POST", body: JSON.stringify(payload) }, parse);
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
  const parseProfiles = parseWith(KidProfileDtoSchema.array());
  const parseDecks = parseWith(KidDeckDtoSchema.array());

  return {
    readUiAudio() {
      return request("/api/v1/kid/ui-audio", { method: "GET" }, parseWith(UiAudioCatalogDtoSchema));
    },
    readMockTestSummary(sessionId) {
      return request(`/api/v1/kid/sessions/${sessionId}/mock-test-summary`, { method: "GET" }, parseWith(MockTestSummaryDtoSchema));
    },
    readLessonMockTestSummary(sessionId) {
      return request(`/api/v1/kid/sessions/${sessionId}/mock-test-summary`, { method: "GET" }, parseWith(LessonMockTestSummaryDtoSchema));
    },
    readSessionActivityResult(sessionId: string): Promise<SessionActivityResultDto> {
      return request(`/api/v1/kid/sessions/${sessionId}/activity-result`, { method: "GET" }, parseActivityResult);
    },
    listProfiles(): Promise<KidProfileDto[]> {
      return request("/api/v1/kid/profiles", { method: "GET" }, parseProfiles);
    },
    listDecks(childId: string, options: { microphoneEnabled?: boolean } = {}): Promise<KidDeckDto[]> {
      const query = options.microphoneEnabled === undefined ? "" : `&microphoneEnabled=${options.microphoneEnabled}`;
      return request(
        `/api/v1/kid/decks?childId=${encodeURIComponent(childId)}${query}`,
        { method: "GET" },
        parseDecks,
      );
    },
    startSession(input: SessionInput): Promise<SessionDto> {
      return post("/api/v1/kid/sessions", input, parseSession);
    },
    async nextTask(sessionId: string): Promise<TaskDto | null> {
      const response = await doFetch(`${base}/api/v1/kid/sessions/${sessionId}/next`, { method: "POST" });
      if (response.status === 204) {
        return null;
      }
      if (!response.ok) {
        throw toKidApiError(await response.json().catch(() => null));
      }
      return parseTask(await response.json());
    },
    submitAnswer(input: Exclude<AttemptInput, { modality: "audio" }>): Promise<AttemptDto> {
      return post(`/api/v1/kid/tasks/${input.taskId}/attempts`, input, parseAttempt);
    },
    async submitSpeech(taskId: string, clientAttemptId: string, audio: RecordedAudio): Promise<AttemptDto> {
      // bajty nagrania idą multipartem poza JSON (arch §11–12); przeglądarka
      // sama ustawi Content-Type z granicznikiem
      const form = new FormData();
      form.append("audio", new Blob([audio.bytes as BlobPart], { type: audio.mimeType }), "recording.webm");
      form.append("clientAttemptId", clientAttemptId);
      const response = await doFetch(`${base}/api/v1/kid/tasks/${taskId}/attempts`, { method: "POST", body: form });
      if (!response.ok) {
        throw toKidApiError(await response.json().catch(() => null));
      }
      return parseAttempt(await response.json());
    },
    readAttempt(attemptId: string): Promise<AttemptDto> {
      return request(`/api/v1/kid/attempts/${attemptId}`, { method: "GET" }, parseAttempt);
    },
    authorizeDisclosure(taskId: string, kind: "audio" | "hint"): Promise<DisclosureDto> {
      return post(`/api/v1/kid/tasks/${taskId}/disclosures`, { kind }, parseDisclosure);
    },
    authorizeFeedbackAudio(attemptId: string): Promise<FeedbackAudioDto> {
      return post(`/api/v1/kid/attempts/${attemptId}/feedback-audio`, {}, parseFeedbackAudio);
    },
    async completePresentation(taskId: string, clientCommandId?: string): Promise<PresentationCompletionDto> {
      return post(
        `/api/v1/kid/tasks/${taskId}/complete-presentation`,
        clientCommandId === undefined ? {} : { clientCommandId },
        parsePresentation,
      );
    },
    async recordObservation(input: EventInput): Promise<void> {
      await post(`/api/v1/kid/tasks/${input.taskId}/events`, input, () => undefined);
    },
    endSession(sessionId: string, activityReport?: SessionActivityReport): Promise<SessionSummaryDto> {
      return post(
        `/api/v1/kid/sessions/${sessionId}/end`,
        activityReport === undefined ? {} : { activityReport },
        parseSummary,
      );
    },
    disableMicrophone(sessionId: string): Promise<SessionDto> {
      return post(`/api/v1/kid/sessions/${sessionId}/disable-microphone`, {}, parseSession);
    },
    mediaUrl(assetId: string): string {
      return `${base}/api/v1/media/${assetId}`;
    },
  };
}
