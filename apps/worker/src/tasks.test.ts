import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@learning/server", () => ({
  runDueGenerationWork: vi.fn(async () => ({ processed: 0 })),
  cleanupExpiredActivityReports: vi.fn(async () => 0),
}));

import { cleanupExpiredActivityReports, runDueGenerationWork, type Services } from "@learning/server";

// Serwis przechodzi wyłącznie do zamockowanych funkcji — pusty obiekt wystarcza.
const services = {} as Services;

// Stan "ostatniego czyszczenia" jest module-level — każdy test dostaje świeży moduł.
async function freshProcessDueWork(): Promise<typeof import("./tasks")["processDueWork"]> {
  vi.resetModules();
  return (await import("./tasks")).processDueWork;
}

/**
 * Retencja raportu aktywności: worker czyści wygasły JSONB najwyżej raz na
 * godzinę; błąd czyszczenia nie psuje przebiegu generacji (bez rethrow).
 */
describe("worker processDueWork activity cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs cleanup on the first pass, skips within an hour and runs again after an hour", async () => {
    const processDueWork = await freshProcessDueWork();
    await processDueWork(services);
    expect(cleanupExpiredActivityReports).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30 * 60_000);
    await processDueWork(services);
    expect(cleanupExpiredActivityReports).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(31 * 60_000);
    await processDueWork(services);
    expect(cleanupExpiredActivityReports).toHaveBeenCalledTimes(2);
  });

  it("keeps the generation pass intact when cleanup fails", async () => {
    vi.mocked(cleanupExpiredActivityReports).mockRejectedValue(new Error("cleanup failed"));
    const processDueWork = await freshProcessDueWork();
    await expect(processDueWork(services)).resolves.toEqual({ processed: 0 });
    expect(runDueGenerationWork).toHaveBeenCalledTimes(1);
    expect(cleanupExpiredActivityReports).toHaveBeenCalledTimes(1);
  });
});
