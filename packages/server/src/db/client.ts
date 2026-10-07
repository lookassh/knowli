import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema> & { $client: Pool };

/** Typ transakcji Drizzle dla naszego schematu — jawny, bo Parameters<> rozpada się na przeciążeniach. */
export type Tx = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export function createDatabase(connectionString: string): { db: Database; pool: Pool } {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema }) as Database;
  return { db, pool };
}

/** Jednorazowe uruchomienie przeglądanych migracji (deploy, testy). */
export async function migrateDatabase(
  connectionString: string,
  migrationsFolder: string,
): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(pool, { schema }) as Database, { migrationsFolder });
  } finally {
    await pool.end();
  }
}
