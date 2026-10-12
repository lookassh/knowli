"use client";

import { useEffect, useRef, useState } from "react";
import {
  messages,
  type ChildDto,
  type CreateEmptyDeckCommand,
  type CreateEmptyDeckResult,
  type DeckSummaryDto,
  type GenerationCommand,
} from "@learning/contracts";
import { apiFetch, errorMessage } from "./api";
import { isDefinitiveGenerationRejection, readGenerationAcceptance } from "./generation-request";
import DeckEditor from "./DeckEditor";
import LessonEditor from "./lessons/LessonEditor";
import NewLessonForm from "./lessons/NewLessonForm";
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
  const [activeDeckKind, setActiveDeckKind] = useState<"vocabulary" | "lesson">("vocabulary");
  const [creatingLesson, setCreatingLesson] = useState(false);
  const pendingEmptyCommand = useRef<CreateEmptyDeckCommand | null>(null);
  const creatingEmptyRef = useRef(false);
  const pendingGenerationCommand = useRef<GenerationCommand | null>(null);
  const generatingRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const generate = async () => {
    if (generatingRef.current || creatingEmptyRef.current) {
      return;
    }
    generatingRef.current = true;
    setGenerating(true);
    setError(null);
    const command = pendingGenerationCommand.current ?? {
      prompt: prompt.trim(),
      idempotencyKey: crypto.randomUUID(),
      ...(title.trim() ? { title: title.trim() } : {}),
    };
    pendingGenerationCommand.current = command;
    try {
      const response = await apiFetch<unknown>("POST", "/api/v1/parent/decks/generate", command);
      const acceptance = readGenerationAcceptance(response);
      if (!acceptance) {
        if (mounted.current) setError(messages.decks.generationUncertain);
        return;
      }
      pendingGenerationCommand.current = null;
      if (mounted.current) {
        setPrompt("");
        setTitle("");
        setActiveDeckKind("vocabulary");
        setActiveDeckId(acceptance.deckId);
        void onChanged().catch(() => undefined);
      }
    } catch (cause) {
      if (isDefinitiveGenerationRejection(cause)) {
        pendingGenerationCommand.current = null;
        if ((cause as { status?: number }).status === 401) {
          if (mounted.current) onAuthExpired();
          return;
        }
        if (mounted.current) setError(errorMessage(cause));
      } else if (mounted.current) {
        setError(messages.decks.generationUncertain);
      }
    } finally {
      generatingRef.current = false;
      if (mounted.current) setGenerating(false);
    }
  };

  const createEmpty = async () => {
    if (creatingEmptyRef.current || generatingRef.current || pendingGenerationCommand.current !== null) {
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
      setActiveDeckKind("vocabulary");
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
    const back = () =>
      requestLeave(() => {
        setActiveDeckId(null);
        void onChanged();
      });
    return activeDeckKind === "lesson" ? (
      <LessonEditor
        deckId={activeDeckId}
        childrenList={childrenList}
        onEditorStateChange={registerEditorState}
        onAuthExpired={onAuthExpired}
        onBack={back}
      />
    ) : (
      <DeckEditor
        deckId={activeDeckId}
        childrenList={childrenList}
        onEditorStateChange={registerEditorState}
        onAuthExpired={onAuthExpired}
        onBack={back}
      />
    );
  }

  if (creatingLesson) {
    return (
      <NewLessonForm
        onAuthExpired={onAuthExpired}
        onCancel={() => setCreatingLesson(false)}
        onCreated={(createdDeckId) => {
          setCreatingLesson(false);
          setActiveDeckKind("lesson");
          setActiveDeckId(createdDeckId);
          void onChanged().catch(() => undefined);
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
          <input data-testid="deck-title" value={title} disabled={generating || pendingGenerationCommand.current !== null || creatingEmpty} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          {messages.decks.promptLabel}
          <textarea
            data-testid="deck-prompt"
            rows={3}
            placeholder={messages.decks.promptPlaceholder}
            value={prompt}
            disabled={generating || pendingGenerationCommand.current !== null || creatingEmpty}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <button
          type="button"
          data-testid="generate-submit"
          onClick={generate}
          disabled={generating || creatingEmpty || creatingEmptyRef.current || (!pendingGenerationCommand.current && prompt.trim().length === 0)}
        >
          {generating ? messages.decks.generating : pendingGenerationCommand.current ? messages.decks.retryGenerationRequest : messages.decks.generate}
        </button>
        <button
          type="button"
          data-testid="create-empty-submit"
          onClick={createEmpty}
          disabled={generating || creatingEmpty || pendingGenerationCommand.current !== null}
        >
          {messages.decks.createEmpty}
        </button>
        <button
          type="button"
          data-testid="new-lesson-submit"
          onClick={() => setCreatingLesson(true)}
          disabled={generating || creatingEmpty || pendingGenerationCommand.current !== null}
        >
          {messages.lessons.newLesson}
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
              onClick={() => {
                setActiveDeckKind(deck.kind === "lesson" ? "lesson" : "vocabulary");
                setActiveDeckId(deck.deckId);
              }}
            >
              <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                <span className="badge" data-testid={`deck-kind-${index}`}>
                  {messages.lessons.kindLabel[deck.kind ?? "vocabulary"]}
                </span>{" "}
                {deck.title}
              </span>
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
