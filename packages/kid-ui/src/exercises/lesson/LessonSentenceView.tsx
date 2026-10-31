import { useEffect, useRef, useState } from "react";
import { MAX_TEXT_ATTEMPT_LENGTH, messages } from "@learning/contracts";
import { ListenButton } from "../../components/ListenButton";
import { ActionButton } from "../../components/ActionButton";
import { AnswerField, AnswerTextArea } from "../../components/AnswerField";
import { ExerciseFrame } from "../ExerciseFrame";
import { SpeechRecordButton } from "../SpeechRecordButton";
import { useRetryReset } from "../useRetryReset";
import { useDictationField } from "./useDictation";
import type { ExerciseProps } from "../types";

/**
 * Pole zdania dla `lesson_error_fix` / `lesson_transform` / `lesson_open_answer`
 * oraz wyniku `lesson_calculation`:
 * polecenie (z ramki), zdanie wyjściowe i pole tekstowe bez autokorekty.
 * „Sprawdź” wysyła odpowiedź `text`. `lesson_open_answer` nie ma deterministycznej
 * oceny do czasu zadania 15 — serwer odpowie wtedy `not_assessed`, a widok
 * feedbacku pokaże komunikat techniczny bez sugerowania błędu. Gdy przedmiot ma
 * TTS odpowiedzi, pojawia się „Posłuchaj” — odsłuch zdania wzorcowego jest
 * dozwolonym wsparciem (wym. 4.6; serwer pieczętuje ekspozycję przed bajtami).
 *
 * Odpowiedź otwarta z `speechInput` (Etap 3 szkoły) dostaje pole wieloliniowe
 * i mikrofon dyktowania: rozpoznany tekst trafia do pola, dziecko może go
 * poprawić, a „Sprawdź” ocenia dopiero zatwierdzony tekst.
 */
export function LessonSentenceView({ task, busy, dock, handlers, mockTest, micAvailable, recordingPhase, microphoneReady, inputLevel, recordingNotice, dictation }: ExerciseProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  // Pole wieloliniowe tylko dla odpowiedzi otwartej z dyktowaniem (Etap 3 szkoły).
  const speech = task.prompt.kind === "lesson_open_answer" && task.prompt.speechInput !== undefined;
  const focusField = () => (speech ? areaRef.current : inputRef.current)?.focus({ preventScroll: true });
  const dictationField = useDictationField(dictation, setText, focusField);

  useEffect(() => {
    // fokus tylko przy nowym zadaniu
    focusField();
  }, [task.taskId]);
  useRetryReset(dock, () => { setText(""); dictationField.reset(); }, focusField);

  if (
    task.prompt.kind !== "lesson_error_fix" &&
    task.prompt.kind !== "lesson_transform" &&
    task.prompt.kind !== "lesson_open_answer" &&
    task.prompt.kind !== "lesson_calculation"
  ) {
    return null;
  }
  // Rachunek: polskie polecenie i wynik z jednostką wpisany dosłownie (przecinek,
  // spacje tysięcy); poprawność liczy wyłącznie serwer.
  const calculation = task.prompt.kind === "lesson_calculation";
  const source = task.prompt.kind === "lesson_open_answer" || task.prompt.kind === "lesson_calculation"
    ? task.prompt.prompt
    : task.prompt.statement;
  const hasAudio = task.prompt.kind !== "lesson_calculation" && task.prompt.audioAssetId !== undefined;
  // Język pytania: rachunek zawsze po polsku; odpowiedź otwarta podaje go, gdy jest
  // jednoznaczny (szkoła) — wtedy dziecko odpowiada w tym samym języku.
  const knownLocale = calculation ? "pl-PL" : task.prompt.kind === "lesson_open_answer" ? task.prompt.promptLocale : undefined;
  const sourceLang = knownLocale ?? "en-GB";
  // Pole odpowiedzi: język odpowiedzi z serwera (np. polskie źródło, angielska odpowiedź);
  // bez niego dziedziczy język pytania, jak dotąd.
  const fieldLocale = (task.prompt.kind === "lesson_open_answer" ? task.prompt.answerLocale : undefined) ?? knownLocale;
  const showMic = speech && micAvailable && !mockTest;
  const disabled = busy || (showMic && recordingPhase !== "idle");
  const formId = `kid-lesson-sentence-${task.taskId}`;
  const changeText = (value: string) => {
    setText(value);
    dictationField.onTextChange(value);
    handlers.onEdit();
  };
  const fieldProps = {
    "data-testid": "kid-lesson-input",
    value: text,
    ...(fieldLocale ? { lang: fieldLocale } : {}),
    // Same cap as the server contract, so a long answer is never rejected after typing.
    maxLength: MAX_TEXT_ATTEMPT_LENGTH,
    autoComplete: "off",
    autoCorrect: "off",
    autoCapitalize: "off",
    spellCheck: false,
    disabled,
  } as const;

  return (
    <ExerciseFrame
      actionLayout="inline"
      dock={dock}
      task={task}
      content={(
        <>
          <p className="kid-lesson-source" data-testid="kid-lesson-source" lang={sourceLang}>{source}</p>
          <form
            id={formId}
            className="kid-written"
            onSubmit={(event) => {
              event.preventDefault();
              if (text.trim() !== "" && !disabled) { if (speech) handlers.onSubmitText(text, dictationField.inputMethod); else handlers.onSubmitText(text); }
            }}
          >
            {speech ? (
              <AnswerTextArea
                ref={areaRef}
                {...fieldProps}
                onChange={(event) => changeText(event.target.value)}
                submitOnEnter
                placeholder={messages.kid.typeWord}
                aria-label={messages.kid.lessonAnswerInput}
              />
            ) : (
              <AnswerField
                ref={inputRef}
                variant="sentence"
                {...fieldProps}
                onChange={(event) => changeText(event.target.value)}
                placeholder={calculation ? messages.kid.lessonCalculationPlaceholder : messages.kid.typeWord}
                aria-label={calculation ? messages.kid.lessonCalculationInput : messages.kid.lessonSourceSentence}
              />
            )}
          </form>
          {showMic && (
            <SpeechRecordButton
              phase={recordingPhase}
              ready={microphoneReady}
              disabled={busy}
              level={inputLevel}
              notice={recordingNotice}
              // długa odpowiedź: dotknij — mów — dotknij, niezależnie od ustawienia profilu
              mode="toggle"
              onPrepare={handlers.onPrepareRecording}
              onStart={handlers.onRecord}
              onStop={handlers.onStopRecording}
              onCancel={handlers.onCancelRecording}
            />
          )}
          {hasAudio && (
            <ListenButton
              data-testid="kid-lesson-listen"
              disabled={disabled}
              onClick={handlers.onPlay}
              aria-label={messages.kid.listen}
            />
          )}
        </>
      )}
      actions={(
        <ActionButton
          form={formId}
          type="submit"
          className="kid-primary"
          data-testid="kid-lesson-check"
          disabled={disabled || text.trim() === ""}
        >
          {messages.kid.lessonCheck}
        </ActionButton>
      )}
      secondaryActions={<div className="kid-secondary-actions">
        <ActionButton priority="secondary" size="sm" fullWidth={false} type="button" data-testid="kid-not-remember" disabled={disabled} onClick={handlers.onNotRemember}>
          {messages.kid.notRemember}
        </ActionButton>
      </div>}
    />
  );
}
