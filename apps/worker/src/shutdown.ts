import type { UsageRecorder } from "@learning/server";

/**
 * Zamknięcie workera (spec llm-cost-tracking §4.3): najpierw pętla kończy
 * bieżącą pracę, potem recorder dopisuje zaległe koszty, a dopiero na końcu
 * zamyka się pula, przez którą te koszty piszą. Nieudany flush nie blokuje
 * zamknięcia puli — recorder i tak nie rzuca, to tylko zabezpieczenie; błąd
 * kroku trafia do logu samym kodem, bez treści.
 */
export async function shutdownWorker(deps: {
  loop: { stop(): Promise<void> };
  usage: UsageRecorder;
  pool: { end(): Promise<void> };
  poolEndTimeoutMs?: number;
}): Promise<void> {
  // Błąd jednego kroku nie może pominąć kolejnych: pula i tak musi się zamknąć.
  await deps.loop.stop().catch((error: unknown) => logStepFailure("loop.stop", error));
  await deps.usage.flush().catch((error: unknown) => logStepFailure("usage.flush", error));
  // `pool.end` czeka na klienty w użyciu (np. insert porzucony przez flush przy zawieszonej
  // bazie, #410); po terminie wychodzimy, a proces kończy `process.exit` w main.ts.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), deps.poolEndTimeoutMs ?? POOL_END_TIMEOUT_MS); });
  try {
    if (await Promise.race([deps.pool.end(), deadline]) === "timeout") {
      console.error("[worker] shutdown step failed", { step: "pool.end", code: "timeout" });
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Mieści się, razem z 5 s flush kosztów, w typowym czasie łaski zatrzymania kontenera. */
const POOL_END_TIMEOUT_MS = 3000;

/** Sam kod błędu (np. SQLSTATE, `ECONNRESET`, nazwa klasy) — bez komunikatu i treści. */
function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" || typeof code === "number") return String(code);
  return error instanceof Error ? error.name : "unknown";
}

function logStepFailure(step: string, error: unknown): void {
  console.error("[worker] shutdown step failed", { step, code: errorCode(error) });
}
