"use client";
import { Button, Group, NumberInput, Stack } from "@mantine/core";
import { DeckSettingsPatchSchema, messages } from "@learning/contracts";
import { errorMessage } from "./api";
import { patchDeckSessionTaskBudget } from "./deck-session-settings";

interface BudgetState {
  /** Bieżąca wartość: lokalna edycja albo sessionTaskBudget z DTO. */
  value: number;
  /** Czy lokalna edycja różni się od DTO (warunek aktywacji zapisu). */
  edited: boolean;
  archived: boolean;
  busy: boolean;
}

/** Zapis jest możliwy tylko po zmianie, w zakresie 1–100, poza archiwum i trwającym zapisem. */
export function sessionBudgetSaveDisabled({ value, edited, archived, busy }: BudgetState): boolean {
  const valid = DeckSettingsPatchSchema.safeParse({ sessionTaskBudget: value }).success;
  return archived || busy || !edited || !valid;
}

/**
 * PATCH budżetu z powiadomieniami edytora. `onSaved` dostaje deckId żądania,
 * żeby edytor aktualizował właściwy deck także po nawigacji w trakcie lotu.
 */
export function submitSessionBudget({ deckId, value, save, onBusyChange, onSaved, onError }: {
  deckId: string;
  value: number;
  save: (deckId: string, sessionTaskBudget: number) => Promise<number>;
  onBusyChange: (busy: boolean) => void;
  onSaved: (deckId: string, value: number) => void;
  onError: (message: string) => void;
}): Promise<void> {
  onBusyChange(true);
  return save(deckId, value)
    .then((saved) => onSaved(deckId, saved))
    .catch((cause) => onError(errorMessage(cause)))
    .finally(() => onBusyChange(false));
}

/**
 * Pole „Liczba pytań w sesji nauki" (`decks.session_task_budget`) — wspólny
 * blok ustawień edytorów słówek i lekcji. Komponent bez wewnętrznego stanu:
 * lokalną edycję i odświeżanie widzianego decka prowadzi edytor
 * (onChange/onSaved), a żądanie PATCH idzie stąd przez domyślne `save`.
 * Zapis jest osobny od szkicu wersji, stąd własny przycisk.
 */
export default function DeckSessionTaskBudgetSettings({
  deckId,
  value,
  edited,
  archived,
  busy,
  onChange,
  onBusyChange,
  onSaved,
  onError,
  error,
  save = patchDeckSessionTaskBudget,
}: BudgetState & {
  deckId: string;
  onChange: (value: number) => void;
  onBusyChange: (busy: boolean) => void;
  onSaved: (deckId: string, value: number) => void;
  onError: (message: string) => void;
  /** Błąd zapisu pokazywany przy polu (edytor słówek); bez niego edytor pokazuje go sam. */
  error?: string | null;
  save?: (deckId: string, sessionTaskBudget: number) => Promise<number>;
}) {
  const disabled = sessionBudgetSaveDisabled({ value, edited, archived, busy });
  return (
    <Stack gap="xs" data-testid="deck-session-settings">
      <NumberInput
        size="md"
        label={messages.decks.sessionTaskBudget}
        description={messages.decks.sessionTaskBudgetHint}
        data-testid="deck-session-task-budget"
        min={1}
        max={100}
        clampBehavior="none"
        allowDecimal={false}
        maw={220}
        value={value}
        disabled={archived || busy}
        error={error ?? undefined}
        onChange={(next) => onChange(Number(next))}
      />
      <Group>
        <Button
          size="md"
          variant="light"
          data-testid="deck-session-task-budget-save"
          disabled={disabled}
          onClick={() => { if (!disabled) void submitSessionBudget({ deckId, value, save, onBusyChange, onSaved, onError }); }}
        >
          {messages.decks.sessionTaskBudgetSave}
        </Button>
      </Group>
    </Stack>
  );
}
