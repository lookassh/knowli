import type { Pool } from "pg";
import {
  createDatabase,
  createServices,
  systemClock,
  type Services,
} from "@learning/server";

let current: { services: Services; pool: Pool } | undefined;

/** Złożenie zależności serwerowych dla web; singleton na czas życia procesu. */
export function getServerServices(): Services {
  current ??= initialize();
  return current.services;
}

function initialize(): { services: Services; pool: Pool } {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }
  const { db, pool } = createDatabase(databaseUrl);
  return { services: createServices({ db, clock: systemClock }), pool };
}

/** Wyłącznie na potrzeby testów i graceful shutdown. */
export async function disposeServerServices(): Promise<void> {
  if (current) {
    await current.pool.end();
    current = undefined;
  }
}
