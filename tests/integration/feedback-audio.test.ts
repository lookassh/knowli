import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { authorizeFeedbackAudio } from "@learning/server";
import { buildTestServices, testDatabase } from "./helpers";

const { pool } = testDatabase();
afterAll(async () => { await pool.end(); });

describe("autoryzacja odsłuchu wzorca (PostgreSQL)", () => {
  it("odrzuca identyfikator próby bez feedbacku mowy", async () => {
    const { services } = buildTestServices();
    await expect(authorizeFeedbackAudio(services, randomUUID())).rejects.toMatchObject({ code: "not_found" });
  });
});
