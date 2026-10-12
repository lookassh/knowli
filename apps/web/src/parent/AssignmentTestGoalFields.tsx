"use client";
import { messages, type AssignmentGoal } from "@learning/contracts";
export interface AssignmentTestSettings { testGoals: AssignmentGoal[] | null; mockTestTaskCount: number }

/** Cele dostępne dla rodzaju zestawu: słówka = recall/spelling/listening; lekcja = pojedynczy „lesson". */
const VOCABULARY_GOALS: readonly AssignmentGoal[] = ["recall", "spelling", "listening"];

/**
 * Pola celu kartkówki i liczby zadań, sparametryzowane rodzajem zestawu. Dla
 * lekcji jest jeden cel `lesson` (etykieta „Gramatyka"), więc włączenie
 * kartkówki ustawia `["lesson"]` i nie pokazuje checkboxów umiejętności słówek.
 */
export default function AssignmentTestGoalFields({
  kind = "vocabulary",
  testGoals,
  mockTestTaskCount,
  onChange,
}: AssignmentTestSettings & { kind?: "vocabulary" | "lesson"; onChange: (value: AssignmentTestSettings) => void }) {
  const isLesson = kind === "lesson";
  const enableGoals: AssignmentGoal[] = isLesson ? ["lesson"] : ["recall", "spelling"];
  return <div style={{ flexBasis: "100%" }}>
    <label><input type="checkbox" data-testid="mock-enable" checked={testGoals !== null}
      onChange={e => onChange({ testGoals: e.target.checked ? enableGoals : null, mockTestTaskCount })} /> {messages.decks.mockTestEnabled}</label>
    {testGoals !== null && (isLesson ? <fieldset>
      <legend>{messages.decks.mockTestGoals}</legend>
      <p className="muted" data-testid="mock-goal-lesson">{messages.lessons.assignGoalGrammar} — {messages.lessons.assignGoalGrammarHint}</p>
      <label>{messages.decks.mockTaskCount}
        <input type="number" data-testid="mock-task-count" min={1} max={100} step={1} value={mockTestTaskCount}
          onChange={e => onChange({ testGoals, mockTestTaskCount: Number(e.target.value) })} />
      </label>
      <p className="muted">{messages.decks.mockTaskCountHint}</p>
    </fieldset> : <fieldset>
      <legend>{messages.decks.mockTestGoals}</legend>
      <div className="row">{VOCABULARY_GOALS.map(goal => <label key={goal}>
        <input type="checkbox" data-testid={`mock-goal-${goal}`} checked={testGoals.includes(goal)}
          onChange={e => onChange({ testGoals: e.target.checked ? [...testGoals, goal] : testGoals.filter(g => g !== goal), mockTestTaskCount })} /> {messages.decks.mockTestGoal[goal as "recall" | "spelling" | "listening"]}
      </label>)}</div>
      <label>{messages.decks.mockTaskCount}
        <input type="number" data-testid="mock-task-count" min={1} max={100} step={1} value={mockTestTaskCount}
          onChange={e => onChange({ testGoals, mockTestTaskCount: Number(e.target.value) })} />
      </label>
      <p className="muted">{messages.decks.mockTaskCountHint}</p>
    </fieldset>)}
  </div>;
}
