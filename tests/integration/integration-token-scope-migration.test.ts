import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { migrateDatabase } from "@learning/server";
import { openQuietDatabase, testDatabaseUrl, waitForDatabaseIdle } from "./helpers";

/**
 * Migracja 0041 (jeden zakres na token, `lessons:write`) na istniejących wierszach: prywatna baza
 * zmigrowana do 0040 z obciętego dziennika, potem pełny dziennik (wzorzec `session-activity-migration`).
 */

const migrationsFolder = path.resolve("packages/server/drizzle");
const adminPool = openQuietDatabase(testDatabaseUrl()).pool;
afterAll(async () => { await adminPool.end(); });

async function databaseAt0040(temporaryFolder: string): Promise<string> {
  const databaseName = `token_scope_${randomUUID().replaceAll("-", "")}`;
  const databaseUrl = new URL(testDatabaseUrl());
  databaseUrl.pathname = `/${databaseName}`;
  const fullJournal = JSON.parse(await readFile(path.join(migrationsFolder, "meta/_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };
  const legacyEntries = fullJournal.entries.slice(0, fullJournal.entries.findIndex(({ tag }) => tag.startsWith("0041_")));
  expect(legacyEntries.at(-1)?.tag).toMatch(/^0040_/);
  const legacyFolder = path.join(temporaryFolder, "legacy");
  await mkdir(path.join(legacyFolder, "meta"), { recursive: true });
  await writeFile(path.join(legacyFolder, "meta/_journal.json"), JSON.stringify({ ...fullJournal, entries: legacyEntries }));
  for (const { tag } of legacyEntries) await copyFile(path.join(migrationsFolder, `${tag}.sql`), path.join(legacyFolder, `${tag}.sql`));
  await adminPool.query(`CREATE DATABASE "${databaseName}"`);
  await migrateDatabase(databaseUrl.toString(), legacyFolder);
  return databaseUrl.toString();
}

async function dropDatabase(databaseUrl: string): Promise<void> {
  const name = new URL(databaseUrl).pathname.replace("/", "");
  await waitForDatabaseIdle(adminPool, name);
  await adminPool.query(`DROP DATABASE "${name}" WITH (FORCE)`);
}

describe("migracja 0041 — jeden zakres tokenu integracji", () => {
  it("zostawia tokeny z jednym zakresem, zwija powtórzony zakres i usuwa token bez zakresu", async () => {
    const temporaryFolder = await mkdtemp(path.join(tmpdir(), "knowli-token-scope-"));
    let databaseUrl: string | undefined;
    try {
      databaseUrl = await databaseAt0040(temporaryFolder);
      const [single, duplicated, empty] = [randomUUID(), randomUUID(), randomUUID()];
      const seed = openQuietDatabase(databaseUrl);
      try {
        await seed.pool.query(
          `insert into learning_app.integration_tokens (id, name, token_hash, scopes) values
             ($1, 'single', 'hash-single', '{learning:read}'),
             ($2, 'duplicated', 'hash-duplicated', '{learning:read,learning:read}'),
             ($3, 'empty', 'hash-empty', '{}')`,
          [single, duplicated, empty],
        );
      } finally { await seed.pool.end(); }

      await migrateDatabase(databaseUrl, migrationsFolder);

      const verify = openQuietDatabase(databaseUrl);
      try {
        const rows = (await verify.pool.query("select id, scopes from learning_app.integration_tokens order by name")).rows;
        expect(rows).toEqual([
          { id: duplicated, scopes: ["learning:read"] },
          { id: single, scopes: ["learning:read"] },
        ]);
      } finally { await verify.pool.end(); }
    } finally {
      if (databaseUrl) await dropDatabase(databaseUrl).catch(() => undefined);
      await rm(temporaryFolder, { recursive: true, force: true });
    }
  });
});
