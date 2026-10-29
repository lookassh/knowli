import { describe, expect, it, vi } from "vitest";
import { messages, type SubjectCatalogDto } from "@learning/contracts";
import NewLessonForm, { canSubmitLesson, defaultPoolSize, initialLessonValues, type NewLessonValues } from "./NewLessonForm";
import { renderParentMarkup } from "../test-render";

const catalog = {
  subjects: [
    {
      id: "english_grammar",
      titlePl: "Gramatyka angielska",
      topics: [{
        id: "present_simple",
        titlePl: "Present Simple",
        objectives: [
          { id: "third_person_s", titlePl: "-s w 3. osobie" },
          { id: "negation", titlePl: "Przeczenia" },
        ],
      }],
    },
    { id: "school", titlePl: "Przedmiot szkolny", topics: [] },
  ],
} as unknown as SubjectCatalogDto;

const values = (overrides: Partial<NewLessonValues> = {}): NewLessonValues => ({
  ...initialLessonValues(catalog),
  material: "He plays football.",
  ...overrides,
});

describe("NewLessonForm", () => {
  it("domyślna pula: większa z 60 i 12 × liczba reguł, w granicach 20–120", () => {
    expect(defaultPoolSize(0)).toBe(60);
    expect(defaultPoolSize(6)).toBe(72);
    expect(defaultPoolSize(20)).toBe(120);
  });

  it("wartości startowe z katalogu: pierwszy przedmiot i temat, wszystkie reguły", () => {
    expect(initialLessonValues(catalog)).toMatchObject({
      subjectId: "english_grammar",
      topicId: "present_simple",
      objectiveIds: ["third_person_s", "negation"],
      poolSize: 60,
      poolSizeTouched: false,
    });
    expect(initialLessonValues(undefined).subjectId).toBe("");
  });

  it("lekcja z katalogu wymaga reguły, materiału i puli 20–120", () => {
    expect(canSubmitLesson(values(), catalog)).toBe(true);
    expect(canSubmitLesson(values({ objectiveIds: [] }), catalog)).toBe(false);
    expect(canSubmitLesson(values({ material: "   " }), catalog)).toBe(false);
    expect(canSubmitLesson(values({ material: "x".repeat(8001) }), catalog)).toBe(false);
    for (const poolSize of [19, 121, 20.5, ""]) expect(canSubmitLesson(values({ poolSize }), catalog), String(poolSize)).toBe(false);
    expect(canSubmitLesson(values({ poolSize: 120 }), catalog)).toBe(true);
  });

  it("przedmiot szkolny wymaga nazw przedmiotu i tematu, pula do 160", () => {
    const school = values({ subjectId: "school", topicId: "", objectiveIds: [] });
    expect(canSubmitLesson(school, catalog)).toBe(false);
    const named = { ...school, schoolSubjectName: "Geografia", schoolTopicName: "Mapa" };
    expect(canSubmitLesson(named, catalog)).toBe(true);
    expect(canSubmitLesson({ ...named, poolSize: 160 }, catalog)).toBe(true);
    expect(canSubmitLesson({ ...named, poolSize: 161 }, catalog)).toBe(false);
  });

  it("renderuje powrót do listy i tytuł przed wczytaniem katalogu", () => {
    const markup = renderParentMarkup(<NewLessonForm onCreated={vi.fn()} onCancel={vi.fn()} registerEditorState={vi.fn()} />);
    expect(markup).toContain('data-testid="new-lesson-form"');
    expect(markup).toContain('data-testid="new-lesson-cancel"');
    expect(markup).toContain(messages.lessons.newLessonTitle);
  });
});
