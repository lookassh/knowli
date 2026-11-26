import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { messages } from "@learning/contracts";
import DeckGenerationServiceNote from "./DeckGenerationServiceNote";
import { NewVocabularyForm } from "./sources/NewVocabularyFromSource";
import { orpc } from "./query-client";
import { renderParentMarkup } from "./test-render";

const SERVICE = "openrouter.ai · google/gemini-3.8-flash";
const TESTID = 'data-testid="deck-generation-service"';
const source = { id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", title: "Unit 3", body: "pizza", bodyRevision: 1 };

function clientWith(generationService?: string): QueryClient {
  const queryClient = new QueryClient();
  queryClient.setQueryData(orpc.lessonCatalog.get.queryOptions().queryKey, {
    lessonGenerationAvailable: true,
    subjects: [],
    ...(generationService ? { generationService } : {}),
  });
  return queryClient;
}

describe("informacja o usłudze generującej słówka (#395)", () => {
  it("notka podaje usługę z katalogu, bez niej (albo przed wczytaniem katalogu) nic nie pokazuje", () => {
    const markup = renderParentMarkup(<DeckGenerationServiceNote />, clientWith(SERVICE));
    expect(markup).toContain(TESTID);
    expect(markup).toContain(messages.decks.generationServiceInfo.replace("{service}", SERVICE));
    expect(renderParentMarkup(<DeckGenerationServiceNote />, clientWith())).not.toContain(TESTID);
    expect(renderParentMarkup(<DeckGenerationServiceNote />)).not.toContain(TESTID);
  });

  it("formularz zestawu ze źródła pokazuje tę samą linię", () => {
    const markup = renderParentMarkup(
      <NewVocabularyForm source={source} onCreated={vi.fn()} onOpenSource={vi.fn()} onSourceChanged={vi.fn()} registerEditorState={vi.fn()} />,
      clientWith(SERVICE),
    );
    expect(markup).toContain(messages.decks.generationServiceInfo.replace("{service}", SERVICE));
  });
});
