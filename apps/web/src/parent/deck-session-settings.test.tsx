import { describe, expect, it, vi } from "vitest";
import { messages } from "@learning/contracts";
import DeckSessionTaskBudgetSettings, { sessionBudgetSaveDisabled, submitSessionBudget } from "./DeckSessionTaskBudgetSettings";
import { patchDeckSessionTaskBudget } from "./deck-session-settings";
import { renderParentMarkup } from "./test-render";

const DECK_ID = "10000000-0000-4000-8000-000000000001";

const state = (overrides: Partial<Parameters<typeof sessionBudgetSaveDisabled>[0]> = {}) => ({
  value: 20,
  edited: false,
  archived: false,
  busy: false,
  ...overrides,
});

describe("DeckSessionTaskBudgetSettings", () => {
  it("zapisuje edytowaną wartość przez PATCH /parent/decks/:id i odświeża stan edytora", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ sessionTaskBudget: 7 }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const events: Array<[string, string, number]> = [];
      const onBusyChange = vi.fn();
      await submitSessionBudget({
        deckId: DECK_ID,
        value: 7,
        save: patchDeckSessionTaskBudget,
        onBusyChange,
        onSaved: (savedDeckId, saved) => events.push(["saved", savedDeckId, saved]),
        onError: vi.fn(),
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(`/api/v1/parent/decks/${DECK_ID}`);
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(init.body as string)).toEqual({ sessionTaskBudget: 7 });
      expect(events).toEqual([["saved", DECK_ID, 7]]);
      expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("blokuje zapis bez edycji, poza zakresem 1–100, po archiwizacji i podczas lotu", () => {
    expect(sessionBudgetSaveDisabled(state({ value: 7, edited: true }))).toBe(false);
    for (const props of [
      state(),
      state({ value: 0, edited: true }),
      state({ value: 101, edited: true }),
      state({ value: 1.5, edited: true }),
      state({ value: 7, edited: true, archived: true }),
      state({ value: 7, edited: true, busy: true }),
    ]) {
      expect(sessionBudgetSaveDisabled(props), JSON.stringify(props)).toBe(true);
    }
  });

  it("zgłasza błąd zapisu do edytora bez zapisu stanu", async () => {
    const onError = vi.fn();
    const onSaved = vi.fn();
    await submitSessionBudget({
      deckId: DECK_ID,
      value: 7,
      save: () => Promise.reject(new Error("Nieprawidłowa wartość.")),
      onBusyChange: vi.fn(),
      onSaved,
      onError,
    });
    expect(onError).toHaveBeenCalledWith("Nieprawidłowa wartość.");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("renderuje pole i własny przycisk zapisu (osobny od zapisu szkicu)", () => {
    const markup = renderParentMarkup(
      <DeckSessionTaskBudgetSettings deckId={DECK_ID} {...state()} onChange={vi.fn()} onBusyChange={vi.fn()} onSaved={vi.fn()} onError={vi.fn()} error="Błąd" />,
    );
    expect(markup).toContain('data-testid="deck-session-task-budget"');
    expect(markup).toContain(messages.decks.sessionTaskBudgetSave);
    expect(markup).toContain("Błąd");
    const button = markup.match(/<button[^>]*data-testid="deck-session-task-budget-save"[^>]*>/)?.[0] ?? "";
    expect(button).toMatch(/\sdisabled(=|\s|>)/);
  });
});
