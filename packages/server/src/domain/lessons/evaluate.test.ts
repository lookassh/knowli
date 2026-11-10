import { describe, expect, it } from "vitest";
import {
  TYPO_TOLERANCE,
  buildAnswerSegments,
  closestApprovedVariant,
  assignmentText,
  evaluateAssignment,
  evaluateChoice,
  evaluateSequence,
  evaluateKeywordSelection,
  gradeFromMatch,
  countSentences,
  gradeFromSchoolVerdict,
  gradeFromVerdict,
  validateSchoolVerdict,
  matchLessonAnswer,
  validateVerdict,
  type LessonAnswerKey,
} from "./evaluate";

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

describe("matchLessonAnswer — exact (neutralna normalizacja)", () => {
  it("odpowiedź kanoniczna → exact", () => {
    const r = matchLessonAnswer("He doesn't play football", writtenKey());
    expect(r.kind).toBe("exact");
  });

  it("interpunkcja i wielkość liter nie przeszkadzają → exact", () => {
    expect(matchLessonAnswer("he doesn't play football.", writtenKey()).kind).toBe("exact");
  });

  it("skróty nie są rozwijane: pełna forma wobec klucza ze skrótem → no_match (ocenia model)", () => {
    expect(matchLessonAnswer("he does not play football.", writtenKey()).kind).toBe("no_match");
  });

  it("niegramatyczne skróty i fałszywe rozwinięcia nie zaliczają bez modelu (#360)", () => {
    const cases: [string, string, string][] = [
      ["Yes, she's.", "Yes, she is.", "is"],
      ["Yes, I'm.", "Yes, I am.", "am"],
      ["Yes, they're.", "Yes, they are.", "are"],
      ["He has running.", "He's running.", "running"],
    ];
    for (const [answer, key, focus] of cases) {
      expect(matchLessonAnswer(answer, writtenKey({ answer: key, focus: [focus] })).kind, answer).toBe("no_match");
    }
  });

  it("skrót obecny w wariantach → exact", () => {
    const key = writtenKey({ answer: "She is not at home.", acceptedAnswers: ["She isn't at home."], focus: ["is", "not"] });
    expect(matchLessonAnswer("she isn't at home", key).kind).toBe("exact");
  });

  it("exact na zatwierdzonym wariancie, nie tylko na kanonicznej", () => {
    const key = writtenKey({ answer: "He plays football", acceptedAnswers: ["He plays soccer"], focus: ["plays"] });
    expect(matchLessonAnswer("he plays soccer", key).kind).toBe("exact");
  });

  it("niezależność od języka: polski tekst, exact mimo wielkości liter", () => {
    const key = writtenKey({ answer: "Mieszko I", acceptedAnswers: [], focus: ["mieszko", "i"] });
    expect(matchLessonAnswer("mieszko i", key).kind).toBe("exact");
  });

  it("pusta odpowiedź → no_match", () => {
    expect(matchLessonAnswer("   ", writtenKey()).kind).toBe("no_match");
  });
});

describe("matchLessonAnswer — tolerancja drobnej literówki poza focus", () => {
  const key = writtenKey({ answer: "She doesn't like milk", focus: ["doesn't", "like"] });

  it("literówka poza focus (milk→milc) → minor_typo z tokenem milc", () => {
    const r = matchLessonAnswer("She doesn't like milc", key);
    expect(r.kind).toBe("minor_typo");
    if (r.kind === "minor_typo") expect(r.typoToken).toBe("milc");
  });

  it("literówka W focus (doesn't→dosen't) → no_match", () => {
    expect(matchLessonAnswer("She dosen't like milk", key).kind).toBe("no_match");
  });

  it("dwie literówki w różnych tokenach → no_match", () => {
    expect(matchLessonAnswer("She doesn't likk milc", key).kind).toBe("no_match");
  });

  it("inna liczba tokenów → no_match", () => {
    expect(matchLessonAnswer("She doesn't like the milk", key).kind).toBe("no_match");
  });

  it("pusty focus → tolerancja wyłączona (no_match)", () => {
    const noFocus = writtenKey({ answer: "milk", acceptedAnswers: [], focus: [] });
    expect(matchLessonAnswer("milc", noFocus).kind).toBe("no_match");
  });

  it("token > 6 znaków z OSA 2 → minor_typo", () => {
    const k = writtenKey({ answer: "He plays football", focus: ["plays"] });
    // football (8) → futball: 1 delete + 1 subst = OSA 2
    const r = matchLessonAnswer("He plays futball", k);
    expect(r.kind).toBe("minor_typo");
  });

  it("token ≤ 6 znaków z OSA 2 → no_match", () => {
    const k = writtenKey({ answer: "He likes milk", focus: ["likes"] });
    // milk (4) → malc: 2 substytucje = OSA 2 na krótkim tokenie
    expect(matchLessonAnswer("He likes malc", k).kind).toBe("no_match");
  });

  it("focus dosłowny: literówka w słowie formy objętym focus → no_match", () => {
    expect(matchLessonAnswer("She doesn't likes milk", key).kind).toBe("no_match");
  });

  it("stara rewizja z focus w formie rozwiniętej: bez tolerancji literówki", () => {
    const old = writtenKey({ answer: "She doesn't like tea.", focus: ["does", "not"] });
    expect(matchLessonAnswer("She don't like tea.", old).kind).toBe("no_match");
    expect(matchLessonAnswer("She doesn't like tee.", old).kind).toBe("no_match");
  });

  it("focus dosłowny w jednym wariancie, a w drugim nie: tolerancja tylko wobec pierwszego", () => {
    const k = writtenKey({ answer: "She does not like tea.", acceptedAnswers: ["She doesn't like tea."], focus: ["does", "not"] });
    expect(matchLessonAnswer("She does not like tee.", k).kind).toBe("minor_typo");
    expect(matchLessonAnswer("She don't like tea.", k).kind).toBe("no_match");
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

  it("sequence: klucz → true, inna kolejność → false, nie-permutacja → null", () => {
    const key = writtenKey({ exerciseType: "lesson_order", itemIds: ["a", "b", "c"] });
    expect(evaluateSequence(["a", "b", "c"], key)).toBe(true);
    expect(evaluateSequence(["a", "c", "b"], key)).toBe(false); // zła kolejność
    expect(evaluateSequence(["a", "b"], key)).toBeNull(); // brakujący
    expect(evaluateSequence(["a", "b", "c", "d"], key)).toBeNull(); // nadmiarowy
    expect(evaluateSequence(["a", "a", "c"], key)).toBeNull(); // powtórzony klocek bez itemValues
  });

  it("sequence: klocki o tym samym tekście są zamienne (#298)", () => {
    const key = writtenKey({
      exerciseType: "lesson_order",
      itemIds: ["t1", "c", "s", "t2", "d"],
      itemValues: { t1: "the", c: "cat", s: "saw", t2: "the", d: "dog" },
    });
    expect(evaluateSequence(["t2", "c", "s", "t1", "d"], key)).toBe(true); // zamienione identyczne klocki
    expect(evaluateSequence(["t1", "d", "s", "t2", "c"], key)).toBe(false); // inna kolejność słów
    expect(evaluateSequence(["t1", "c", "s", "t1", "d"], key)).toBeNull(); // ten sam klocek dwa razy
    expect(evaluateSequence(["t1", "c", "s", "x", "d"], key)).toBeNull(); // obcy klocek
  });

  it("keywords: poprawne tylko gdy każde wybrane pojęcie jest kluczowe, zakres wyborów nieoceniany", () => {
    const key = writtenKey({ exerciseType: "lesson_keywords", correctOptionIds: ["k1", "k2", "k3"], minSelected: 2, maxSelected: 3 });
    expect(evaluateKeywordSelection(["k2", "k1"], key)).toBe(true); // 2 z 3 kluczowych, kolejność bez znaczenia
    expect(evaluateKeywordSelection(["k1", "k2", "k3"], key)).toBe(true);
    expect(evaluateKeywordSelection(["k1", "d1"], key)).toBe(false); // dystraktor
    expect(evaluateKeywordSelection(["k1"], key)).toBeNull(); // za mało
    expect(evaluateKeywordSelection(["k1", "k2", "k3", "d1"], key)).toBeNull(); // za dużo
    expect(evaluateKeywordSelection(["k1", "k1"], key)).toBeNull(); // powtórzenie
    expect(evaluateKeywordSelection(["k1", "k2"], writtenKey({ exerciseType: "lesson_keywords" }))).toBeNull(); // brak klucza
  });
});

describe("validateVerdict — walidacja werdyktu modelu (Zod)", () => {
  const ctx = { allowedCategories: ["wrong_verb_form", "missing_ending"] as const, childAnswer: "He play football" };

  it("poprawny incorrect z kategorią celu i fragmentem obecnym w odpowiedzi", () => {
    const v = validateVerdict({ verdict: "incorrect", errorCategory: "wrong_verb_form", fragments: ["play"], note: "brak -s", usesTargetForm: true }, ctx);
    expect(v).not.toBeNull();
    expect(v?.verdict).toBe("incorrect");
  });

  it("kategoria spoza listy → null", () => {
    expect(validateVerdict({ verdict: "incorrect", errorCategory: "banana", fragments: ["play"], note: "", usesTargetForm: true }, ctx)).toBeNull();
  });

  it("kategoria other jest dozwolona", () => {
    const v = validateVerdict({ verdict: "incorrect", errorCategory: "other", fragments: ["play"], note: "", usesTargetForm: true }, ctx);
    expect(v).not.toBeNull();
  });

  it("correct z kategorią → null", () => {
    expect(validateVerdict({ verdict: "correct", errorCategory: "wrong_verb_form", fragments: [], note: "", usesTargetForm: true }, ctx)).toBeNull();
  });

  it("correct z fragmentem → null", () => {
    expect(validateVerdict({ verdict: "correct", errorCategory: null, fragments: ["play"], note: "", usesTargetForm: true }, ctx)).toBeNull();
  });

  it("correct czysty → ok", () => {
    expect(validateVerdict({ verdict: "correct", errorCategory: null, fragments: [], note: "ok", usesTargetForm: true }, ctx)).not.toBeNull();
  });

  it("incorrect bez kategorii (null) → null", () => {
    expect(validateVerdict({ verdict: "incorrect", errorCategory: null, fragments: ["play"], note: "", usesTargetForm: true }, ctx)).toBeNull();
  });

  it("fragment nieobecny w odpowiedzi → null", () => {
    expect(validateVerdict({ verdict: "incorrect", errorCategory: "other", fragments: ["swims"], note: "", usesTargetForm: true }, ctx)).toBeNull();
  });

  it("fragment z inną wielkością liter → odrzucony (porównanie z rozróżnieniem wielkości)", () => {
    expect(validateVerdict({ verdict: "incorrect", errorCategory: "other", fragments: ["Play"], note: "", usesTargetForm: true }, ctx)).toBeNull();
  });

  it("5 fragmentów (> 4) → null", () => {
    expect(
      validateVerdict({ verdict: "incorrect", errorCategory: "other", fragments: ["H", "e", "p", "l", "a"], note: "", usesTargetForm: true }, ctx),
    ).toBeNull();
  });

  it("note > 300 → null (odrzucenie, nie obcięcie)", () => {
    const note = "x".repeat(301);
    expect(validateVerdict({ verdict: "incorrect", errorCategory: "other", fragments: ["play"], note, usesTargetForm: true }, ctx)).toBeNull();
  });

  it("brak pola verdict → null", () => {
    expect(validateVerdict({ errorCategory: null, fragments: [], note: "", usesTargetForm: true }, ctx)).toBeNull();
  });

  it("verdict spoza listy → null", () => {
    expect(validateVerdict({ verdict: "maybe", errorCategory: null, fragments: [], note: "", usesTargetForm: true }, ctx)).toBeNull();
  });

  it("nadmiarowe pole ignorowane, ale nie przekazywane dalej", () => {
    const v = validateVerdict(
      { verdict: "almost", errorCategory: null, fragments: ["play"], note: "", usesTargetForm: true, extra: "ignore" } as unknown,
      ctx,
    );
    expect(v).not.toBeNull();
    expect(v && Object.keys(v).sort()).toEqual(["errorCategory", "fragments", "note", "usesTargetForm", "verdict"]);
  });

  it("brak albo zły typ usesTargetForm (grader-v2) → null", () => {
    expect(validateVerdict({ verdict: "correct", errorCategory: null, fragments: [], note: "" }, ctx)).toBeNull();
    expect(validateVerdict({ verdict: "correct", errorCategory: null, fragments: [], note: "", usesTargetForm: "yes" }, ctx)).toBeNull();
    expect(validateVerdict({ verdict: "correct", errorCategory: null, fragments: [], note: "", usesTargetForm: false }, ctx)?.usesTargetForm).toBe(false);
  });

  it("wejście nie-obiekt → null", () => {
    expect(validateVerdict("not an object", ctx)).toBeNull();
    expect(validateVerdict(null, ctx)).toBeNull();
    expect(validateVerdict(42, ctx)).toBeNull();
  });

  it("pusty fragment → null", () => {
    expect(validateVerdict({ verdict: "incorrect", errorCategory: "other", fragments: [""], note: "", usesTargetForm: true }, ctx)).toBeNull();
  });

  it("almost z kategorią celu jest WERDYKTEM POPRAWNYM pod względem kształtu (walidacja go nie odrzuca; ocenę rozstrzyga gradeFromVerdict)", () => {
    const v = validateVerdict({ verdict: "almost", errorCategory: "missing_ending", fragments: ["play"], note: "", usesTargetForm: true }, ctx);
    expect(v).not.toBeNull();
    expect(v?.errorCategory).toBe("missing_ending");
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
    expect(gradeFromVerdict({ verdict: "correct", errorCategory: null, fragments: [], note: "", usesTargetForm: true })).toEqual({
      outcome: "correct",
      verdict: "model_correct",
    });
  });

  it("werdykt almost bez kategorii (błąd poza celem / drobna nieścisłość) → correct/model_almost", () => {
    expect(gradeFromVerdict({ verdict: "almost", errorCategory: null, fragments: [], note: "", usesTargetForm: true })).toEqual({
      outcome: "correct",
      verdict: "model_almost",
    });
  });

  it("werdykt almost z kategorią other (błąd poza sprawdzanym elementem) → nadal correct/model_almost", () => {
    expect(gradeFromVerdict({ verdict: "almost", errorCategory: "other", fragments: ["play"], note: "", usesTargetForm: true })).toEqual({
      outcome: "correct",
      verdict: "model_almost",
    });
  });

  it("werdykt almost z kategorią celu (błąd DOTYCZY sprawdzanej reguły) → NIE zalicza (incorrect/model_incorrect + errorCategory)", () => {
    // 'he play' almost+missing_ending: model stwierdza brak sprawdzanej końcówki.
    // Spójne z tolerancją literówki (literówka nie może dotyczyć focusa) — tu też
    // błąd na sprawdzanym elemencie nie może dać sukcesu reguły (wymóg 6.4/6.9).
    expect(
      gradeFromVerdict({ verdict: "almost", errorCategory: "missing_ending", fragments: ["play"], note: "", usesTargetForm: true }),
    ).toEqual({ outcome: "incorrect", verdict: "model_incorrect", errorCategory: "missing_ending" });
  });

  it("werdykt incorrect z kategorią celu → incorrect/model_incorrect + errorCategory", () => {
    expect(
      gradeFromVerdict({ verdict: "incorrect", errorCategory: "wrong_verb_form", fragments: ["play"], note: "", usesTargetForm: true }),
    ).toEqual({ outcome: "incorrect", verdict: "model_incorrect", errorCategory: "wrong_verb_form" });
  });

  it("werdykt incorrect z kategorią other → unevaluated/model_other", () => {
    expect(gradeFromVerdict({ verdict: "incorrect", errorCategory: "other", fragments: ["play"], note: "", usesTargetForm: true })).toEqual({
      outcome: "unevaluated",
      verdict: "model_other",
    });
  });

  it("bez ćwiczonej formy: correct albo almost poza celem z usesTargetForm=false → model_off_target (#360)", () => {
    const offTarget = { outcome: "unevaluated", verdict: "model_off_target" };
    expect(gradeFromVerdict({ verdict: "correct", errorCategory: null, fragments: [], note: "", usesTargetForm: false })).toEqual(offTarget);
    expect(gradeFromVerdict({ verdict: "almost", errorCategory: null, fragments: [], note: "", usesTargetForm: false })).toEqual(offTarget);
    expect(gradeFromVerdict({ verdict: "almost", errorCategory: "other", fragments: ["play"], note: "", usesTargetForm: false })).toEqual(offTarget);
  });

  it("błąd celu i other nie zależą od usesTargetForm", () => {
    expect(gradeFromVerdict({ verdict: "almost", errorCategory: "missing_ending", fragments: ["play"], note: "", usesTargetForm: false }))
      .toEqual({ outcome: "incorrect", verdict: "model_incorrect", errorCategory: "missing_ending" });
    expect(gradeFromVerdict({ verdict: "incorrect", errorCategory: "other", fragments: ["play"], note: "", usesTargetForm: false }))
      .toEqual({ outcome: "unevaluated", verdict: "model_other" });
  });

  it("brak oceny (null) → unevaluated + technical + unavailable", () => {
    expect(gradeFromVerdict(null)).toEqual({ outcome: "unevaluated", reason: "technical", verdict: "unavailable" });
  });
});

describe("closestApprovedVariant — najbliższy zatwierdzony wariant (oryginalny zapis)", () => {
  it("zwraca wariant o najmniejszej odległości tokenowej, oryginalny zapis", () => {
    const key = writtenKey({ answer: "He plays football", acceptedAnswers: ["He plays soccer"], focus: ["plays"] });
    expect(closestApprovedVariant("He plays socer", key)).toBe("He plays soccer");
  });

  it("remis → pierwszy w kolejności answer, ...acceptedAnswers", () => {
    const key = writtenKey({ answer: "abd", acceptedAnswers: ["abe"], focus: ["x"] });
    expect(closestApprovedVariant("abc", key)).toBe("abd");
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

describe("werdykt szkolny dwuwymiarowy (Etap 2)", () => {
  const CTX = { requiredElementIds: ["e1", "e2"], childAnswer: "Roślina wytwarza cukry i uparcie opowiada o pogodzie" };

  it("przyjmuje poprawny werdykt i zachowuje oba wymiary", () => {
    const v = validateSchoolVerdict({
      knowledge: "correct", precision: "verbose",
      matchedElementIds: ["e1", "e2"], missingElementIds: [],
      incorrectStatements: [], redundantFragments: ["opowiada o pogodzie"], note: "ok",
    }, CTX);
    expect(v?.knowledge).toBe("correct");
    expect(v?.precision).toBe("verbose");
  });

  it("odrzuca correct z brakami i nieznany element; fragment spoza odpowiedzi tylko pomija", () => {
    const base = {
      precision: "concise", matchedElementIds: ["e1"], missingElementIds: ["e2"],
      incorrectStatements: [], redundantFragments: [], note: "",
    };
    expect(validateSchoolVerdict({ ...base, knowledge: "correct" }, CTX)).toBeNull();
    expect(validateSchoolVerdict({ ...base, knowledge: "partial", matchedElementIds: ["e9"] }, CTX)).toBeNull();
    const kept = validateSchoolVerdict({ ...base, knowledge: "partial", redundantFragments: ["nie ma tego w odpowiedzi"] }, CTX);
    expect(kept?.knowledge).toBe("partial");
    expect(kept?.redundantFragments).toEqual([]);
  });

  it("pomija wadliwy fragment zamiast unieważniać ocenę wiedzy (AC-11, AC-12, AC-14)", () => {
    const ok = { knowledge: "correct", precision: "verbose", matchedElementIds: ["e1", "e2"], missingElementIds: [], incorrectStatements: [], note: "" };
    const v = validateSchoolVerdict({ ...ok, redundantFragments: ["nie ma tego w odpowiedzi", "opowiada o pogodzie"] }, CTX);
    expect(v?.knowledge).toBe("correct");
    expect(v?.redundantFragments).toEqual(["opowiada o pogodzie"]);
    // siedem fragmentów: zostają cztery pierwsze poprawne, powtórzenie i pusty odpadają
    const many = validateSchoolVerdict({ ...ok, redundantFragments: ["Roślina", "Roślina", "", "wytwarza", "cukry", "uparcie", "opowiada"] }, CTX);
    expect(many?.redundantFragments).toEqual(["Roślina", "wytwarza", "cukry", "uparcie"]);
    // zbędny nachodzący na nie na temat: zostaje wcześniejsza kategoria
    const overlap = validateSchoolVerdict({ ...ok, redundantFragments: ["uparcie opowiada"], offTopicFragments: ["opowiada o pogodzie"] }, CTX);
    expect(overlap?.redundantFragments).toEqual(["uparcie opowiada"]);
    expect(overlap?.offTopicFragments).toEqual([]);
    // wszystkie fragmenty wadliwe: ocena zostaje, listy puste (nie ma czego skracać)
    const none = validateSchoolVerdict({ ...ok, redundantFragments: ["zmyślony fragment"], offTopicFragments: ["inny zmyślony"] }, CTX);
    expect(none).toMatchObject({ knowledge: "correct", precision: "verbose", redundantFragments: [], offTopicFragments: [] });
  });

  it("reguły wiedzy zostają odrzucające, a niedosłowne błędne stwierdzenie nadal jest luką (AC-13)", () => {
    const full = { precision: "concise", matchedElementIds: ["e1", "e2"], missingElementIds: [], redundantFragments: [], note: "" };
    expect(validateSchoolVerdict({ ...full, knowledge: "correct", incorrectStatements: ["tego nie ma"] }, CTX)).toBeNull();
    const partial = validateSchoolVerdict({ ...full, knowledge: "partial", incorrectStatements: ["tego nie ma"] }, CTX);
    expect(partial?.incorrectStatements).toEqual([]);
    expect(gradeFromSchoolVerdict(partial!)).toMatchObject({ verdict: "model_almost", errorCategory: "wrong_fact" });
    // `incorrect` bez żadnej widocznej luki po odsianiu zostaje nieoceniony; z brakującym elementem — oceniony
    expect(validateSchoolVerdict({ ...full, knowledge: "incorrect", incorrectStatements: ["tego nie ma"] }, CTX)).toBeNull();
    const missing = validateSchoolVerdict({ ...full, knowledge: "incorrect", matchedElementIds: ["e1"], missingElementIds: ["e2"], incorrectStatements: ["tego nie ma"] }, CTX);
    expect(gradeFromSchoolVerdict(missing!)).toMatchObject({ verdict: "model_incorrect", errorCategory: "incomplete" });
  });

  it("wymaga pełnego pokrycia elementów: correct bez wymienienia e2 jest odrzucany (K1)", () => {
    const base = { precision: "concise", incorrectStatements: [], redundantFragments: [], note: "" };
    // e2 ani w matched, ani w missing — werdykt nie może zaliczyć wiedzy.
    expect(validateSchoolVerdict({ ...base, knowledge: "correct", matchedElementIds: ["e1"], missingElementIds: [] }, CTX)).toBeNull();
    expect(validateSchoolVerdict({ ...base, knowledge: "correct", matchedElementIds: [], missingElementIds: [] }, CTX)).toBeNull();
    expect(validateSchoolVerdict({ ...base, knowledge: "incorrect", matchedElementIds: ["e1"], missingElementIds: [] }, CTX)).toBeNull();
  });

  it("partial bez braków i bez błędnych stwierdzeń jest odrzucany, a z nieścisłością przyjmowany (W1)", () => {
    const base = { precision: "concise", matchedElementIds: ["e1", "e2"], missingElementIds: [], redundantFragments: [], note: "" };
    expect(validateSchoolVerdict({ ...base, knowledge: "partial", incorrectStatements: [] }, CTX)).toBeNull();
    const v = validateSchoolVerdict({ ...base, knowledge: "partial", incorrectStatements: ["uparcie"] }, CTX);
    expect(v?.knowledge).toBe("partial");
  });

  it("formOk=false klamruje precyzję concise do verbose, bez zmiany wiedzy", () => {
    const v = validateSchoolVerdict({
      knowledge: "correct", precision: "concise",
      matchedElementIds: ["e1", "e2"], missingElementIds: [],
      incorrectStatements: [], redundantFragments: [], note: "",
    }, { ...CTX, formOk: false });
    expect(v?.precision).toBe("verbose");
    expect(v?.knowledge).toBe("correct");
  });

  it("precyzja nigdy nie zmienia mapowania wiedzy", () => {
    for (const precision of ["concise", "verbose", "unfocused"] as const) {
      const base = { precision, matchedElementIds: ["e1", "e2"], missingElementIds: [], incorrectStatements: [], redundantFragments: [], note: "" };
      expect(gradeFromSchoolVerdict(validateSchoolVerdict({ ...base, knowledge: "correct" }, CTX)!).outcome).toBe("correct");
      expect(gradeFromSchoolVerdict(validateSchoolVerdict({ ...base, knowledge: "partial", matchedElementIds: ["e1"], missingElementIds: ["e2"] }, CTX)!).outcome).toBe("incorrect");
    }
    expect(gradeFromSchoolVerdict(null)).toEqual({ outcome: "unevaluated", reason: "technical", verdict: "unavailable" });
  });

  it("liczy zdania deterministycznie", () => {
    expect(countSentences("")).toBe(0);
    expect(countSentences("Jedno zdanie")).toBe(1);
    expect(countSentences("Roślina bierze światło. Bierze też wodę. I robi cukry.")).toBe(3);
    expect(countSentences("Roślina bierze światło! Robi cukry")).toBe(2);
    expect(countSentences("Roślina wytwarza np. cukry.")).toBe(1);
    expect(countSentences("Roślina potrzebuje (np. światła).")).toBe(1);
    expect(countSentences("Mówi się „m.in. o liściach”.")).toBe(1);
    expect(countSentences("Rośliny m.in. wytwarzają cukry, tzn. pokarm.")).toBe(1);
    expect(countSentences("W 966 r. Mieszko I przyjął chrzest.")).toBe(1);
    expect(countSentences("Szczyt ma 2499 m n.p.m. i jest najwyższy w Polsce.")).toBe(1);
    expect(countSentences("Woda wrze w 99.5 stopnia na tej wysokości.")).toBe(1);
    expect(countSentences("Rośliny rosną (szybko.) Potem kwitną.")).toBe(2);
  });
});
describe("werdykt szkolny v3: kategorie fragmentów i pomylone pojęcia (Etap 6)", () => {
  const CTX = {
    requiredElementIds: ["e1"],
    childAnswer: "Równoleżnik łączy bieguny. To ważna linia na mapie. Wczoraj grałem w piłkę.",
  };
  const base = {
    precision: "unfocused", matchedElementIds: [], missingElementIds: ["e1"],
    incorrectStatements: [], redundantFragments: [], note: "",
  };

  it("werdykt v2 bez nowych pól ma puste listy v3", () => {
    const v = validateSchoolVerdict({ ...base, knowledge: "incorrect", incorrectStatements: ["Równoleżnik łączy bieguny."] }, CTX);
    expect(v?.offTopicFragments).toEqual([]);
    expect(v?.confusedConcepts).toEqual([]);
  });

  it("przyjmuje fragment nie na temat i parę pomylonych pojęć z odpowiedzi", () => {
    const v = validateSchoolVerdict({
      ...base, knowledge: "incorrect",
      incorrectStatements: ["Równoleżnik łączy bieguny."],
      redundantFragments: ["To ważna linia na mapie."],
      offTopicFragments: ["Wczoraj grałem w piłkę."],
      confusedConcepts: [{ said: "równoleżnik", meant: "południk" }],
    }, CTX);
    expect(v?.offTopicFragments).toEqual(["Wczoraj grałem w piłkę."]);
    expect(v?.confusedConcepts).toEqual([{ said: "równoleżnik", meant: "południk" }]);
    expect(gradeFromSchoolVerdict(v)).toMatchObject({ outcome: "incorrect", errorCategory: "confused_concept" });
  });

  it("pomylenie pojęć przy częściowej wiedzy też ma kategorię confused_concept", () => {
    const v = validateSchoolVerdict({
      knowledge: "partial", precision: "concise", matchedElementIds: ["e1"], missingElementIds: [],
      incorrectStatements: ["Równoleżnik łączy bieguny."], redundantFragments: [], note: "",
      confusedConcepts: [{ said: "Równoleżnik", meant: "południk" }],
    }, CTX);
    expect(gradeFromSchoolVerdict(v)).toMatchObject({ verdict: "model_almost", errorCategory: "confused_concept" });
  });

  it("odrzuca pomylenie przy wiedzy poprawnej, `said` spoza odpowiedzi i parę identycznych pojęć", () => {
    const correct = { knowledge: "correct", precision: "concise", matchedElementIds: ["e1"], missingElementIds: [], incorrectStatements: [], redundantFragments: [], note: "" };
    expect(validateSchoolVerdict({ ...correct, confusedConcepts: [{ said: "równoleżnik", meant: "południk" }] }, CTX)).toBeNull();
    const wrong = { ...base, knowledge: "incorrect", incorrectStatements: ["Równoleżnik łączy bieguny."] };
    expect(validateSchoolVerdict({ ...wrong, confusedConcepts: [{ said: "zwrotnik", meant: "południk" }] }, CTX)).toBeNull();
    expect(validateSchoolVerdict({ ...wrong, confusedConcepts: [{ said: "Równoleżnik", meant: "równoleżnik" }] }, CTX)).toBeNull();
  });

  it("ten sam fragment w dwóch kategoriach zostaje w pierwszej, a fragment spoza odpowiedzi odpada", () => {
    const wrong = { ...base, knowledge: "incorrect", incorrectStatements: ["Równoleżnik łączy bieguny."] };
    expect(validateSchoolVerdict({ ...wrong, redundantFragments: ["Wczoraj grałem w piłkę."], offTopicFragments: ["Wczoraj grałem w piłkę."] }, CTX))
      .toMatchObject({ redundantFragments: ["Wczoraj grałem w piłkę."], offTopicFragments: [] });
    expect(validateSchoolVerdict({ ...wrong, offTopicFragments: ["Równoleżnik łączy bieguny."] }, CTX))
      .toMatchObject({ incorrectStatements: ["Równoleżnik łączy bieguny."], offTopicFragments: [] });
    expect(validateSchoolVerdict({ ...wrong, offTopicFragments: ["Grałem w szachy."] }, CTX)).toMatchObject({ knowledge: "incorrect", offTopicFragments: [] });
  });

  it("wiedza częściowa z samym pomyleniem pojęć (komplet elementów) jest przyjmowana", () => {
    const v = validateSchoolVerdict({
      knowledge: "partial", precision: "concise", matchedElementIds: ["e1"], missingElementIds: [],
      incorrectStatements: [], redundantFragments: [], note: "",
      confusedConcepts: [{ said: "Równoleżnik", meant: "południk" }],
    }, CTX);
    expect(v?.knowledge).toBe("partial");
    expect(gradeFromSchoolVerdict(v)).toMatchObject({ errorCategory: "confused_concept" });
  });

  it("pary pomylonych pojęć są przycinane i liczone raz", () => {
    const v = validateSchoolVerdict({
      ...base, knowledge: "incorrect", incorrectStatements: ["Równoleżnik łączy bieguny."],
      confusedConcepts: [{ said: " Równoleżnik ", meant: "południk" }, { said: "równoleżnik", meant: "Południk" }],
    }, CTX);
    expect(v?.confusedConcepts).toEqual([{ said: "Równoleżnik", meant: "południk" }]);
    expect(validateSchoolVerdict({
      ...base, knowledge: "incorrect", incorrectStatements: ["Równoleżnik łączy bieguny."],
      confusedConcepts: [{ said: "południk", meant: "południk " }],
    }, { ...CTX, childAnswer: `${CTX.childAnswer} południk` })).toBeNull();
  });

  it("pomija fragment nachodzący na fragment innej kategorii (błędne stwierdzenie ma pierwszeństwo)", () => {
    const wrong = { ...base, knowledge: "incorrect", incorrectStatements: ["Równoleżnik łączy bieguny."] };
    expect(validateSchoolVerdict({ ...wrong, offTopicFragments: ["łączy bieguny"] }, CTX)).toMatchObject({ incorrectStatements: wrong.incorrectStatements, offTopicFragments: [] });
    expect(validateSchoolVerdict({ ...wrong, redundantFragments: ["bieguny. To ważna"] }, CTX)).toMatchObject({ incorrectStatements: wrong.incorrectStatements, redundantFragments: [] });
    // zakresy jak w segmentatorze: bez wielkości liter („Kot” i „kot” to to samo pierwsze słowo)
    const cat = { requiredElementIds: ["e1"], childAnswer: "Kot kot" };
    expect(validateSchoolVerdict({ ...base, knowledge: "incorrect", incorrectStatements: ["Kot"], offTopicFragments: ["kot"] }, cat))
      .toMatchObject({ incorrectStatements: ["Kot"], offTopicFragments: [] });
    // w obrębie jednej kategorii nachodzenie jest dozwolone (segmenty się scalają)
    expect(validateSchoolVerdict({ ...wrong, offTopicFragments: ["Wczoraj grałem", "grałem w piłkę."] }, CTX)?.offTopicFragments).toHaveLength(2);
  });

  it("segmenty rozróżniają zbędne (pill) i nie na temat (offtopic)", () => {
    expect(buildAnswerSegments("Linia na mapie. Grałem w piłkę.", ["Linia na mapie."], ["Grałem w piłkę."])).toEqual([
      { text: "Linia na mapie.", state: "pill" },
      { text: " ", state: "plain" },
      { text: "Grałem w piłkę.", state: "offtopic" },
    ]);
  });
});

describe("evaluateAssignment (design szkoły §10.3)", () => {
  const base = { exerciseType: "lesson_match" as const, objectiveId: "o", answer: "a", acceptedAnswers: [], focus: [] };
  const matchKey = {
    ...base,
    assignments: [{ itemId: "l1", targetId: "r1" }, { itemId: "l2", targetId: "r2" }, { itemId: "l3", targetId: "r3" }],
    targetIds: ["r1", "r2", "r3", "rx"],
    targetOnce: true,
  };

  it("komplet zgodnych przypisań jest poprawny, a jedna zamiana — błędna", () => {
    expect(evaluateAssignment([{ itemId: "l2", targetId: "r2" }, { itemId: "l1", targetId: "r1" }, { itemId: "l3", targetId: "r3" }], matchKey)).toBe(true);
    expect(evaluateAssignment([{ itemId: "l1", targetId: "r2" }, { itemId: "l2", targetId: "r1" }, { itemId: "l3", targetId: "r3" }], matchKey)).toBe(false);
    expect(evaluateAssignment([{ itemId: "l1", targetId: "rx" }, { itemId: "l2", targetId: "r2" }, { itemId: "l3", targetId: "r3" }], matchKey)).toBe(false);
  });

  it("kształt niezgodny z zadaniem daje null (błąd klienta, nie wiedzy)", () => {
    expect(evaluateAssignment([{ itemId: "l1", targetId: "r1" }, { itemId: "l2", targetId: "r2" }], matchKey)).toBeNull();
    expect(evaluateAssignment([{ itemId: "l1", targetId: "r1" }, { itemId: "l2", targetId: "r2" }, { itemId: "l9", targetId: "r3" }], matchKey)).toBeNull();
    expect(evaluateAssignment([{ itemId: "l1", targetId: "r1" }, { itemId: "l2", targetId: "r2" }, { itemId: "l3", targetId: "r9" }], matchKey)).toBeNull();
    expect(evaluateAssignment([{ itemId: "l1", targetId: "r1" }, { itemId: "l2", targetId: "r1" }, { itemId: "l3", targetId: "r3" }], matchKey)).toBeNull();
    expect(evaluateAssignment([{ itemId: "l1", targetId: "r1" }], { ...base })).toBeNull();
  });

  it("w grupach cel można użyć wielokrotnie", () => {
    const groupKey = {
      ...base, exerciseType: "lesson_group" as const,
      assignments: [{ itemId: "i1", targetId: "g1" }, { itemId: "i2", targetId: "g1" }, { itemId: "i3", targetId: "g2" }, { itemId: "i4", targetId: "g2" }],
      targetIds: ["g1", "g2"],
    };
    expect(evaluateAssignment([{ itemId: "i1", targetId: "g1" }, { itemId: "i2", targetId: "g1" }, { itemId: "i3", targetId: "g2" }, { itemId: "i4", targetId: "g2" }], groupKey)).toBe(true);
    expect(evaluateAssignment([{ itemId: "i1", targetId: "g1" }, { itemId: "i2", targetId: "g2" }, { itemId: "i3", targetId: "g2" }, { itemId: "i4", targetId: "g2" }], groupKey)).toBe(false);
  });
});

describe("assignmentText", () => {
  const values = { l1: "woda", l2: "światło", r1: "korzenie", r2: "energia", g1: "substraty", g2: "produkty" };
  it("pary w kolejności lewej kolumny", () => {
    expect(assignmentText([{ itemId: "l2", targetId: "r2" }, { itemId: "l1", targetId: "r1" }], values, { itemOrder: ["l1", "l2"] }))
      .toBe("woda → korzenie; światło → energia");
  });
  it("grupy w kolejności grup, z pominięciem pustych", () => {
    expect(assignmentText([{ itemId: "l1", targetId: "g2" }, { itemId: "l2", targetId: "g2" }], values, { grouped: true, targetOrder: ["g1", "g2"], itemOrder: ["l2", "l1"] }))
      .toBe("produkty: światło, woda");
  });
  it("pomija przypisania z nieznanym tekstem", () => {
    expect(assignmentText([{ itemId: "x", targetId: "r1" }], values)).toBe("");
  });
});

describe("matchLessonAnswer — Present Continuous (neutralna normalizacja)", () => {
  const pcKey = (answer: string, focus: readonly string[]) => writtenKey({ answer, focus });

  it("klucz „He is playing now.” zalicza małe litery i wersaliki bez kropki; skrót ocenia model", () => {
    const key = pcKey("He is playing now.", ["is", "playing"]);
    for (const answer of ["he is playing now", "HE IS PLAYING NOW"]) {
      expect(matchLessonAnswer(answer, key).kind, answer).toBe("exact");
    }
    expect(matchLessonAnswer("He's playing now.", key).kind).toBe("no_match");
  });

  it("klucz „isn't watching” nie zalicza bez modelu „is not watching”, „isnt watching” ani „watching”", () => {
    const key = pcKey("isn't watching", ["isn't", "watching"]);
    expect(matchLessonAnswer("is not watching", key).kind).toBe("no_match");
    expect(matchLessonAnswer("isnt watching", key).kind).toBe("no_match");
    expect(matchLessonAnswer("watching", key).kind).toBe("no_match");
  });

  it("klucz „is playing” nie zalicza samego „playing”", () => {
    expect(matchLessonAnswer("playing", pcKey("is playing", ["is", "playing"])).kind).toBe("no_match");
  });

  it("skrót po rzeczowniku „Mum's” nie dopasowuje się deterministycznie", () => {
    // Normalizator nie rozwija „Mum's” (rzeczownik), więc taka odpowiedź trafia do
    // modelu oceniającego, gdy jest skonfigurowany (spec Present Continuous §6.3).
    const key = pcKey("Mum is cooking now.", ["is", "cooking"]);
    expect(matchLessonAnswer("Mum's cooking now.", key).kind).toBe("no_match");
  });
});
