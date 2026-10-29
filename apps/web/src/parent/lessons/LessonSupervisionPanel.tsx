"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  messages,
  LessonMockTestReportDtoSchema,
  type ChildDto,
  type LessonMockTestReportDto,
  type LessonVerdictDecision,
  type LessonVerdictDto,
  type ObjectiveProgressDto,
} from "@learning/contracts";
import { callParent, errorMessage, parentClient } from "../api";

/**
 * Panel nadzoru rodzica nad lekcją (zadanie 16): postęp celów dziecka (statusy po
 * polsku, kategorie błędów z przykładami TYLKO tego dziecka, podpowiedź o
 * wyczerpanej puli) oraz lista werdyktów modelu z decyzjami rodzica (potwierdź,
 * uznaj za poprawne/błędne, dodaj jako wariant). Czyta i mutuje przez API
 * rodzica; po mutacji odświeża listę werdyktów. Oznacza werdykty zmienione
 * później decyzją rodzica. Teksty z `messages.ts`, dostępność (nagłówki,
 * `aria-live`, etykiety przycisków).
 */
export default function LessonSupervisionPanel({
  deckId,
  childrenList,
  gradingModel,
  onRegenerate,
}: {
  deckId: string;
  childrenList: ChildDto[];
  /** Nazwa modelu oceniającego (gdy dostępny) — do tekstu o providerze. */
  gradingModel: string | null;
  /** Dogenerowanie ćwiczeń dla celu z wyczerpaną pulą (reużywa akcji edytora). */
  onRegenerate?: (objectiveId: string) => void;
}) {
  const [childId, setChildId] = useState<string | null>(childrenList[0]?.id ?? null);
  const [progress, setProgress] = useState<ObjectiveProgressDto[]>([]);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [verdicts, setVerdicts] = useState<LessonVerdictDto[]>([]);
  const [mockTests, setMockTests] = useState<LessonMockTestReportDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyVerdict, setBusyVerdict] = useState<string | null>(null);
  const progressRequestSequence = useRef(0);

  // Gdy lista dzieci dociera po zamontowaniu, wybierz pierwsze (jeśli żadne nie wybrane).
  useEffect(() => {
    if (childId === null && childrenList.length > 0) setChildId(childrenList[0]!.id);
  }, [childrenList, childId]);

  const loadProgress = useCallback(async () => {
    const requestId = ++progressRequestSequence.current;
    setProgress([]);
    setProgressError(null);
    if (!childId) {
      return;
    }
    try {
      const nextProgress = await callParent(() => parentClient.lessons.progress({ deckId, childId }));
      if (requestId === progressRequestSequence.current) setProgress(nextProgress.body);
    } catch (cause) {
      if (requestId === progressRequestSequence.current) setProgressError(errorMessage(cause));
    }
  }, [deckId, childId]);

  const loadVerdicts = useCallback(async () => {
    try {
      const nextVerdicts = await callParent(() => parentClient.lessons.verdicts({ deckId }));
      setVerdicts(nextVerdicts.body);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [deckId]);

  const loadMockTests = useCallback(async () => {
    if (!childId) {
      setMockTests([]);
      return;
    }
    try {
      // Unia raportów (słówka vs lekcja) zwężana schematem — panel lekcji
      // czyta wyłącznie raporty lekcji, obca odpowiedź pada na walidacji.
      const result = await callParent(() => parentClient.mockTests.list({ childId, deckId }));
      setMockTests(LessonMockTestReportDtoSchema.array().parse(result.body));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [deckId, childId]);

  useEffect(() => {
    void loadProgress();
  }, [loadProgress]);
  useEffect(() => {
    void loadVerdicts();
  }, [loadVerdicts]);
  useEffect(() => {
    void loadMockTests();
  }, [loadMockTests]);

  const decide = async (verdictId: string, decision: LessonVerdictDecision) => {
    setBusyVerdict(verdictId);
    setError(null);
    setNotice(null);
    try {
      await callParent(() => parentClient.lessonVerdicts.decision({ verdictId, decision }));
      await loadVerdicts();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyVerdict(null);
    }
  };

  const acceptVariant = async (verdictId: string) => {
    setBusyVerdict(verdictId);
    setError(null);
    setNotice(null);
    try {
      await callParent(() => parentClient.lessonVerdicts.acceptAsVariant({ verdictId }));
      setNotice(messages.lessons.verdictVariantAdded);
      await loadVerdicts();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyVerdict(null);
    }
  };

  const formatDate = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString("pl-PL") : "—");

  return (
    <section className="card" data-testid="supervision-panel" aria-labelledby="supervision-title">
      <h3 id="supervision-title">{messages.lessons.progressTitle}</h3>

      <p className="muted" data-testid="grading-provider">
        {gradingModel
          ? messages.lessons.gradingProvider.replace("{model}", gradingModel)
          : messages.lessons.gradingProviderNone}
      </p>

      {childrenList.length > 0 && (
        <label>
          {messages.decks.assignTitle}
          <select
            data-testid="supervision-child"
            value={childId ?? ""}
            onChange={(e) => setChildId(e.target.value || null)}
          >
            {childrenList.map((child) => (
              <option key={child.id} value={child.id}>{child.displayName}</option>
            ))}
          </select>
        </label>
      )}

      {error && <p className="error" data-testid="supervision-error" role="alert">{error}</p>}
      {progressError && <p className="error" data-testid="supervision-progress-error" role="alert">{progressError}</p>}
      {notice && <p className="info" data-testid="supervision-notice" role="status" aria-live="polite">{notice}</p>}

      {!childId ? (
        <p className="muted">{messages.lessons.loadChild}</p>
      ) : (
        <div data-testid="objective-progress">
          {progress.map((objective) => (
            <article className="card" key={objective.objectiveId} data-testid={`progress-${objective.objectiveId}`}>
              <div className="row space">
                <strong>{objective.titlePl}</strong>
                <span className="badge" data-testid={`progress-status-${objective.objectiveId}`}>
                  {messages.lessons.objectiveStatus[objective.status] ?? objective.status}
                </span>
              </div>
              <p className="muted">
                {messages.lessons.lastIndependentAt.replace("{date}", formatDate(objective.lastIndependentAt))}
                {" · "}
                {messages.lessons.nextReviewAt.replace("{date}", formatDate(objective.nextReviewAt))}
              </p>
              {objective.poolExhausted && (
                <p className="info" data-testid={`pool-exhausted-${objective.objectiveId}`} role="status">
                  {messages.lessons.poolExhausted}{" "}
                  {onRegenerate && (
                    <button type="button" data-testid={`pool-regen-${objective.objectiveId}`} onClick={() => onRegenerate(objective.objectiveId)}>
                      {messages.lessons.poolExhaustedAction}
                    </button>
                  )}
                </p>
              )}
              {objective.school && (
                <div data-testid={`school-progress-${objective.objectiveId}`}>
                  <h4>{messages.lessons.schoolKnowledgeTitle}</h4>
                  <p className="muted">
                    {messages.lessons.schoolCounts
                      .replace("{correct}", String(objective.school.knowledge.correct))
                      .replace("{partial}", String(objective.school.knowledge.partial))
                      .replace("{incorrect}", String(objective.school.knowledge.incorrect))}
                  </p>
                  <h4>{messages.lessons.schoolPrecisionTitle}</h4>
                  <p className="muted">
                    {messages.lessons.schoolPrecisionCounts
                      .replace("{concise}", String(objective.school.precision.concise))
                      .replace("{verbose}", String(objective.school.precision.verbose))
                      .replace("{unfocused}", String(objective.school.precision.unfocused))}
                  </p>
                  {objective.school.topMissing.length > 0 && (
                    <>
                      <h4>{messages.lessons.schoolMissingTitle}</h4>
                      <ul className="plain">
                        {objective.school.topMissing.map((m) => (
                          <li key={m.text}>{m.text} <span className="muted">({m.count})</span></li>
                        ))}
                      </ul>
                    </>
                  )}
                  {objective.school.recentAnswers.length > 0 && (
                    <>
                      <h4>{messages.lessons.schoolRecentTitle}</h4>
                      <ul className="plain">
                        {objective.school.recentAnswers.map((a, i) => (
                          <li key={i} className="muted">
                            <em>{a.text}</em> — {messages.lessons.schoolKnowledgeValue[a.knowledge] ?? a.knowledge}
                            {a.precision ? ` · ${messages.lessons.schoolPrecisionValue[a.precision] ?? a.precision}` : ""}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {objective.school.shortening && (
                    <div data-testid={`supervision-shortening-${objective.objectiveId}`}>
                      <h4>{messages.lessons.schoolShorteningTitle}</h4>
                      <p>{messages.lessons.schoolShorteningCounts
                        .replace("{offered}", String(objective.school.shortening.offered))
                        .replace("{attempted}", String(objective.school.shortening.attempted))
                        .replace("{successful}", String(objective.school.shortening.successful))}</p>
                      <ul className="plain">
                        {objective.school.shortening.recent.map((pair, i) => (
                          <li key={i} className="muted">
                            <em>{pair.original}</em> → <em>{pair.revision}</em>
                            {" — "}{pair.successful ? messages.lessons.schoolShorteningSuccess : messages.lessons.schoolShorteningNotYet}
                            {pair.lostElements.length > 0 && ` · ${messages.lessons.schoolShorteningLost.replace("{elements}", pair.lostElements.join(", "))}`}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              {objective.topErrors.length === 0 ? (
                <p className="muted">{messages.lessons.noErrors}</p>
              ) : (
                <div>
                  <h4>{messages.lessons.topErrorsTitle}</h4>
                  <ul className="plain">
                    {objective.topErrors.map((err) => (
                      <li key={err.category} data-testid={`error-${objective.objectiveId}-${err.category}`}>
                        <span>{err.labelPl}</span>{" "}
                        <span className="muted">({messages.lessons.errorCount.replace("{n}", String(err.count))})</span>
                        {err.examples.length > 0 && (
                          <>
                            <span className="muted"> — {messages.lessons.errorExamplesLabel}</span>
                            <ul className="plain">
                              {err.examples.map((ex, i) => (
                                <li key={i} className="muted"><em>{ex}</em></li>
                              ))}
                            </ul>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {childId && (
        <section data-testid="lesson-mock-reports" aria-label={messages.lessons.mockTestsTitle}>
          <h3>{messages.lessons.mockTestsTitle}</h3>
          {mockTests.length === 0 ? (
            <p className="muted" data-testid="lesson-mock-empty">{messages.lessons.mockTestsEmpty}</p>
          ) : (
            <>
              <p className="muted">{messages.lessons.mockTestsRecent}</p>
              <ul className="plain" data-testid="lesson-mock-list">
                {mockTests.map((report, index) => (
                  <li className="card" key={report.sessionId} data-testid="lesson-mock-report" data-session-id={report.sessionId}>
                    <div className="row space">
                      <strong>{messages.lessons.mockTestDate.replace("{date}", formatDate(report.startedAt))}</strong>
                      <span className="badge" data-testid={`lesson-mock-complete-${index}`}>
                        {report.complete ? messages.lessons.mockTestComplete : messages.lessons.mockTestPartial}
                      </span>
                    </div>
                    <p className="muted">{messages.lessons.mockTestBudget.replace("{n}", String(report.taskBudget))}</p>
                    {report.objectives.map((objective) => (
                      <div key={objective.objectiveId} data-testid={`lesson-mock-objective-${objective.objectiveId}`}>
                        <p><strong>{objective.titlePl}</strong></p>
                        <p className="muted">{messages.lessons.mockTestObjectiveCounts
                          .replace("{correct}", String(objective.correct))
                          .replace("{total}", String(objective.total))
                          .replace("{incorrect}", String(objective.incorrect))
                          .replace("{unassessed}", String(objective.unassessed))
                          .replace("{skipped}", String(objective.skipped))}</p>
                        {objective.modelGraded > 0 && (
                          <p className="muted">{messages.lessons.mockTestModelGraded.replace("{n}", String(objective.modelGraded))}</p>
                        )}
                        {objective.errorCategories.length > 0 && (
                          <div>
                            <h5>{messages.lessons.mockTestErrorsTitle}</h5>
                            <ul className="plain">
                              {objective.errorCategories.map((cat) => (
                                <li key={cat.category} className="muted">
                                  {messages.lessons.mockTestErrorCount.replace("{label}", cat.labelPl).replace("{n}", String(cat.count))}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
              <p className="muted">{messages.lessons.mockTestNote}</p>
            </>
          )}
        </section>
      )}

      <h3>{messages.lessons.verdictsTitle}</h3>
      {verdicts.length === 0 ? (
        <p className="muted" data-testid="no-verdicts">{messages.lessons.noVerdicts}</p>
      ) : (
        <ul className="plain" data-testid="verdict-list">
          {verdicts.map((verdict) => (
            <li className="card" key={verdict.id} data-testid={`verdict-${verdict.id}`}>
              <div className="row space">
                <span>
                  <strong>{messages.lessons.verdictAnswerLabel}:</strong> {verdict.childAnswer}
                </span>
                <span className="badge" data-testid={`verdict-value-${verdict.id}`}>
                  {messages.lessons.verdictValue[verdict.verdict] ?? verdict.verdict}
                </span>
              </div>
              {verdict.errorCategory && (
                <p className="muted">{messages.lessons.verdictCategoryLabel}: {verdict.errorCategory}</p>
              )}
              {verdict.note && (
                <p className="muted">{messages.lessons.verdictNoteLabel}: {verdict.note}</p>
              )}
              <p className="muted">{messages.lessons.verdictModelLabel}: {verdict.graderModel}</p>
              {verdict.parentDecision && (
                <p className="info" data-testid={`verdict-changed-${verdict.id}`}>
                  {messages.lessons.verdictChangedLater}
                  {" — "}
                  {messages.lessons.verdictDecision[verdict.parentDecision] ?? verdict.parentDecision}
                </p>
              )}
              <div className="row">
                <button type="button" data-testid={`verdict-confirm-${verdict.id}`} disabled={busyVerdict === verdict.id}
                  onClick={() => decide(verdict.id, "confirmed")}>
                  {messages.lessons.verdictConfirm}
                </button>
                <button type="button" data-testid={`verdict-correct-${verdict.id}`} disabled={busyVerdict === verdict.id}
                  onClick={() => decide(verdict.id, "overridden_correct")}>
                  {messages.lessons.verdictOverrideCorrect}
                </button>
                <button type="button" data-testid={`verdict-incorrect-${verdict.id}`} disabled={busyVerdict === verdict.id}
                  onClick={() => decide(verdict.id, "overridden_incorrect")}>
                  {messages.lessons.verdictOverrideIncorrect}
                </button>
                <button type="button" data-testid={`verdict-variant-${verdict.id}`} disabled={busyVerdict === verdict.id}
                  onClick={() => acceptVariant(verdict.id)}>
                  {messages.lessons.verdictAcceptVariant}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
