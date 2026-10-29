"use client";
import { Checkbox, Fieldset, Group, NumberInput, Stack, Text } from "@mantine/core";
import { messages, type AssignmentGoal } from "@learning/contracts";
export interface AssignmentTestSettings { testGoals: AssignmentGoal[] | null; mockTestTaskCount: number }

/** Cele dostępne dla rodzaju zestawu: słówka = recall/spelling/listening; lekcja = pojedynczy „lesson". */
const VOCABULARY_GOALS: readonly AssignmentGoal[] = ["recall", "spelling", "listening"];

/**
 * Pola celu kartkówki i liczby zadań, sparametryzowane rodzajem zestawu. Dla
 * lekcji jest jeden cel `lesson` (etykieta „Gramatyka"), więc włączenie
 * kartkówki ustawia `["lesson"]` i nie pokazuje checkboxów umiejętności słówek.
 * Liczba zadań bez przycinania: wartość spoza 1–100 lub ułamkowa blokuje
 * „Przypisz” (walidacja `AssignmentPutSchema` w edytorze).
 */
export default function AssignmentTestGoalFields({
  kind = "vocabulary",
  testGoals,
  mockTestTaskCount,
  onChange,
}: AssignmentTestSettings & { kind?: "vocabulary" | "lesson"; onChange: (value: AssignmentTestSettings) => void }) {
  const isLesson = kind === "lesson";
  const enableGoals: AssignmentGoal[] = isLesson ? ["lesson"] : ["recall", "spelling"];
  const taskCount = (
    <NumberInput
      size="md"
      label={messages.decks.mockTaskCount}
      description={messages.decks.mockTaskCountHint}
      data-testid="mock-task-count"
      min={1}
      max={100}
      clampBehavior="none"
      maw={260}
      value={mockTestTaskCount}
      onChange={(value) => onChange({ testGoals, mockTestTaskCount: Number(value) })}
    />
  );
  return (
    <Stack gap="xs">
      <Checkbox
        size="md"
        label={messages.decks.mockTestEnabled}
        data-testid="mock-enable"
        checked={testGoals !== null}
        onChange={(event) => onChange({ testGoals: event.currentTarget.checked ? enableGoals : null, mockTestTaskCount })}
      />
      {testGoals !== null && (
        <Fieldset legend={messages.decks.mockTestGoals} radius="md" p="sm">
          <Stack gap="sm">
            {isLesson ? (
              <Text size="sm" className="pp-editor-muted" data-testid="mock-goal-lesson">
                {messages.lessons.assignGoalGrammar} — {messages.lessons.assignGoalGrammarHint}
              </Text>
            ) : (
              <Group gap="md">
                {VOCABULARY_GOALS.map((goal) => (
                  <Checkbox
                    key={goal}
                    size="md"
                    label={messages.decks.mockTestGoal[goal as "recall" | "spelling" | "listening"]}
                    data-testid={`mock-goal-${goal}`}
                    checked={testGoals.includes(goal)}
                    onChange={(event) => onChange({
                      testGoals: event.currentTarget.checked ? [...testGoals, goal] : testGoals.filter((g) => g !== goal),
                      mockTestTaskCount,
                    })}
                  />
                ))}
              </Group>
            )}
            {taskCount}
          </Stack>
        </Fieldset>
      )}
    </Stack>
  );
}
