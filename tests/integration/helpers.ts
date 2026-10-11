import { inject } from "vitest";
import {
  createDatabase,
  createServices,
  type Clock,
  type Services,
} from "@learning/server";

export function testDatabaseUrl(): string {
  // klucze provide() z global-setup nie są statycznie typowane w Vitest 3
  const url = (inject as (key: string) => unknown)("DATABASE_URL");
  if (typeof url !== "string" || !url) {
    throw new Error("Brak DATABASE_URL z global-setup");
  }
  return url;
}

/** Zegar sterowany ręcznie — testy domeny i limity czasu nie śpią. */
export class ManualClock implements Clock {
  #now: Date;

  constructor(startIso = "2026-10-07T16:00:00.000Z") {
    this.#now = new Date(startIso);
  }

  now(): Date {
    return this.#now;
  }

  advanceMs(ms: number): void {
    this.#now = new Date(this.#now.getTime() + ms);
  }

  advanceHours(hours: number): void {
    this.advanceMs(hours * 3_600_000);
  }
}

let shared: ReturnType<typeof createDatabase> | undefined;

/** Jedna współdzielona pula dla pliku testowego. */
export function testDatabase(): ReturnType<typeof createDatabase> {
  shared ??= createDatabase(testDatabaseUrl());
  return shared;
}

/** Świeży Services (osobny limiter logowania) na współdzielonym połączeniu. */
export function buildTestServices(startIso?: string): { services: Services; clock: ManualClock } {
  const { db } = testDatabase();
  const clock = new ManualClock(startIso);
  return { services: createServices({ db, clock }), clock };
}

/** Osobna pula symuluje restart procesu przy tym samym DATABASE_URL. */
export function openRestartedServices(): { services: Services; dispose: () => Promise<void> } {
  const { db, pool } = createDatabase(testDatabaseUrl());
  const services = createServices({ db, clock: new ManualClock() });
  return { services, dispose: () => pool.end() };
}

export async function truncateCoreTables(): Promise<void> {
  const { pool } = testDatabase();
  // CASCADE czyści również tabele historyczne referencjonujące profile; TRUNCATE nie
  // uruchamia triggerów BEFORE DELETE, więc omija guards (właściwe w teardown).
  await pool.query(
    "TRUNCATE learning_app.child_profiles, learning_app.parent_sessions, learning_app.parent_credentials, learning_app.integration_tokens CASCADE",
  );
}

export async function countRows(table: string): Promise<number> {
  const { pool } = testDatabase();
  const result = await pool.query(`SELECT count(*)::int AS count FROM learning_app.${table}`);
  return result.rows[0]?.count as number;
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
