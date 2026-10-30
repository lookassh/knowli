import { describe, expect, it } from "vitest";
import { SubjectCatalogDtoSchema } from "@learning/contracts";
import { createServices } from "../../../config";
import { lessonCatalog } from "./lesson-api";

describe("lessonCatalog (sposób tworzenia zestawu per przedmiot)", () => {
  const catalog = lessonCatalog(createServices({ db: {} as never }));
  const byId = (id: string) => catalog.subjects.find((subject) => subject.id === id);

  it("zwraca poprawny kontrakt katalogu", () => {
    expect(SubjectCatalogDtoSchema.safeParse(catalog).success).toBe(true);
  });

  it("przedmiot z tematami katalogowymi: creation catalog, bez nazwy od rodzica", () => {
    expect(byId("english_grammar")).toMatchObject({ creation: "catalog", subjectTitleRequired: false });
    expect(byId("english_grammar")!.topics.length).toBeGreaterThan(0);
  });

  it("szkoła: z materiału, rodzic nazywa przedmiot", () => {
    expect(byId("school")).toMatchObject({ creation: "material", subjectTitleRequired: true, topics: [] });
  });

  it("rozdział angielski: z materiału, stały tytuł przedmiotu", () => {
    expect(byId("english_chapter")).toMatchObject({
      titlePl: "Angielski — rozdział",
      creation: "material",
      subjectTitleRequired: false,
      topics: [],
    });
  });
});
