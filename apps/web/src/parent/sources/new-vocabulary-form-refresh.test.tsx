// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { messages, type GenerationCommand } from "@learning/contracts";
import { ApiCallError } from "../api";
import { parentTheme } from "../theme";
import type { EditorLeaveState } from "../useParentLeaveGuard";
import { NewVocabularyForm, type VocabularySource } from "./NewVocabularyFromSource";
import type { SourceRefreshOutcome } from "./source-refresh";

/**
 * Konflikt rewizji źródła przy tworzeniu zestawu słówek (409 `source_changed`):
 * „Utwórz zestaw” wraca dopiero, gdy ponowny odczyt źródła przyniesie rewizję
 * treści inną niż odrzucona — odczyt TanStack kończy się bez wyjątku także po
 * błędzie, a odczyt z tą samą rewizją to wciąż stary podgląd, więc oba
 * pokazują komunikat z ponowieniem, a nie odblokowują tworzenia. Do tego
 * ostateczne odrzucenia polecenia (400/403/401). Interakcja w jsdom,
 * wywołanie API zaślepione.
 */

const generate = vi.hoisted(() => vi.fn());
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, parentClient: { decks: { generate } } };
});

const SOURCE_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const DECK_ID = "00000000-0000-4000-8000-0000000000d1";
const RUN_ID = "00000000-0000-4000-8000-0000000000aa";
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

/** Odczyt źródła w teście: może podmienić źródło (jak udany `query.refetch()`) i zwraca wynik odczytu. */
type Refresh = (setSource: (next: VocabularySource) => void) => SourceRefreshOutcome | Promise<SourceRefreshOutcome>;

/** Udany odczyt z nowym tekstem i rewizją (opcjonalnie z innym tytułem źródła). */
const fresh = (next: VocabularySource = changed): Refresh => (setSource) => {
  setSource(next);
  return { status: "refreshed", bodyRevision: next.bodyRevision };
};

/** Formularz ze źródłem w stanie testu (jak `NewVocabularyFromSource` z `query.data`). */
function Harness({ refresh, onCreated, registerEditorState }: {
  refresh: Refresh;
  onCreated: (deckId: string) => void;
  registerEditorState: (state: EditorLeaveState) => void;
}) {
  const [source, setSource] = useState(first);
  return (
    <NewVocabularyForm
      source={source}
      onCreated={onCreated}
      onOpenSource={vi.fn()}
      onSourceChanged={async () => refresh(setSource)}
      registerEditorState={registerEditorState}
    />
  );
}

function renderHarness(refresh: Refresh) {
  const onCreated = vi.fn();
  const registerEditorState = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <MantineProvider theme={parentTheme}>
        <Harness refresh={refresh} onCreated={onCreated} registerEditorState={registerEditorState} />
      </MantineProvider>
    </QueryClientProvider>,
  );
  return { onCreated, registerEditorState };
}

const submit = () => screen.getByTestId("new-vocabulary-submit") as HTMLButtonElement;
const preview = () => screen.getByTestId("new-vocabulary-source-preview") as HTMLTextAreaElement;
const titleInput = () => screen.getByTestId("new-vocabulary-title") as HTMLInputElement;
const instructionInput = () => screen.getByTestId("new-vocabulary-instruction") as HTMLInputElement;
const errorText = () => screen.getByTestId("new-vocabulary-error").textContent;
const sentCommands = () => generate.mock.calls.map(([command]) => command as GenerationCommand);
const sourceChanged = () => new ApiCallError("Konflikt.", "conflict", 409, { reason: "source_changed" });
const accepted = () => ({ generationRunId: RUN_ID, deckId: DECK_ID });

describe("NewVocabularyForm — źródło zmienione w innym oknie", () => {
  it("nieudany odczyt po 409: tworzenie wyłączone, komunikat z ponowieniem; udany — nowe polecenie z nową rewizją", async () => {
    const outcomes: Refresh[] = [() => ({ status: "failed" }), fresh()];
    const refresh = vi.fn<Refresh>((setSource) => outcomes.shift()!(setSource));
    generate.mockRejectedValueOnce(sourceChanged());
    generate.mockResolvedValueOnce(accepted());
    const { onCreated } = renderHarness(refresh);

    await act(async () => { fireEvent.click(submit()); });
    await waitFor(() => expect(errorText()).toContain(messages.sources.refreshFailed));
    expect(refresh).toHaveBeenCalledTimes(1);
    // stary podgląd zostaje, a „Utwórz zestaw” czeka na świeży tekst
    expect(preview().value).toBe(first.body);
    expect(submit().disabled).toBe(true);
    const retry = screen.getByTestId("new-vocabulary-refresh-retry");
    expect(retry.textContent).toContain(messages.parentShell.retry);
    // nieudany odczyt to błąd; wyłączone „Utwórz zestaw” oddaje fokus ponowieniu odczytu
    expect(screen.getByTestId("new-vocabulary-error").getAttribute("data-tone")).toBe("error");
    expect(document.activeElement).toBe(retry);

    await act(async () => { fireEvent.click(retry); });
    await waitFor(() => expect(submit().disabled).toBe(false));
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("new-vocabulary-refresh-retry")).toBeNull();
    expect(errorText()).toContain(messages.sources.changedBeforeCreateVocabulary);
    // odświeżony podgląd to informacja (żółta), nie błąd — nadal ogłaszana czytnikom ekranu
    expect(screen.getByTestId("new-vocabulary-error").getAttribute("data-tone")).toBe("notice");
    expect(screen.getByTestId("new-vocabulary-error").getAttribute("role")).toBe("alert");
    expect(preview().value).toBe(changed.body);
    expect(submit().textContent).toContain(messages.sources.createVocabularySubmit);

    await act(async () => { fireEvent.click(submit()); });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(DECK_ID));
    expect(generate).toHaveBeenCalledTimes(2);
    const [rejected, created] = sentCommands();
    expect(rejected).toMatchObject({ sourceMaterialId: SOURCE_ID, expectedSourceRevision: 2 });
    // ponowne „Utwórz zestaw” potwierdza nowy tekst: nowe polecenie z bieżącą rewizją treści
    expect(created).toMatchObject({ sourceMaterialId: SOURCE_ID, expectedSourceRevision: 3 });
    expect(created!.idempotencyKey).not.toBe(rejected!.idempotencyKey);
  });

  it("udany odczyt z tą samą (odrzuconą) rewizją: tworzenie zostaje wyłączone, komunikat z ponowieniem", async () => {
    generate.mockRejectedValueOnce(sourceChanged());
    const refresh = vi.fn<Refresh>(() => ({ status: "refreshed", bodyRevision: first.bodyRevision }));
    renderHarness(refresh);

    await act(async () => { fireEvent.click(submit()); });
    await waitFor(() => expect(errorText()).toContain(messages.sources.refreshFailed));
    expect(submit().disabled).toBe(true);
    expect(screen.getByTestId("new-vocabulary-refresh-retry")).toBeTruthy();

    // ponowienie znów z tą samą rewizją — nadal stary podgląd, nadal bez tworzenia
    const retry = screen.getByTestId("new-vocabulary-refresh-retry");
    await act(async () => { fireEvent.click(retry); });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    // drugi odczyt zakończony: przycisk bez ładowania i z fokusem (dopiero potem stan ma znaczenie)
    await waitFor(() => expect(retry.hasAttribute("data-loading")).toBe(false));
    expect(document.activeElement).toBe(retry);
    expect(errorText()).toContain(messages.sources.refreshFailed);
    expect(submit().disabled).toBe(true);
    // Enter w polu formularza też nie wysyła polecenia ze starym podglądem
    await act(async () => { fireEvent.submit(submit().closest("form")!); });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("„Spróbuj ponownie” zostaje w trakcie odczytu (ładowanie), a fokus trafia na następny krok", async () => {
    generate.mockRejectedValueOnce(sourceChanged());
    let finish: (outcome: SourceRefreshOutcome) => void = () => undefined;
    const outcomes: Refresh[] = [
      () => ({ status: "failed" }),
      () => new Promise<SourceRefreshOutcome>((resolve) => { finish = resolve; }),
      fresh(),
    ];
    renderHarness((setSource) => outcomes.shift()!(setSource));

    await act(async () => { fireEvent.click(submit()); });
    const retry = await screen.findByTestId("new-vocabulary-refresh-retry");
    retry.focus();
    await act(async () => { fireEvent.click(retry); });
    // ten sam przycisk, w stanie ładowania — nie znika spod fokusu
    expect(screen.getByTestId("new-vocabulary-refresh-retry")).toBe(retry);
    expect(retry.hasAttribute("data-loading")).toBe(true);
    expect(submit().disabled).toBe(true);

    await act(async () => { finish({ status: "failed" }); });
    await waitFor(() => expect(retry.hasAttribute("data-loading")).toBe(false));
    expect(document.activeElement).toBe(retry);

    await act(async () => { fireEvent.click(retry); });
    await waitFor(() => expect(submit().disabled).toBe(false));
    // przycisk ponowienia znika — fokus przechodzi na odświeżony tekst do sprawdzenia
    expect(document.activeElement).toBe(preview());
  });

  it("nazwa zestawu niezmieniona przez rodzica podąża za nowym tytułem źródła; wpisana zostaje", async () => {
    const renamed: VocabularySource = { ...changed, title: "Unit 3 — Food and drinks" };
    generate.mockRejectedValueOnce(sourceChanged());
    generate.mockResolvedValueOnce(accepted());
    const { onCreated, registerEditorState } = renderHarness(fresh(renamed));
    expect(titleInput().value).toBe(first.title);

    await act(async () => { fireEvent.click(submit()); });
    await waitFor(() => expect(submit().disabled).toBe(false));
    expect(titleInput().value).toBe(renamed.title);
    // po 409 i udanym odczycie fokus trafia na odświeżony tekst (jak po „Spróbuj ponownie”)
    expect(document.activeElement).toBe(preview());
    // nowa domyślna nazwa nie jest zmianą rodzica — wyjście nie pyta o niezapisane dane
    expect(registerEditorState).toHaveBeenLastCalledWith({ dirty: false, busy: false });

    await act(async () => { fireEvent.click(submit()); });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(DECK_ID));
    expect(sentCommands()[1]).toMatchObject({ title: renamed.title, expectedSourceRevision: 3 });
  });

  it("nazwa wpisana przez rodzica nie jest nadpisywana tytułem odświeżonego źródła", async () => {
    generate.mockRejectedValueOnce(sourceChanged());
    renderHarness(fresh({ ...changed, title: "Unit 3 — Food and drinks" }));
    fireEvent.change(titleInput(), { target: { value: "Jedzenie" } });

    await act(async () => { fireEvent.click(submit()); });
    await waitFor(() => expect(submit().disabled).toBe(false));
    expect(titleInput().value).toBe("Jedzenie");
  });

  it("źródło usunięte przy odczycie po 409: stan „źródło usunięte”, tworzenie wyłączone na stałe", async () => {
    generate.mockRejectedValueOnce(sourceChanged());
    renderHarness(() => ({ status: "missing" }));

    await act(async () => { fireEvent.click(submit()); });
    await waitFor(() => expect(errorText()).toContain(messages.sources.notFound));
    expect(submit().disabled).toBe(true);
    expect(screen.queryByTestId("new-vocabulary-refresh-retry")).toBeNull();
    expect(screen.getByTestId("new-vocabulary-source-missing-change")).toBeTruthy();
    // jeden „Zmień źródło” — przy komunikacie, z fokusem; link przy tytule źródła znika
    expect(screen.queryByTestId("new-vocabulary-source-change")).toBeNull();
    expect(screen.getAllByText(messages.sources.changeSource)).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByTestId("new-vocabulary-source-missing-change"));
    expect(screen.getByTestId("new-vocabulary-cancel").textContent).toContain(messages.sources.backToList);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe("NewVocabularyForm — pole „Najwięcej słówek”", () => {
  it("puste albo spoza 1–100: błąd przy polu (aria-invalid) i wyłączone „Utwórz zestaw”", async () => {
    renderHarness(fresh());
    const field = () => screen.getByTestId("new-vocabulary-max-items") as HTMLInputElement;
    expect(field().getAttribute("aria-invalid")).not.toBe("true");
    expect(screen.queryByText(messages.sources.vocabularyMaxItemsInvalid)).toBeNull();
    expect(messages.sources.vocabularyMaxItemsInvalid).toBe("Podaj liczbę od 1 do 100.");

    for (const value of ["", "0", "101"]) {
      fireEvent.change(field(), { target: { value } });
      await waitFor(() => expect(field().getAttribute("aria-invalid"), value).toBe("true"));
      expect(screen.getByText(messages.sources.vocabularyMaxItemsInvalid), value).toBeTruthy();
      expect(submit().disabled, value).toBe(true);
    }

    fireEvent.change(field(), { target: { value: "50" } });
    await waitFor(() => expect(field().getAttribute("aria-invalid")).not.toBe("true"));
    expect(screen.queryByText(messages.sources.vocabularyMaxItemsInvalid)).toBeNull();
    expect(submit().disabled).toBe(false);
  });
});

describe("NewVocabularyForm — odpowiedź na polecenie", () => {
  it("niepewny wynik: ponowienie wysyła to samo polecenie, pola zablokowane", async () => {
    generate.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    generate.mockResolvedValueOnce(accepted());
    const { onCreated } = renderHarness(fresh());
    fireEvent.change(instructionInput(), { target: { value: "  tylko owoce  " } });

    await act(async () => { fireEvent.click(submit()); });
    await waitFor(() => expect(errorText()).toContain(messages.decks.generationUncertain));
    expect(submit().textContent).toContain(messages.decks.retryGenerationRequest);
    expect(instructionInput().disabled).toBe(true);
    expect((screen.getByTestId("new-vocabulary-max-items") as HTMLInputElement).disabled).toBe(true);

    await act(async () => { fireEvent.click(submit()); });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(DECK_ID));
    const [firstCall, retried] = sentCommands();
    expect(retried).toEqual(firstCall);
    expect(firstCall).toMatchObject({ instruction: "tylko owoce", expectedSourceRevision: 2 });
  });

  it.each([
    ["400 walidacji", new ApiCallError("Nieprawidłowe dane polecenia.", "validation", 400), "Nieprawidłowe dane polecenia."],
    ["403", new ApiCallError("Brak dostępu.", "forbidden", 403), "Brak dostępu."],
    // 401 bez komunikatu: logowanie otwiera globalny handler, formularz nie pokazuje błędu
    ["401 bez komunikatu", new ApiCallError("", "unauthorized", 401), null],
  ])("ostateczne odrzucenie (%s): polecenie porzucone, pola odblokowane, następna wysyłka z nowym kluczem", async (_, rejection, shown) => {
    generate.mockRejectedValueOnce(rejection);
    generate.mockResolvedValueOnce(accepted());
    const { onCreated } = renderHarness(fresh());

    await act(async () => { fireEvent.click(submit()); });
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(submit().disabled).toBe(false));
    if (shown === null) {
      expect(screen.queryByTestId("new-vocabulary-error")).toBeNull();
    } else {
      expect(errorText()).toContain(shown);
    }
    // bez polecenia do ponowienia: zwykłe „Utwórz zestaw” i pola do poprawy
    expect(submit().textContent).toContain(messages.sources.createVocabularySubmit);
    expect(titleInput().disabled).toBe(false);
    expect(instructionInput().disabled).toBe(false);
    expect((screen.getByTestId("new-vocabulary-max-items") as HTMLInputElement).disabled).toBe(false);

    fireEvent.change(instructionInput(), { target: { value: "tylko owoce" } });
    await act(async () => { fireEvent.click(submit()); });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(DECK_ID));
    const [rejected, created] = sentCommands();
    expect(created!.idempotencyKey).not.toBe(rejected!.idempotencyKey);
    expect(created).toMatchObject({ instruction: "tylko owoce", expectedSourceRevision: 2 });
    expect(rejected).not.toHaveProperty("instruction");
  });
});
