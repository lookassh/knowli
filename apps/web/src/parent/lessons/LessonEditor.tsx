"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  messages,
  AssignmentPutSchema,
  type ChildDto,
  type LessonDeckDto,
  type LessonDraftDto,
  type LessonExerciseErrors,
  type SubjectCatalogDto,
} from "@learning/contracts";
import { apiFetch, ApiCallError, errorMessage } from "../api";
import AssignmentTestGoalFields, { type AssignmentTestSettings } from "../AssignmentTestGoalFields";
import type { EditorLeaveState } from "../useParentLeaveGuard";
import LessonSupervisionPanel from "./LessonSupervisionPanel";
import {
  createLessonSnapshot,
  groupExercisesByObjectiveAndStage,
  lessonExerciseChanged,
  toLessonDraftPatch,
  type EditableLessonExercise,
  type EditableLessonForm,
  type LessonEditorSnapshot,
} from "./lesson-editor-state";

/** Pola payloadu edytowalne per typ ćwiczenia (reszta jest tylko do odczytu dla danego typu). */
const STEM_LABEL_TYPES = new Set(["lesson_choice", "lesson_gap"]);

/** Czy zapisany werdykt dowolnych odpowiedzi jest wyłączony (brak modelu oceniającego). */
function gradingDisabled(deck: LessonDeckDto | null): boolean {
  // Typowane pole `grading` (zadanie 16) zastąpiło rzutowanie
  // `deck as unknown as {gradingAvailable?: boolean}`.
  return deck?.grading.available === false;
}

/**
 * Przegląd i edycja jednej lekcji: ćwiczenia pogrupowane wg reguł i etapów
 * z etykietami typów, edycja pól zależnie od typu, usuwanie, walidacja per
 * ćwiczenie (400), zapis z `expectedEditNumber` i obsługą konfliktu (409),
 * dogenerowanie per reguła, pokrycie etapów, karty wyjaśnienia, status TTS,
 * publikacja (409 pokrycia → lista braków), nowa wersja i przypisania z celem
 * kartkówki „Gramatyka". Reużywa `useParentLeaveGuard` (przez propsy) oraz
 * logikę stanu z `lesson-editor-state.ts`.
 */
export default function LessonEditor({
  deckId,
  childrenList,
  onBack,
  onEditorStateChange,
  onAuthExpired,
}: {
  deckId: string;
  childrenList: ChildDto[];
  onBack: () => void;
  onEditorStateChange: (state: EditorLeaveState) => void;
  onAuthExpired: () => void;
}) {
  const [deck, setDeck] = useState<LessonDeckDto | null>(null);
  const [form, setForm] = useState<EditableLessonForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [exerciseErrors, setExerciseErrors] = useState<Record<number, string[]>>({});
  const [regenCounts, setRegenCounts] = useState<Record<string, number>>({});
  const [assignDates, setAssignDates] = useState<Record<string, string>>({});
  const [assignSettings, setAssignSettings] = useState<Record<string, AssignmentTestSettings>>({});
  // Edytowalne przykłady AI per cel (wym. 3.3). Trzymane lokalnie, bo serializacja
  // PATCH-a ćwiczeń żyje w `lesson-editor-state.ts` (poza zakresem tej edycji);
  // przykłady dokładamy do ciała PATCH w `save()`. `null` = jeszcze nie zasiane.
  const [examplesForm, setExamplesForm] = useState<Record<string, string[]> | null>(null);
  const [catalog, setCatalog] = useState<SubjectCatalogDto | null>(null);

  const dirty = useRef(false);
  const busyRef = useRef(false);
  const regenLock = useRef(false);
  const baseSnapshot = useRef<LessonEditorSnapshot | null>(null);
  const loadVersion = useRef(0);
  const newKey = useCallback(() => crypto.randomUUID(), []);

  const setBusyState = (value: boolean) => {
    busyRef.current = value;
    setBusy(value);
    onEditorStateChange({ dirty: dirty.current, busy: value });
  };
  const markDirty = () => {
    dirty.current = true;
    setIsDirty(true);
    onEditorStateChange({ dirty: true, busy: busyRef.current });
  };

  useEffect(() => {
    onEditorStateChange({ dirty: isDirty || conflict, busy });
    return () => onEditorStateChange({ dirty: false, busy: false });
  }, [onEditorStateChange, isDirty, busy, conflict]);

  const load = useCallback(async (): Promise<boolean> => {
    const requestVersion = ++loadVersion.current;
    try {
      const result = await apiFetch<LessonDeckDto>("GET", `/api/v1/parent/lessons/${deckId}`);
      if (requestVersion === loadVersion.current && !dirty.current && !conflict) {
        setDeck(result);
      }
      return true;
    } catch (cause) {
      if (requestVersion === loadVersion.current && !dirty.current && !conflict) {
        setError(errorMessage(cause));
      }
      return false;
    }
  }, [deckId, conflict]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<SubjectCatalogDto>("GET", "/api/v1/parent/lesson-catalog")
      .then((result) => { if (!cancelled) setCatalog(result); })
      .catch((cause) => { if (!cancelled) setError(errorMessage(cause)); });
    return () => { cancelled = true; };
  }, [deckId]);

  const draft = deck?.draft ?? null;
  const active: LessonDraftDto | null = draft ?? deck?.published ?? null;
  const editable = draft !== null;

  const generating = deck?.generation?.state === "queued" || deck?.generation?.state === "running";
  const generationFailure = deck?.generation?.errorCode
    ? messages.lessons.generationErrors[deck.generation.errorCode] ?? messages.lessons.generationFailed
    : messages.lessons.generationFailed;
  const assetsPending = active?.assets.some((a) => a.state === "pending") ?? false;
  useEffect(() => {
    if (!generating && !assetsPending) return;
    const timer = setInterval(() => void load(), 1000);
    return () => clearInterval(timer);
  }, [generating, assetsPending, load]);

  // Formularz podąża za widoczną wersją, dopóki rodzic nie zaczął edytować.
  useEffect(() => {
    if (!active || dirty.current) return;
    const snapshot = createLessonSnapshot(active, newKey);
    if (draft) baseSnapshot.current = snapshot;
    setForm(snapshot.form);
    setExamplesForm(structuredClone(active.examples ?? {}));
  }, [active, draft, newKey]);

  useEffect(() => () => {
    loadVersion.current += 1;
  }, [deckId]);

  const mutateExercise = (clientKey: string, patch: Partial<EditableLessonExercise>) => {
    markDirty();
    setForm((current) =>
      current
        ? { ...current, exercises: current.exercises.map((ex) => (ex.clientKey === clientKey ? { ...ex, ...patch } : ex)) }
        : current,
    );
  };

  const removeExercise = (clientKey: string) => {
    markDirty();
    setForm((current) =>
      current ? { ...current, exercises: current.exercises.filter((ex) => ex.clientKey !== clientKey) } : current,
    );
  };

  // Edycja jednej linii przykładu danego celu (wym. 3.3): rodzic poprawia błędny
  // przykład AI przed publikacją. Zmiana brudzi formularz jak każda inna edycja.
  const mutateExampleLine = (objectiveId: string, lineIndex: number, value: string) => {
    markDirty();
    setExamplesForm((current) => {
      const base = current ?? {};
      const lines = [...(base[objectiveId] ?? [])];
      lines[lineIndex] = value;
      return { ...base, [objectiveId]: lines };
    });
  };

  const save = async () => {
    const base = baseSnapshot.current;
    if (!draft || !form || !base || busyRef.current || !dirty.current || base.versionId !== draft.id) return;
    if (form.title.trim().length === 0) {
      setError(messages.decks.titleIncomplete);
      return;
    }
    const snapshot: LessonEditorSnapshot = { ...base, form: structuredClone(form) };
    setBusyState(true);
    setError(null);
    setExerciseErrors({});
    try {
      const patch = toLessonDraftPatch(snapshot);
      // Przykłady serwer nadpisuje całością per cel; dokładamy aktualny stan,
      // bo serializacja ćwiczeń (lesson-editor-state) ich nie obejmuje.
      if (examplesForm) patch.examples = examplesForm;
      const saved = await apiFetch<LessonDraftDto>("PATCH", `/api/v1/parent/lesson-drafts/${snapshot.versionId}`, patch);
      baseSnapshot.current = createLessonSnapshot(saved, newKey);
      setForm(baseSnapshot.current.form);
      setExamplesForm(structuredClone(saved.examples ?? {}));
      dirty.current = false;
      setIsDirty(false);
      onEditorStateChange({ dirty: false, busy: true });
      setDeck((current) => (current ? { ...current, draft: saved, title: saved.title } : current));
      if (!(await load())) setError(messages.decks.savedRefreshFailed);
    } catch (cause) {
      if (cause instanceof ApiCallError && cause.code === "validation" && cause.details) {
        const parsed = cause.details as LessonExerciseErrors;
        const map: Record<number, string[]> = {};
        for (const entry of parsed.exercises ?? []) map[entry.index] = entry.errors;
        setExerciseErrors(map);
        setError(messages.errors.validation);
      } else if (cause instanceof ApiCallError && (cause.code === "conflict" || cause.code === "immutable")) {
        setConflict(true);
        setError(messages.decks.conflictDetected);
      } else {
        setError(errorMessage(cause));
      }
    } finally {
      setBusyState(false);
    }
  };

  // Konflikt: porzuć lokalne poprawki i wczytaj aktualną wersję (wspólny,
  // minimalny mechanizm — odpowiednik „przejdź na aktualną wersję" słówek).
  const loadCurrentVersion = async () => {
    setBusyState(true);
    try {
      const result = await apiFetch<LessonDeckDto>("GET", `/api/v1/parent/lessons/${deckId}`);
      dirty.current = false;
      setIsDirty(false);
      setConflict(false);
      setDeck(result);
      const next = result.draft ?? result.published;
      if (next) {
        const snapshot = createLessonSnapshot(next, newKey);
        if (result.draft) baseSnapshot.current = snapshot;
        setForm(snapshot.form);
        setExamplesForm(structuredClone(next.examples ?? {}));
      }
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyState(false);
    }
  };

  const publish = async () => {
    if (!draft || busy || isDirty || conflict || draft.exercises.length === 0 || draft.coverage.length > 0) return;
    setBusyState(true);
    setError(null);
    try {
      await apiFetch("POST", `/api/v1/parent/lesson-drafts/${draft.id}/publish`, { expectedEditNumber: draft.editNumber });
      dirty.current = false;
      setIsDirty(false);
      await load();
    } catch (cause) {
      // 409 pokrycia: odśwież, by pokazać aktualną listę braków z DTO.
      setError(errorMessage(cause));
      await load();
    } finally {
      setBusyState(false);
    }
  };

  const startNewVersion = async () => {
    setBusyState(true);
    setError(null);
    try {
      await apiFetch("POST", `/api/v1/parent/lessons/${deckId}/draft`);
      dirty.current = false;
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyState(false);
    }
  };

  const retry = async () => {
    if (!deck?.generation || busyRef.current || dirty.current || conflict) return;
    setBusyState(true);
    setError(null);
    try {
      await apiFetch("POST", `/api/v1/parent/generation/${deck.generation.id}/retry`);
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyState(false);
    }
  };

  const regenerate = async (objectiveId: string) => {
    if (!draft || busyRef.current || regenLock.current || generating || isDirty) return;
    regenLock.current = true;
    const count = regenCounts[objectiveId] ?? 4;
    setBusyState(true);
    setError(null);
    try {
      await apiFetch("POST", `/api/v1/parent/lesson-drafts/${draft.id}/regenerate`, {
        objectiveId,
        count,
        expectedEditNumber: draft.editNumber,
        clientRequestId: crypto.randomUUID(),
      });
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      regenLock.current = false;
      setBusyState(false);
    }
  };

  const assignmentSettings = (childId: string): AssignmentTestSettings => {
    const existing = deck?.assignments.find((a) => a.childId === childId);
    return assignSettings[childId] ?? { testGoals: existing?.testGoals ?? null, mockTestTaskCount: existing?.mockTestTaskCount ?? 10 };
  };

  const assign = async (childId: string) => {
    setError(null);
    try {
      await apiFetch("PUT", `/api/v1/parent/assignments/${childId}/${deckId}`, {
        testDate: (assignDates[childId] ?? deck?.assignments.find((a) => a.childId === childId)?.testDate) || null,
        ...assignmentSettings(childId),
      });
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const playAsset = (assetId: string) => {
    const audio = new Audio(`/api/v1/media/${assetId}`);
    void audio.play().catch(() => undefined);
  };

  // Źródło przykładów do wyświetlenia: edytowalny stan lokalny gdy jest szkic,
  // inaczej wartości z DTO (opublikowana wersja — podgląd tylko do odczytu).
  const examples = editable ? (examplesForm ?? draft?.examples ?? {}) : (deck?.published?.examples ?? {});
  const topic = catalog?.subjects.find((subject) => subject.id === active?.subjectId)?.topics
    .find((candidate) => candidate.id === active?.topicId && candidate.version === active?.topicVersion);
  const indexByClientKey = new Map((form?.exercises ?? []).map((ex, index) => [ex.clientKey, index]));
  const groups = form ? groupExercisesByObjectiveAndStage(form.exercises, active?.objectiveIds ?? []) : [];

  const audioStateText = (state: string): string =>
    messages.decks.audioState[state === "approved" ? "ready" : state] ?? "";

  return (
    <section data-testid="lesson-editor">
      <div className="row space">
        <button type="button" data-testid="editor-back" onClick={onBack}>{messages.decks.back}</button>
        <h2>{deck?.title ?? ""}</h2>
        {deck?.state === "published" && <span className="badge ok" data-testid="publish-status">{messages.decks.published}</span>}
      </div>

      {generating && <div className="info" data-testid="generation-banner">
        <p>{messages.lessons.generating}</p>
        {deck?.generation?.state === "running" && <p>{messages.lessons.stalledGenerationHint}{" "}
          <button type="button" data-testid="retry-stalled-generation" disabled={busy || isDirty || conflict} onClick={retry}>{messages.lessons.retryGeneration}</button>
        </p>}
      </div>}
      {deck?.generation?.state === "failed" && (
        <p className="error" data-testid="generation-failed">
          {generationFailure}{" "}
          <button type="button" onClick={retry}>{messages.lessons.retryGeneration}</button>
        </p>
      )}
      {gradingDisabled(deck) && <p className="info" data-testid="grading-disabled">{messages.lessons.gradingDisabled}</p>}
      {active && active.rejectedCount > 0 && (
        <p className="muted" data-testid="rejected-count">{messages.lessons.rejectedCount.replace("{n}", String(active.rejectedCount))}</p>
      )}
      {error && <p className="error" data-testid="api-error" role="alert">{error}</p>}

      {conflict && (
        <section className="card" data-testid="lesson-conflict-panel" aria-labelledby="lesson-conflict-title">
          <h3 id="lesson-conflict-title">{messages.decks.conflictTitle}</h3>
          <p>{messages.decks.conflictDescription}</p>
          <button type="button" data-testid="conflict-load-remote" disabled={busy} onClick={loadCurrentVersion}>
            {messages.decks.conflictLoad}
          </button>
        </section>
      )}

      {form && (
        <label>
          {messages.decks.titleLabel}
          <input
            data-testid="editor-title"
            value={form.title}
            disabled={!editable || busy}
            onChange={(e) => { markDirty(); setForm((c) => (c ? { ...c, title: e.target.value } : c)); }}
          />
        </label>
      )}

      {/* Karty wyjaśnienia: tekst reguły z katalogu (read-only); przykłady AI
          rodzic może poprawić przed publikacją (wym. 3.3). */}
      {active && active.objectiveIds.length > 0 && (
        <section className="card" data-testid="lesson-examples">
          <h3>{messages.lessons.examplesTitle}</h3>
          <p className="muted">{messages.lessons.exampleHint}</p>
          {active.objectiveIds.map((objectiveId) => (
            <div key={objectiveId} data-testid={`examples-${objectiveId}`}>
              <strong>{topic?.objectives.find((objective) => objective.id === objectiveId)?.titlePl ?? objectiveId}</strong>
              {topic?.objectives.find((objective) => objective.id === objectiveId)?.cards.map((card, index) => (
                <article key={index} className="card" data-testid={`lesson-card-preview-${objectiveId}`}>
                  <h4>{card.title}</h4>
                  <p>{card.body.split("{{examples}}").join(" ").replace(/\s+/g, " ").trim()}</p>
                  <ul>{(examples[objectiveId] ?? []).map((line, i) => line.trim() && <li key={i}>{line.trim()}</li>)}</ul>
                </article>
              ))}
              {editable ? (
                <ul className="plain">
                  {(examples[objectiveId] ?? []).map((line, i) => (
                    <li key={i}>
                      <input
                        data-testid={`example-line-${objectiveId}-${i}`}
                        value={line}
                        disabled={busy}
                        aria-label={messages.lessons.exampleLineLabel.replace("{n}", String(i + 1))}
                        onChange={(e) => mutateExampleLine(objectiveId, i, e.target.value)}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="plain">
                  {(examples[objectiveId] ?? []).map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              )}
              {editable && <button type="button" data-testid={`example-add-${objectiveId}`} disabled={busy || (examples[objectiveId]?.length ?? 0) >= 3}
                onClick={() => mutateExampleLine(objectiveId, examples[objectiveId]?.length ?? 0, "")}>{messages.lessons.addExample}</button>}
            </div>
          ))}
        </section>
      )}

      {groups.map((group) => (
        <section className="card" key={group.objectiveId} data-testid={`objective-group-${group.objectiveId}`}>
          <h3>{group.objectiveId}</h3>
          {group.stages.map((stageGroup) => (
            <div key={stageGroup.stage} data-testid={`stage-${group.objectiveId}-${stageGroup.stage}`}>
              <h4>{messages.lessons.stages[stageGroup.stage]}</h4>
              {stageGroup.exercises.length === 0 ? (
                <p className="muted">{messages.lessons.noExercisesInStage}</p>
              ) : (
                stageGroup.exercises.map((ex) => {
                  const index = indexByClientKey.get(ex.clientKey)!;
                  const errors = exerciseErrors[index];
                  const base = baseSnapshot.current?.form.exercises.find((b) => b.clientKey === ex.clientKey);
                  const unchanged = base !== undefined && !lessonExerciseChanged(ex, base);
                  const revisionId = unchanged ? (active?.exercises.find((e) => e.id === ex.id)?.revisionId ?? "") : "";
                  const audio = active?.assets.find((a) => a.itemRevisionId === revisionId && a.role === "target_audio") ?? null;
                  const errId = `exercise-errors-${index}`;
                  return (
                    <article className="card" key={ex.clientKey} data-testid={`exercise-${index}`}>
                      <div className="row space">
                        <span className="badge" data-testid={`exercise-type-${index}`}>{messages.lessons.exerciseTypes[ex.exerciseType]}</span>
                        {editable && (
                          <button type="button" data-testid={`exercise-remove-${index}`} disabled={busy} onClick={() => removeExercise(ex.clientKey)}>
                            {messages.lessons.removeExercise}
                          </button>
                        )}
                      </div>

                      <label>
                        {messages.lessons.exerciseInstructionLabel}
                        <input data-testid={`exercise-instruction-${index}`} value={ex.instructionPl} disabled={!editable || busy}
                          {...(errors ? { "aria-describedby": errId } : {})}
                          onChange={(e) => mutateExercise(ex.clientKey, { instructionPl: e.target.value })} />
                      </label>

                      {STEM_LABEL_TYPES.has(ex.exerciseType) && (
                        <label>
                          {messages.lessons.exerciseStemLabel}
                          <input data-testid={`exercise-stem-${index}`} value={ex.stem} disabled={!editable || busy}
                            onChange={(e) => mutateExercise(ex.clientKey, { stem: e.target.value })} />
                        </label>
                      )}
                      {(ex.exerciseType === "lesson_error_fix" || ex.exerciseType === "lesson_transform") && (
                        <label>
                          {messages.lessons.exerciseStatementLabel}
                          <input data-testid={`exercise-statement-${index}`} value={ex.statement} disabled={!editable || busy}
                            onChange={(e) => mutateExercise(ex.clientKey, { statement: e.target.value })} />
                        </label>
                      )}
                      {(ex.exerciseType === "lesson_open_answer" || ex.exerciseType === "lesson_short_answer") && (
                        <label>
                          {messages.lessons.exercisePromptLabel}
                          <input data-testid={`exercise-prompt-${index}`} value={ex.prompt || (ex.exerciseType === "lesson_short_answer" ? ex.stem : "")} disabled={!editable || busy}
                            onChange={(e) => mutateExercise(ex.clientKey, { prompt: e.target.value })} />
                        </label>
                      )}

                      {ex.exerciseType === "lesson_notice" ? (
                        <p className="muted" data-testid={`exercise-notice-word-${index}`}>
                          {messages.lessons.exerciseNoticeWord}: {ex.correctOption}
                        </p>
                      ) : (
                        <label>
                          {messages.lessons.exerciseAnswerLabel}
                          <input data-testid={`exercise-answer-${index}`} value={ex.answer} disabled={!editable || busy}
                            {...(errors ? { "aria-describedby": errId } : {})}
                            onChange={(e) => mutateExercise(ex.clientKey, { answer: e.target.value })} />
                        </label>
                      )}

                      {ex.options && (
                        <fieldset>
                          <legend>{messages.lessons.exerciseCorrectOptionLabel}</legend>
                          {ex.options.map((opt, oi) => (
                            <label key={opt.id} style={{ display: "block" }}>
                              <input type="radio" name={`correct-${index}`} data-testid={`exercise-correct-${index}-${opt.id}`}
                                checked={ex.correctOption === opt.id} disabled={!editable || busy}
                                onChange={() => mutateExercise(ex.clientKey, { correctOption: opt.id })} />{" "}
                              <input data-testid={`exercise-option-${index}-${oi}`} value={opt.text} disabled={!editable || busy}
                                aria-label={messages.lessons.exerciseOptionLabel.replace("{n}", String(oi + 1))}
                                onChange={(e) => mutateExercise(ex.clientKey, { options: ex.options!.map((o) => (o.id === opt.id ? { ...o, text: e.target.value } : o)) })} />
                            </label>
                          ))}
                        </fieldset>
                      )}

                      {ex.items && (
                        <fieldset>
                          <legend>{messages.lessons.exerciseItemLabel.replace("{n}", "")}</legend>
                          {ex.items.map((item, ii) => (
                            <input key={item.id} data-testid={`exercise-item-${index}-${ii}`} value={item.text} disabled={!editable || busy}
                              aria-label={messages.lessons.exerciseItemLabel.replace("{n}", String(ii + 1))}
                              onChange={(e) => mutateExercise(ex.clientKey, { items: ex.items!.map((o) => (o.id === item.id ? { ...o, text: e.target.value } : o)) })} />
                          ))}
                        </fieldset>
                      )}

                      <label>
                        {messages.lessons.exerciseAcceptedLabel}
                        <textarea data-testid={`exercise-accepted-${index}`} value={ex.acceptedText} disabled={!editable || busy}
                          onChange={(e) => mutateExercise(ex.clientKey, { acceptedText: e.target.value })} />
                      </label>
                      <label>
                        {messages.lessons.exerciseFocusLabel}
                        <input data-testid={`exercise-focus-${index}`} value={ex.focusText} disabled={!editable || busy}
                          onChange={(e) => mutateExercise(ex.clientKey, { focusText: e.target.value })} />
                      </label>

                      {audio && (
                        <div className="row">
                          <span data-testid={`exercise-audio-state-${index}`}>{audioStateText(audio.state)}</span>
                          <button type="button" data-testid={`exercise-play-${index}`}
                            disabled={!(audio.state === "approved" && audio.assetId)}
                            onClick={() => audio.assetId && playAsset(audio.assetId)}>
                            {messages.decks.listen}
                          </button>
                        </div>
                      )}

                      {errors && (
                        <div className="error" id={errId} data-testid={`exercise-errors-${index}`} role="alert">
                          <p>{messages.lessons.exerciseErrorsTitle}</p>
                          <ul className="plain">{errors.map((msg, i) => <li key={i}>{msg}</li>)}</ul>
                        </div>
                      )}
                    </article>
                  );
                })
              )}
            </div>
          ))}

          {editable && (
            <div className="row">
              <label htmlFor={`regen-count-${group.objectiveId}`}>{messages.lessons.regenerateCount}</label>
              <input id={`regen-count-${group.objectiveId}`} type="number" min={1} max={60} step={1}
                data-testid={`regen-count-${group.objectiveId}`}
                value={regenCounts[group.objectiveId] ?? 4} disabled={busy || generating || isDirty}
                onChange={(e) => setRegenCounts((c) => ({ ...c, [group.objectiveId]: Number(e.target.value) }))} />
              <button type="button" data-testid={`regen-submit-${group.objectiveId}`} disabled={busy || generating || isDirty}
                onClick={() => regenerate(group.objectiveId)}>
                {messages.lessons.regenerateSubmit}
              </button>
            </div>
          )}
        </section>
      ))}

      {active && (
        <section className="card" data-testid="coverage-section">
          <h3>{messages.lessons.coverageTitle}</h3>
          {active.coverage.length === 0 ? (
            <p data-testid="coverage-ok">{messages.lessons.coverageOk}</p>
          ) : (
            <ul className="plain" data-testid="coverage-gaps">
              {active.coverage.map((gap, i) => (
                <li key={i} data-testid={`coverage-gap-${i}`}>
                  {messages.lessons.coverageGap
                    .replace("{objective}", gap.objectiveId)
                    .replace("{stage}", messages.lessons.stages[gap.stage] ?? gap.stage)
                    .replace("{actual}", String(gap.actual))
                    .replace("{required}", String(gap.required))}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {deck?.state === "published" && !draft && (
        <div className="row">
          <button type="button" data-testid="new-version" onClick={startNewVersion} disabled={busy}>
            {messages.decks.newVersion}
          </button>
        </div>
      )}

      {deck && deck.published && (
        <LessonSupervisionPanel
          deckId={deckId}
          childrenList={childrenList}
          gradingModel={deck.grading.available ? (deck.grading.model ?? null) : null}
          onRegenerate={draft ? (objectiveId) => void regenerate(objectiveId) : undefined}
        />
      )}

      {editable && (
        <div className="row">
          <button type="button" data-testid="save-lesson" onClick={save} disabled={busy || conflict}>
            {messages.decks.save}
          </button>
          <button type="button" data-testid="publish-lesson" onClick={publish}
            disabled={busy || isDirty || conflict || (draft?.exercises.length ?? 0) === 0 || (draft?.coverage.length ?? 0) > 0}>
            {messages.decks.publish}
          </button>
        </div>
      )}

      {editable && (isDirty || (draft?.exercises.length ?? 0) === 0 || (draft?.coverage.length ?? 0) > 0) && (
        <p className="info" data-testid="publish-blocked-reason">
          {isDirty
            ? messages.lessons.saveBeforePublish
            : (draft?.exercises.length ?? 0) === 0
              ? messages.lessons.emptyLesson
              : messages.lessons.publishBlockedCoverage}
        </p>
      )}

      {deck?.state === "published" && (
        <section className="card">
          <h3>{messages.decks.assignTitle}</h3>
          {childrenList.map((child, index) => (
            <div className="row space" key={child.id} data-testid={`assign-row-${index}`}>
              <span data-child-id={child.id}>{child.displayName}</span>
              {child.canRead === false && <p className="info" data-testid={`non-reader-lesson-warning-${index}`}>{messages.decks.nonReaderLessonAssignment}</p>}
              <input type="date" data-testid={`assign-date-${index}`}
                aria-label={`${messages.decks.assignDate} ${child.displayName}`}
                value={assignDates[child.id] ?? deck.assignments.find((a) => a.childId === child.id)?.testDate ?? ""}
                onChange={(e) => setAssignDates((c) => ({ ...c, [child.id]: e.target.value }))} />
              <button type="button" data-testid={`assign-submit-${index}`}
                disabled={!AssignmentPutSchema.safeParse({ testDate: null, ...assignmentSettings(child.id) }).success}
                onClick={() => assign(child.id)}>
                {messages.decks.assign}
              </button>
              <AssignmentTestGoalFields kind="lesson" {...assignmentSettings(child.id)}
                onChange={(value) => setAssignSettings((c) => ({ ...c, [child.id]: value }))} />
            </div>
          ))}
          <ul className="plain">
            {deck.assignments.map((assignment, index) => (
              <li key={assignment.childId} data-testid={`assignment-row-${index}`}>
                {assignment.displayName} — {assignment.testDate ?? messages.decks.noDate}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
