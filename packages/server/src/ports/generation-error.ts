export type GenerationProviderErrorKind =
  | "configuration"
  | "rate_limit"
  | "transient"
  | "timeout"
  | "refusal"
  | "incomplete"
  | "output";

export class GenerationProviderError extends Error {
  override readonly name = "GenerationProviderError";
  readonly kind: GenerationProviderErrorKind;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(
    kind: GenerationProviderErrorKind,
    options: { status?: number; retryAfterMs?: number } = {},
  ) {
    super(`provider_${kind}`);
    this.kind = kind;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** Upływ `AbortSignal.timeout` adaptera → `timeout`; przerwanie sygnałem wywołującego (AbortError) zostaje bez zmian. */
export function timeoutAsProviderError(error: unknown): unknown {
  return error instanceof Error && error.name === "TimeoutError" ? new GenerationProviderError("timeout") : error;
}
