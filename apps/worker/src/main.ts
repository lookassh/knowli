import { createServer } from "node:http";
import { buildWorkerServices } from "./composition";
import { processDueWork } from "./tasks";

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 2000);
const HEALTH_PORT = Number(process.env.WORKER_HEALTH_PORT ?? 9301);

/** Pętla workera z graceful shutdown: przeloty są bezpieczne do przerwania. */
async function main(): Promise<void> {
  const { services, pool } = buildWorkerServices();
  let running: Promise<unknown> = Promise.resolve();
  let stopping = false;
  let lastPassAt: Date | null = null;

  // Healthcheck orkiestratora (Compose/Coolify): odpowiadamy, dopóki żyje
  // proces i pętla przelotów; słucha tylko na localhost wewnątrz kontenera.
  const health = createServer((request, response) => {
    const ok = request.url === "/health";
    response.writeHead(ok ? 200 : 404, { "content-type": "application/json" });
    response.end(
      ok
        ? JSON.stringify({ status: "ok", lastPassAt: lastPassAt?.toISOString() ?? null })
        : "{}",
    );
  });
  health.listen(HEALTH_PORT, "127.0.0.1");

  const timer = setInterval(() => {
    if (stopping) {
      return;
    }
    running = running
      .then(async () => {
        await processDueWork(services);
        lastPassAt = new Date();
      })
      .catch((error: unknown) => {
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
    health.close();
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
