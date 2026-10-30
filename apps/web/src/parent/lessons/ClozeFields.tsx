import { Button, Group, Stack, Text, TextInput, Textarea } from "@mantine/core";
import { messages, MAX_CLOZE_EXTRA, MAX_CLOZE_TEXT_LENGTH, MAX_CLOZE_WORD_LENGTH } from "@learning/contracts";
import { clozeAnswerOf, clozeWordsOf, filledClozeOf, syncGapAnswers, type EditableLessonExercise } from "./lesson-editor-state";

type Patch = Partial<EditableLessonExercise>;

/**
 * Edycja „Uzupełnij tekst” (`lesson_cloze`) — design szkoły §13.7. Pola słów
 * podążają za liczbą luk „___” w tekście, odpowiedź wzorcowa wynika ze słów,
 * a podgląd pokazuje uzupełniony tekst do sprawdzenia przez rodzica.
 */
export default function ClozeFields({ exercise, index, disabled, onChange }: {
  exercise: EditableLessonExercise;
  index: number;
  disabled: boolean;
  onChange: (patch: Patch) => void;
}) {
  const t = messages.lessons;
  const text = exercise.clozeText ?? "";
  const answers = exercise.gapAnswers ?? [];
  const visible = clozeWordsOf(exercise);
  const extra = exercise.extraWords ?? [];
  const setAnswers = (next: string[]) => onChange({ gapAnswers: next, answer: clozeAnswerOf({ clozeText: text, gapAnswers: next }) });
  return (
    <fieldset className="pp-lesson-fieldset pp-lesson-wide" data-testid={`cloze-${index}`}>
      <legend>{t.clozeTextLabel}</legend>
      <Stack gap="xs">
        <Textarea size="md" autosize minRows={3} data-testid={`cloze-text-${index}`} value={text} disabled={disabled} maxLength={MAX_CLOZE_TEXT_LENGTH}
          aria-label={t.clozeTextLabel} description={t.clozeTextHint}
          onChange={(e) => {
            const nextText = e.currentTarget.value;
            const next = syncGapAnswers(nextText, answers);
            onChange({ clozeText: nextText, gapAnswers: next, answer: clozeAnswerOf({ clozeText: nextText, gapAnswers: next }) });
          }} />
        {visible.map((word, gi) => (
          <TextInput key={gi} size="md" data-testid={`cloze-gap-${index}-${gi}`} value={word} disabled={disabled} maxLength={MAX_CLOZE_WORD_LENGTH}
            label={t.clozeGapLabel.replace("{n}", String(gi + 1))}
            onChange={(e) => {
              const value = e.currentTarget.value;
              setAnswers(answers.map((w, i) => (i === gi ? value : w)));
            }} />
        ))}
        <Text size="sm" className="pp-editor-muted">{t.clozeExtraHint}</Text>
        {extra.map((word, xi) => (
          <Group key={xi} gap="xs">
            <TextInput size="md" className="pp-lesson-grow" data-testid={`cloze-extra-${index}-${xi}`} value={word} disabled={disabled} maxLength={MAX_CLOZE_WORD_LENGTH}
              aria-label={t.clozeExtraLabel.replace("{n}", String(xi + 1))}
              onChange={(e) => {
                const value = e.currentTarget.value;
                onChange({ extraWords: extra.map((w, i) => (i === xi ? value : w)) });
              }} />
            <Button size="md" variant="subtle" color="red" data-testid={`cloze-extra-remove-${index}-${xi}`} disabled={disabled}
              onClick={() => onChange({ extraWords: extra.filter((_, i) => i !== xi) })}>
              {t.removeRow}
            </Button>
          </Group>
        ))}
        {extra.length < MAX_CLOZE_EXTRA && (
          <Button size="md" variant="light" className="pp-lesson-start" data-testid={`cloze-extra-add-${index}`} disabled={disabled}
            onClick={() => onChange({ extraWords: [...extra, ""] })}>
            {t.clozeExtraAdd}
          </Button>
        )}
        <Text size="sm" fw={600}>{t.clozePreviewLabel}</Text>
        <Text size="sm" data-testid={`cloze-preview-${index}`}>{filledClozeOf(text, visible)}</Text>
      </Stack>
    </fieldset>
  );
}
