// @vitest-environment jsdom
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, renderKid, screen } from "../test/render-kid";
import { ExerciseInstruction } from "./ExerciseInstruction";

afterEach(cleanup);

it("replaces the decorative icon with one accessible playback action and preserves its ref", () => {
  const onPlay = vi.fn();
  const ref = createRef<HTMLButtonElement>();
  const view = (disabled: boolean) => <ExerciseInstruction instruction="Posłuchaj i wybierz" icon="volume"
    audio={{ onPlay, disabled, ref }} />;
  const { rerender } = renderKid(view(false));
  const header = screen.getByTestId("kid-instruction");
  const button = screen.getByTestId("kid-play");
  expect(header.contains(button)).toBe(true);
  expect(header.querySelectorAll("svg")).toHaveLength(1);
  expect(button.getAttribute("aria-label")).toBeTruthy();
  expect(ref.current).toBe(button);
  fireEvent.click(button);
  expect(onPlay).toHaveBeenCalledTimes(1);
  rerender(view(true));
  fireEvent.click(button);
  expect(onPlay).toHaveBeenCalledTimes(1);
});

it("keeps instructions without audio free of playback controls", () => {
  renderKid(<ExerciseInstruction instruction="Wpisz odpowiedź" icon="pencil" />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByTestId("kid-instruction").textContent).toBe("Wpisz odpowiedź");
});
