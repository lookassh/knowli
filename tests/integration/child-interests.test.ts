import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createChild, deleteChild, listChildren, updateChild } from "@learning/server";
import { buildTestServices, countRows, testDatabase, truncateCoreTables } from "./helpers";

describe("profil — zainteresowania", () => {
  beforeEach(async () => {
    await truncateCoreTables();
  });

  afterAll(async () => {
    const { pool } = testDatabase();
    await pool.end();
  });

  it("nowy profil ma pustą listę zainteresowań", async () => {
    const { services } = buildTestServices();
    const child = await createChild(services, { displayName: "Ala", avatarKey: "fox" });
    expect(child.interests).toEqual([]);
    await expect(listChildren(services)).resolves.toEqual([expect.objectContaining({ id: child.id, interests: [] })]);
  });

  it("updateChild zapisuje zainteresowania w podanej kolejności, a pusta lista je czyści", async () => {
    const { services } = buildTestServices();
    const child = await createChild(services, { displayName: "Ala", avatarKey: "fox" });

    const updated = await updateChild(services, child.id, { interests: ["piłka nożna", "Minecraft"] });
    expect(updated.interests).toEqual(["piłka nożna", "Minecraft"]);
    await expect(listChildren(services)).resolves.toEqual([
      expect.objectContaining({ id: child.id, interests: ["piłka nożna", "Minecraft"] }),
    ]);

    // zmiana innego pola nie rusza listy
    await updateChild(services, child.id, { avatarKey: "owl" });
    await expect(listChildren(services)).resolves.toEqual([
      expect.objectContaining({ interests: ["piłka nożna", "Minecraft"] }),
    ]);

    const cleared = await updateChild(services, child.id, { interests: [] });
    expect(cleared.interests).toEqual([]);
  });

  it("CHECK odrzuca więcej niż 5 elementów i NULL w tablicy", async () => {
    const { services } = buildTestServices();
    const child = await createChild(services, { displayName: "Ala", avatarKey: "fox" });
    const { pool } = testDatabase();

    await expect(pool.query(
      "UPDATE learning_app.child_profiles SET interests = ARRAY['a','b','c','d','e','f'] WHERE id = $1",
      [child.id],
    )).rejects.toMatchObject({ constraint: "child_profiles_interests_valid" });
    await expect(pool.query(
      "UPDATE learning_app.child_profiles SET interests = ARRAY['a', NULL] WHERE id = $1",
      [child.id],
    )).rejects.toMatchObject({ constraint: "child_profiles_interests_valid" });
    await expect(pool.query(
      "INSERT INTO learning_app.child_profiles (id, display_name, avatar_key, interests) VALUES (gen_random_uuid(), 'Ola', 'cat', ARRAY['a','b','c','d','e','f'])",
    )).rejects.toMatchObject({ constraint: "child_profiles_interests_valid" });

    await expect(pool.query(
      "UPDATE learning_app.child_profiles SET interests = ARRAY['a','b','c','d','e'] WHERE id = $1",
      [child.id],
    )).resolves.toBeDefined();
  });

  it("deleteChild usuwa wiersz razem z listą", async () => {
    const { services } = buildTestServices();
    const child = await createChild(services, { displayName: "Ala", avatarKey: "fox" });
    await updateChild(services, child.id, { interests: ["dinozaury"] });

    await deleteChild(services, child.id);

    expect(await countRows("child_profiles")).toBe(0);
  });
});
