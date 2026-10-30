import { MediaPendingDetailsSchema, messages } from "@learning/contracts";
import { createORPCClient, MalformedResponseError, ORPCError, type AnyORPCError } from "@orpc/client";
import type { RouterContractClient } from "@orpc/contract";
import { OpenAPILink } from "@orpc/openapi/fetch";
import type { JsonifiedClient } from "@orpc/openapi";
import { parentApiContract } from "./orpc-contract";

/** Błąd API w jednolitym formacie {code, message, retryable, requestId}. */
export class ApiCallError extends Error {
  readonly code: string | undefined;
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, code: string | undefined, status: number, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * Koperta błędu serwera `{code, message, retryable, requestId, details?}`
 * mapowana na ORPCError — bez dekodera link zgłasza MalformedResponseError
 * (spike v2). Kod koperty przenosimy 1:1; dane niosą kopertę oraz status HTTP
 * odpowiedzi, z którego ekrany rozpoznają wygasłą sesję (401).
 *
 * Ciało błędu BEZ koperty (np. JSON proxy z samym `message`) nie może gubić
 * komunikatu — dawny `apiFetch` czytał `message` z każdego błędu, więc i tu
 * ratujemy go z kodem nieokreślonym (paritety UX pilnuje test e2e work-card).
 */
const errorEnvelopeDecoder = (body: unknown, response?: { status: number }): AnyORPCError | null => {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const envelope = body as { code?: unknown; message?: unknown };
  if (typeof envelope.code === "string") {
    return new ORPCError(envelope.code, {
      data: { envelope: body, status: response?.status },
    });
  }
  if (typeof envelope.message === "string") {
    return new ORPCError("INTERNAL_SERVER_ERROR", {
      data: { envelope: { message: envelope.message }, status: response?.status },
    });
  }
  return null;
};

/** Typowany klient Parent API z kontraktu (wartości jak na wire, czyli JSON). */
export type ParentClient = JsonifiedClient<RouterContractClient<typeof parentApiContract>>;

/** Klient oRPC panelu rodzica: same-origin, cookie sesji z domyślnych credentials. */
export const parentClient: ParentClient = createORPCClient(
  new OpenAPILink(parentApiContract, {
    url: "/api/v1/parent",
    customErrorResponseBodyDecoder: errorEnvelopeDecoder,
  }),
);

/**
 * Normalizacja błędów klienta oRPC do `ApiCallError` — zmigrowane ekrany
 * zachowują dotychczasową obsługę (`code`, `status`, `errorMessage`).
 * Awaria sieci pozostaje TypeError (jak w dawny `apiFetch`), bo tylko ona
 * uzasadnia stany „niepewnego polecenia” (ponowienie z tym samym kluczem).
 */
export async function callParent<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiCallError) throw error;
    if (error instanceof ORPCError) {
      const data = error.data as { envelope?: { code?: string; message?: string; details?: unknown }; status?: number } | undefined;
      const envelope = data?.envelope;
      throw new ApiCallError(
        envelope?.message ?? messages.errors.internal,
        envelope?.code,
        data?.status ?? 500,
        envelope?.details,
      );
    }
    if (error instanceof MalformedResponseError || error instanceof SyntaxError) {
      throw new ApiCallError(messages.errors.internal, "internal", 500);
    }
    throw error;
  }
}

export function errorMessage(error: unknown): string {
  // błąd zapytania TanStack przychodzi z klienta oRPC bez `callParent` —
  // komunikat serwera niesie koperta, a nie `message` ORPCError
  if (error instanceof ORPCError) {
    const envelope = (error.data as { envelope?: { message?: string } } | undefined)?.envelope;
    return envelope?.message || messages.errors.internal;
  }
  // jak w `callParent`: niezrozumiała odpowiedź (np. strona HTML proxy) albo
  // dane niezgodne ze schematem to ogólny polski komunikat, nie tekst techniczny
  if (error instanceof MalformedResponseError || error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError")) {
    return messages.errors.internal;
  }
  if (error instanceof ApiCallError || error instanceof Error) {
    return error.message || messages.errors.internal;
  }
  return messages.errors.internal;
}

/**
 * Publikacja odrzucona, bo wymagane media wciąż się generują: zlecenia są już
 * zapisane, więc rodzic czeka i publikuje ponownie (issue #106).
 */
export function isMediaPendingError(error: unknown): boolean {
  return error instanceof ApiCallError && error.code === "validation"
    && MediaPendingDetailsSchema.safeParse(error.details).success;
}
