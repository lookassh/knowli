"use client";

import { useEffect, useRef, useState } from "react";
import {
  messages,
  type ChildDto,
  type CreateEmptyDeckCommand,
  type DeckSummaryDto,
  type GenerationCommand,
} from "@learning/contracts";
import { callParent, ApiCallError, errorMessage, parentClient } from "./api";
import { isDefinitiveGenerationRejection, readGenerationAcceptance } from "./generation-request";
import DeckEditor from "./DeckEditor";
import LessonEditor from "./lessons/LessonEditor";
import NewLessonForm from "./lessons/NewLessonForm";
import ArchiveLessonDialog from "./lessons/ArchiveLessonDialog";
import NewMaterialDialog, { type NewMaterialStep } from "./NewMaterialDialog";
import { filterByKind, groupDecksByState, polishPlural, type DeckKindFilter } from "./deck-list-grouping";
import { ParentIcon } from "./ParentIcon";
import type { EditorLeaveState } from "./useParentLeaveGuard";

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

/** Czytelny zapis ISO daty rodzinnej (YYYY-MM-DD) bez stref czasowych. */
function formatFamilyDate(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

/** Części meta wiersza zestawu: liczba pozycji, przypisane dzieci, najbliższy sprawdzian. */
function deckMetaParts(deck: DeckSummaryDto): string[] {
  const kind = deck.kind === "lesson" ? "lesson" : "vocabulary";
  const parts: string[] = [];
  if (deck.itemCount !== undefined) {
    const templates = messages.decks.itemCount[kind];
    parts.push(fill(templates[polishPlural(deck.itemCount)], { n: deck.itemCount }));
  }
  const assigned = deck.assignedChildren ?? [];
  if (assigned.length > 0) {
    const names = assigned.slice(0, 2).map((child) => child.displayName).join(", ");
    parts.push(assigned.length > 2 ? `${names}, ${fill(messages.decks.assignedMore, { n: assigned.length - 2 })}` : names);
    const nearest = assigned
      .map((child) => child.testDate)
      .filter((date): date is string => date !== null)
      .sort()
      .at(0);
    if (nearest) {
      parts.push(fill(messages.decks.testDateShort, { date: formatFamilyDate(nearest) }));
    }
  }
  return parts;
}

/** Lista zestawów pogrupowana po stanie i uruchomienie generacji nowego materiału. */
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
  const [vocabularyFormat, setVocabularyFormat] = useState<"standard" | "picture">("standard");
  const [generating, setGenerating] = useState(false);
  const [creatingEmpty, setCreatingEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [activeDeckKind, setActiveDeckKind] = useState<"vocabulary" | "lesson">("vocabulary");
  const [creatingLesson, setCreatingLesson] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [newMaterialOpen, setNewMaterialOpen] = useState(false);
  const [newMaterialStep, setNewMaterialStep] = useState<NewMaterialStep>("menu");
  const [kindFilter, setKindFilter] = useState<DeckKindFilter>("all");
  const [archiveLesson, setArchiveLesson] = useState<DeckSummaryDto | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveNotice, setArchiveNotice] = useState<string | null>(null);
  // Potwierdzony zapis pozostaje widoczny także po nieudanym odświeżeniu listy.
  const [archivedIds, setArchivedIds] = useState<ReadonlySet<string>>(new Set());
  const archiveBusyRef = useRef(false);
  const archiveFilter = useRef<HTMLInputElement>(null);
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

  const archive = async () => {
    if (!archiveLesson || archiveBusyRef.current) return;
    archiveBusyRef.current = true;
    setArchiveBusy(true);
    setArchiveError(null);
    try {
      await callParent(() => parentClient.decks.archive({ deckId: archiveLesson.deckId }));
      if (!mounted.current) return;
      setArchivedIds((current) => new Set([...current, archiveLesson.deckId]));
      setArchiveLesson(null);
      try {
        await onChanged();
      } catch (cause) {
        if (!mounted.current) return;
        if ((cause as { status?: number }).status === 401) onAuthExpired();
        else setArchiveNotice(messages.lessons.archiveRefreshFailed);
      }
    } catch (cause) {
      if (!mounted.current) return;
      if ((cause as { status?: number }).status === 401) onAuthExpired();
      else setArchiveError(cause instanceof ApiCallError ? errorMessage(cause) : messages.lessons.archiveFailed);
    } finally {
      archiveBusyRef.current = false;
      if (mounted.current) setArchiveBusy(false);
    }
  };

  const visibleDecks = decks
    .map((deck) => archivedIds.has(deck.deckId) ? { ...deck, state: "archived" as const } : deck)
    .filter((deck) => showArchived || deck.kind !== "lesson" || deck.state !== "archived");

  // Stan niepewnego polecenia żyje poza modalem: ponowne otwarcie wraca do
  // formularza z przyciskiem ponowienia, zanim polecenie zostanie rozstrzygnięte.
  const openNewMaterial = () => {
    setNewMaterialStep(
      pendingGenerationCommand.current !== null
        ? "generate"
        : pendingEmptyCommand.current !== null
          ? "empty"
          : "menu",
    );
    setNewMaterialOpen(true);
  };

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
      vocabularyFormat,
      ...(title.trim() ? { title: title.trim() } : {}),
    };
    pendingGenerationCommand.current = command;
    try {
      const response = await callParent(() => parentClient.decks.generate(command));
      const acceptance = readGenerationAcceptance(response);
      if (!acceptance) {
        if (mounted.current) setError(messages.decks.generationUncertain);
        return;
      }
      pendingGenerationCommand.current = null;
      if (mounted.current) {
        setPrompt("");
        setTitle("");
        setVocabularyFormat("standard");
        setActiveDeckKind("vocabulary");
        setActiveDeckId(acceptance.deckId);
        setNewMaterialOpen(false);
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
      const created = await callParent(() => parentClient.decks.create(command));
      pendingEmptyCommand.current = null;
      setPrompt("");
      setTitle("");
      setActiveDeckKind("vocabulary");
      setActiveDeckId(created.body.deckId);
      setNewMaterialOpen(false);
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

  const pendingGeneration = pendingGenerationCommand.current !== null;
  const groups = groupDecksByState(filterByKind(visibleDecks, kindFilter));
  let rowIndex = 0;

  return (
    <section>
      <div className="pp-pagehead">
        <h2 className="pp-pagehead-title">{messages.decks.title}</h2>
        <button
          type="button"
          className="pp-btn pp-btn-primary"
          data-testid="new-material-open"
          onClick={openNewMaterial}
        >
          <ParentIcon name="plus" />
          {messages.decks.newMaterial}
        </button>
      </div>

      <div className="pp-filterbar">
        <div className="pp-filter-segmented" data-testid="deck-kind-filter" role="group" aria-label={messages.decks.kindFilterLabel}>
          {(["all", "vocabulary", "lesson"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className={kindFilter === kind ? "is-on" : undefined}
              aria-pressed={kindFilter === kind}
              onClick={() => setKindFilter(kind)}
            >
              {messages.decks.kindFilter[kind]}
            </button>
          ))}
        </div>
        {decks.some((deck) => deck.kind === "lesson") && (
          <label className="pp-check">
            <input
              ref={archiveFilter}
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            {messages.lessons.showArchived}
          </label>
        )}
      </div>

      {archiveNotice && <p role="status">{archiveNotice}</p>}
      {visibleDecks.length === 0 && <p className="pp-empty">{messages.decks.empty}</p>}

      {groups.map((group) => (
        <section key={group.id} data-testid={`deck-group-${group.id}`}>
          <h3 className="pp-group-label">
            {messages.decks.groups[group.id]}
            <span className="pp-group-count">{group.decks.length}</span>
          </h3>
          <ul className="pp-plain">
            {group.decks.map((deck) => {
              const index = rowIndex++;
              const kind = deck.kind === "lesson" ? "lesson" : "vocabulary";
              const metaParts = deckMetaParts(deck);
              const chipTone =
                deck.state === "published"
                  ? "pp-chip-green"
                  : deck.state === "review"
                    ? "pp-chip-amber"
                    : "pp-chip-gray";
              return (
                <li key={deck.deckId} className="pp-deck-li">
                  <button
                    type="button"
                    className="pp-deck"
                    data-testid={`deck-row-${index}`}
                    data-deck-id={deck.deckId}
                    onClick={() => {
                      setActiveDeckKind(kind);
                      setActiveDeckId(deck.deckId);
                    }}
                  >
                    <span className={`pp-deck-icon ${kind === "lesson" ? "pp-deck-icon-purple" : "pp-deck-icon-blue"}`}>
                      <ParentIcon name={kind === "lesson" ? "graduation-cap" : "book-open"} />
                    </span>
                    <span className="pp-deck-body">
                      <span className="pp-deck-title">{deck.title}</span>
                      <span className="pp-deck-meta">
                        <span className="pp-sr-only" data-testid={`deck-kind-${index}`}>
                          {messages.lessons.kindLabel[kind]}
                        </span>
                        {metaParts.map((part, partIndex) => (
                          <span key={partIndex}>
                            {partIndex > 0 && <span className="pp-meta-dot" aria-hidden="true">·</span>}
                            {part}
                          </span>
                        ))}
                      </span>
                    </span>
                    <span className="pp-deck-side">
                      <span className={`pp-chip ${chipTone}`}>{messages.decks.states[deck.state]}</span>
                      <ParentIcon name="chevron-right" className="pp-deck-chevron" />
                    </span>
                  </button>
                  {deck.kind === "lesson" && deck.state !== "archived" && (
                    <button
                      type="button"
                      className="pp-btn pp-btn-quiet pp-btn-icon pp-deck-remove"
                      disabled={archiveBusy}
                      aria-label={messages.lessons.archiveLabel.replace("{title}", deck.title)}
                      onClick={() => {
                        setArchiveError(null);
                        setArchiveNotice(null);
                        setArchiveLesson(deck);
                      }}
                    >
                      <ParentIcon name="trash-2" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <NewMaterialDialog
        open={newMaterialOpen}
        step={newMaterialStep}
        onStepChange={setNewMaterialStep}
        onRequestClose={() => setNewMaterialOpen(false)}
        title={title}
        onTitleChange={setTitle}
        vocabularyFormat={vocabularyFormat}
        onVocabularyFormatChange={setVocabularyFormat}
        prompt={prompt}
        onPromptChange={setPrompt}
        generating={generating}
        pendingGeneration={pendingGeneration}
        createDisabled={
          newMaterialStep === "generate"
            ? generating || creatingEmpty || creatingEmptyRef.current || (!pendingGeneration && prompt.trim().length === 0)
            : generating || creatingEmpty || pendingGeneration
        }
        onGenerate={generate}
        creatingEmpty={creatingEmpty}
        pendingEmpty={pendingEmptyCommand.current !== null}
        onCreateEmpty={createEmpty}
        onLesson={() => {
          setNewMaterialOpen(false);
          setCreatingLesson(true);
        }}
        error={error}
      />

      <ArchiveLessonDialog lesson={archiveLesson} busy={archiveBusy} error={archiveError}
        onConfirm={() => { void archive(); }}
        onFocusFallback={() => archiveFilter.current?.focus()}
        onCancel={() => { if (!archiveBusyRef.current) setArchiveLesson(null); }} />
    </section>
  );
}
