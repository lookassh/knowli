import { join } from "node:path";
import { migrateDatabase } from "@learning/server";

/**
 * Jednorazowe migracje przy starcie stacka (deploy/compose.yaml, serwis
 * `migrate`). Stosuje przeglądane migracje Drizzle z packages/server/drizzle —
 * tabelę kolejki tworzą te same migracje (pętla workera odpytuje bazę).
 */
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }
  const migrationsFolder = join(process.cwd(), "packages/server/drizzle");
  console.log("[migrate] stosuję przeglądane migracje Drizzle…");
  await migrateDatabase(databaseUrl, migrationsFolder);
  console.log("[migrate] gotowe");
}

void main();
