import { describe, expect, it } from "vitest";
import { openQuietDatabase, testDatabaseUrl } from "./helpers";

// Indeksy pod udokumentowane filtry historii i raportów (migracja 0022).
// Global-setup migruje świeżą bazę wyłącznie z SQL, więc ten test dowodzi
// kształtu indeksów z migracji; zgodność nazw ze schema.ts pilnuje review.
const EXPECTED_INDEXES: Record<string, string> = {
  assessments_child_skill_idx: "ON learning_app.assessments USING btree (child_id, skill_version_id, skill)",
  attempts_child_received_idx: "ON learning_app.attempts USING btree (child_id, received_at DESC)",
  attempts_item_revision_idx: "ON learning_app.attempts USING btree (item_revision_id)",
  session_tasks_child_issued_idx: "ON learning_app.session_tasks USING btree (child_id, issued_at)",
  session_tasks_revision_issued_idx: "ON learning_app.session_tasks USING btree (item_revision_id, issued_at)",
  learning_events_child_occurred_idx: "ON learning_app.learning_events USING btree (child_id, occurred_at DESC)",
  event_exposures_child_target_idx: "ON learning_app.event_exposures USING btree (child_id, target_key)",
};

describe("indeksy historii nauki", () => {
  it("istnieją z właściwymi tabelami i kolumnami po migracji świeżej bazy", async () => {
    const { pool } = openQuietDatabase(testDatabaseUrl());
    try {
      const { rows } = await pool.query<{ indexname: string; indexdef: string }>(
        "select indexname, indexdef from pg_indexes where schemaname = 'learning_app' and indexname = any($1::text[])",
        [Object.keys(EXPECTED_INDEXES)],
      );
      const byName = new Map(rows.map((row) => [row.indexname, row.indexdef]));
      for (const [name, expectedDef] of Object.entries(EXPECTED_INDEXES)) {
        expect(byName.get(name), name).toContain(expectedDef);
      }
      expect(byName.size).toBe(Object.keys(EXPECTED_INDEXES).length);
    } finally {
      await pool.end();
    }
  });
});
