import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { messages, type SourceMaterialDto, type SourceMaterialSummaryDto } from "@learning/contracts";
import SourcesPanel from "./SourcesPanel";
import SourcePage from "./SourcePage";
import { orpc } from "../query-client";
import { renderParentMarkup } from "../test-render";

const SOURCE_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const SECOND_ID = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";

const summaries: SourceMaterialSummaryDto[] = [
  { id: SOURCE_ID, title: "Unit 3 — Food", revision: 2, createdAt: "2026-10-30T12:00:00.000Z", updatedAt: "2026-10-31T12:00:00.000Z", deckCount: 2 },
  { id: SECOND_ID, title: "Rozdział 4: Mapa", revision: 1, createdAt: "2026-10-29T12:00:00.000Z", updatedAt: "2026-10-29T12:00:00.000Z", deckCount: 1 },
];

const source: SourceMaterialDto = {
  ...summaries[0]!,
  body: "I like pizza.\nDo you like apples?",
  decks: [
    { deckId: "10000000-0000-4000-8000-000000000001", title: "Angielski — rozdział: Unit 3", kind: "lesson", state: "published", copiedRevision: 1, stale: true },
    { deckId: "10000000-0000-4000-8000-000000000002", title: "Jedzenie", kind: "lesson", state: "archived", copiedRevision: 2, stale: false },
  ],
};

function withList(list: SourceMaterialSummaryDto[]): QueryClient {
  const queryClient = new QueryClient();
  queryClient.setQueryData(orpc.sources.list.queryOptions().queryKey, list);
  return queryClient;
}

function withSource(dto: SourceMaterialDto): QueryClient {
  const queryClient = new QueryClient();
  queryClient.setQueryData(orpc.sources.get.queryOptions({ input: { sourceId: dto.id } }).queryKey, dto);
  return queryClient;
}

const handlers = () => ({ onNavigate: vi.fn(), registerEditorState: vi.fn() });

describe("SourcesPanel", () => {
  it("lista: tytuł, data zmiany i liczba zestawów; przycisk nowego źródła", () => {
    const markup = renderParentMarkup(<SourcesPanel route={{ section: "sources" }} {...handlers()} />, withList(summaries));
    expect(markup).toContain('data-testid="sources-panel"');
    expect(markup).toContain(messages.sources.tab);
    expect(markup).toContain('data-testid="new-source-open"');
    expect(markup).toContain(messages.sources.newSource);
    expect(markup).toContain('data-testid="source-row-0"');
    expect(markup).toContain(`data-source-id="${SOURCE_ID}"`);
    expect(markup).toContain("Unit 3 — Food");
    expect(markup).toContain("31.10.2026");
    expect(markup).toContain("2 zestawy");
    expect(markup).toContain('data-testid="source-row-1"');
    expect(markup).toContain("1 zestaw");
    expect(markup).not.toContain(messages.sources.empty);
  });

  it("pusta lista: komunikat bez źródeł", () => {
    const markup = renderParentMarkup(<SourcesPanel route={{ section: "sources" }} {...handlers()} />, withList([]));
    expect(markup).toContain(messages.sources.empty);
    expect(markup).not.toContain('data-testid="source-row-0"');
  });

  it("adres źródła otwiera jego stronę", () => {
    const markup = renderParentMarkup(<SourcesPanel route={{ section: "sources", sourceId: SOURCE_ID }} {...handlers()} />, withSource(source));
    expect(markup).toContain('data-testid="source-page"');
    expect(markup).not.toContain('data-testid="new-source-open"');
  });
});

describe("SourcePage", () => {
  it("podgląd tekstu, przyciski tworzenia lekcji, edycja i usunięcie", () => {
    const markup = renderParentMarkup(<SourcePage sourceId={SOURCE_ID} {...handlers()} />, withSource(source));
    expect(markup).toContain('data-testid="source-back"');
    expect(markup).toContain("Unit 3 — Food");
    expect(markup).toContain('data-testid="source-preview"');
    expect(markup).toContain("Do you like apples?");
    expect(markup).toContain('data-testid="source-create-chapter"');
    expect(markup).toContain(messages.sources.createChapterLesson);
    expect(markup).toContain('data-testid="source-create-school"');
    expect(markup).toContain(messages.sources.createSchoolLesson);
    expect(markup).toContain('data-testid="source-edit"');
    expect(markup).toContain('data-testid="source-delete"');
    // podgląd jest tylko do odczytu — pola edycji pojawiają się dopiero po „Edytuj”
    expect(markup).not.toContain('data-testid="source-body"');
  });

  it("zestawy z tego źródła: tytuł, stan i notka o zmianie źródła", () => {
    const markup = renderParentMarkup(<SourcePage sourceId={SOURCE_ID} {...handlers()} />, withSource(source));
    expect(markup).toContain(messages.sources.decksHeading);
    expect(markup).toContain('data-testid="source-deck-0"');
    expect(markup).toContain("Angielski — rozdział: Unit 3");
    expect(markup).toContain('data-testid="source-deck-1"');
    expect(markup).toContain(messages.decks.states.archived);
    expect(markup).toContain('data-testid="source-deck-stale-0"');
    expect(markup).not.toContain('data-testid="source-deck-stale-1"');
  });

  it("źródło bez zestawów: komunikat zamiast listy", () => {
    const markup = renderParentMarkup(<SourcePage sourceId={SOURCE_ID} {...handlers()} />, withSource({ ...source, decks: [] }));
    expect(markup).toContain('data-testid="source-no-decks"');
    expect(markup).toContain(messages.sources.noDecks);
  });
});
