"use client";

import { useRef, useState } from "react";
import {
  messages,
  type ChildDto,
  type CreateEmptyDeckCommand,
  type CreateEmptyDeckResult,
  type DeckSummaryDto,
} from "@learning/contracts";
import { apiFetch, errorMessage } from "./api";
import DeckEditor from "./DeckEditor";
import type { EditorLeaveState } from "./useParentLeaveGuard";

/** Lista zestawów i uruchomienie generacji nowego materiału. */
export default function DecksPanel({
  decks,
  childrenList,
  onChanged,
  registerEditorState,
  requestLeave,
  onAuthExpired,
}: {
  decks: DeckSummaryDto[];
  childrenList: ChildDto[];
  onChanged: () => Promise<void>;
  registerEditorState: (state: EditorLeaveState) => void;
  requestLeave: (action: () => void | Promise<void>) => void;
  onAuthExpired: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [generating, setGenerating] = useState(false);
  const [creatingEmpty, setCreatingEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const pendingEmptyCommand = useRef<CreateEmptyDeckCommand | null>(null);
  const creatingEmptyRef = useRef(false);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      // unikalny klucz idempotencji: ponowne kliknięcie to nowe polecenie
      await apiFetch("POST", "/api/v1/parent/decks/generate", {
        prompt,
        idempotencyKey: crypto.randomUUID(),
        ...(title ? { title } : {}),
      });
      setPrompt("");
      setTitle("");
      await onChanged();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setGenerating(false);
    }
  };

  const createEmpty = async () => {
    if (creatingEmptyRef.current) {
      return;
    }
    creatingEmptyRef.current = true;
    setCreatingEmpty(true);
    setError(null);
    const command = pendingEmptyCommand.current ?? {
      deckId: crypto.randomUUID(),
      ...(title.trim() ? { title: title.trim() } : {}),
    };
    pendingEmptyCommand.current = command;

    try {
      const created = await apiFetch<CreateEmptyDeckResult>("POST", "/api/v1/parent/decks", command);
      pendingEmptyCommand.current = null;
      setPrompt("");
      setTitle("");
      setActiveDeckId(created.deckId);
      // Utworzenie już się powiodło; problem odświeżenia listy nie może wyglądać
      // jak błąd tworzenia i nie może uruchomić nowego UUID przy kolejnym kliknięciu.
      void onChanged().catch(() => undefined);
    } catch (cause) {
      if ((cause as { code?: string }).code === "validation") {
        // Błąd walidacji jest definitywny, więc rodzic może poprawić tytuł;
        // tylko niepewny wynik sieciowy powinien zachować poprzednie polecenie.
        pendingEmptyCommand.current = null;
      }
      setError(errorMessage(cause));
    } finally {
      creatingEmptyRef.current = false;
      setCreatingEmpty(false);
    }
  };

  if (activeDeckId) {
    return (
      <DeckEditor
        deckId={activeDeckId}
        childrenList={childrenList}
        onEditorStateChange={registerEditorState}
        onAuthExpired={onAuthExpired}
        onBack={() => {
          requestLeave(() => {
            setActiveDeckId(null);
            void onChanged();
          });
        }}
      />
    );
  }

  return (
    <section>
      <section className="card">
        <h2>{messages.decks.newTitle}</h2>
        <label>
          {messages.decks.titleLabel}
          <input data-testid="deck-title" value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          {messages.decks.promptLabel}
          <textarea
            data-testid="deck-prompt"
            rows={3}
            placeholder={messages.decks.promptPlaceholder}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <button
          type="button"
          data-testid="generate-submit"
          onClick={generate}
          disabled={generating || creatingEmpty || prompt.trim().length === 0}
        >
          {messages.decks.generate}
        </button>
        <button
          type="button"
          data-testid="create-empty-submit"
          onClick={createEmpty}
          disabled={generating || creatingEmpty}
        >
          {messages.decks.createEmpty}
        </button>
        {error && (
          <p className="error" data-testid="api-error" role="alert">
            {error}
          </p>
        )}
      </section>

      {decks.length === 0 && <p>{messages.decks.empty}</p>}
      <ul className="plain">
        {decks.map((deck, index) => (
          <li key={deck.deckId}>
            <button
              type="button"
              className="card deck-row row space"
              data-testid={`deck-row-${index}`}
              onClick={() => setActiveDeckId(deck.deckId)}
            >
              <span>{deck.title}</span>
              <span className="badge" data-testid={`deck-state-${index}`}>
                {messages.decks.states[deck.state]}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
