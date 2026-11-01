// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { TaskDto } from "@learning/contracts";
import { cleanup, renderKid } from "../test/render-kid";
import { stubFinePointer } from "../test/fine-pointer-stub";
import { ExerciseFrame } from "./ExerciseFrame";

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.matchMedia = originalMatchMedia;
});

const task = {
  taskId: "t1", exerciseType: "lesson_choice", remainingAssessed: 3,
  prompt: { kind: "lesson_choice", instructionPl: "Wybierz.", stem: "He ___ to school.", options: [] },
} as unknown as TaskDto;

/** Dolna krawędź stopki względem dolnej krawędzi ramy (800 px) — jedyne, co czyta `data-frame-full`. */
function stubFooterBottom(initial: number) {
  let footerBottom = initial;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const bottom = this.classList.contains("kid-exercise-frame") ? 800
      : this.classList.contains("kid-exercise-actions") ? footerBottom : 0;
    return { x: 0, y: 0, top: 0, left: 0, right: 0, width: 0, height: bottom, bottom, toJSON: () => ({}) } as DOMRect;
  });
  return { set: (next: number) => { footerBottom = next; } };
}

it("przelicza data-frame-full po zmianie myszy na dotyk (odstęp zwartej ramy) w panelu w przepływie", () => {
  const pointer = stubFinePointer(true);
  const footer = stubFooterBottom(800);
  renderKid(
    <div className="kid-page">
      <ExerciseFrame task={task} content={<p>treść</p>} feedbackLayout="flow" dock={<div data-testid="dock">wynik</div>} />
    </div>,
  );
  const panel = document.querySelector<HTMLElement>("[data-frame-full]");
  expect(panel, "pełna rama przy stopce na dole").not.toBeNull();
  // Zmiana wskaźnika zmienia odstęp od góry (`--frame-offset`), a rama i panel
  // mogą zachować rozmiar — bez nasłuchu atrybut zostałby nieaktualny.
  footer.set(700);
  pointer.setFine(false);
  expect(document.querySelector("[data-frame-full]")).toBeNull();
});
