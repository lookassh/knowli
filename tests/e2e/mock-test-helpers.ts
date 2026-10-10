import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createDatabase, createServices, upsertAssignment } from "@learning/server";
import { readTestRunConfig } from "../test-run-config";
import { mockTestDeck } from "../fixtures/mock-test-world";
export async function seedMockTest(count = 3, known = true, recent = false) {
  const world = JSON.parse(await readFile(join(process.cwd(), readTestRunConfig(process.env).worldFile), "utf8")) as { databaseUrl: string };
  const database = createDatabase(world.databaseUrl);
  try {
    const services = createServices({ db: database.db, clock: { now: () => new Date(Date.now() - (recent ? 0 : 13 * 3_600_000)) } });
    const data = await mockTestDeck(services, database.pool, 15, known);
    await upsertAssignment(services, data.childId, data.deckId, null, { testGoals: ["recall", "spelling"], mockTestTaskCount: count });
    return data;
  } finally { await database.pool.end(); }
}
