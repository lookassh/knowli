import type { LessonExerciseDraft, LessonTopic } from "../../types";
import { computeCalculationAnswer, renderCalculationPrompt } from "../../calculation";

/**
 * Reguły przedmiotu szkolnego dokładane do walidacji ogólnej puli
 * (`subject.validateExercise`) oraz walidacja całej puli z materiałem
 * (`validatePoolExtra`: uziemienie cytatów i spójność rodzin pytań).
 * Komunikaty po polsku, z nazwą pola — jak reszta walidatorów lekcji.
 */

const OPEN_TYPE = "lesson_open_answer";

/**
 * Normalizacja do porównania cytatu z materiałem: tylko NFC i białe znaki —
 * cytat pokazywany rodzicowi ma być dokładnym fragmentem, z wielkością liter.
 */
function normalizeForGrounding(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** Porównanie sformułowań w rodzinie pytań: jak wyżej, ale bez wielkości liter. */
function normalizeForPromptComparison(text: string): string {
  return normalizeForGrounding(text).toLocaleLowerCase("pl-PL");
}

export function validateSchoolExercise(ex: LessonExerciseDraft, _topic: LessonTopic): string[] {
  const errors: string[] = [];

  // Każde ćwiczenie puli musi mieć uziemienie (obecność; zgodność z materiałem
  // sprawdza validateSchoolPool, które ma dostęp do materiału).
  if (ex.exerciseType !== "lesson_card") {
    if (!ex.sourceRefs || ex.sourceRefs.length === 0) {
      errors.push("sourceRefs: ćwiczenie przedmiotu szkolnego wymaga co najmniej jednego cytatu źródłowego");
    }
  }

  if (ex.exerciseType === "lesson_calculation") {
    if (ex.calculation === undefined) {
      errors.push("calculation: zadanie rachunkowe wymaga parametrów obliczenia");
    } else {
      try {
        const expectedAnswer = computeCalculationAnswer(ex.calculation).answer;
        const expectedPrompt = renderCalculationPrompt(ex.calculation);
        if (ex.answer !== expectedAnswer) {
          errors.push("answer: wynik rachunku musi być zgodny z odpowiedzią obliczoną przez kod");
        }
        if (ex.prompt !== expectedPrompt) {
          errors.push("prompt: treść rachunku musi być zgodna z szablonem renderowanym przez kod");
        }
      } catch {
        errors.push("calculation: nieprawidłowe parametry obliczenia lub tolerancja wyniku");
      }
    }
    if (ex.acceptedAnswers.length > 0) {
      errors.push("acceptedAnswers: zadanie rachunkowe wymaga pustej listy wariantów");
    }
    if (ex.focus.length > 0) {
      errors.push("focus: zadanie rachunkowe wymaga pustej listy");
    }
  }

  if (ex.exerciseType === OPEN_TYPE) {
    if (!ex.questionType) {
      errors.push("questionType: odpowiedź otwarta wymaga typu pytania");
    }
    if (!ex.requiredElements || ex.requiredElements.length === 0) {
      errors.push("requiredElements: odpowiedź otwarta wymaga 1–6 elementów wymaganych");
    } else {
      const ids = ex.requiredElements.map((el) => el.id);
      if (new Set(ids).size !== ids.length) {
        errors.push("requiredElements: identyfikatory elementów muszą być unikalne w ćwiczeniu");
      }
    }
    if (!ex.expectedForm) {
      errors.push("expectedForm: odpowiedź otwarta wymaga oczekiwanej formy");
    }
  } else {
    if (ex.questionType !== undefined) {
      errors.push("questionType: typ pytania dotyczy tylko odpowiedzi otwartej");
    }
    if (ex.requiredElements !== undefined) {
      errors.push("requiredElements: elementy wymagane dotyczą tylko odpowiedzi otwartej");
    }
    if (ex.supplementaryElements !== undefined) {
      errors.push("supplementaryElements: elementy uzupełniające dotyczą tylko odpowiedzi otwartej");
    }
    if (ex.commonErrors !== undefined) {
      errors.push("commonErrors: typowe błędy dotyczą tylko odpowiedzi otwartej");
    }
    if (ex.expectedForm !== undefined) {
      errors.push("expectedForm: oczekiwana forma dotyczy tylko odpowiedzi otwartej");
    }
    if (ex.familyId !== undefined) {
      errors.push("familyId: rodziny pytań dotyczą tylko odpowiedzi otwartej");
    }
  }

  return errors;
}

/**
 * Walidacja puli z materiałem: (1) każdy cytat niepochodzący od rodzica musi
 * być dokładnym fragmentem materiału (po normalizacji), (2) ćwiczenia jednej
 * rodziny pytań (cel + familyId) muszą mieć tę samą odpowiedź wzorcową i ten
 * sam zbiór identyfikatorów elementów wymaganych.
 */
export function validateSchoolPool(
  drafts: readonly LessonExerciseDraft[],
  ctx: { material: string },
): ReadonlyMap<number, readonly string[]> {
  const errors = new Map<number, string[]>();
  const push = (index: number, message: string) => {
    const list = errors.get(index) ?? [];
    list.push(message);
    errors.set(index, list);
  };

  const materialNormalized = normalizeForGrounding(ctx.material);
  drafts.forEach((ex, index) => {
    for (const ref of ex.sourceRefs ?? []) {
      if (ref.parentAdded === true) continue;
      const quote = normalizeForGrounding(ref.quote);
      if (quote.length < 10) {
        push(index, "sourceRefs: cytat za krótki, aby uziemiał ćwiczenie (min. 10 znaków)");
      } else if (!materialNormalized.includes(quote)) {
        push(index, "sourceRefs: cytat nie występuje w materiale źródłowym");
      }
    }
  });

  // Rodzina żyje w obrębie celu: model generuje każdy cel osobną partią i nie zna
  // slugów innych partii, więc ten sam slug w dwóch celach to dwie różne rodziny.
  const families = new Map<string, number[]>();
  drafts.forEach((ex, index) => {
    if (!ex.familyId) return;
    const key = JSON.stringify([ex.objectiveId, ex.familyId]);
    const list = families.get(key) ?? [];
    list.push(index);
    families.set(key, list);
  });
  for (const indexes of families.values()) {
    if (indexes.length < 2) continue;
    const familyId = drafts[indexes[0]!]!.familyId!;
    const first = drafts[indexes[0]!]!;
    const firstElements = (first.requiredElements ?? []).map((el) => el.id).sort((a, b) => a.localeCompare(b)).join(",");
    for (const index of indexes.slice(1)) {
      const ex = drafts[index]!;
      const elements = (ex.requiredElements ?? []).map((el) => el.id).sort((a, b) => a.localeCompare(b)).join(",");
      const samePrompt =
        normalizeForPromptComparison(ex.prompt ?? "") === normalizeForPromptComparison(first.prompt ?? "") && (ex.prompt ?? "") !== "";
      if (samePrompt) {
        push(index, `familyId: ćwiczenie z rodziny „${familyId}” powiela tekst pytania innego członka rodziny`);
      }
      if (ex.answer.trim() !== first.answer.trim() || elements !== firstElements) {
        push(
          index,
          `familyId: ćwiczenie z rodziny „${familyId}” różni się odpowiedzią wzorcową lub elementami wymaganymi od reszty rodziny`,
        );
      }
    }
  }

  // Rodzina wariantów liczbowych współdzieli metodę i jednostki, nie wynik.
  const calculationFamilies = new Map<string, number[]>();
  drafts.forEach((ex, index) => {
    if (ex.exerciseType !== "lesson_calculation" || !ex.calculation) return;
    const key = JSON.stringify([ex.objectiveId, ex.calculation.templateFamilyId]);
    const indexes = calculationFamilies.get(key) ?? [];
    indexes.push(index);
    calculationFamilies.set(key, indexes);
  });
  for (const indexes of calculationFamilies.values()) {
    const first = drafts[indexes[0]!]!;
    const firstCalculation = first.calculation!;
    const familyId = firstCalculation.templateFamilyId;
    for (const index of indexes.slice(1)) {
      const ex = drafts[index]!;
      const calculation = ex.calculation!;
      const sameInputUnit = firstCalculation.kind !== "unit_conversion" || (
        calculation.kind === "unit_conversion" && calculation.params.fromUnit === firstCalculation.params.fromUnit
      );
      if (calculation.kind !== firstCalculation.kind || calculation.unit !== firstCalculation.unit || !sameInputUnit) {
        push(index, `templateFamilyId: ćwiczenie z rodziny „${familyId}” różni się rodzajem obliczenia lub jednostkami od reszty rodziny`);
      }
    }
  }

  return errors;
}
