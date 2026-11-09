import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "../../errors";
import { errorCodeOf } from "./generation-runtime";

function fsError(code: string): Error {
  const error = new Error(`fs failure ${code}`) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

describe("errorCodeOf (#385)", () => {
  it.each(["ENOSPC", "EACCES", "EROFS"])("klasyfikuje %s zapisu mediów jako media_storage", (code) => {
    expect(errorCodeOf(fsError(code))).toBe("media_storage");
  });

  it("rozpoznaje kod systemowy w łańcuchu cause", () => {
    const wrapped = new Error("store failed", { cause: new Error("write failed", { cause: fsError("ENOSPC") }) });
    expect(errorCodeOf(wrapped)).toBe("media_storage");
  });

  it("rozpoznaje zwykły obiekt z kodem systemowym", () => {
    expect(errorCodeOf({ code: "EROFS" })).toBe("media_storage");
  });

  it.each(["EIO", "ENOENT", "EEXIST"])("zachowuje dotychczasową klasyfikację dla %s", (code) => {
    expect(errorCodeOf(fsError(code))).toBe("provider");
  });

  it("zachowuje validation dla błędów walidacji i provider dla pozostałych", () => {
    let zodError: unknown;
    try {
      z.object({ a: z.string() }).parse({});
    } catch (error) {
      zodError = error;
    }
    expect(errorCodeOf(zodError)).toBe("validation");
    expect(errorCodeOf(new AppError("validation"))).toBe("validation");
    expect(errorCodeOf(new Error("provider down"))).toBe("provider");
    expect(errorCodeOf("boom")).toBe("provider");
    expect(errorCodeOf(null)).toBe("provider");
  });

  it("nie zapętla się na cyklicznym cause", () => {
    const cyclic: { cause?: unknown } = new Error("cyclic");
    cyclic.cause = cyclic;
    expect(errorCodeOf(cyclic)).toBe("provider");
  });
});
