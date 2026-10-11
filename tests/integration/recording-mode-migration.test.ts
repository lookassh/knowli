import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, copyFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDatabase, migrateDatabase } from "@learning/server";
import { testDatabaseUrl } from "./helpers";

const migrationsFolder = path.resolve("packages/server/drizzle");

describe("migracja trybu nagrywania", () => {
  it("ustawia hold na istniejącym profilu i zachowuje jego dane", async () => {
    const temporaryFolder = await mkdtemp(path.join(tmpdir(), "knowli-recording-mode-"));
    const adminUrl = new URL(testDatabaseUrl());
    const databaseName = `recording_mode_${randomUUID().replaceAll("-", "")}`;
    const databaseUrl = new URL(adminUrl);
    databaseUrl.pathname = `/${databaseName}`;
    const adminPool = createDatabase(testDatabaseUrl()).pool;

    try {
      const journal = JSON.parse(await readFile(path.join(migrationsFolder, "meta/_journal.json"), "utf8")) as {
        entries: unknown[];
      };
      journal.entries = journal.entries.slice(0, 5);
      const metaFolder = path.join(temporaryFolder, "meta");
      await mkdir(metaFolder);
      await writeFile(path.join(metaFolder, "_journal.json"), JSON.stringify(journal));
      for (const file of [
        "0000_mean_patch.sql",
        "0001_guards_and_seed.sql",
        "0002_progress_needs_reconfirmation.sql",
        "0003_child_policy.sql",
        "0004_mock_tests.sql",
      ]) {
        await copyFile(path.join(migrationsFolder, file), path.join(temporaryFolder, file));
      }

      await adminPool.query(`CREATE DATABASE "${databaseName}"`);
      await migrateDatabase(databaseUrl.toString(), temporaryFolder);
      const oldPool = createDatabase(databaseUrl.toString()).pool;
      const childId = randomUUID();
      try {
        await oldPool.query(
          "insert into learning_app.child_profiles (id, display_name, avatar_key) values ($1, $2, $3)",
          [childId, "Ola", "fox"],
        );
      } finally {
        await oldPool.end();
      }

      await expect(readFile(path.join(migrationsFolder, "0005_child_recording_mode.sql"), "utf8"))
        .resolves.toContain("recording_mode");
      await migrateDatabase(databaseUrl.toString(), migrationsFolder);
      const upgradedPool = createDatabase(databaseUrl.toString()).pool;
      try {
        const { rows } = await upgradedPool.query(
          "select display_name, avatar_key, recording_mode from learning_app.child_profiles where id = $1",
          [childId],
        );
        expect(rows).toEqual([{ display_name: "Ola", avatar_key: "fox", recording_mode: "hold" }]);
      } finally {
        await upgradedPool.end();
      }
    } finally {
      await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`).catch(() => undefined);
      await adminPool.end();
      await rm(temporaryFolder, { recursive: true, force: true });
    }
  });
});
