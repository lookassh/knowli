/** Bezpieczna diagnostyka transportu; nigdy nie przechowuje body ani przyczyny błędu. */
export class SessionActivityProviderError extends Error {
  constructor(
    readonly failureKind: "http_error" | "invalid_response" | "missing_content" | "invalid_json",
    readonly httpStatus?: number,
  ) {
    const messages = {
      http_error: `session activity review failed: ${httpStatus}`,
      invalid_response: "session activity reviewer returned invalid response JSON",
      missing_content: "session activity reviewer returned no content",
      invalid_json: "session activity reviewer returned non-JSON content",
    };
    super(messages[failureKind]);
    this.name = "SessionActivityProviderError";
  }
}
