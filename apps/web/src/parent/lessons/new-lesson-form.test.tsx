import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { messages, type SubjectCatalogDto } from "@learning/contracts";
import NewLessonForm, { buildCommand, canSubmitLesson, classifyCreateFailure, defaultPoolSize, initialLessonValues, lessonPathOf, type NewLessonValues } from "./NewLessonForm";
import { ApiCallError } from "../api";
import { orpc } from "../query-client";
import { renderParentMarkup } from "../test-render";

const grammar = {
  id: "english_grammar",
  titlePl: "Gramatyka angielska",
  creation: "catalog",
  subjectTitleRequired: false,
  topics: [{
    id: "present_simple",
    titlePl: "Present Simple",
    objectives: [
      { id: "third_person_s", titlePl: "-s w 3. osobie" },
      { id: "negation", titlePl: "Przeczenia" },
    ],
  }],
};
const school = { id: "school", titlePl: "Przedmiot szkolny", creation: "material", subjectTitleRequired: true, topics: [] };
const chapter = { id: "english_chapter", titlePl: "Angielski — rozdział", creation: "material", subjectTitleRequired: false, topics: [] };

const catalog = { subjects: [grammar, school, chapter] } as unknown as SubjectCatalogDto;

const values = (overrides: Partial<NewLessonValues> = {}): NewLessonValues => ({
  ...initialLessonValues(catalog),
  material: "He plays football.",
  ...overrides,
});

/** Formularz z wczytanym katalogiem, w którym pierwszym przedmiotem jest podany (renderowanie statyczne nie wykonuje zapytań). */
function renderWithCatalog(first: unknown): string {
  const queryClient = new QueryClient();
  queryClient.setQueryData(orpc.lessonCatalog.get.queryOptions().queryKey, { subjects: [first] } as unknown as SubjectCatalogDto);
  return renderParentMarkup(<NewLessonForm onCreated={vi.fn()} onCancel={vi.fn()} registerEditorState={vi.fn()} />, queryClient);
}

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

  it("ścieżka tworzenia wynika z creation i subjectTitleRequired, nie z pustej listy tematów", () => {
    expect(lessonPathOf(catalog, "english_grammar")).toBe("catalog");
    expect(lessonPathOf(catalog, "school")).toBe("school");
    expect(lessonPathOf(catalog, "english_chapter")).toBe("material");
    expect(lessonPathOf(catalog, "unknown")).toBe("catalog");
    expect(lessonPathOf(undefined, "school")).toBe("catalog");
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
    const schoolValues = values({ subjectId: "school", topicId: "", objectiveIds: [] });
    expect(canSubmitLesson(schoolValues, catalog)).toBe(false);
    const named = { ...schoolValues, schoolSubjectName: "Geografia", topicTitle: "Mapa" };
    expect(canSubmitLesson(named, catalog)).toBe(true);
    expect(canSubmitLesson({ ...named, poolSize: 160 }, catalog)).toBe(true);
    expect(canSubmitLesson({ ...named, poolSize: 161 }, catalog)).toBe(false);
  });

  it("rozdział wymaga tylko tytułu i materiału do 16000 znaków, bez nazwy przedmiotu; pula do 160", () => {
    const chapterValues = values({ subjectId: "english_chapter", topicId: "", objectiveIds: [], schoolSubjectName: "" });
    expect(canSubmitLesson(chapterValues, catalog)).toBe(false);
    const titled = { ...chapterValues, topicTitle: "Unit 1" };
    expect(canSubmitLesson(titled, catalog)).toBe(true);
    expect(canSubmitLesson({ ...titled, material: "x".repeat(16000) }, catalog)).toBe(true);
    expect(canSubmitLesson({ ...titled, material: "x".repeat(16001) }, catalog)).toBe(false);
    expect(canSubmitLesson({ ...titled, material: "   " }, catalog)).toBe(false);
    expect(canSubmitLesson({ ...titled, topicTitle: "x".repeat(121) }, catalog)).toBe(false);
    expect(canSubmitLesson({ ...titled, poolSize: 160 }, catalog)).toBe(true);
    expect(canSubmitLesson({ ...titled, poolSize: 161 }, catalog)).toBe(false);
  });

  describe("buildCommand", () => {
    it("rozdział: polecenie z materiału z identyfikatorem przedmiotu i bez nazwy przedmiotu", () => {
      const chapterValues = values({
        subjectId: "english_chapter", topicId: "", objectiveIds: [], topicTitle: "  Unit 1  ", material: "  I like pizza.  ",
        instruction: "  tylko jedzenie  ", poolSize: 80,
      });
      const pending = buildCommand(chapterValues, lessonPathOf(catalog, "english_chapter"));
      expect(pending.kind).toBe("material");
      expect(pending.command).toMatchObject({
        subjectId: "english_chapter",
        topicTitlePl: "Unit 1",
        material: "I like pizza.",
        instruction: "tylko jedzenie",
        poolSize: 80,
        deckId: expect.any(String),
        clientRequestId: expect.any(String),
      });
      expect(pending.command).not.toHaveProperty("subjectTitlePl");
      expect(pending.command).not.toHaveProperty("topicId");
      expect(pending.command).not.toHaveProperty("objectiveIds");
    });

    it("szkoła: polecenie szkolne z nazwą przedmiotu i tematu jak dotąd", () => {
      const pending = buildCommand(
        values({ subjectId: "school", topicId: "", objectiveIds: [], schoolSubjectName: " Geografia ", topicTitle: " Mapa ", material: "Skala mapy." }),
        lessonPathOf(catalog, "school"),
      );
      expect(pending.kind).toBe("school");
      expect(pending.command).toMatchObject({ subjectTitlePl: "Geografia", topicTitlePl: "Mapa", material: "Skala mapy." });
      expect(pending.command).not.toHaveProperty("subjectId");
    });

    it("gramatyka: polecenie katalogowe z tematem i regułami", () => {
      const pending = buildCommand(values(), lessonPathOf(catalog, "english_grammar"));
      expect(pending.kind).toBe("catalog");
      expect(pending.command).toMatchObject({
        subjectId: "english_grammar",
        topicId: "present_simple",
        objectiveIds: ["third_person_s", "negation"],
      });
    });
  });

  it("renderuje powrót do listy i tytuł przed wczytaniem katalogu", () => {
    const markup = renderParentMarkup(<NewLessonForm onCreated={vi.fn()} onCancel={vi.fn()} registerEditorState={vi.fn()} />);
    expect(markup).toContain('data-testid="new-lesson-form"');
    expect(markup).toContain('data-testid="new-lesson-cancel"');
    expect(markup).toContain(messages.lessons.newLessonTitle);
  });

  it("rozdział: pole tytułu rozdziału i licznik do 16000, bez nazwy przedmiotu, wyboru reguł i podpowiedzi szkolnej", () => {
    const markup = renderWithCatalog(chapter);
    expect(markup).not.toContain('data-testid="school-subject-name"');
    expect(markup).not.toContain('data-testid="lesson-topic"');
    expect(markup).not.toContain('data-testid="school-material-hint"');
    expect(markup).toContain('data-testid="material-topic-name"');
    expect(markup).toContain("Rozdział (np. Unit 1)");
    expect(markup).toContain(messages.lessons.chapterTopicLabel);
    expect(markup).toContain(messages.lessons.chapterMaterialHint);
    expect(markup).toContain("0/16000 znaków");
    expect(markup).toContain(messages.lessons.schoolObjectivesAuto);
    // Podpowiedź puli zgodna z limitami ścieżki z materiału (20–160), bez wzoru z liczbą reguł.
    expect(messages.lessons.chapterPoolSizeHint).toBe("Od 20 do 160 ćwiczeń. Domyślnie 60.");
    expect(markup).toContain(messages.lessons.chapterPoolSizeHint);
    expect(markup).not.toContain(messages.lessons.poolSizeHint);
    expect(markup).not.toContain("liczba reguł");
  });

  it("szkoła: nadal nazwa przedmiotu i temat, podpowiedź szkolna i licznik do 16000", () => {
    const markup = renderWithCatalog(school);
    expect(markup).toContain('data-testid="school-subject-name"');
    expect(markup).toContain('data-testid="school-topic-name"');
    expect(markup).toContain('data-testid="school-material-hint"');
    expect(markup).not.toContain(messages.lessons.chapterTopicLabel);
    expect(markup).toContain("0/16000 znaków");
  });

  describe("lekcja ze źródła", () => {
    const SOURCE_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
    const source = { id: SOURCE_ID, title: "Unit 3 — Food", body: "I like pizza.\nDo you like apples?", bodyRevision: 3 };

    it("wartości startowe: wskazany przedmiot z materiału i tytuł źródła jako temat", () => {
      expect(initialLessonValues(catalog, { subjectId: "school", topicTitle: source.title, fromSource: true })).toMatchObject({
        subjectId: "school", topicId: "", objectiveIds: [], topicTitle: "Unit 3 — Food", material: "",
      });
      expect(initialLessonValues(catalog, { subjectId: "english_chapter", fromSource: true }).subjectId).toBe("english_chapter");
      // przedmiot spoza ścieżki z materiału (albo nieznany) → pierwszy przedmiot z materiału
      expect(initialLessonValues(catalog, { subjectId: "english_grammar", fromSource: true }).subjectId).toBe("school");
      expect(initialLessonValues(catalog, { subjectId: "nieznany", fromSource: true }).subjectId).toBe("school");
      // bez źródła wskazany przedmiot też wybiera się od startu
      expect(initialLessonValues(catalog, { subjectId: "english_chapter" }).subjectId).toBe("english_chapter");
    });

    it("tekst pochodzi ze źródła: pusty materiał nie blokuje wysyłki", () => {
      const chapterValues = values({ subjectId: "english_chapter", topicId: "", objectiveIds: [], material: "", topicTitle: "Unit 3" });
      expect(canSubmitLesson(chapterValues, catalog)).toBe(false);
      expect(canSubmitLesson(chapterValues, catalog, true)).toBe(true);
      expect(canSubmitLesson({ ...chapterValues, topicTitle: " " }, catalog, true)).toBe(false);
      const schoolValues = values({ subjectId: "school", topicId: "", objectiveIds: [], material: "", topicTitle: "Mapa" });
      expect(canSubmitLesson(schoolValues, catalog, true)).toBe(false);
      expect(canSubmitLesson({ ...schoolValues, schoolSubjectName: "Geografia" }, catalog, true)).toBe(true);
    });

    it("rozdział: polecenie z sourceMaterialId i rewizją treści podglądu, bez materiału", () => {
      const pending = buildCommand(
        values({ subjectId: "english_chapter", topicId: "", objectiveIds: [], topicTitle: "Unit 3", material: "" }),
        "material",
        source,
      );
      expect(pending.kind).toBe("material");
      expect(pending.command).toMatchObject({ subjectId: "english_chapter", topicTitlePl: "Unit 3", sourceMaterialId: SOURCE_ID, expectedSourceRevision: 3 });
      expect(pending.command).not.toHaveProperty("material");
    });

    it("szkoła: polecenie z sourceMaterialId, bez materiału", () => {
      const pending = buildCommand(
        values({ subjectId: "school", topicId: "", objectiveIds: [], schoolSubjectName: "Geografia", topicTitle: "Mapa", material: "ignorowany" }),
        "school",
        source,
      );
      expect(pending.kind).toBe("school");
      expect(pending.command).toMatchObject({ subjectTitlePl: "Geografia", topicTitlePl: "Mapa", sourceMaterialId: SOURCE_ID, expectedSourceRevision: 3 });
      expect(pending.command).not.toHaveProperty("material");
    });

    it("bez źródła polecenie nie niesie rewizji źródła", () => {
      const pending = buildCommand(values({ subjectId: "english_chapter", topicId: "", objectiveIds: [], topicTitle: "Unit 3" }), "material");
      expect(pending.command).not.toHaveProperty("sourceMaterialId");
      expect(pending.command).not.toHaveProperty("expectedSourceRevision");
    });

    it("odpowiedź tworzenia: zmienione źródło i usunięte źródło są ostateczne, inny konflikt — niepewny", () => {
      const changed = new ApiCallError("Konflikt.", "conflict", 409, { reason: "source_changed" });
      const otherConflict = new ApiCallError("Konflikt.", "conflict", 409);
      const missing = new ApiCallError("Nie znaleziono.", "not_found", 404);
      const invalid = new ApiCallError("Błąd.", "validation", 400);
      expect(classifyCreateFailure(changed, true)).toBe("source-changed");
      expect(classifyCreateFailure(missing, true)).toBe("source-missing");
      expect(classifyCreateFailure(invalid, true)).toBe("rejected");
      // konflikt bez szczegółów zmienionego źródła nie daje komunikatu o zmianie — wynik pozostaje niepewny
      expect(classifyCreateFailure(otherConflict, true)).toBe("uncertain");
      expect(classifyCreateFailure(new ApiCallError("Konflikt.", "conflict", 409, { reason: "other" }), true)).toBe("uncertain");
      // bez źródła (wklejony tekst) te odpowiedzi nie dotyczą źródła
      expect(classifyCreateFailure(changed, false)).toBe("uncertain");
      expect(classifyCreateFailure(missing, false)).toBe("uncertain");
      expect(classifyCreateFailure(new TypeError("Failed to fetch"), true)).toBe("uncertain");
      expect(messages.sources.changedBeforeCreate).toBe("Źródło zmieniono w innym oknie. Sprawdź tekst i utwórz lekcję ponownie.");
    });

    it("formularz: podgląd źródła tylko do odczytu i link „Zmień źródło” zamiast pola materiału", () => {
      const queryClient = new QueryClient();
      queryClient.setQueryData(orpc.lessonCatalog.get.queryOptions().queryKey, catalog);
      const markup = renderParentMarkup(
        <NewLessonForm source={source} initialSubjectId="school" onOpenSource={vi.fn()} onCreated={vi.fn()} onCancel={vi.fn()} registerEditorState={vi.fn()} />,
        queryClient,
      );
      expect(markup).not.toContain('data-testid="lesson-material"');
      expect(markup).not.toContain('data-testid="lesson-material-counter"');
      expect(markup).toContain('data-testid="lesson-source"');
      expect(markup).toContain(messages.sources.fromSource.replace("{title}", "Unit 3 — Food"));
      expect(markup).toContain('data-testid="lesson-source-preview"');
      expect(markup).toContain("Do you like apples?");
      const preview = markup.match(/<textarea[^>]*data-testid="lesson-source-preview"[^>]*>/)?.[0] ?? "";
      expect(preview).toMatch(/readonly/i);
      expect(preview).toContain('aria-labelledby="lesson-source-title"');
      expect(preview).not.toMatch(/tabindex/i);
      // „Zmień źródło” prowadzi do listy źródeł, a przycisk u góry wraca do strony źródła
      expect(markup).toContain('data-testid="lesson-source-change"');
      expect(markup).toContain('href="/parent/sources"');
      expect(markup).not.toContain(`href="/parent/sources/${SOURCE_ID}"`);
      expect(markup).toContain(messages.sources.changeSource);
      expect(markup).toContain(messages.sources.backToSource);
      expect(markup).not.toContain(messages.decks.backToList);
      // tylko przedmioty tworzone z materiału; wskazany wybrany od startu
      expect(markup).toContain('value="school" selected=""');
      expect(markup).toContain('value="english_chapter"');
      expect(markup).not.toContain('value="english_grammar"');
      expect(markup).toContain('data-testid="school-subject-name"');
      expect(markup).toContain('value="Unit 3 — Food"');
    });
  });

  it("gramatyka: wybór tematu i reguł, licznik do 8000", () => {
    const markup = renderWithCatalog(grammar);
    expect(markup).toContain('data-testid="lesson-topic"');
    expect(markup).toContain('data-testid="lesson-objective-third_person_s"');
    expect(markup).not.toContain('data-testid="school-subject-name"');
    expect(markup).not.toContain('data-testid="material-topic-name"');
    expect(markup).toContain("0/8000 znaków");
    expect(markup).toContain(messages.lessons.poolSizeHint);
    expect(markup).not.toContain(messages.lessons.chapterPoolSizeHint);
  });
});
