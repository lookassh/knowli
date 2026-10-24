import { messages } from "@learning/contracts";
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
 */
const errorEnvelopeDecoder = (body: unknown, response?: { status: number }): AnyORPCError | null => {
  if (typeof body === "object" && body !== null && typeof (body as { code?: unknown }).code === "string") {
    return new ORPCError((body as { code: string }).code, {
      data: { envelope: body, status: response?.status },
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
 * Awaria sieci pozostaje TypeError (jak w apiFetch), bo tylko ona uzasadnia
 * stany „niepewnego polecenia” (ponowienie z tym samym kluczem).
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

/** Wywołanie API panelu: same-origin z cookie sesji, błędy jako ApiCallError. */
export async function apiFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" } }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { code?: string; message?: string; details?: unknown } | null;
    throw new ApiCallError(
      payload?.message ?? messages.errors.internal,
      payload?.code,
      response.status,
      payload?.details,
    );
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiCallError || error instanceof Error) {
    return error.message || messages.errors.internal;
  }
  return messages.errors.internal;
}
