// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, renderKid, screen } from "../test/render-kid";
import { QuestionAudioButton } from "./QuestionAudioButton";

afterEach(cleanup);

describe("QuestionAudioButton (design szkoły §11.4)", () => {
  it("nazwany głośnik „Posłuchaj pytania” odtwarza na żądanie", () => {
    const onPlay = vi.fn(async () => {});
    renderKid(<QuestionAudioButton onPlay={onPlay} disabled={false} />);
    const button = screen.getByTestId("kid-question-audio");
    expect(button.getAttribute("aria-label")).toBe("Posłuchaj pytania");
    expect(onPlay).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(onPlay).toHaveBeenCalledOnce();
  });

  it("jest nieaktywny, gdy zadanie nie przyjmuje odsłuchu (np. nagrywanie)", () => {
    renderKid(<QuestionAudioButton onPlay={async () => {}} disabled />);
    expect((screen.getByTestId("kid-question-audio") as HTMLButtonElement).disabled).toBe(true);
  });

  it("błąd odtwarzania pokazuje komunikat z ponowieniem i nie blokuje zadania", async () => {
    const onPlay = vi.fn(async () => { throw new Error("playback failed"); });
    renderKid(<QuestionAudioButton onPlay={onPlay} disabled={false} />);
    await act(async () => { fireEvent.click(screen.getByTestId("kid-question-audio")); });
    expect(screen.getByTestId("kid-question-audio-error").textContent).toContain("Nie udało się odtworzyć pytania");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Odtwórz pytanie" })); });
    expect(onPlay).toHaveBeenCalledTimes(2);
  });
});
