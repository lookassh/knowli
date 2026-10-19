import { describe, expect, it } from "vitest";
import { selectTask, type ScheduleCandidate } from "./scheduler";
import { assessedSkills, evaluateChoice } from "./evaluate";
import { computeTargetKey } from "./target-key";
import { getVocabularyCapabilities } from "./vocabulary-capabilities";
import { LEARNING_V1_POLICY as policy } from "../policies/learning-v1";

function numbers(count = 3): ScheduleCandidate[] {
  return Array.from({ length: count }, (_, position) => ({
    itemRevisionId: `rev-${position}`, itemId: `item-${position}`, position,
    target: `number ${position}`, source: `liczba ${position}`, targetLocale: "en-GB", acceptedAnswers: [],
    visual: { kind: "number" as const, count: position },
    progress: {}, failuresThisSession: 0, supportedThisSession: false,
    usedThisSession: 0, presentationsThisSession: 0, lastContactAt: null, lastUsedOrdinal: null,
    readingDirections: {}, practiceMix: { listening: 0, reading: 0 },
    introducedSkills: { recall: true, pronunciation: true },
  }));
}

/** Poznane elementy — pula pytań obrazkowego treningu (arch §9.3). */
function presented(candidates: ScheduleCandidate[]): ScheduleCandidate[] {
  for (const item of candidates) {
    item.ownPresentationCompleted = true;
    item.presentationsThisSession = 1;
    item.usedThisSession = 1;
  }
  return candidates;
}

function input(candidates: ScheduleCandidate[], extra: Partial<Parameters<typeof selectTask>[0]> = {}) {
  return {
    candidates, peers: candidates, now: "2026-10-19T12:00:00.000Z", policy,
    canRead: false, vocabularyFormat: "picture" as const, microphoneEnabled: false,
    supportsPictureVocabulary: true, supportsPictureRecognition: true,
    assessedRemaining: 24, nextOrdinal: 2, reservedTargetKeys: [], ...extra,
  };
}

describe("picture_recognition: dostępność i ocena", () => {
  it("capabilities: tylko nieczytający w zestawie picture z flagą klienta", () => {
    expect(getVocabularyCapabilities({ canRead: false, microphoneEnabled: false })).toEqual({
      skills: ["listening"], exerciseTypes: ["exposure", "listening"],
    });
    expect(getVocabularyCapabilities({ canRead: false, microphoneEnabled: false, vocabularyFormat: "picture" }))
      .toEqual({ skills: ["listening"], exerciseTypes: ["exposure", "listening"] });
    expect(getVocabularyCapabilities({
      canRead: false, microphoneEnabled: false, vocabularyFormat: "picture", supportsPictureRecognition: true,
    })).toEqual({ skills: ["listening"], exerciseTypes: ["exposure", "listening", "picture_recognition"] });
    expect(getVocabularyCapabilities({
      canRead: true, microphoneEnabled: false, vocabularyFormat: "picture", supportsPictureRecognition: true,
    }).exerciseTypes).not.toContain("picture_recognition");
    expect(getVocabularyCapabilities({
      canRead: false, microphoneEnabled: true, vocabularyFormat: "standard", supportsPictureRecognition: true,
    }).exerciseTypes).not.toContain("picture_recognition");
  });

  it("oceniane jako reading z kierunkiem pojęcie→słowo", () => {
    expect(assessedSkills("picture_recognition")).toEqual(["reading"]);
    const grade = evaluateChoice("option-1", {
      exerciseType: "picture_recognition", target: "horse", acceptedAnswers: [], correctOptionId: "option-1",
    }, { receivedAt: "2026-10-19T12:00:00.000Z", policy, firstTry: true, assistance: [], lastExposureAt: null,
      previousSessionContactAt: null, timezone: "Europe/Warsaw" });
    expect(grade.skills).toMatchObject({
      reading: { outcome: "correct", independent: true, details: { direction: "source_to_target" } },
    });
    const incorrect = evaluateChoice("x", {
      exerciseType: "picture_recognition", target: "horse", acceptedAnswers: [], correctOptionId: "option-2",
    }, { receivedAt: "2026-10-19T12:00:00.000Z", policy, firstTry: true, assistance: [], lastExposureAt: null,
      previousSessionContactAt: null, timezone: "Europe/Warsaw" });
    expect(incorrect.skills).toMatchObject({
      reading: { outcome: "incorrect", details: { direction: "source_to_target" } },
    });
  });
});

describe("picture_recognition: plan schedulera", () => {
  it("naprzemiennie z obrazkowym listening po pierwszym pytaniu słuchowym", () => {
    const candidates = presented(numbers());
    const first = selectTask(input(candidates, { selectionSeed: 0 }));
    expect(first?.exerciseType).toBe("listening");

    // każde słowo ma za sobą pierwsze pytanie słuchowe (SPEC §13: prezentacje
    // przeplatane łatwym rozpoznawaniem); dalsza praktyka miesza typy
    for (const item of candidates) {
      item.usedThisSession = 2;
      item.practiceMix = { listening: 1, reading: 0 };
      item.lastUsedOrdinal = 2;
    }
    const target = candidates.find((item) => item.itemRevisionId === first!.itemRevisionId)!;

    const second = selectTask(input(candidates, { selectionSeed: 0 }));
    expect(second).toMatchObject({ exerciseType: "picture_recognition", direction: "source_to_target", assessed: true });
    expect(second!.itemRevisionId).toBe(target.itemRevisionId);
    // opcje = angielskie słowa (nigdy polskie), unikalne, jedna poprawna
    const texts = second!.options!.map((option) => option.text);
    expect(texts.length).toBeGreaterThanOrEqual(2);
    expect(texts.length).toBeLessThanOrEqual(4);
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts).toContain(target.target);
    expect(texts.every((text) => /^number \d+$/.test(text))).toBe(true);
    expect(second!.options!.filter((option) => option.correct)).toHaveLength(1);
    // ekspozycje obejmują klucze wszystkich pokazanych słów, łącznie z dystraktorami
    const expectedKeys = second!.options!.map((option) =>
      computeTargetKey(candidates.find((item) => item.itemRevisionId === option.itemRevisionId)!.target, "en-GB"));
    expect(second!.revealsTargetKeys).toEqual([...new Set(expectedKeys)]);

    // kolejne tekstowe pytania utrzymują typ; strona słuchowa wraca, gdy
    // słuchowych pytań elementu jest mniej niż tekstowych (miks per element)
    const after = candidates.find((item) => item.itemRevisionId === second!.itemRevisionId)!;
    after.usedThisSession += 1;
    after.practiceMix = { listening: 1, reading: 1 };
    const third = selectTask(input(candidates, { selectionSeed: 0 }));
    expect(third?.exerciseType).toBe("picture_recognition");
    for (const item of candidates) item.practiceMix = { listening: item.practiceMix.listening, reading: 2 };
    const fourth = selectTask(input(candidates, { selectionSeed: 0 }));
    expect(fourth?.exerciseType).toBe("listening");
  });

  it("cel zarezerwowany dla należnego sprawdzenia nie jest opcją ani dystraktorem", () => {
    const candidates = presented(numbers());
    for (const item of candidates) {
      item.usedThisSession = 2;
      item.practiceMix = { listening: 1, reading: 0 };
    }
    const [target] = candidates;
    const reservedKey = computeTargetKey(candidates[2]!.target, candidates[2]!.targetLocale);
    // rezerwacje recall obowiązują w sesji z mikrofonem (bez niego scheduler je zwalnia)
    const plan = selectTask(input(candidates, {
      microphoneEnabled: true, reservedTargetKeys: [reservedKey], selectionSeed: 0,
    }));
    expect(plan?.exerciseType).toBe("picture_recognition");
    expect(plan?.itemRevisionId).toBe(target.itemRevisionId);
    expect(plan?.options?.some((option) => option.itemRevisionId === candidates[2]!.itemRevisionId)).toBe(false);
    expect(plan?.options!.map((option) => option.text)).not.toContain(candidates[2]!.target);
    expect(plan?.revealsTargetKeys).not.toContain(reservedKey);
    expect(plan?.keepsReservations).toContain(reservedKey);
  });

  it("bez flagi klienta typ nie jest planowany (graceful)", () => {
    const candidates = presented(numbers());
    for (const item of candidates) {
      item.usedThisSession = 2;
      item.practiceMix = { listening: 1, reading: 1 };
    }
    const plans = [0, 1, 2, 3].map((selectionSeed) =>
      selectTask(input(candidates, { supportsPictureRecognition: false, selectionSeed })));
    expect(plans.every((plan) => plan?.exerciseType !== "picture_recognition")).toBe(true);
    expect(new Set(plans.map((plan) => plan?.exerciseType))).toEqual(new Set(["listening"]));
  });

  it("czytający nie dostaje picture_recognition nawet z flagą", () => {
    const candidates = presented(numbers());
    for (const item of candidates) {
      item.usedThisSession = 2;
      item.practiceMix = { listening: 1, reading: 1 };
    }
    const plans = [0, 1, 2].map((selectionSeed) =>
      selectTask(input(candidates, { canRead: true, selectionSeed })));
    expect(plans.every((plan) => plan?.exerciseType !== "picture_recognition")).toBe(true);
    expect(plans.map((plan) => plan?.exerciseType)).toEqual(["reading", "reading", "reading"]);
  });

  it("element bez wizualu pomija typ; fallback nie blokuje sesji", () => {
    const candidates = presented(numbers());
    for (const item of candidates) {
      item.usedThisSession = 2;
      item.practiceMix = { listening: 1, reading: 0 };
    }
    const [target] = candidates;
    target.visual = undefined;
    const plan = selectTask(input(candidates, { selectionSeed: 0 }));
    expect(plan?.itemRevisionId).toBe(target.itemRevisionId);
    expect(plan?.exerciseType).not.toBe("picture_recognition");
    expect(plan).toMatchObject({ exerciseType: "exposure", reason: "recognition-fallback" });
    // pozostałe elementy dalej dostają oceniane rozpoznawanie — sesja trwa
    const next = selectTask(input(candidates, { selectionSeed: 1 }));
    expect(next?.assessed).toBe(true);
    expect(["listening", "picture_recognition"]).toContain(next?.exerciseType);
  });

  it("za mała pula angielskich słów nie wymusza losowej odpowiedzi", () => {
    const candidates = presented(numbers(1));
    const plan = selectTask(input(candidates, { selectionSeed: 0 }));
    // brak bezpiecznych opcji rozpoznawania → fallback prezentacji, nigdy
    // zadanie z jedną opcją lub wymuszoną odpowiedzią (SPEC §13)
    expect(plan?.exerciseType).not.toBe("picture_recognition");
    expect(plan).toMatchObject({ exerciseType: "exposure", reason: "recognition-fallback" });
  });

  it("należne powtórki reading nieczytającego nie tłumią fallbacku rozpoznawania", () => {
    const candidates = presented(numbers(1));
    // picture_recognition buduje realny postęp reading; due reading nieczytającego
    // nigdy nie jest jednak planowane (reading poza skills) i nie może odbierać sesji zadań
    candidates[0]!.progress.reading = { status: "learning", streak: 0, nextReviewAt: "2026-10-18T12:00:00.000Z" };
    const plan = selectTask(input(candidates, { selectionSeed: 0 }));
    expect(plan).not.toBeNull();
    expect(plan).toMatchObject({ exerciseType: "exposure", reason: "recognition-fallback" });
  });

  it("dystraktor o wizualu identycznym z celem nigdy nie wchodzi do opcji", () => {
    const candidates = presented(numbers());
    for (const item of candidates) {
      item.usedThisSession = 2;
      item.practiceMix = { listening: 1, reading: 0 };
    }
    // dwa itemy o tym samym wizualu: oba słowa pasują do obrazka, ale tylko
    // jedno jest odpowiedzią — drugie nie może zostać zaliczone jako pomyłka
    candidates[1]!.visual = { kind: "number", count: 0 };
    const plan = selectTask(input(candidates, { selectionSeed: 0 }));
    expect(plan?.exerciseType).toBe("picture_recognition");
    expect(plan?.itemRevisionId).toBe(candidates[0]!.itemRevisionId);
    expect(plan?.options?.some((option) => option.itemRevisionId === candidates[1]!.itemRevisionId)).toBe(false);
    expect(plan?.options?.map((option) => option.text)).toEqual(["number 0", "number 2"]);
  });

  it("cel z wizualem i peerami bez wizuali dostaje picture_recognition, nie fallback", () => {
    const candidates = presented(numbers(2));
    for (const item of candidates) {
      item.usedThisSession = 2;
      item.practiceMix = { listening: 1, reading: 0 };
    }
    // obrazkowy listening jest niewykonalny (brak wizuali u peerów), ale pula
    // angielskich słów wystarcza — to jedyny stan, w którym nowa dysjunkcja
    // w recognitionPossibleWithoutReservations zmienia wynik
    candidates[1]!.visual = undefined;
    const plan = selectTask(input(candidates, { selectionSeed: 0 }));
    expect(plan?.exerciseType).toBe("picture_recognition");
    expect(plan?.itemRevisionId).toBe(candidates[0]!.itemRevisionId);
    // dystraktorem słownym bywa peer bez wizualu — opcje to słowa, nie obrazki
    expect(plan?.options?.map((option) => option.text)).toEqual(["number 0", "number 1"]);
  });
});
