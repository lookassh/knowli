"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { messages, type LessonCommand, type SubjectCatalogDto } from "@learning/contracts";
import { apiFetch, errorMessage } from "../api";
import { isDefinitiveGenerationRejection, readLessonAcceptance } from "../generation-request";

const MATERIAL_MAX = 8000;
const POOL_MIN = 20;
const POOL_MAX = 120;

/** Domyślna wielkość puli: większa z 60 i 12 × liczba reguł (requirements 2.1). */
export function defaultPoolSize(objectiveCount: number): number {
  const raw = Math.max(60, 12 * objectiveCount);
  return Math.min(POOL_MAX, Math.max(POOL_MIN, raw));
}

/**
 * Formularz nowej lekcji: przedmiot → temat (z katalogu) → reguły (checkboxy,
 * domyślnie wszystkie) → materiał (licznik, limit 8000) → instrukcja → wielkość
 * puli. Wysyłka z kluczem idempotencji i obsługą niepewnej odpowiedzi jak
 * w generowaniu słówek (reużyty `readLessonAcceptance` / `isDefinitiveGenerationRejection`).
 */
export default function NewLessonForm({
  onCreated,
  onCancel,
  onAuthExpired,
}: {
  onCreated: (deckId: string) => void;
  onCancel: () => void;
  onAuthExpired: () => void;
}) {
  const [catalog, setCatalog] = useState<SubjectCatalogDto | null>(null);
  const [subjectId, setSubjectId] = useState("");
  const [topicId, setTopicId] = useState("");
  const [selectedObjectives, setSelectedObjectives] = useState<string[]>([]);
  const [material, setMaterial] = useState("");
  const [instruction, setInstruction] = useState("");
  const [poolSizeTouched, setPoolSizeTouched] = useState(false);
  const [poolSize, setPoolSize] = useState<number>(defaultPoolSize(0));
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const pendingCommand = useRef<LessonCommand | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<SubjectCatalogDto>("GET", "/api/v1/parent/lesson-catalog");
        if (!mounted.current) return;
        setCatalog(data);
        const firstSubject = data.subjects[0];
        if (firstSubject) {
          setSubjectId(firstSubject.id);
          const firstTopic = firstSubject.topics[0];
          if (firstTopic) {
            setTopicId(firstTopic.id);
            setSelectedObjectives(firstTopic.objectives.map((o) => o.id));
          }
        }
      } catch (cause) {
        if (mounted.current) setError(errorMessage(cause));
      }
    })();
  }, []);

  const subject = useMemo(() => catalog?.subjects.find((s) => s.id === subjectId) ?? null, [catalog, subjectId]);
  const topic = useMemo(() => subject?.topics.find((t) => t.id === topicId) ?? null, [subject, topicId]);
  const objectives = topic?.objectives ?? [];

  // Domyślna pula podąża za liczbą reguł, dopóki rodzic jej ręcznie nie zmieni.
  useEffect(() => {
    if (!poolSizeTouched) {
      setPoolSize(defaultPoolSize(selectedObjectives.length));
    }
  }, [selectedObjectives.length, poolSizeTouched]);

  const chooseSubject = (id: string) => {
    setSubjectId(id);
    const next = catalog?.subjects.find((s) => s.id === id);
    const firstTopic = next?.topics[0];
    setTopicId(firstTopic?.id ?? "");
    setSelectedObjectives(firstTopic?.objectives.map((o) => o.id) ?? []);
  };

  const chooseTopic = (id: string) => {
    setTopicId(id);
    const next = subject?.topics.find((t) => t.id === id);
    setSelectedObjectives(next?.objectives.map((o) => o.id) ?? []);
  };

  const toggleObjective = (id: string) => {
    setSelectedObjectives((current) =>
      current.includes(id) ? current.filter((o) => o !== id) : [...current, id],
    );
  };

  const materialLength = material.trim().length;
  const canSubmit = subject !== null && topic !== null && selectedObjectives.length > 0 && materialLength > 0 && materialLength <= MATERIAL_MAX;

  const create = async () => {
    if (creatingRef.current) return;
    if (!pendingCommand.current) {
      if (selectedObjectives.length === 0) {
        setError(messages.lessons.objectivesRequired);
        return;
      }
      if (materialLength === 0 || materialLength > MATERIAL_MAX) {
        setError(messages.lessons.materialRequired);
        return;
      }
    }
    creatingRef.current = true;
    setCreating(true);
    setError(null);
    const command: LessonCommand = pendingCommand.current ?? {
      deckId: crypto.randomUUID(),
      subjectId,
      topicId,
      objectiveIds: [...selectedObjectives],
      material: material.trim(),
      ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
      poolSize,
      clientRequestId: crypto.randomUUID(),
    };
    pendingCommand.current = command;
    try {
      const response = await apiFetch<unknown>("POST", "/api/v1/parent/lessons", command);
      const acceptance = readLessonAcceptance(response);
      if (!acceptance) {
        if (mounted.current) setError(messages.lessons.createUncertain);
        return;
      }
      pendingCommand.current = null;
      if (mounted.current) onCreated(acceptance.deckId);
    } catch (cause) {
      if (isDefinitiveGenerationRejection(cause)) {
        pendingCommand.current = null;
        if ((cause as { status?: number }).status === 401) {
          if (mounted.current) onAuthExpired();
          return;
        }
        if (mounted.current) setError(errorMessage(cause));
      } else if (mounted.current) {
        setError(messages.lessons.createUncertain);
      }
    } finally {
      creatingRef.current = false;
      if (mounted.current) setCreating(false);
    }
  };

  return (
    <section className="card" data-testid="new-lesson-form">
      <div className="row space">
        <h2>{messages.lessons.newLessonTitle}</h2>
        <button type="button" data-testid="new-lesson-cancel" onClick={onCancel}>
          {messages.decks.back}
        </button>
      </div>

      <div className="grid-2">
        <div>
          <label htmlFor="lesson-subject">{messages.lessons.subjectLabel}</label>
          <select id="lesson-subject" data-testid="lesson-subject" value={subjectId} disabled={creating} onChange={(e) => chooseSubject(e.target.value)}>
            {catalog?.subjects.map((s) => <option key={s.id} value={s.id}>{s.titlePl}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="lesson-topic">{messages.lessons.topicLabel}</label>
          <select id="lesson-topic" data-testid="lesson-topic" value={topicId} disabled={creating} onChange={(e) => chooseTopic(e.target.value)}>
            {subject?.topics.map((t) => <option key={t.id} value={t.id}>{t.titlePl}</option>)}
          </select>
        </div>
      </div>

      <fieldset>
        <legend>{messages.lessons.objectivesLabel}</legend>
        {objectives.map((objective) => (
          <label key={objective.id} style={{ display: "block" }}>
            <input
              type="checkbox"
              data-testid={`lesson-objective-${objective.id}`}
              checked={selectedObjectives.includes(objective.id)}
              disabled={creating}
              onChange={() => toggleObjective(objective.id)}
            />{" "}
            {objective.titlePl}
          </label>
        ))}
      </fieldset>

      <label>
        {messages.lessons.materialLabel}
        <textarea
          data-testid="lesson-material"
          rows={6}
          maxLength={MATERIAL_MAX}
          placeholder={messages.lessons.materialPlaceholder}
          value={material}
          disabled={creating}
          aria-describedby="lesson-material-counter"
          onChange={(e) => setMaterial(e.target.value)}
        />
      </label>
      <p className="muted" id="lesson-material-counter" data-testid="lesson-material-counter">
        {messages.lessons.materialCounter.replace("{n}", String(material.length))}
      </p>

      <label>
        {messages.lessons.instructionLabel}
        <input data-testid="lesson-instruction" maxLength={500} value={instruction} disabled={creating} onChange={(e) => setInstruction(e.target.value)} />
      </label>

      <label>
        {messages.lessons.poolSizeLabel}
        <input
          type="number"
          data-testid="lesson-pool-size"
          min={POOL_MIN}
          max={POOL_MAX}
          step={1}
          value={poolSize}
          disabled={creating}
          aria-describedby="lesson-pool-hint"
          onChange={(e) => {
            setPoolSizeTouched(true);
            setPoolSize(Number(e.target.value));
          }}
        />
      </label>
      <p className="muted" id="lesson-pool-hint">{messages.lessons.poolSizeHint}</p>

      <button
        type="button"
        data-testid="lesson-create-submit"
        onClick={create}
        disabled={creating || (!pendingCommand.current && !canSubmit)}
      >
        {creating ? messages.lessons.creating : pendingCommand.current ? messages.lessons.retryCreate : messages.lessons.createLesson}
      </button>
      {error && <p className="error" data-testid="api-error" role="alert">{error}</p>}
    </section>
  );
}
