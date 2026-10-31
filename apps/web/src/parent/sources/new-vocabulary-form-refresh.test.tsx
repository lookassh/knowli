// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { messages, type GenerationCommand } from "@learning/contracts";
import { ApiCallError } from "../api";
import { parentTheme } from "../theme";
import { NewVocabularyForm, type SourceRefreshOutcome, type VocabularySource } from "./NewVocabularyFromSource";

/**
 * Konflikt rewizji źródła przy tworzeniu zestawu słówek (409 `source_changed`):
 * „Utwórz zestaw” wraca dopiero, gdy ponowny odczyt źródła się powiedzie —
 * odczyt TanStack kończy się bez wyjątku także po błędzie, więc nieudany
 * odczyt pokazuje komunikat z ponowieniem, a nie odblokowuje tworzenia ze
 * starym podglądem. Interakcja w jsdom, wywołanie API zaślepione.
 */

const generate = vi.hoisted(() => vi.fn());
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, parentClient: { decks: { generate } } };
});

const SOURCE_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const DECK_ID = "00000000-0000-4000-8000-0000000000d1";
const first: VocabularySource = { id: SOURCE_ID, title: "Unit 3 — Food", body: "I like pizza.", bodyRevision: 2 };
const changed: VocabularySource = { ...first, body: "I like pizza.\nWe like bananas.", bodyRevision: 3 };

beforeAll(() => {
  // Mantine czyta preferencje schematu kolorów i ruchu z matchMedia — jsdom go nie ma
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  // Textarea z autosize (podgląd źródła) obserwuje rozmiar i ładowanie fontów — też spoza jsdom
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  if (!("fonts" in document)) {
    Object.defineProperty(document, "fonts", { value: { addEventListener: () => undefined, removeEventListener: () => undefined } });
  }
});

afterEach(() => {
  cleanup();
  generate.mockReset();
});

/** Formularz ze źródłem w stanie testu: udany odczyt podmienia podgląd i rewizję jak `query.refetch()`. */
function Harness({ refresh, onCreated }: { refresh: () => SourceRefreshOutcome; onCreated: (deckId: string) => void }) {
  const [source, setSource] = useState(first);
  return (
    <NewVocabularyForm
      source={source}
      onCreated={onCreated}
      onOpenSource={vi.fn()}
      onSourceChanged={async () => {
        const outcome = refresh();
        if (outcome === "fresh") setSource(changed);
        return outcome;
      }}
      registerEditorState={vi.fn()}
    />
  );
}

function renderHarness(refresh: () => SourceRefreshOutcome, onCreated = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <MantineProvider theme={parentTheme}>
        <Harness refresh={refresh} onCreated={onCreated} />
      </MantineProvider>
    </QueryClientProvider>,
  );
  return onCreated;
}

const submit = () => screen.getByTestId("new-vocabulary-submit") as HTMLButtonElement;
const sourceChanged = () => new ApiCallError("Konflikt.", "conflict", 409, { reason: "source_changed" });

describe("NewVocabularyForm — źródło zmienione w innym oknie", () => {
  it("nieudany odczyt po 409: tworzenie wyłączone, komunikat z ponowieniem; udany — nowe polecenie z nową rewizją", async () => {
    const outcomes: SourceRefreshOutcome[] = ["failed", "fresh"];
    const refresh = vi.fn(() => outcomes.shift()!);
    generate.mockRejectedValueOnce(sourceChanged());
    generate.mockResolvedValueOnce({ generationRunId: "00000000-0000-4000-8000-0000000000aa", deckId: DECK_ID });
    const onCreated = renderHarness(refresh);

    await act(async () => { fireEvent.click(submit()); });
    await waitFor(() => expect(screen.getByTestId("new-vocabulary-error").textContent).toContain(messages.sources.refreshFailed));
    expect(refresh).toHaveBeenCalledTimes(1);
    // stary podgląd zostaje, a „Utwórz zestaw” czeka na świeży tekst
    expect((screen.getByTestId("new-vocabulary-source-preview") as HTMLTextAreaElement).value).toBe(first.body);
    expect(submit().disabled).toBe(true);
    const retry = screen.getByTestId("new-vocabulary-refresh-retry");
    expect(retry.textContent).toContain(messages.parentShell.retry);

    await act(async () => { fireEvent.click(retry); });
    await waitFor(() => expect(submit().disabled).toBe(false));
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("new-vocabulary-refresh-retry")).toBeNull();
    expect(screen.getByTestId("new-vocabulary-error").textContent).toContain(messages.sources.changedBeforeCreateVocabulary);
    expect((screen.getByTestId("new-vocabulary-source-preview") as HTMLTextAreaElement).value).toBe(changed.body);
    expect(submit().textContent).toContain(messages.sources.createVocabularySubmit);

    await act(async () => { fireEvent.click(submit()); });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(DECK_ID));
    expect(generate).toHaveBeenCalledTimes(2);
    const [rejected, accepted] = generate.mock.calls.map(([command]) => command as GenerationCommand);
    expect(rejected).toMatchObject({ sourceMaterialId: SOURCE_ID, expectedSourceRevision: 2 });
    // ponowne „Utwórz zestaw” potwierdza nowy tekst: nowe polecenie z bieżącą rewizją treści
    expect(accepted).toMatchObject({ sourceMaterialId: SOURCE_ID, expectedSourceRevision: 3 });
    expect(accepted!.idempotencyKey).not.toBe(rejected!.idempotencyKey);
  });

  it("źródło usunięte przy odczycie po 409: stan „źródło usunięte”, tworzenie wyłączone na stałe", async () => {
    generate.mockRejectedValueOnce(sourceChanged());
    renderHarness(() => "missing");

    await act(async () => { fireEvent.click(submit()); });
    await waitFor(() => expect(screen.getByTestId("new-vocabulary-error").textContent).toContain(messages.sources.notFound));
    expect(submit().disabled).toBe(true);
    expect(screen.queryByTestId("new-vocabulary-refresh-retry")).toBeNull();
    expect(screen.getByTestId("new-vocabulary-source-missing-change")).toBeTruthy();
    expect(screen.getByTestId("new-vocabulary-cancel").textContent).toContain(messages.sources.backToList);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("niepewny wynik: ponowienie wysyła to samo polecenie, pola zablokowane", async () => {
    generate.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    generate.mockResolvedValueOnce({ generationRunId: "00000000-0000-4000-8000-0000000000aa", deckId: DECK_ID });
    const onCreated = renderHarness(() => "fresh");
    fireEvent.change(screen.getByTestId("new-vocabulary-instruction"), { target: { value: "  tylko owoce  " } });

    await act(async () => { fireEvent.click(submit()); });
    await waitFor(() => expect(screen.getByTestId("new-vocabulary-error").textContent).toContain(messages.decks.generationUncertain));
    expect(submit().textContent).toContain(messages.decks.retryGenerationRequest);
    expect((screen.getByTestId("new-vocabulary-instruction") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId("new-vocabulary-max-items") as HTMLInputElement).disabled).toBe(true);

    await act(async () => { fireEvent.click(submit()); });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(DECK_ID));
    const [firstCall, retried] = generate.mock.calls.map(([command]) => command as GenerationCommand);
    expect(retried).toEqual(firstCall);
    expect(firstCall).toMatchObject({ instruction: "tylko owoce", expectedSourceRevision: 2 });
  });
});
