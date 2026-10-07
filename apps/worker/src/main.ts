import { buildWorkerServices } from "./composition";
import { processDueWork } from "./tasks";

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 2000);

/** Pętla workera z graceful shutdown: przeloty są bezpieczne do przerwania. */
async function main(): Promise<void> {
  const { services, pool } = buildWorkerServices();
  let running: Promise<unknown> = Promise.resolve();
  let stopping = false;

  const timer = setInterval(() => {
    if (stopping) {
      return;
    }
    running = running.then(() => processDueWork(services)).catch((error: unknown) => {
      console.error("[worker] przelot zakończony błędem:", error);
    });
  }, POLL_MS);

  const shutdown = (signal: string) => {
    if (stopping) {
      return;
    }
    stopping = true;
    console.log(`[worker] ${signal}: czekam na bieżący przelot i zamykam`);
    clearInterval(timer);
    running
      .catch(() => undefined)
      .finally(() => {
        pool.end().finally(() => process.exit(0));
      });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

void main();
