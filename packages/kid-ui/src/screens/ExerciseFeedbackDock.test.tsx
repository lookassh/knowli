// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { messages } from "@learning/contracts";
import { cleanup, fireEvent, renderKid, screen } from "../test/render-kid";
import { ExerciseFeedbackDock, FEEDBACK_TONE_ICONS } from "./ExerciseFeedbackDock";

afterEach(cleanup);

it.each(Object.entries(FEEDBACK_TONE_ICONS))("shows the %s tone with the %s icon badge", (tone, icon) => {
  renderKid(
    <ExerciseFeedbackDock tone={tone as keyof typeof FEEDBACK_TONE_ICONS} primary={<span>Dalej</span>}>
      <p>Wynik</p>
    </ExerciseFeedbackDock>,
  );
  const badge = screen.getByTestId("kid-feedback-tone-icon");
  expect(badge.getAttribute("data-icon")).toBe(icon);
  expect(badge.getAttribute("aria-hidden")).toBe("true");
  expect(screen.getByTestId("kid-feedback-dock").getAttribute("data-tone")).toBe(tone);
});

it("maps every tone to its icon", () => {
  expect(FEEDBACK_TONE_ICONS).toEqual({ correct: "check", partial: "almost", incorrect: "close", technical: "info", neutral: "info" });
});

it("renders the guidance next to the badge inside the dock", () => {
  renderKid(
    <ExerciseFeedbackDock tone="partial" primary={<span>Dalej</span>} guidance={<button type="button" data-testid="kid-guidance-play">Odsłuchaj</button>}>
      <p>Prawie!</p>
    </ExerciseFeedbackDock>,
  );
  const dock = screen.getByTestId("kid-feedback-dock");
  expect(dock.contains(screen.getByTestId("kid-guidance-play"))).toBe(true);
  expect(dock.contains(screen.getByTestId("kid-feedback-tone-icon"))).toBe(true);
});

const idleSentence = { playing: null, error: null, disabled: false } as const;

it("renders the sentence replay group with the normal and slow listen buttons", () => {
  const onPlay = vi.fn();
  renderKid(
    <ExerciseFeedbackDock tone="correct" primary={<span>Dalej</span>} sentenceAudio={{ ...idleSentence, onPlay }}>
      <p>Świetnie!</p>
    </ExerciseFeedbackDock>,
  );
  const dock = screen.getByTestId("kid-feedback-dock");
  const group = screen.getByTestId("kid-sentence-audio-group");
  expect(dock.contains(group)).toBe(true);
  const sentence = screen.getByTestId("kid-sentence-audio");
  const slow = screen.getByTestId("kid-sentence-audio-slow");
  expect(group.contains(sentence)).toBe(true);
  expect(group.contains(slow)).toBe(true);
  // Zdanie przed żółwiem: ta kolejność w wierszu i w kolumnie.
  expect(sentence.compareDocumentPosition(slow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(sentence.getAttribute("aria-label")).toBe("Posłuchaj zdania");
  expect(sentence.getAttribute("title")).toBe("Posłuchaj zdania");
  expect(slow.getAttribute("aria-label")).toBe("Posłuchaj wolniej");
  expect(slow.getAttribute("title")).toBe("Posłuchaj wolniej");
  expect(sentence.classList.contains("kid-listen")).toBe(true);
  expect(slow.classList.contains("kid-listen")).toBe(true);
  expect(sentence.querySelector("svg")?.getAttribute("data-icon")).toBe("volume");
  expect(slow.querySelector("svg")?.getAttribute("data-icon")).toBe("turtle");
  fireEvent.click(sentence);
  fireEvent.click(slow);
  expect(onPlay.mock.calls).toEqual([["normal"], ["slow"]]);
});

it("shows the sound ring only on the button whose rate is playing", () => {
  renderKid(
    <ExerciseFeedbackDock tone="correct" primary={<span>Dalej</span>} sentenceAudio={{ ...idleSentence, playing: "slow", onPlay: vi.fn() }}>
      <p>Świetnie!</p>
    </ExerciseFeedbackDock>,
  );
  const sentence = screen.getByTestId("kid-sentence-audio");
  const slow = screen.getByTestId("kid-sentence-audio-slow");
  expect(slow.getAttribute("data-sound-active")).toBe("true");
  expect(slow.querySelector(".kid-sound-ring")).not.toBeNull();
  expect(sentence.hasAttribute("data-sound-active")).toBe(false);
  expect(sentence.querySelector(".kid-sound-ring")).toBeNull();
});

it("marks the failed button and fills the polite error region", () => {
  renderKid(
    <ExerciseFeedbackDock tone="incorrect" primary={<span>Dalej</span>} sentenceAudio={{ ...idleSentence, error: { rate: "slow", seq: 3 }, onPlay: vi.fn() }}>
      <p>Spróbuj jeszcze raz</p>
    </ExerciseFeedbackDock>,
  );
  const slow = screen.getByTestId("kid-sentence-audio-slow");
  expect(slow.getAttribute("data-audio-failed")).toBe("3");
  expect(slow.querySelector("[data-fail-key]")?.getAttribute("data-fail-key")).toBe("3");
  expect(screen.getByTestId("kid-sentence-audio").hasAttribute("data-audio-failed")).toBe(false);
  const region = screen.getByTestId("kid-sentence-audio-error");
  expect(region.getAttribute("aria-live")).toBe("polite");
  expect(region.hasAttribute("role")).toBe(false);
  expect(region.textContent).toBe(messages.kid.sentenceAudioFailed);
  // Region stoi pod górnym wierszem, przed akcjami: nie w grupie przycisków.
  expect(screen.getByTestId("kid-sentence-audio-group").contains(region)).toBe(false);
});

it("keeps an empty error region in the dock while the sentence buttons are shown", () => {
  renderKid(
    <ExerciseFeedbackDock tone="correct" primary={<span>Dalej</span>} sentenceAudio={{ ...idleSentence, onPlay: vi.fn() }}>
      <p>Świetnie!</p>
    </ExerciseFeedbackDock>,
  );
  const region = screen.getByTestId("kid-sentence-audio-error");
  expect(region.getAttribute("aria-live")).toBe("polite");
  expect(region.textContent).toBe("");
  expect(region.childElementCount).toBe(0);
});

it("disables both sentence buttons when the controller would ignore the tap", () => {
  const onPlay = vi.fn();
  renderKid(
    <ExerciseFeedbackDock tone="correct" primary={<span>Dalej</span>} sentenceAudio={{ ...idleSentence, disabled: true, onPlay }}>
      <p>Świetnie!</p>
    </ExerciseFeedbackDock>,
  );
  const sentence = screen.getByTestId("kid-sentence-audio") as HTMLButtonElement;
  const slow = screen.getByTestId("kid-sentence-audio-slow") as HTMLButtonElement;
  expect(sentence.disabled).toBe(true);
  expect(slow.disabled).toBe(true);
  fireEvent.click(sentence);
  fireEvent.click(slow);
  expect(onPlay).not.toHaveBeenCalled();
});

it("renders no sentence replay without the prop", () => {
  renderKid(
    <ExerciseFeedbackDock tone="correct" primary={<span>Dalej</span>} sentenceAudio={null}>
      <p>Świetnie!</p>
    </ExerciseFeedbackDock>,
  );
  expect(screen.queryByRole("button", { name: "Posłuchaj zdania" })).toBeNull();
  expect(screen.queryByTestId("kid-sentence-audio")).toBeNull();
  expect(screen.queryByTestId("kid-sentence-audio-slow")).toBeNull();
  expect(screen.queryByTestId("kid-sentence-audio-group")).toBeNull();
  expect(screen.queryByTestId("kid-sentence-audio-error")).toBeNull();
});
