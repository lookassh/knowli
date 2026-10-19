"use client";
import React from "react";
import { DeckSettingsPatchSchema, messages } from "@learning/contracts";
import { errorMessage } from "./api";
import { patchDeckSessionTaskBudget } from "./deck-session-settings";

/**
 * Pole „Liczba pytań w sesji nauki" (`decks.session_task_budget`) — wspólny
 * blok ustawień edytorów słówek i lekcji. Komponent bez wewnętrznego stanu:
 * lokalną edycję i odświeżanie widzanego decka prowadzi edytor
 * (onChange/onSaved), a żądanie PATCH idzie stąd przez domyślne `save`
 * (dzięki temu URL i ładunek są testowalne z mockowanym fetchem).
 * `onSaved` dostaje deckId żądania, żeby edytor aktualizował właściwy deck
 * także po nawigacji w trakcie lotu.
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
  save = patchDeckSessionTaskBudget,
}: {
  deckId: string;
  /** Bieżąca wartość: lokalna edycja albo sessionTaskBudget z DTO. */
  value: number;
  /** Czy lokalna edycja różni się od DTO (warunek aktywacji zapisu). */
  edited: boolean;
  archived: boolean;
  busy: boolean;
  onChange: (value: number) => void;
  onBusyChange: (busy: boolean) => void;
  onSaved: (deckId: string, value: number) => void;
  onError: (message: string) => void;
  save?: (deckId: string, sessionTaskBudget: number) => Promise<number>;
}) {
  const valid = DeckSettingsPatchSchema.safeParse({ sessionTaskBudget: value }).success;
  const disabled = archived || busy || !edited || !valid;
  const submit = () => {
    if (disabled) {
      return;
    }
    onBusyChange(true);
    save(deckId, value)
      .then((saved) => onSaved(deckId, saved))
      .catch((cause) => onError(errorMessage(cause)))
      .finally(() => onBusyChange(false));
  };
  return (
    <section className="card" data-testid="deck-session-settings">
      <label>
        {messages.decks.sessionTaskBudget}
        <input
          type="number"
          data-testid="deck-session-task-budget"
          min={1}
          max={100}
          step={1}
          value={value}
          disabled={archived || busy}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </label>
      <p className="muted">{messages.decks.sessionTaskBudgetHint}</p>
      <button type="button" data-testid="deck-session-task-budget-save" disabled={disabled} onClick={submit}>
        {messages.decks.save}
      </button>
    </section>
  );
}
