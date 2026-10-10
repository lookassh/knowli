import {
  MockTestSummaryDtoSchema,
  AttemptDtoSchema,
  DisclosureDtoSchema,
  KidDeckDtoSchema,
  KidProfileDtoSchema,
  PresentationCompletionDtoSchema,
  SessionDtoSchema,
  SessionSummaryDtoSchema,
  TaskDtoSchema,
  type AttemptDto,
  type AttemptInput,
  type DisclosureDto,
  type EventInput,
  type KidDeckDto,
  type KidProfileDto,
  type PresentationCompletionDto,
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
    const response = await doFetch(base + path, init);
    if (response.status === 204) {
      return undefined as T;
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const apiError = body as { code?: string; retryable?: boolean } | null;
      throw new KidApiError(apiError?.code ?? "internal", apiError?.retryable ?? false);
    }
    return parse(body);
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
  const parseDisclosure = parseWith(DisclosureDtoSchema);
  const parsePresentation = parseWith(PresentationCompletionDtoSchema);
  const parseProfiles = parseWith(KidProfileDtoSchema.array());
  const parseDecks = parseWith(KidDeckDtoSchema.array());

  return {
    readMockTestSummary(sessionId) {
      return request(`/api/v1/kid/sessions/${sessionId}/mock-test-summary`, { method: "GET" }, parseWith(MockTestSummaryDtoSchema));
    },
    listProfiles(): Promise<KidProfileDto[]> {
      return request("/api/v1/kid/profiles", { method: "GET" }, parseProfiles);
    },
    listDecks(childId: string): Promise<KidDeckDto[]> {
      return request(
        `/api/v1/kid/decks?childId=${encodeURIComponent(childId)}`,
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
        const body = (await response.json().catch(() => null)) as { code?: string; retryable?: boolean } | null;
        throw new KidApiError(body?.code ?? "internal", body?.retryable ?? false);
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
        const body = (await response.json().catch(() => null)) as { code?: string; retryable?: boolean } | null;
        throw new KidApiError(body?.code ?? "internal", body?.retryable ?? false);
      }
      return parseAttempt(await response.json());
    },
    readAttempt(attemptId: string): Promise<AttemptDto> {
      return request(`/api/v1/kid/attempts/${attemptId}`, { method: "GET" }, parseAttempt);
    },
    authorizeDisclosure(taskId: string, kind: "audio" | "hint"): Promise<DisclosureDto> {
      return post(`/api/v1/kid/tasks/${taskId}/disclosures`, { kind }, parseDisclosure);
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
    endSession(sessionId: string): Promise<SessionSummaryDto> {
      return post(`/api/v1/kid/sessions/${sessionId}/end`, {}, parseSummary);
    },
    mediaUrl(assetId: string): string {
      return `${base}/api/v1/media/${assetId}`;
    },
  };
}
