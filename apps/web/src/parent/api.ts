import { messages } from "@learning/contracts";

/** Błąd API w jednolitym formacie {code, message, retryable, requestId}. */
export class ApiCallError extends Error {
  readonly code: string | undefined;
  readonly status: number;

  constructor(message: string, code: string | undefined, status: number) {
    super(message);
    this.code = code;
    this.status = status;
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
    const payload = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new ApiCallError(
      payload?.message ?? messages.errors.internal,
      payload?.code,
      response.status,
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
