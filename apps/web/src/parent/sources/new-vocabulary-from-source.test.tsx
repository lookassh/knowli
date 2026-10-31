import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { GenerationCommandSchema, messages, type SourceMaterialDto } from "@learning/contracts";
import NewVocabularyFromSource, {
  NewVocabularyForm,
  buildVocabularyCommand,
  canSubmitVocabulary,
  initialVocabularyValues,
  sourceRefreshOutcome,
  vocabularySubmitDisabled,
  type VocabularyFromSourceValues,
} from "./NewVocabularyFromSource";
import { ApiCallError } from "../api";
import { orpc } from "../query-client";
import { renderParentMarkup } from "../test-render";

const SOURCE_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const source = { id: SOURCE_ID, title: "Unit 3 — Food", body: "pizza — pizza\nI like pizza. Do you like apples?", bodyRevision: 3 };

const values = (overrides: Partial<VocabularyFromSourceValues> = {}): VocabularyFromSourceValues => ({
  ...initialVocabularyValues(source.title),
  ...overrides,
});

const idle = { creating: false, sourceRefresh: "idle" as const, sourceMissing: false, pending: false };

function renderForm(): string {
  return renderParentMarkup(
    <NewVocabularyForm source={source} onCreated={vi.fn()} onOpenSource={vi.fn()} onSourceChanged={vi.fn()} registerEditorState={vi.fn()} />,
  );
}

describe("NewVocabularyFromSource", () => {
  it("wartości startowe: nazwa = tytuł źródła, zestaw standardowy, 20 słówek, bez zawężenia", () => {
    expect(initialVocabularyValues("  Unit 3 — Food  ")).toEqual({ title: "Unit 3 — Food", vocabularyFormat: "standard", maxItems: 20, instruction: "" });
  });

  it("pola zgodne z kontraktem: 1–100 słówek, nazwa do 200, zawężenie do 500 znaków", () => {
    expect(canSubmitVocabulary(values())).toBe(true);
    for (const maxItems of [1, 100]) expect(canSubmitVocabulary(values({ maxItems })), String(maxItems)).toBe(true);
    for (const maxItems of [0, 101, 2.5, "", "20"]) expect(canSubmitVocabulary(values({ maxItems })), String(maxItems)).toBe(false);
    // pusta nazwa jest dozwolona — serwer nada tytuł źródła
    expect(canSubmitVocabulary(values({ title: "   " }))).toBe(true);
    expect(canSubmitVocabulary(values({ title: "x".repeat(201) }))).toBe(false);
    expect(canSubmitVocabulary(values({ instruction: "x".repeat(500) }))).toBe(true);
    expect(canSubmitVocabulary(values({ instruction: ` ${"x".repeat(500)} ` }))).toBe(true);
    expect(canSubmitVocabulary(values({ instruction: "x".repeat(501) }))).toBe(false);
  });

  describe("buildVocabularyCommand", () => {
    it("z zawężeniem: odwołanie do źródła z rewizją podglądu, obcięte teksty, poprawne wg kontraktu", () => {
      const command = buildVocabularyCommand(
        values({ title: "  Jedzenie  ", vocabularyFormat: "picture", maxItems: 12, instruction: "  tylko owoce  " }),
        source,
      );
      expect(command).toEqual({
        sourceMaterialId: SOURCE_ID,
        expectedSourceRevision: 3,
        vocabularyFormat: "picture",
        maxItems: 12,
        idempotencyKey: expect.any(String),
        title: "Jedzenie",
        instruction: "tylko owoce",
      });
      expect(command).not.toHaveProperty("prompt");
      expect(command).not.toHaveProperty("locales");
      expect(GenerationCommandSchema.safeParse(command).success).toBe(true);
    });

    it("bez zawężenia i z pustą nazwą: pola pominięte (kontrakt nie przyjmuje pustych tekstów)", () => {
      const command = buildVocabularyCommand(values({ title: "  ", instruction: " \n " }), source);
      expect(command).not.toHaveProperty("instruction");
      expect(command).not.toHaveProperty("title");
      expect(command).toMatchObject({ sourceMaterialId: SOURCE_ID, expectedSourceRevision: 3, vocabularyFormat: "standard", maxItems: 20 });
      expect(GenerationCommandSchema.safeParse(command).success).toBe(true);
      // puste zawężenie wysłane wprost byłoby odrzucone przez kontrakt
      expect(GenerationCommandSchema.safeParse({ ...command, instruction: "" }).success).toBe(false);
    });

    it("domyślne wartości: nazwa ze źródła, 20 słówek; każde polecenie ma nowy klucz", () => {
      const first = buildVocabularyCommand(values(), source);
      const second = buildVocabularyCommand(values(), { ...source, bodyRevision: 4 });
      expect(first).toMatchObject({ title: "Unit 3 — Food", maxItems: 20, expectedSourceRevision: 3 });
      expect(second.expectedSourceRevision).toBe(4);
      expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    });
  });

  it("„Utwórz zestaw” wyłączone w trakcie zapisu, przy odświeżaniu źródła, bez źródła i z błędnymi polami", () => {
    expect(vocabularySubmitDisabled(values(), idle)).toBe(false);
    expect(vocabularySubmitDisabled(values(), { ...idle, creating: true })).toBe(true);
    expect(vocabularySubmitDisabled(values(), { ...idle, sourceRefresh: "refreshing" })).toBe(true);
    expect(vocabularySubmitDisabled(values(), { ...idle, sourceRefresh: "failed" })).toBe(true);
    expect(vocabularySubmitDisabled(values(), { ...idle, sourceMissing: true })).toBe(true);
    expect(vocabularySubmitDisabled(values({ maxItems: "" }), idle)).toBe(true);
    // niepewne polecenie czeka na ponowienie tym samym poleceniem — pola go nie blokują
    expect(vocabularySubmitDisabled(values({ maxItems: "" }), { ...idle, pending: true })).toBe(false);
    expect(vocabularySubmitDisabled(values(), { ...idle, pending: true, creating: true })).toBe(true);
  });

  it("wynik ponownego odczytu źródła: świeży, usunięte (404) albo nieudany", () => {
    expect(sourceRefreshOutcome({ isError: false, error: null })).toBe("fresh");
    expect(sourceRefreshOutcome({ isError: true, error: new ApiCallError("Nie znaleziono.", "not_found", 404) })).toBe("missing");
    expect(sourceRefreshOutcome({ isError: true, error: new ApiCallError("Błąd.", "internal", 503) })).toBe("failed");
    expect(sourceRefreshOutcome({ isError: true, error: new TypeError("Failed to fetch") })).toBe("failed");
  });

  it("teksty formularza", () => {
    expect(messages.sources.newVocabularyTitle).toBe("Nowy zestaw słówek ze źródła");
    expect(messages.decks.titleLabel).toBe("Nazwa zestawu");
    expect(messages.sources.vocabularyMaxItemsLabel).toBe("Najwięcej słówek");
    expect(messages.sources.vocabularyInstructionLabel).toBe("Zawężenie (opcjonalnie)");
    expect(messages.sources.vocabularyInstructionPlaceholder).toBe("np. tylko pogoda");
    expect(messages.sources.vocabularyInstructionHint).toBe("Słowa wybieramy wyłącznie z tekstu źródła.");
    expect(messages.sources.createVocabularySubmit).toBe("Utwórz zestaw");
  });

  it("formularz: podgląd źródła tylko do odczytu, pola z wartościami startowymi i aktywne „Utwórz zestaw”", () => {
    const markup = renderForm();
    expect(markup).toContain('data-testid="new-vocabulary-form"');
    expect(markup).toContain(messages.sources.newVocabularyTitle);
    expect(markup).toContain(messages.sources.fromSource.replace("{title}", "Unit 3 — Food"));
    const preview = markup.match(/<textarea[^>]*data-testid="new-vocabulary-source-preview"[^>]*>/)?.[0] ?? "";
    expect(preview).toMatch(/readonly/i);
    expect(preview).toContain('aria-labelledby="new-vocabulary-source-title"');
    expect(preview).not.toMatch(/tabindex/i);
    expect(markup).toContain("Do you like apples?");
    // „Zmień źródło” prowadzi do listy źródeł, przycisk u góry wraca do strony źródła
    expect(markup).toMatch(/href="\/parent\/sources"[^>]*data-testid="new-vocabulary-source-change"/);
    expect(markup).toContain(messages.sources.backToSource);

    expect(markup).toMatch(/<input[^>]*data-testid="new-vocabulary-title"[^>]*value="Unit 3 — Food"|<input[^>]*value="Unit 3 — Food"[^>]*data-testid="new-vocabulary-title"/);
    expect(markup).toContain('value="standard" selected=""');
    expect(markup).toContain(messages.decks.pictureVocabulary);
    expect(markup).toMatch(/<input[^>]*data-testid="new-vocabulary-max-items"[^>]*>/);
    expect(markup.match(/<input[^>]*data-testid="new-vocabulary-max-items"[^>]*>/)?.[0]).toContain('value="20"');
    expect(markup).toContain(messages.sources.vocabularyMaxItemsLabel);
    const instruction = markup.match(/<input[^>]*data-testid="new-vocabulary-instruction"[^>]*>/)?.[0] ?? "";
    expect(instruction).toContain(`placeholder="${messages.sources.vocabularyInstructionPlaceholder}"`);
    expect(instruction).toContain('maxLength="500"');
    expect(markup).toContain(messages.sources.vocabularyInstructionHint);
    expect(markup).toMatch(/<button(?![^>]*disabled)[^>]*data-testid="new-vocabulary-submit"/);
    expect(markup).toContain(messages.sources.createVocabularySubmit);
    expect(markup).not.toContain('data-testid="new-vocabulary-error"');
  });

  describe("odczyt źródła przed formularzem", () => {
    const dto: SourceMaterialDto = {
      id: SOURCE_ID, title: source.title, body: source.body, bodyRevision: 3, revision: 4, deckCount: 0, decks: [],
      createdAt: "2026-10-30T12:00:00.000Z", updatedAt: "2026-10-31T12:00:00.000Z",
    };
    const key = orpc.sources.get.queryOptions({ input: { sourceId: SOURCE_ID } }).queryKey;
    const render = (queryClient: QueryClient) => renderParentMarkup(
      <NewVocabularyFromSource sourceId={SOURCE_ID} onOpenSource={vi.fn()} onCreated={vi.fn()} registerEditorState={vi.fn()} />,
      queryClient,
    );

    it("wczytywanie: bez formularza i przycisku tworzenia", () => {
      const markup = render(new QueryClient());
      expect(markup).toContain('data-testid="new-vocabulary-loading"');
      expect(markup).not.toContain('data-testid="new-vocabulary-submit"');
    });

    it("wczytane źródło: formularz z jego tekstem", () => {
      const queryClient = new QueryClient();
      queryClient.setQueryData(key, dto);
      const markup = render(queryClient);
      expect(markup).toContain('data-testid="new-vocabulary-form"');
      expect(markup).toContain("Do you like apples?");
    });

    // źródło usunięte (404) przed formularzem: renderowanie statyczne ponawia odczyt przy montowaniu
    // (stan „wczytywanie”), więc ten widok sprawdza mocked Playwright (parent-source-vocabulary-layout).
  });
});
