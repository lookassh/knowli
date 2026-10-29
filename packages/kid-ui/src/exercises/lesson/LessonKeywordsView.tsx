import { useMemo, useState } from "react";
import { messages } from "@learning/contracts";
import { format } from "../../format";
import { ActionButton } from "../../components/ActionButton";
import { AnswerGrid } from "../../components/AnswerGrid";
import { ExerciseFrame } from "../ExerciseFrame";
import { useChoiceKeyboard } from "../useChoiceKeyboard";
import { useRetryReset } from "../useRetryReset";
import type { ExerciseProps } from "../types";
import { toggleKeyword } from "./keyword-selection";

const NO_OPTIONS: never[] = [];

/**
 * Słowa kluczowe (`lesson_keywords`, trener precyzji): pytanie odpowiedzi
 * otwartej, która przyjdzie zaraz potem, i 4–6 pojęć do zaznaczenia.
 * Dotknięcie kafelka przełącza wybór (bez wysyłania); licznik pokazuje
 * „Wybrane: n z max”, a po `maxSelected` pozostałe kafelki są wyłączone.
 * „Sprawdź” aktywne od `minSelected` i wysyła zbiór `selection` — kolejność
 * nie ma znaczenia. Które pojęcia są kluczowe, wie wyłącznie serwer.
 */
export function LessonKeywordsView({ task, busy, dock, handlers }: ExerciseProps) {
  const prompt = task.prompt.kind === "lesson_keywords" ? task.prompt : null;
  const [selected, setSelected] = useState<readonly string[]>([]);
  const options = prompt?.options ?? NO_OPTIONS;
  const maxSelected = prompt?.maxSelected ?? 0;
  const disabled = busy || dock !== undefined;
  const toggle = (optionId: string) => {
    setSelected((current) => toggleKeyword(current, optionId, maxSelected));
    handlers.onEdit();
  };
  const optionRefs = useChoiceKeyboard({ options, busy: disabled, onChoice: toggle });
  useRetryReset(dock, () => setSelected([]), () => optionRefs.current[0]?.focus({ preventScroll: true }));
  const selectedIds = useMemo(() => new Set(selected), [selected]);

  if (prompt === null) return null;
  const ready = selected.length >= prompt.minSelected && selected.length <= prompt.maxSelected;

  return (
    <ExerciseFrame
      dock={dock}
      task={task}
      content={(
        <div className="kid-lesson-keywords" data-testid="kid-lesson-keywords">
          <p className="kid-lesson-source" data-testid="kid-lesson-source">{prompt.prompt}</p>
          <p className="kid-lesson-keywords__count" data-testid="kid-lesson-keywords-count" aria-live="polite">
            {format(messages.kid.lessonKeywordsSelected, { count: String(selected.length), max: String(prompt.maxSelected) })}
          </p>
          <AnswerGrid
            options={prompt.options.map((option) => ({ id: option.id, label: option.text, content: null }))}
            outcomes={new Map()}
            disabled={disabled}
            optionRefs={optionRefs}
            onChoose={toggle}
            selection={{ selectedIds, maxSelected: prompt.maxSelected }}
            listLabel={messages.kid.lessonKeywordsOptions}
            listTestId="kid-lesson-keywords-options"
            className="kid-lesson-keywords__options"
          />
        </div>
      )}
      actions={(
        <ActionButton
          type="button"
          className="kid-primary"
          data-testid="kid-lesson-check"
          disabled={disabled || !ready}
          onClick={() => { if (ready && !disabled) handlers.onAnswerSelection([...selected]); }}
        >
          {messages.kid.lessonCheck}
        </ActionButton>
      )}
    />
  );
}
