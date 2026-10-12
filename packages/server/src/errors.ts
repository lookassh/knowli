export type AppErrorCode =
  | "unauthorized"
  | "invalid_credentials"
  | "rate_limited"
  | "setup_required"
  | "already_configured"
  | "validation"
  | "mock_test_unavailable"
  | "learning_summary_unavailable"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "immutable"
  | "internal";

interface CodeProfile {
  status: number;
  retryable: boolean;
}

const CODE_PROFILES: Record<AppErrorCode, CodeProfile> = {
  unauthorized: { status: 401, retryable: false },
  invalid_credentials: { status: 401, retryable: false },
  rate_limited: { status: 429, retryable: true },
  setup_required: { status: 409, retryable: false },
  already_configured: { status: 409, retryable: false },
  validation: { status: 400, retryable: false },
  mock_test_unavailable: { status: 400, retryable: false },
  learning_summary_unavailable: { status: 503, retryable: true },
  forbidden: { status: 403, retryable: false },
  not_found: { status: 404, retryable: false },
  conflict: { status: 409, retryable: false },
  immutable: { status: 409, retryable: false },
  internal: { status: 500, retryable: true },
};

/**
 * Błąd przypadku użycia z kodem i statusem HTTP. Bez tekstu po polsku —
 * komunikaty dla klienta dobiera warstwa HTTP z katalogu messages.
 */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(
    code: AppErrorCode,
    options?: { message?: string; cause?: unknown },
  ) {
    const profile = CODE_PROFILES[code];
    super(options?.message ?? code, { cause: options?.cause });
    this.name = "AppError";
    this.code = code;
    this.status = profile.status;
    this.retryable = profile.retryable;
  }
}
