import { describe, expect, it } from "vitest";
import { MalformedResponseError, ORPCError } from "@orpc/client";
import { messages } from "@learning/contracts";
import { ApiCallError, errorMessage } from "./api";

describe("errorMessage", () => {
  it("reads the server message from the envelope of a raw oRPC error (TanStack queries)", () => {
    const error = new ORPCError("INTERNAL_SERVER_ERROR", { data: { envelope: { message: "Błąd raportu" }, status: 500 } });
    expect(errorMessage(error)).toBe("Błąd raportu");
  });

  it("falls back to the generic message when the envelope has none", () => {
    expect(errorMessage(new ORPCError("INTERNAL_SERVER_ERROR"))).toBe(messages.errors.internal);
    expect(errorMessage("x")).toBe(messages.errors.internal);
  });

  it("shows the generic Polish message for unreadable responses and schema mismatches", () => {
    expect(errorMessage(new MalformedResponseError({ response: { status: 502, headers: {}, body: "<html>Bad gateway</html>" } } as never))).toBe(messages.errors.internal);
    expect(errorMessage(new SyntaxError("Unexpected token <"))).toBe(messages.errors.internal);
    const zodError = Object.assign(new Error("[{...}]"), { name: "ZodError" });
    expect(errorMessage(zodError)).toBe(messages.errors.internal);
  });

  it("keeps messages of normalised and network errors", () => {
    expect(errorMessage(new ApiCallError("Sesja wygasła", "unauthorized", 401))).toBe("Sesja wygasła");
    expect(errorMessage(new TypeError("Failed to fetch"))).toBe("Failed to fetch");
  });
});
