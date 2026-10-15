import { describe, expect, it } from "vitest";
import { selectTask, type ScheduleCandidate, type ScheduleInput } from "./scheduler";
import { LEARNING_V1_POLICY } from "../policies/learning-v1";
import { computeTargetKey } from "./target-key";

function words(count = 8): ScheduleCandidate[] {
  return Array.from({ length: count }, (_, position) => ({
    itemRevisionId: `rev-${position}`, itemId: `item-${position}`, position,
    target: `word-${position}`, source: `słowo-${position}`, targetLocale: "en-GB", acceptedAnswers: [],
    visual: { kind: "color", color: `#${(position + 1).toString(16).repeat(6)}` },
    progress: {}, failuresThisSession: 0, supportedThisSession: false,
    usedThisSession: 0, presentationsThisSession: 0, lastContactAt: null, lastUsedOrdinal: null,
    readingDirections: {}, practiceMix: { listening: 0, reading: 0 },
    introducedSkills: { recall: true, pronunciation: true },
  }));
}
function snapshot(candidates: ScheduleCandidate[], overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return { now: "2026-10-15T12:00:00Z", policy: LEARNING_V1_POLICY,
    vocabularyFormat: "picture", canRead: false, microphoneEnabled: false,
    assessedRemaining: 16, nextOrdinal: 2, reservedTargetKeys: [], candidates, peers: candidates, ...overrides };
}
function present(item: ScheduleCandidate) {
  item.ownPresentationCompleted = true;
  item.usedThisSession = 1;
  item.presentationsThisSession = 1;
}

describe("nieprzewidywalna kolejność nieczytającego", () => {
  it.each(["runtime", "legacy"])("czeka na odstęp po wsparciu (%s), potem wydaje retry", representation => {
    const candidates = words(2);
    candidates.forEach(present);
    const waiting = candidates[0]!;
    waiting.supportedThisSession = true;
    waiting.lastUsedOrdinal = 4;
    if (representation === "runtime") waiting.support = {
      phase: "waiting", cycleId: "support", sourceTaskId: "failure", retryType: "listening",
    };
    for (const selectionSeed of [0, 1, 2, 999]) {
      expect(selectTask(snapshot(candidates, { microphoneEnabled: true, nextOrdinal: 5, selectionSeed })))
        .toMatchObject({ itemRevisionId: "rev-1", exerciseType: "listening" });
      expect(selectTask(snapshot(candidates, { microphoneEnabled: true, nextOrdinal: 6, selectionSeed })))
        .toMatchObject({ itemRevisionId: "rev-0", reason: "retry-after-support" });
    }
  });
  it("z tego samego stanu wybiera oba poznane słowa albo trzecią prezentację", () => {
    const candidates = words();
    candidates.slice(0, 2).forEach(present);
    const plans = [0, 1, 2].map(selectionSeed => selectTask(snapshot(candidates, { selectionSeed })));
    expect(plans.map(plan => [plan?.itemRevisionId, plan?.exerciseType])).toEqual([
      ["rev-0", "listening"], ["rev-1", "listening"], ["rev-2", "exposure"],
    ]);
  });

  it("udana sesja z mikrofonem wprowadza Recall i wymowę po rozpoznawaniu", () => {
    const candidates = words(6);
    candidates.forEach(item => { item.introducedSkills = { recall: false, pronunciation: false }; });
    let remaining = 24;
    const transitions: string[] = [];
    for (let ordinal = 0; ordinal < 40 && remaining > 0; ordinal++) {
      const plan = selectTask(snapshot(candidates, { microphoneEnabled: true, nextOrdinal: ordinal,
        assessedRemaining: remaining, selectionSeed: ordinal * 7 + 2 }));
      expect(plan).not.toBeNull();
      const target = candidates.find(item => item.itemRevisionId === plan!.itemRevisionId)!;
      if (plan!.exerciseType === "exposure") {
        target.ownPresentationCompleted = true;
        target.presentationsThisSession++;
      } else {
        remaining--;
        expect(target.ownPresentationCompleted).toBe(true);
        if (plan!.exerciseType === "listening") {
          target.practiceMix.listening++;
          target.progress.listening = { status: "learning", nextReviewAt: null, streak: 1 };
        } else if (plan!.exerciseType === "recall") {
          expect(target.progress.listening?.streak).toBe(1);
          expect(target.introducedSkills.recall).toBe(false);
          target.introducedSkills.recall = true;
          target.progress.recall = { status: "learning", nextReviewAt: null, streak: 1 };
          transitions.push("recall");
        } else if (plan!.exerciseType === "speech") {
          expect(target.introducedSkills.recall).toBe(true);
          expect(target.introducedSkills.pronunciation).toBe(false);
          target.introducedSkills.pronunciation = true;
          target.progress.pronunciation = { status: "learning", nextReviewAt: null, streak: 1 };
          transitions.push("speech");
        } else throw new Error(`Unexpected exercise ${plan!.exerciseType}`);
      }
      target.usedThisSession++;
      target.lastUsedOrdinal = ordinal;
    }
    expect(remaining).toBe(0);
    expect(transitions).toContain("recall");
    expect(transitions).toContain("speech");
    expect(candidates.filter(item => item.introducedSkills.pronunciation).length).toBeGreaterThanOrEqual(2);
  });

  it.each(["recall", "listening", "pronunciation"] as const)("należne %s zachowuje priorytet dla różnych seedów", skill => {
    const candidates = words(3);
    candidates.forEach(present);
    candidates[1]!.progress[skill] = { status: "learning", nextReviewAt: "2026-10-14T12:00:00Z", streak: 0 };
    for (const selectionSeed of [0, 1, 2, 999]) {
      expect(selectTask(snapshot(candidates, { microphoneEnabled: true, selectionSeed })))
        .toMatchObject({ itemRevisionId: "rev-1", reason: skill === "recall" ? "due-check" : "due-review",
          exerciseType: skill === "pronunciation" ? "speech" : skill });
    }
  });

  it("rezerwacja z mikrofonem wyklucza cel i jego opcję niezależnie od entropii", () => {
    const candidates = words(4);
    candidates.forEach(present);
    const key = computeTargetKey(candidates[0]!.target, "en-GB");
    for (const selectionSeed of [0, 1, 2, 999]) {
      const plan = selectTask(snapshot(candidates, { microphoneEnabled: true, selectionSeed, reservedTargetKeys: [key] }));
      expect(plan?.itemRevisionId).not.toBe("rev-0");
      expect(plan?.options?.map(option => option.itemRevisionId)).not.toContain("rev-0");
      expect(plan?.revealsTargetKeys).not.toContain(key);
      expect(plan?.keepsReservations).toContain(key);
    }
  });

  it.each([2, 9, 37])("przebieg seed=%s łamie FIFO z opóźnieniem o jedno słowo", stream => {
    const candidates = words(8);
    const presentationOrder: string[] = [];
    const questions: { target: string; lag: number }[] = [];
    let remaining = 16;
    for (let ordinal = 0; ordinal < 40 && remaining > 0; ordinal++) {
      const plan = selectTask(snapshot(candidates, { nextOrdinal: ordinal, assessedRemaining: remaining,
        selectionSeed: ordinal * stream + 2 }));
      expect(plan).not.toBeNull();
      const target = candidates.find(item => item.itemRevisionId === plan!.itemRevisionId)!;
      if (plan!.assessed) {
        expect(presentationOrder).toContain(target.itemRevisionId);
        questions.push({ target: target.itemRevisionId,
          lag: presentationOrder.length - 1 - presentationOrder.indexOf(target.itemRevisionId) });
        target.practiceMix.listening++;
        remaining--;
      } else {
        presentationOrder.push(target.itemRevisionId);
        target.presentationsThisSession++;
        target.ownPresentationCompleted = true;
      }
      target.usedThisSession++;
      target.lastUsedOrdinal = ordinal;
    }
    expect(questions).toHaveLength(16);
    expect(questions.some(question => question.lag !== 1)).toBe(true);
    // Również pierwsze pytania, gdy wciąż są nowe słowa, nie powtarzają FIFO A,B,C…
    expect(questions.slice(0, 5).map(question => question.target))
      .not.toEqual(presentationOrder.slice(0, 5));
  });

  it("w jednej dopuszczalnej migawce wybiera najnowsze, przedostatnie i starsze ćwiczone słowo", () => {
    const candidates = words(4);
    candidates.slice(0, 3).forEach(present);
    const presentationOrder = candidates.slice(0, 3).map(item => item.itemRevisionId);
    candidates[0]!.practiceMix.listening = 1;
    candidates[0]!.usedThisSession++;
    const selected = [0, 1, 2].map(selectionSeed => selectTask(snapshot(candidates, { selectionSeed }))?.itemRevisionId);
    expect(selected).toEqual([presentationOrder[1], presentationOrder[2], presentationOrder[0]]);
  });

  it.each([false, true])("prowadzi wielokrokowo osiem słów z mikrofonem=%s", microphoneEnabled => {
    const candidates = words();
    let remaining = 16;
    const asked: number[] = [];
    for (let ordinal = 0; ordinal < 40; ordinal++) {
      const plan = selectTask(snapshot(candidates, { microphoneEnabled, selectionSeed: ordinal * 7 + 2,
        nextOrdinal: ordinal, assessedRemaining: remaining }));
      if (!plan) break;
      const target = candidates.find(item => item.itemRevisionId === plan.itemRevisionId)!;
      if (plan.assessed) {
        expect(target.ownPresentationCompleted).toBe(true);
        remaining--;
        asked.push(target.position);
        target.practiceMix.listening++;
        target.progress.listening = { status: "learning", nextReviewAt: null, streak: 0 };
      } else {
        target.presentationsThisSession++;
        target.ownPresentationCompleted = true;
      }
      target.usedThisSession++;
      target.lastUsedOrdinal = ordinal;
      expect(candidates.filter(item => item.ownPresentationCompleted && item.practiceMix.listening === 0).length).toBeLessThanOrEqual(3);
    }
    expect(remaining).toBe(0);
    expect(asked).toHaveLength(16);
    expect(new Set(asked).size).toBeGreaterThanOrEqual(6);
    expect(asked.some((position, index) => index > 0 && position === asked[index - 1])).toBe(true);
    expect(selectTask(snapshot(candidates, { assessedRemaining: 0 }))).toBeNull();
  });

  it("przy trzech oczekujących nie wprowadza czwartego", () => {
    const candidates = words();
    candidates.slice(0, 3).forEach(present);
    for (let selectionSeed = 0; selectionSeed < 20; selectionSeed++) {
      expect(selectTask(snapshot(candidates, { selectionSeed }))?.exerciseType).toBe("listening");
    }
  });

  it("dopuszcza ponowne ostatnie słowo, lecz ogranicza różnicę liczby pytań", () => {
    const candidates = words(3);
    candidates.forEach(present);
    candidates[0]!.usedThisSession += 1;
    candidates[0]!.practiceMix.listening = 1;
    candidates[0]!.lastUsedOrdinal = 1;
    expect(selectTask(snapshot(candidates, { selectionSeed: 2 }))?.itemRevisionId).toBe("rev-0");
    candidates[0]!.usedThisSession += 1;
    expect([0, 1, 2].map(selectionSeed => selectTask(snapshot(candidates, { selectionSeed }))?.itemRevisionId)).not.toContain("rev-0");
  });

  it("losuje również starsze słowa w znanym zestawie, w pierwszym priorytecie mastery", () => {
    const candidates = words(4);
    candidates.forEach(item => {
      item.progress.listening = { status: "learning", nextReviewAt: null, streak: 0 };
    });
    candidates[3]!.progress.listening!.status = "mastered";
    const plans = [0, 1, 2, 3, 4, 5].map(selectionSeed => selectTask(snapshot(candidates, { selectionSeed })));
    expect(new Set(plans.map(plan => plan?.itemRevisionId))).toEqual(new Set(["rev-0", "rev-1", "rev-2"]));
  });

  it("liczy okno użyć dopiero po odrzuceniu niewykonalnych celów", () => {
    const candidates = words(3);
    candidates.forEach(present);
    candidates[0]!.acceptedAnswers = ["word-1", "word-2"];
    candidates[0]!.recognitionFallbackUsedThisSession = true;
    for (const item of candidates.slice(1)) item.usedThisSession += 5;
    expect([0, 1].map(selectionSeed => selectTask(snapshot(candidates, { selectionSeed }))?.itemRevisionId))
      .toEqual(["rev-1", "rev-2"]);
  });

  it("trzy niewykonalne cele nie pozwalają na czwartą prezentację", () => {
    const candidates = words(4);
    candidates.slice(0, 3).forEach(item => {
      present(item);
      item.acceptedAnswers = candidates.map(candidate => candidate.target);
      item.recognitionFallbackUsedThisSession = true;
    });
    expect(selectTask(snapshot(candidates))).toBeNull();
  });

  it("entropia nie zmienia pierwszeństwa wsparcia ani reguł czytającego", () => {
    const candidates = words(3);
    candidates.slice(0, 2).forEach(present);
    candidates[1]!.failuresThisSession = 2;
    for (const selectionSeed of [0, 1, 2, 999]) {
      expect(selectTask(snapshot(candidates, { selectionSeed }))?.reason).toBe("support");
    }
    candidates[1]!.failuresThisSession = 0;
    expect(selectTask(snapshot(candidates, { vocabularyFormat: "standard", canRead: true, selectionSeed: 0 })))
      .toEqual(selectTask(snapshot(candidates, { vocabularyFormat: "standard", canRead: true, selectionSeed: 999 })));
  });
});
