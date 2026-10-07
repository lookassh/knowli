"use client";

import { useState } from "react";
import { messages, type ChildDto, type DeckSummaryDto } from "@learning/contracts";
import { apiFetch, errorMessage } from "./api";
import DeckEditor from "./DeckEditor";

/** Lista zestawów i uruchomienie generacji nowego materiału. */
export default function DecksPanel({
  decks,
  childrenList,
  onChanged,
}: {
  decks: DeckSummaryDto[];
  childrenList: ChildDto[];
  onChanged: () => Promise<void>;
}) {
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);

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

  if (activeDeckId) {
    return (
      <DeckEditor
        deckId={activeDeckId}
        childrenList={childrenList}
        onBack={() => {
          setActiveDeckId(null);
          void onChanged();
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
          disabled={generating || prompt.trim().length === 0}
        >
          {messages.decks.generate}
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
