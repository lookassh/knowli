import { describe, expect, it } from "vitest";
import { LessonMaterialCreateInputSchema } from "./lesson-authoring";

const card = { title: "Karta", body: "Treść karty." };
const objective = { titlePl: "Nogi pająka", descriptionEn: "Spiders have eight legs.", cards: [card, card] };
const valid = {
  clientRequestId: "6f1d3c52-4a63-4a8e-9c53-0d6f6a1b2c3d",
  subjectId: "school-science",
  topicTitlePl: "Pająki",
  material: "Pająki mają osiem nóg.",
  objectives: [objective],
};
const rejects = (patch: object) => LessonMaterialCreateInputSchema.safeParse({ ...valid, ...patch }).success;
const withObjective = (o: object) => rejects({ objectives: [{ ...objective, ...o }] });

describe("lesson_material_create", () => {
  it("limity równe progom rdzenia", () => {
    expect(LessonMaterialCreateInputSchema.safeParse(valid).success).toBe(true);
    expect(withObjective({ slug: "nogi_pajaka" })).toBe(true);
    expect(withObjective({ cards: [card] })).toBe(false);
    expect(withObjective({ cards: [card, card, card, card, card] })).toBe(false);
    expect(withObjective({ descriptionEn: "a".repeat(401) })).toBe(false);
    expect(withObjective({ cards: [{ ...card, body: "a".repeat(601) }, card] })).toBe(false);
    expect(rejects({ objectives: Array(9).fill(objective) })).toBe(false);
    expect(withObjective({ kind: "other" })).toBe(false);
    for (const slug of ["Ź", "a__b", "_a", "a_"]) expect(withObjective({ slug })).toBe(false);
    expect(withObjective({ cards: [{ ...card, body: "x {{examples}}" }, card] })).toBe(false);
    expect(rejects({ extra: 1 })).toBe(false);
    expect(withObjective({ extra: 1 })).toBe(false);
    expect(withObjective({ cards: [{ ...card, extra: 1 }, card] })).toBe(false);
  });
});
