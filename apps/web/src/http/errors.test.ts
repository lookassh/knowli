import { format } from "node:util";
import { messages } from "@learning/contracts";
import { AppError } from "@learning/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorResponse } from "./errors";

// #401: log granicy withApi niesie wyłącznie bezpieczne metadane jak enkoder
// oRPC (orpc/handler.test.ts) — nigdy surową przyczynę ani jej treść (CWE-532).
describe("errorResponse — log wyłącznie bezpiecznych metadanych (#401)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function captureLog(run: () => unknown): string {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    run();
    // util.format jak prawdziwy console.error — inaczej obiekty degenerują się do [object Object]
    return log.mock.calls.map((parts) => format(...parts)).join(" | ");
  }

  it("surowy błąd z treścią SQL: loguje kod, requestId, komunikat katalogu i nazwę klasy, nie treść", () => {
    const canary = "FAKE_SQL_WITH_CHILD_ANSWER_CANARY";
    const raw = new Error(`insert into attempts values ('${canary}')`);

    const logged = captureLog(() => errorResponse(raw, "00000000-0000-4000-8000-00000000040a"));

    expect(logged).not.toContain(canary);
    expect(logged).not.toContain("insert into");
    expect(logged).toContain("internal");
    expect(logged).toContain("00000000-0000-4000-8000-00000000040a");
    expect(logged).toContain(messages.errors.internal);
    expect(logged).toContain("Error");
  });

  it("AppError z własnym komunikatem i przyczyną-obiektem: żaden canary nie trafia do logu", () => {
    const messageCanary = "FAKE_ITEM_TARGET_CANARY";
    const causeCanary = "FAKE_CAUSE_PAYLOAD_CANARY";
    const err = new AppError("validation", {
      message: `item.target ${messageCanary} is invalid`,
      cause: { invalidData: { answer: causeCanary } },
    });

    const logged = captureLog(() => errorResponse(err, "00000000-0000-4000-8000-00000000040b"));

    expect(logged).not.toContain(messageCanary);
    expect(logged).not.toContain(causeCanary);
    expect(logged).not.toContain("invalidData");
    expect(logged).toContain("validation");
    expect(logged).toContain("00000000-0000-4000-8000-00000000040b");
    expect(logged).toContain(messages.errors.validation);
  });

  it("przyczyna AppError: loguje tylko jej kod; błąd sterownika: tylko jego kod SQLSTATE", () => {
    const chained = new AppError("internal", {
      cause: new AppError("conflict", { message: "FAKE_CHAINED_MESSAGE_CANARY" }),
    });
    const loggedChained = captureLog(() => errorResponse(chained, "00000000-0000-4000-8000-00000000040c"));
    expect(loggedChained).not.toContain("FAKE_CHAINED_MESSAGE_CANARY");
    expect(loggedChained).toContain("conflict");

    const pgLike = Object.assign(new Error("duplicate key FAKE_PG_DETAIL_CANARY"), { code: "23505" });
    const loggedPg = captureLog(() => errorResponse(pgLike, "00000000-0000-4000-8000-00000000040d"));
    expect(loggedPg).not.toContain("FAKE_PG_DETAIL_CANARY");
    expect(loggedPg).toContain("23505");
  });
});
