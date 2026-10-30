import { describe, expect, it } from "vitest";
import { SubjectCatalogDtoSchema } from "@learning/contracts";
import { createServices } from "../../../config";
import { createSubjectRegistry } from "../../../domain/lessons/registry";
import { englishChapterSubject } from "../../../domain/lessons/subjects/english-chapter/module";
import { lessonCatalog } from "./lesson-api";
import { createLessonFromMaterial, createMaterialLesson } from "./lesson-drafts";

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

  it("temat dynamiczny bez deklaracji tytułu: katalog nie obiecuje tworzenia z materiału, a polecenie je odrzuca", async () => {
    const { materialSubjectTitle: _omitted, ...undeclared } = englishChapterSubject;
    const services = createServices({
      db: {} as never,
      subjects: createSubjectRegistry([{ ...undeclared, id: "undeclared_title" }]),
    });
    expect(lessonCatalog(services).subjects[0]).toMatchObject({ id: "undeclared_title", creation: "catalog", subjectTitleRequired: false });
    const command = { subjectId: "undeclared_title", topicTitlePl: "Unit 1", material: "I like pizza.", clientRequestId: "11111111-1111-4111-8111-111111111111" };
    await expect(createLessonFromMaterial(services, command)).rejects.toMatchObject({ code: "validation" });
    await expect(createMaterialLesson(services, command)).rejects.toMatchObject({ code: "validation" });
  });
});
