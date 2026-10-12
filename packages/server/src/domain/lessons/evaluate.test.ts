import { describe, expect, it } from "vitest";
import { englishNormalizer } from "./subjects/english-grammar/normalizer";
import { historyLikeSubject } from "./testing/history-like-subject";
import {
  TYPO_TOLERANCE,
  buildAnswerSegments,
  closestApprovedVariant,
  evaluateChoice,
  evaluateSequence,
  gradeFromMatch,
  gradeFromVerdict,
  matchLessonAnswer,
  validateVerdict,
  type LessonAnswerKey,
} from "./evaluate";

const historyNormalizer = historyLikeSubject.normalizer;

function writtenKey(partial: Partial<LessonAnswerKey> = {}): LessonAnswerKey {
  return {
    exerciseType: "lesson_gap",
    objectiveId: "obj",
    answer: "He doesn't play football",
    acceptedAnswers: [],
    focus: ["doesn't", "play"],
    ...partial,
  };
}

describe("matchLessonAnswer — exact (po normalizacji przedmiotu)", () => {
  it("odpowiedź kanoniczna → exact", () => {
    const r = matchLessonAnswer("He doesn't play football", writtenKey(), englishNormalizer);
    expect(r.kind).toBe("exact");
  });

  it("rozwinięcie skrótu i interpunkcja/wielkość liter nie przeszkadzają → exact", () => {
    const r = matchLessonAnswer("he does not play football.", writtenKey(), englishNormalizer);
    expect(r.kind).toBe("exact");
  });

  it("exact na zatwierdzonym wariancie, nie tylko na kanonicznej", () => {
    const key = writtenKey({ answer: "He plays football", acceptedAnswers: ["He plays soccer"], focus: ["plays"] });
    expect(matchLessonAnswer("he plays soccer", key, englishNormalizer).kind).toBe("exact");
  });

  it("niezależność od języka: fixture historyczny, exact mimo wielkości liter", () => {
    const key = writtenKey({ answer: "Mieszko I", acceptedAnswers: [], focus: ["mieszko", "i"] });
    expect(matchLessonAnswer("mieszko i", key, historyNormalizer).kind).toBe("exact");
  });

  it("pusta odpowiedź → no_match", () => {
    expect(matchLessonAnswer("   ", writtenKey(), englishNormalizer).kind).toBe("no_match");
  });
});

describe("matchLessonAnswer — tolerancja drobnej literówki poza focus", () => {
  const key = writtenKey({ answer: "She doesn't like milk", focus: ["doesn't", "like"] });

  it("literówka poza focus (milk→milc) → minor_typo z tokenem milc", () => {
    const r = matchLessonAnswer("She doesn't like milc", key, englishNormalizer);
    expect(r.kind).toBe("minor_typo");
    if (r.kind === "minor_typo") expect(r.typoToken).toBe("milc");
  });

  it("literówka W focus (doesn't→dosen't) → no_match", () => {
    expect(matchLessonAnswer("She dosen't like milk", key, englishNormalizer).kind).toBe("no_match");
  });

  it("dwie literówki w różnych tokenach → no_match", () => {
    expect(matchLessonAnswer("She doesn't likk milc", key, englishNormalizer).kind).toBe("no_match");
  });

  it("inna liczba tokenów → no_match", () => {
    expect(matchLessonAnswer("She doesn't like the milk", key, englishNormalizer).kind).toBe("no_match");
  });

  it("pusty focus → tolerancja wyłączona (no_match)", () => {
    const noFocus = writtenKey({ answer: "milk", acceptedAnswers: [], focus: [] });
    expect(matchLessonAnswer("milc", noFocus, englishNormalizer).kind).toBe("no_match");
  });

  it("token > 6 znaków z OSA 2 → minor_typo", () => {
    const k = writtenKey({ answer: "He plays football", focus: ["plays"] });
    // football (8) → futball: 1 delete + 1 subst = OSA 2
    const r = matchLessonAnswer("He plays futball", k, englishNormalizer);
    expect(r.kind).toBe("minor_typo");
  });

  it("token ≤ 6 znaków z OSA 2 → no_match", () => {
    const k = writtenKey({ answer: "He likes milk", focus: ["likes"] });
    // milk (4) → malc: 2 substytucje = OSA 2 na krótkim tokenie
    expect(matchLessonAnswer("He likes malc", k, englishNormalizer).kind).toBe("no_match");
  });

  it("progi są nazwanymi stałymi, nie magią", () => {
    expect(TYPO_TOLERANCE.shortMaxDistance).toBe(1);
    expect(TYPO_TOLERANCE.longMaxDistance).toBe(2);
    expect(TYPO_TOLERANCE.shortTokenMaxLength).toBe(6);
  });
});

describe("evaluateChoice / evaluateSequence (typy zamknięte)", () => {
  it("choice: poprawny i niepoprawny po id", () => {
    const key = writtenKey({ exerciseType: "lesson_choice", correctOptionId: "o2" });
    expect(evaluateChoice("o2", key)).toBe(true);
    expect(evaluateChoice("o1", key)).toBe(false);
  });

  it("sequence: ta sama długość i kolejność co key.itemIds", () => {
    const key = writtenKey({ exerciseType: "lesson_order", itemIds: ["a", "b", "c"] });
    expect(evaluateSequence(["a", "b", "c"], key)).toBe(true);
    expect(evaluateSequence(["a", "c", "b"], key)).toBe(false); // zła kolejność
    expect(evaluateSequence(["a", "b"], key)).toBe(false); // brakujący
    expect(evaluateSequence(["a", "b", "c", "d"], key)).toBe(false); // nadmiarowy
  });
});

describe("validateVerdict — walidacja werdyktu modelu (Zod)", () => {
  const ctx = { allowedCategories: ["wrong_verb_form", "missing_ending"] as const, childAnswer: "He play football" };

  it("poprawny incorrect z kategorią celu i fragmentem obecnym w odpowiedzi", () => {
    const v = validateVerdict({ verdict: "incorrect", errorCategory: "wrong_verb_form", fragments: ["play"], note: "brak -s" }, ctx);
    expect(v).not.toBeNull();
    expect(v?.verdict).toBe("incorrect");
  });

  it("kategoria spoza listy → null", () => {
    expect(validateVerdict({ verdict: "incorrect", errorCategory: "banana", fragments: ["play"], note: "" }, ctx)).toBeNull();
  });

  it("kategoria other jest dozwolona", () => {
    const v = validateVerdict({ verdict: "incorrect", errorCategory: "other", fragments: ["play"], note: "" }, ctx);
    expect(v).not.toBeNull();
  });

  it("correct z kategorią → null", () => {
    expect(validateVerdict({ verdict: "correct", errorCategory: "wrong_verb_form", fragments: [], note: "" }, ctx)).toBeNull();
  });

  it("correct z fragmentem → null", () => {
    expect(validateVerdict({ verdict: "correct", errorCategory: null, fragments: ["play"], note: "" }, ctx)).toBeNull();
  });

  it("correct czysty → ok", () => {
    expect(validateVerdict({ verdict: "correct", errorCategory: null, fragments: [], note: "ok" }, ctx)).not.toBeNull();
  });

  it("incorrect bez kategorii (null) → null", () => {
    expect(validateVerdict({ verdict: "incorrect", errorCategory: null, fragments: ["play"], note: "" }, ctx)).toBeNull();
  });

  it("fragment nieobecny w odpowiedzi → null", () => {
    expect(validateVerdict({ verdict: "incorrect", errorCategory: "other", fragments: ["swims"], note: "" }, ctx)).toBeNull();
  });

  it("fragment z inną wielkością liter → odrzucony (porównanie z rozróżnieniem wielkości)", () => {
    expect(validateVerdict({ verdict: "incorrect", errorCategory: "other", fragments: ["Play"], note: "" }, ctx)).toBeNull();
  });

  it("5 fragmentów (> 4) → null", () => {
    expect(
      validateVerdict({ verdict: "incorrect", errorCategory: "other", fragments: ["H", "e", "p", "l", "a"], note: "" }, ctx),
    ).toBeNull();
  });

  it("note > 300 → null (odrzucenie, nie obcięcie)", () => {
    const note = "x".repeat(301);
    expect(validateVerdict({ verdict: "incorrect", errorCategory: "other", fragments: ["play"], note }, ctx)).toBeNull();
  });

  it("brak pola verdict → null", () => {
    expect(validateVerdict({ errorCategory: null, fragments: [], note: "" }, ctx)).toBeNull();
  });

  it("verdict spoza listy → null", () => {
    expect(validateVerdict({ verdict: "maybe", errorCategory: null, fragments: [], note: "" }, ctx)).toBeNull();
  });

  it("nadmiarowe pole ignorowane, ale nie przekazywane dalej", () => {
    const v = validateVerdict(
      { verdict: "almost", errorCategory: null, fragments: ["play"], note: "", extra: "ignore" } as unknown,
      ctx,
    );
    expect(v).not.toBeNull();
    expect(v && Object.keys(v).sort()).toEqual(["errorCategory", "fragments", "note", "verdict"]);
  });

  it("wejście nie-obiekt → null", () => {
    expect(validateVerdict("not an object", ctx)).toBeNull();
    expect(validateVerdict(null, ctx)).toBeNull();
    expect(validateVerdict(42, ctx)).toBeNull();
  });

  it("pusty fragment → null", () => {
    expect(validateVerdict({ verdict: "incorrect", errorCategory: "other", fragments: [""], note: "" }, ctx)).toBeNull();
  });

  it("almost z kategorią celu dozwolone (almost zalicza, może mieć fragmenty)", () => {
    const v = validateVerdict({ verdict: "almost", errorCategory: "missing_ending", fragments: ["play"], note: "" }, ctx);
    expect(v).not.toBeNull();
  });
});

describe("gradeFromMatch / gradeFromVerdict — mapowanie na ocenę celu (tabela design)", () => {
  it("exact → correct/exact", () => {
    expect(gradeFromMatch({ kind: "exact", variant: "x" })).toEqual({ outcome: "correct", verdict: "exact" });
  });

  it("minor_typo → correct/minor_typo", () => {
    expect(gradeFromMatch({ kind: "minor_typo", variant: "x", typoToken: "milc" })).toEqual({
      outcome: "correct",
      verdict: "minor_typo",
    });
  });

  it("no_match → null (nie da się pomylić z oceną; wywołujący eskaluje do modelu)", () => {
    expect(gradeFromMatch({ kind: "no_match" })).toBeNull();
  });

  it("werdykt correct → correct/model_correct", () => {
    expect(gradeFromVerdict({ verdict: "correct", errorCategory: null, fragments: [], note: "" })).toEqual({
      outcome: "correct",
      verdict: "model_correct",
    });
  });

  it("werdykt almost → correct/model_almost", () => {
    expect(gradeFromVerdict({ verdict: "almost", errorCategory: null, fragments: [], note: "" })).toEqual({
      outcome: "correct",
      verdict: "model_almost",
    });
  });

  it("werdykt incorrect z kategorią celu → incorrect/model_incorrect + errorCategory", () => {
    expect(
      gradeFromVerdict({ verdict: "incorrect", errorCategory: "wrong_verb_form", fragments: ["play"], note: "" }),
    ).toEqual({ outcome: "incorrect", verdict: "model_incorrect", errorCategory: "wrong_verb_form" });
  });

  it("werdykt incorrect z kategorią other → unevaluated/model_other", () => {
    expect(gradeFromVerdict({ verdict: "incorrect", errorCategory: "other", fragments: ["play"], note: "" })).toEqual({
      outcome: "unevaluated",
      verdict: "model_other",
    });
  });

  it("brak oceny (null) → unevaluated + technical + unavailable", () => {
    expect(gradeFromVerdict(null)).toEqual({ outcome: "unevaluated", reason: "technical", verdict: "unavailable" });
  });
});

describe("closestApprovedVariant — najbliższy zatwierdzony wariant (oryginalny zapis)", () => {
  it("zwraca wariant o najmniejszej odległości tokenowej, oryginalny zapis", () => {
    const key = writtenKey({ answer: "He plays football", acceptedAnswers: ["He plays soccer"], focus: ["plays"] });
    expect(closestApprovedVariant("He plays socer", key, englishNormalizer)).toBe("He plays soccer");
  });

  it("remis → pierwszy w kolejności answer, ...acceptedAnswers", () => {
    const key = writtenKey({ answer: "abd", acceptedAnswers: ["abe"], focus: ["x"] });
    expect(closestApprovedVariant("abc", key, englishNormalizer)).toBe("abd");
  });
});

describe("buildAnswerSegments — segmenty plain/pill po punktach kodowych", () => {
  it("pojedynczy fragment → plain/pill/plain", () => {
    expect(buildAnswerSegments("He play football", ["play"])).toEqual([
      { text: "He ", state: "plain" },
      { text: "play", state: "pill" },
      { text: " football", state: "plain" },
    ]);
  });

  it("wiele fragmentów rozdzielonych tekstem plain pozostaje osobnymi pill", () => {
    expect(buildAnswerSegments("He play ball", ["He", "play"])).toEqual([
      { text: "He", state: "pill" },
      { text: " ", state: "plain" },
      { text: "play", state: "pill" },
      { text: " ball", state: "plain" },
    ]);
  });

  it("sąsiadujące fragmenty tego samego stanu scalone w jeden segment", () => {
    expect(buildAnswerSegments("abcdef", ["abc", "def"])).toEqual([{ text: "abcdef", state: "pill" }]);
  });

  it("nakładające się fragmenty scalone", () => {
    expect(buildAnswerSegments("abcdef", ["abc", "cde"])).toEqual([
      { text: "abcde", state: "pill" },
      { text: "f", state: "plain" },
    ]);
  });

  it("brak fragmentu w odpowiedzi → całość plain", () => {
    expect(buildAnswerSegments("He plays", ["xyz"])).toEqual([{ text: "He plays", state: "plain" }]);
  });

  it("pusta lista fragmentów → całość plain", () => {
    expect(buildAnswerSegments("He plays", [])).toEqual([{ text: "He plays", state: "plain" }]);
  });

  it("fragment znormalizowany (lowercase) trafia w odpowiedź z wielką literą — segment zachowuje oryginał", () => {
    expect(buildAnswerSegments("Milc", ["milc"])).toEqual([{ text: "Milc", state: "pill" }]);
  });

  it("znaki spoza BMP liczone jako jedna jednostka", () => {
    expect(buildAnswerSegments("a😀b", ["😀"])).toEqual([
      { text: "a", state: "plain" },
      { text: "😀", state: "pill" },
      { text: "b", state: "plain" },
    ]);
  });

  it("niestabilny casefold (İ) → null", () => {
    expect(buildAnswerSegments("İstanbul", ["istanbul"])).toBeNull();
  });

  it("segmenty składają się dokładnie na childAnswer", () => {
    const segments = buildAnswerSegments("He play football", ["play"]);
    expect(segments?.map((s) => s.text).join("")).toBe("He play football");
  });
});
