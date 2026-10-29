// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { messages, type TaskDto, type TaskPrompt } from "@learning/contracts";
import { cleanup, fireEvent, renderKid, screen } from "../../test/render-kid";
import { makeExerciseProps } from "../../test/exercise-fixtures";
import type { ExerciseProps } from "../types";
import { LessonSentenceView } from "./LessonSentenceView";
import { LessonShortenView } from "./LessonShortenView";

afterEach(cleanup);

const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function task(prompt: TaskPrompt): TaskDto {
  return { taskId: id(1), sessionId: id(2), ordinal: 1, exerciseType: "lesson_open_answer", direction: null, state: "issued", prompt, remainingAssessed: 4 };
}

const openPrompt: TaskPrompt = {
  kind: "lesson_open_answer",
  instructionPl: "Odpowiedz własnymi słowami.",
  prompt: "Co to jest poziomica?",
  promptLocale: "pl-PL",
  speechInput: { maxSeconds: 45 },
};
const shortenPrompt: TaskPrompt = {
  kind: "lesson_shorten",
  instructionPl: "Skróć odpowiedź.",
  prompt: "Co to jest poziomica?",
  originalAnswer: "Wczoraj na wycieczce poziomica to linia łącząca punkty o tej samej wysokości.",
  answerSegments: [{ text: "Wczoraj na wycieczce ", state: "pill" }, { text: "poziomica to linia łącząca punkty o tej samej wysokości.", state: "plain" }],
  speechInput: { maxSeconds: 45 },
};

const heard = (seq: number, text: string) => ({ taskId: id(1), seq, status: "heard", text, failures: 0 });
const field = () => screen.getByTestId("kid-lesson-input") as HTMLTextAreaElement;
const check = () => screen.getByTestId("kid-lesson-check") as HTMLButtonElement;

function renderSentence(overrides: Partial<ExerciseProps> = {}, prompt: TaskPrompt = openPrompt) {
  const props = makeExerciseProps(task(prompt), { micAvailable: true, microphoneReady: true, ...overrides });
  const view = renderKid(<LessonSentenceView {...props} />);
  return { props, rerender: (next: Partial<ExerciseProps>) => view.rerender(<LessonSentenceView {...props} {...next} />) };
}

describe("odpowiedź otwarta z dyktowaniem", () => {
  it("pokazuje mikrofon w trybie przełącznika obok pola wieloliniowego", () => {
    const { props } = renderSentence({ recordingMode: "hold" });
    expect(field().tagName).toBe("TEXTAREA");
    expect(field().getAttribute("aria-label")).toBe(messages.kid.lessonAnswerInput);
    const record = screen.getByTestId("kid-record");
    // dotknij — mów — dotknij, mimo profilu „przytrzymaj”: zwykły klik startuje nagrywanie
    expect(record.textContent).toContain(messages.kid.record);
    fireEvent.click(record);
    expect(props.handlers.onRecord).toHaveBeenCalledTimes(1);
  });

  it("bez speechInput, w kartkówce albo bez mikrofonu nie ma przycisku nagrywania", () => {
    const { speechInput: _omit, ...withoutSpeech } = openPrompt as Extract<TaskPrompt, { kind: "lesson_open_answer" }>;
    renderSentence({}, withoutSpeech);
    expect(screen.queryByTestId("kid-record")).toBeNull();
    expect(field().tagName).toBe("INPUT");
    cleanup();
    renderSentence({ mockTest: true });
    expect(screen.queryByTestId("kid-record")).toBeNull();
    cleanup();
    renderSentence({ micAvailable: false });
    expect(screen.queryByTestId("kid-record")).toBeNull();
  });

  it("rozpoznany tekst trafia do pola raz i można go poprawić; „Sprawdź” zgłasza mowę", () => {
    const { props, rerender } = renderSentence();
    rerender({ dictation: heard(1, "Poziomica to linia na mapie.") });
    expect(field().value).toBe("Poziomica to linia na mapie.");
    fireEvent.change(field(), { target: { value: "Poziomica to linia łącząca punkty." } });
    // ten sam wynik przy kolejnym renderze nie nadpisuje poprawki dziecka
    rerender({ dictation: heard(1, "Poziomica to linia na mapie.") });
    expect(field().value).toBe("Poziomica to linia łącząca punkty.");
    fireEvent.click(check());
    expect(props.handlers.onSubmitText).toHaveBeenCalledWith("Poziomica to linia łącząca punkty.", "speech");
  });

  it("wyczyszczenie pola wraca do klawiatury", () => {
    const { props, rerender } = renderSentence();
    rerender({ dictation: heard(1, "Linia.") });
    fireEvent.change(field(), { target: { value: "" } });
    fireEvent.change(field(), { target: { value: "Linia łącząca punkty." } });
    fireEvent.click(check());
    expect(props.handlers.onSubmitText).toHaveBeenCalledWith("Linia łącząca punkty.", "keyboard");
  });

  it("nieudane dyktowanie nie zmienia pola, a podczas nagrywania pole i „Sprawdź” czekają", () => {
    const { rerender } = renderSentence();
    fireEvent.change(field(), { target: { value: "Moja odpowiedź" } });
    rerender({ dictation: { taskId: id(1), seq: 2, status: "uncertain", failures: 1 }, recordingNotice: messages.kid.dictationNotHeard });
    expect(field().value).toBe("Moja odpowiedź");
    expect(screen.getByTestId("kid-record-status").textContent).toBe(messages.kid.dictationNotHeard);
    rerender({ recordingPhase: "recording" });
    expect(field().disabled).toBe(true);
    expect(check().disabled).toBe(true);
  });

  it("po dwóch nieudanych dyktowaniach z rzędu fokus wraca do pola", () => {
    const { rerender } = renderSentence();
    (screen.getByTestId("kid-record") as HTMLButtonElement).focus();
    rerender({ dictation: { taskId: id(1), seq: 3, status: "no_speech", failures: 2 } });
    expect(document.activeElement).toBe(field());
  });
});

describe("„Skróć odpowiedź” z dyktowaniem", () => {
  function renderShorten(overrides: Partial<ExerciseProps> = {}) {
    const props = makeExerciseProps(task(shortenPrompt), { micAvailable: true, microphoneReady: true, ...overrides });
    const view = renderKid(<LessonShortenView {...props} />);
    return { props, rerender: (next: Partial<ExerciseProps>) => view.rerender(<LessonShortenView {...props} {...next} />) };
  }

  it("dyktowanie zastępuje treść pola, a oryginał z zaznaczeniami zostaje widoczny", () => {
    const { props, rerender } = renderShorten();
    expect(field().value).toBe(shortenPrompt.kind === "lesson_shorten" ? shortenPrompt.originalAnswer : "");
    expect(screen.getByTestId("kid-record")).toBeTruthy();
    rerender({ dictation: heard(4, "Poziomica łączy punkty o tej samej wysokości.") });
    expect(field().value).toBe("Poziomica łączy punkty o tej samej wysokości.");
    expect(screen.getByTestId("kid-lesson-shorten-original")).toBeTruthy();
    fireEvent.click(check());
    expect(props.handlers.onSubmitText).toHaveBeenCalledWith("Poziomica łączy punkty o tej samej wysokości.", "speech");
  });

  it("bez dyktowania wysyła tekst jak dotąd, bez sposobu wprowadzenia", () => {
    const { speechInput: _omit, ...withoutSpeech } = shortenPrompt as Extract<TaskPrompt, { kind: "lesson_shorten" }>;
    const props = makeExerciseProps(task(withoutSpeech), { micAvailable: true });
    renderKid(<LessonShortenView {...props} />);
    expect(screen.queryByTestId("kid-record")).toBeNull();
    fireEvent.click(check());
    expect(props.handlers.onSubmitText).toHaveBeenCalledWith(withoutSpeech.originalAnswer);
  });
});
