import { Client } from "pg";

export interface DatabaseReadinessOptions {
  /** Odstęp między próbami handshake'u. */
  intervalMs?: number;
  /** Całkowity limit czekania na gotowość. */
  timeoutMs?: number;
  /** Podmienialny probe — testy jednostkowe nie stawiają Postgresa. */
  probe?: (connectionString: string) => Promise<void>;
}

/**
 * Realny handshake (connect + SELECT 1) po dokładnie tym URL-u, po którym biegną
 * migracje. pg_isready po unix sockecie wewnątrz kontenera potrafi zgłosić gotowość
 * podczas tymczasowego serwera entrypointa (listen_addresses='') — wtedy port TCP
 * hosta jeszcze nie słucha i pierwsza migracja dostaje ECONNRESET.
 */
async function probePostgres(connectionString: string): Promise<void> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 2_000 });
  try {
    await client.connect();
    await client.query("SELECT 1");
  } finally {
    await client.end().catch(() => undefined);
  }
}

function redactCredentials(connectionString: string): string {
  return connectionString.replace(/\/\/([^:@/\s]+):([^@/\s]+)@/, "//$1:***@");
}

export async function waitUntilDatabaseReady(
  connectionString: string,
  options: DatabaseReadinessOptions = {},
): Promise<void> {
  const intervalMs = options.intervalMs ?? 250;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const probe = options.probe ?? probePostgres;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await probe(connectionString);
      return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    `PostgreSQL nie odpowiedział handshake'em na ${redactCredentials(connectionString)} w ${timeoutMs} ms` +
      (lastError === undefined ? "" : ` (ostatnia przyczyna: ${String(lastError)})`),
  );
}
