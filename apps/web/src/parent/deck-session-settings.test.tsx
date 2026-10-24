import { describe, expect, it, vi } from "vitest";
import React from "react";
import DeckSessionTaskBudgetSettings from "./DeckSessionTaskBudgetSettings";

function nodes(element: React.ReactNode): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (Array.isArray(element)) return element.flatMap(nodes);
  if (!React.isValidElement(element)) return [];
  const node = element as React.ReactElement<Record<string, unknown>>;
  const rendered =
    typeof node.type === "function"
      ? (node.type as (props: Record<string, unknown>) => React.ReactNode)(node.props)
      : (node.props.children as React.ReactNode);
  return [{ type: node.type, props: node.props }, ...nodes(rendered)];
}

const DECK_ID = "10000000-0000-4000-8000-000000000001";

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function field(overrides: Partial<Parameters<typeof DeckSessionTaskBudgetSettings>[0]> = {}) {
  return {
    deckId: DECK_ID,
    value: 20,
    edited: false,
    archived: false,
    busy: false,
    onChange: vi.fn(),
    onBusyChange: vi.fn(),
    onSaved: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

describe("DeckSessionTaskBudgetSettings", () => {
  it("zapisuje edytowaną wartość przez PATCH /parent/decks/:id i odświeża stan edytora", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ sessionTaskBudget: 7 }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      // przed edycją zapis jest nieaktywny, a wpisanie 7 trafia do stanu edytora
      const onChange = vi.fn();
      const before = nodes(<DeckSessionTaskBudgetSettings {...field({ onChange })} />);
      expect(before.find((n) => n.props["data-testid"] === "deck-session-task-budget-save")?.props.disabled).toBe(true);
      const input = before.find((n) => n.props["data-testid"] === "deck-session-task-budget")!;
      (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "7" } });
      expect(onChange).toHaveBeenCalledWith(7);

      // edytor po wpisaniu renderuje value=7/edited — klik zapisu wysyła PATCH
      const events: Array<[string, string, number]> = [];
      const onSaved = vi.fn((savedDeckId: string, saved: number) => events.push(["saved", savedDeckId, saved]));
      const onBusyChange = vi.fn();
      const edited = nodes(
        <DeckSessionTaskBudgetSettings {...field({ value: 7, edited: true, onSaved, onBusyChange })} />,
      );
      const save = edited.find((n) => n.props["data-testid"] === "deck-session-task-budget-save")!;
      expect(save.props.disabled).toBe(false);
      (save.props.onClick as () => void)();
      await flush();

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
    for (const props of [
      field(),
      field({ value: 0, edited: true }),
      field({ value: 101, edited: true }),
      field({ value: 7, edited: true, archived: true }),
      field({ value: 7, edited: true, busy: true }),
    ]) {
      const rendered = nodes(<DeckSessionTaskBudgetSettings {...props} />);
      expect(
        rendered.find((n) => n.props["data-testid"] === "deck-session-task-budget-save")?.props.disabled,
        JSON.stringify(props),
      ).toBe(true);
    }
  });

  it("zgłasza błąd zapisu do edytora bez zapisu stanu", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: "validation", message: "Nieprawidłowa wartość." }), { status: 400, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onError = vi.fn();
    const onSaved = vi.fn();
    try {
      const rendered = nodes(
        <DeckSessionTaskBudgetSettings {...field({ value: 7, edited: true, onError, onSaved })} />,
      );
      (rendered.find((n) => n.props["data-testid"] === "deck-session-task-budget-save")!.props.onClick as () => void)();
      await flush();
      expect(onError).toHaveBeenCalledWith("Nieprawidłowa wartość.");
      expect(onSaved).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
