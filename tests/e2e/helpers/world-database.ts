import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createDatabase } from "@learning/server";
import { readTestRunConfig } from "../../test-run-config";

let database: ReturnType<typeof createDatabase> | null = null;

export async function worldPool(): Promise<ReturnType<typeof createDatabase>["pool"]> {
  if (!database) {
    const worldPath = join(process.cwd(), readTestRunConfig(process.env).worldFile);
    const world = JSON.parse(await readFile(worldPath, "utf8")) as { databaseUrl?: string };
    if (!world.databaseUrl) throw new Error(`Brak databaseUrl w konfiguracji świata E2E: ${worldPath}`);
    database = createDatabase(world.databaseUrl);
  }
  return database.pool;
}

export async function closeWorldDatabase(): Promise<void> {
  await database?.pool.end();
  database = null;
}
