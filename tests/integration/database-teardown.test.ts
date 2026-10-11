import { randomUUID } from "node:crypto";
import { createDatabase } from "@learning/server";
import { describe, expect, it } from "vitest";
import { openQuietDatabase, testDatabase, testDatabaseUrl, waitForDatabaseIdle } from "./helpers";

/**
 * Regression trybu B flaków CI: run padał jednym nieobsłużonym błędem 57P01 mimo
 * 183/183 zielonych testów. Pool.end() w pg rozwiązuje się, zanim sockety klientów
 * się zamkną, a DROP DATABASE ... WITH (FORCE) z teardownu ubija wtedy półotwarte
 * backendy — FATAL wraca jako nieobsłużony event 'error' puli. Te helpery pilnują,
 * żeby przed DROP nie było żywych backendów, a późne błędy puli nie zabijały runu.
 */
describe("teardown bazy per-testowej", () => {
  it("waitForDatabaseIdle czeka na zamknięcie ostatniego backendu i dopiero wtedy rozwiązuje", async () => {
    const admin = testDatabase();
    const databaseName = `teardown_idle_${randomUUID().replaceAll("-", "")}`;
    await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
    const url = new URL(testDatabaseUrl());
    url.pathname = `/${databaseName}`;
    const held = createDatabase(url.toString());
    try {
      await held.pool.query("select 1");

      await expect(waitForDatabaseIdle(admin.pool, databaseName, 300)).rejects.toThrow(/wciąż aktywne backendy/);

      await held.pool.end();
      await expect(waitForDatabaseIdle(admin.pool, databaseName, 5_000)).resolves.toBeUndefined();
    } finally {
      await admin.pool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`).catch(() => undefined);
    }
  });

  it("openQuietDatabase zamienia późne ubicie backendu (57P01) w obsługany event, nie nieobsłużony wyjątek", async () => {
    const admin = testDatabase();
    const databaseName = `teardown_quiet_${randomUUID().replaceAll("-", "")}`;
    await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
    const url = new URL(testDatabaseUrl());
    url.pathname = `/${databaseName}`;
    const { pool } = openQuietDatabase(url.toString());
    try {
      // kontrakt guarda: pula ma własny listener 'error', zanim test doda swój —
      // bez niego późny 57P01 staje się nieobsłużonym wyjątkiem całego runu
      expect(pool.listenerCount("error")).toBeGreaterThan(0);
      const { rows } = await pool.query("select pg_backend_pid() as pid");
      const pid = rows[0]!.pid as number;
      const lateError = new Promise<Error>((resolve) => pool.once("error", resolve));
      await admin.pool.query("select pg_terminate_backend($1)", [pid]);
      const error = await lateError;
      expect((error as NodeJS.ErrnoException & { code?: string }).code ?? String(error)).toMatch(/57P01|terminating connection|administrator command/);
    } finally {
      await pool.end().catch(() => undefined);
      await admin.pool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`).catch(() => undefined);
    }
  });
});
