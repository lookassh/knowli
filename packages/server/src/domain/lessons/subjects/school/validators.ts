import type { LessonExerciseDraft, LessonTopic } from "../../types";
import { computeCalculationAnswer, renderCalculationPrompt } from "../../calculation";

/**
 * Reguły przedmiotu szkolnego dokładane do walidacji ogólnej puli
 * (`subject.validateExercise`) oraz walidacja całej puli z materiałem
 * (`validatePoolExtra`: uziemienie cytatów i spójność rodzin pytań).
 * Komunikaty po polsku, z nazwą pola — jak reszta walidatorów lekcji.
 */

const OPEN_TYPE = "lesson_open_answer";
const KEYWORDS_TYPE = "lesson_keywords";

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

/** Słowa tekstu po NFC i małymi literami (litery i cyfry). */
function wordsOf(text: string): string[] {
  return text.normalize("NFC").toLocaleLowerCase("pl-PL").match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * Czy pojęcie występuje w tekście z tolerancją polskiej odmiany: każde słowo
 * pojęcia ma w tekście słowo o tym samym początku (słowo bez dwóch ostatnich
 * liter, co najmniej 4 znaki; krótsze słowa muszą wystąpić w całości).
 * „światło” pasuje do „światła”, „cukry” do „cukrów”. Heurystyka uziemienia,
 * nie ocena — rodzic i tak zatwierdza pojęcia.
 */
function termOccursIn(term: string, words: readonly string[]): boolean {
  const termWords = wordsOf(term);
  return termWords.length > 0 && termWords.every((word) => {
    if (word.length <= 4) return words.includes(word);
    const stem = word.slice(0, Math.max(4, word.length - 2));
    return words.some((candidate) => candidate.startsWith(stem));
  });
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
    if (ex.familyId !== undefined && ex.exerciseType !== KEYWORDS_TYPE) {
      errors.push("familyId: rodziny pytań dotyczą tylko odpowiedzi otwartej i słów kluczowych");
    }
  }

  if (ex.exerciseType === KEYWORDS_TYPE) {
    // Słowa kluczowe poprzedzają konkretną rodzinę pytań otwartych (design 6.1);
    // istnienie tej rodziny w celu sprawdza validateSchoolPool.
    if (!ex.familyId) {
      errors.push("familyId: słowa kluczowe muszą wskazywać rodzinę pytań otwartych");
    }
    if (ex.acceptedAnswers.length > 0) {
      errors.push("acceptedAnswers: słowa kluczowe wymagają pustej listy wariantów");
    }
    if (ex.focus.length > 0) {
      errors.push("focus: słowa kluczowe wymagają pustej listy");
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
    if (!ex.familyId || ex.exerciseType !== OPEN_TYPE) return;
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

  // Słowa kluczowe: rodzina pytań otwartych musi istnieć w tym samym celu, a
  // każde pojęcie kluczowe występuje w jej odpowiedzi wzorcowej albo w materiale
  // (dobór dystraktorów sprawdza rodzic).
  drafts.forEach((ex, index) => {
    if (ex.exerciseType !== KEYWORDS_TYPE || !ex.familyId) return;
    const familyIndexes = families.get(JSON.stringify([ex.objectiveId, ex.familyId])) ?? [];
    const family = familyIndexes[0] === undefined ? undefined : drafts[familyIndexes[0]];
    if (!family) {
      push(index, `familyId: brak rodziny pytań otwartych „${ex.familyId}” w tym zagadnieniu`);
      return;
    }
    const haystack = [...wordsOf(family.answer), ...wordsOf(ctx.material)];
    const textById = new Map((ex.keywordOptions ?? []).map((option) => [option.id, option.text] as const));
    for (const id of ex.keyOptionIds ?? []) {
      const term = textById.get(id);
      if (term !== undefined && !termOccursIn(term, haystack)) {
        push(index, `keyOptionIds: pojęcie kluczowe „${term}” nie występuje w odpowiedzi wzorcowej ani w materiale`);
      }
    }
  });

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
