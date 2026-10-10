"use client";
import { messages, type TestGoal } from "@learning/contracts";
export interface AssignmentTestSettings { testGoals: TestGoal[] | null; mockTestTaskCount: number }
export default function AssignmentTestGoalFields({ testGoals, mockTestTaskCount, onChange }: AssignmentTestSettings & { onChange: (value: AssignmentTestSettings) => void }) {
  return <div style={{ flexBasis: "100%" }}>
    <label><input type="checkbox" data-testid="mock-enable" checked={testGoals !== null}
      onChange={e => onChange({ testGoals: e.target.checked ? ["recall", "spelling"] : null, mockTestTaskCount })} /> {messages.decks.mockTestEnabled}</label>
    {testGoals !== null && <fieldset>
      <legend>{messages.decks.mockTestGoals}</legend>
      <div className="row">{(["recall", "spelling", "listening"] as const).map(goal => <label key={goal}>
        <input type="checkbox" data-testid={`mock-goal-${goal}`} checked={testGoals.includes(goal)}
          onChange={e => onChange({ testGoals: e.target.checked ? [...testGoals, goal] : testGoals.filter(g => g !== goal), mockTestTaskCount })} /> {messages.decks.mockTestGoal[goal]}
      </label>)}</div>
      <label>{messages.decks.mockTaskCount}
        <input type="number" data-testid="mock-task-count" min={1} max={100} step={1} value={mockTestTaskCount}
          onChange={e => onChange({ testGoals, mockTestTaskCount: Number(e.target.value) })} />
      </label>
      <p className="muted">{messages.decks.mockTaskCountHint}</p>
    </fieldset>}
  </div>;
}
