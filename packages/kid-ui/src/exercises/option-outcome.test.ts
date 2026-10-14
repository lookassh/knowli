import { describe, expect, it } from "vitest";
import type { ChoiceOption, FeedbackDto } from "@learning/contracts";
import { optionOutcomes } from "./option-outcome";

const OPTIONS: ChoiceOption[] = [
  { id: "11111111-1111-1111-1111-111111111111", text: "poniedziałek" },
  { id: "22222222-2222-2222-2222-222222222222", text: "czwartek" },
  { id: "33333333-3333-3333-3333-333333333333", text: "piątek" },
];

/**
 * Podświetlenie opcji po próbie wyboru (design 2026-10-09): kolor wyniku
 * pochodzi wyłącznie z feedbacku serwera — nigdy z lokalnego zgadywania
 * (plan zadania 9: offline nie tworzy fałszywego sukcesu).
 */
describe("optionOutcomes — podświetlenie opcji po próbie wyboru", () => {
  it("sukces zapala tylko wybraną opcję na zielono", () => {
    const outcomes = optionOutcomes(
      { kind: "great" },
      OPTIONS[0]!.id,
      OPTIONS,
    );
    expect(outcomes.get(OPTIONS[0]!.id)).toBe("correct");
    expect(outcomes.get(OPTIONS[1]!.id)).toBeUndefined();
    expect(outcomes.get(OPTIONS[2]!.id)).toBeUndefined();
  });

  it("podpowiedź kapitalizacji to sukces — wybrana opcja zielona", () => {
    const outcomes = optionOutcomes(
      { kind: "capitalization_hint", correctText: "Monday" },
      OPTIONS[1]!.id,
      OPTIONS,
    );
    expect(outcomes.get(OPTIONS[1]!.id)).toBe("correct");
  });

  it("pomyłka zapala wybraną opcję na czerwono, a poprawną na zielono", () => {
    const outcomes = optionOutcomes(
      { kind: "incorrect", correctText: "czwartek" },
      OPTIONS[0]!.id,
      OPTIONS,
    );
    expect(outcomes.get(OPTIONS[0]!.id)).toBe("wrong");
    expect(outcomes.get(OPTIONS[1]!.id)).toBe("correct");
    expect(outcomes.get(OPTIONS[2]!.id)).toBeUndefined();
  });

  it("„prawie” podświetla jak pomyłkę — wybrana czerwono, poprawna zielono", () => {
    const outcomes = optionOutcomes(
      { kind: "almost", correctText: "czwartek" },
      OPTIONS[2]!.id,
      OPTIONS,
    );
    expect(outcomes.get(OPTIONS[2]!.id)).toBe("wrong");
    expect(outcomes.get(OPTIONS[1]!.id)).toBe("correct");
  });

  it("correctText bez dopasowania do opcji zostawia samą czerwoną wybraną", () => {
    const outcomes = optionOutcomes(
      { kind: "incorrect", correctText: "niedziela" },
      OPTIONS[0]!.id,
      OPTIONS,
    );
    expect(outcomes.get(OPTIONS[0]!.id)).toBe("wrong");
    expect(outcomes.size).toBe(1);
  });

  it("dopasowuje poprawną odpowiedź po polskiej etykiecie opcji obrazkowej", () => {
    const pictureOptions = [
      { id: "red", labelPl: "czerwony", visual: { kind: "color" as const, color: "#ff0000" } },
      { id: "blue", labelPl: "niebieski", visual: { kind: "color" as const, color: "#0000ff" } },
    ];
    const outcomes = optionOutcomes({ kind: "incorrect", correctText: "czerwony" }, "blue", pictureOptions);
    expect(outcomes.get("blue")).toBe("wrong");
    expect(outcomes.get("red")).toBe("correct");
  });

  it("próba nieoceniona nie podświetla nic — bez udawanego wyniku", () => {
    expect(optionOutcomes({ kind: "not_assessed" }, OPTIONS[0]!.id, OPTIONS).size).toBe(0);
    expect(optionOutcomes({ kind: "content_matched" }, OPTIONS[0]!.id, OPTIONS).size).toBe(0);
  });

  it("bez feedbacku lub bez wybranej opcji (pisownia, wymowa) brak podświetleń", () => {
    expect(optionOutcomes(null, OPTIONS[0]!.id, OPTIONS).size).toBe(0);
    expect(optionOutcomes({ kind: "incorrect", correctText: "czwartek" }, undefined, OPTIONS).size).toBe(0);
    expect(optionOutcomes({ kind: "great" }, undefined, OPTIONS).size).toBe(0);
  });
});
