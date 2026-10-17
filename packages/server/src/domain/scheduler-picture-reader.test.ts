import { describe, expect, it } from "vitest";
import { selectTask, type ScheduleCandidate } from "./scheduler";
import { projectProgress } from "./progress";
import { evaluateChoice, evaluateWritten } from "./evaluate";
import { computeTargetKey } from "./target-key";
import { LEARNING_V1_POLICY as policy } from "../policies/learning-v1";
import type { HistoryEntry, Skill } from "./types";

function numbers(count = 21): ScheduleCandidate[] {
  return Array.from({ length: count }, (_, position) => ({
    itemRevisionId: `rev-${position}`, itemId: `item-${position}`, position,
    target: `number ${position}`, source: `liczba ${position}`, targetLocale: "en-GB", acceptedAnswers: [],
    visual: position === 0 ? { kind: "image" as const, imageAssetId: "00000000-0000-4000-8000-000000000000" }
      : { kind: "number" as const, count: position },
    progress: {}, failuresThisSession: 0, supportedThisSession: false,
    usedThisSession: 0, presentationsThisSession: 0, lastContactAt: null, lastUsedOrdinal: null,
    readingDirections: {}, practiceMix: { listening: 0, reading: 0 },
    introducedSkills: { recall: true, pronunciation: true },
  }));
}

function input(candidates: ScheduleCandidate[], canRead = true) {
  return { candidates, peers: candidates, now: "2026-10-15T12:00:00.000Z", policy,
    canRead, vocabularyFormat: "picture" as const, microphoneEnabled: false,
    assessedRemaining: 24, nextOrdinal: 2, reservedTargetKeys: [] };
}

describe("losowanie picture niezależnie od czytania", () => {
  it.each([false, true])("losuje dwa poznane cele lub trzecią prezentację, canRead=%s", canRead => {
    const candidates = numbers();
    for (const item of candidates.slice(0, 2)) {
      item.ownPresentationCompleted = true;
      item.presentationsThisSession = item.usedThisSession = 1;
    }
    expect([0, 1, 2].map(selectionSeed => {
      const plan = selectTask({ ...input(candidates, canRead), selectionSeed });
      return [plan?.itemRevisionId, plan?.exerciseType];
    })).toEqual([["rev-0", "listening"], ["rev-1", "listening"], ["rev-2", "exposure"]]);
  });

  it("liczby 0–20: pełne kontrolowane przebiegi różnią się także po bootstrapie", () => {
    const traces: { target: string; exercise: string }[][] = [];
    for (const stream of [2, 9, 37, 2]) {
      const trace: { target: string; exercise: string }[] = [];
      const candidates = numbers();
      const histories = new Map<string, HistoryEntry[]>();
      const presentations: string[] = [];
      const questions: { target: string; lag: number }[] = [];
      let remaining = 72;
      const directions = new Set<string>();
      for (let ordinal = 0; ordinal < 120 && remaining > 0; ordinal++) {
        const now = new Date(Date.parse("2026-10-15T12:00:00Z") + ordinal * 1000).toISOString();
        const plan = selectTask({ ...input(candidates), now, nextOrdinal: ordinal,
          assessedRemaining: remaining, selectionSeed: ordinal * stream + 2 });
        expect(plan).not.toBeNull();
        const target = candidates.find(item => item.itemRevisionId === plan!.itemRevisionId)!;
        trace.push({ target: target.itemRevisionId, exercise: plan!.exerciseType });
        if (!plan!.assessed) {
          presentations.push(target.itemRevisionId);
          target.ownPresentationCompleted = true;
          target.presentationsThisSession++;
        } else {
          expect(target.ownPresentationCompleted).toBe(true);
          questions.push({ target: target.itemRevisionId,
            lag: presentations.length - 1 - presentations.indexOf(target.itemRevisionId) });
          const grade = evaluateChoice("correct", { exerciseType: plan!.exerciseType,
            target: target.target, acceptedAnswers: [], correctOptionId: "correct", direction: plan!.direction },
          { receivedAt: now, policy, firstTry: true, assistance: [], lastExposureAt: null,
            previousSessionContactAt: null, timezone: "Europe/Warsaw" });
          const history = histories.get(target.itemRevisionId) ?? [];
          for (const [skill, result] of Object.entries(grade.skills)) {
            history.push({ receivedAt: now, policyVersion: policy.version, skill: skill as Skill, ...result });
          }
          histories.set(target.itemRevisionId, history);
          target.progress = projectProgress(history, policy, now).skills;
          target.readingEvidenceDirections = projectProgress(history, policy, now).skills.reading?.directions;
          if (plan!.direction) {
            directions.add(plan!.direction);
            target.practiceMix.reading++;
            target.readingDirections[plan!.direction] = (target.readingDirections[plan!.direction] ?? 0) + 1;
          } else target.practiceMix.listening++;
          remaining--;
        }
        target.usedThisSession++;
        target.lastUsedOrdinal = ordinal;
        expect(candidates.filter(item => item.ownPresentationCompleted &&
          item.practiceMix.listening + item.practiceMix.reading === 0).length).toBeLessThanOrEqual(3);
      }
      expect(remaining).toBe(0);
      expect(selectTask({ ...input(candidates), assessedRemaining: 0 })).toBeNull();
      expect(questions.some(question => question.lag !== 1)).toBe(true);
      expect(questions.slice(0, 5).map(question => question.target)).not.toEqual(presentations.slice(0, 5));
      expect(directions).toEqual(new Set(["target_to_source", "source_to_target"]));
      expect([...histories.values()].flat().some(entry => entry.skill === "listening")).toBe(true);
      traces.push(trace);
    }
    expect(traces[0]).toEqual(traces[3]);
    for (const [left, right] of [[0, 1], [0, 2], [1, 2]] as const) {
      expect(traces[left]).not.toEqual(traces[right]);
      // Sprawdzamy cały dalszy przebieg, nie tylko jedno wczesne odejście od FIFO.
      expect(traces[left]!.slice(20)).not.toEqual(traces[right]!.slice(20));
    }
  });

  it("późny stan liczb 0–20 losuje 4/5/6 i starsze ćwiczone cele", () => {
    const candidates = numbers();
    for (const item of candidates.slice(0, 7)) {
      item.ownPresentationCompleted = true;
      item.presentationsThisSession = item.usedThisSession = 1;
    }
    for (const item of candidates.slice(0, 4)) {
      item.usedThisSession++;
      item.practiceMix.listening++;
      item.progress.listening = { status: "learning", streak: 1, nextReviewAt: "2026-10-16T12:00:00Z" };
    }
    const plans = [0, 1, 2, 3, 6].map(selectionSeed => selectTask({
      ...input(candidates), nextOrdinal: 12, selectionSeed,
    }));
    expect(plans.every(plan => plan?.assessed)).toBe(true);
    expect(plans.map(plan => plan?.itemRevisionId)).toEqual(["rev-4", "rev-5", "rev-6", "rev-0", "rev-3"]);
    // Różne dopuszczalne decyzje w tej samej późnej migawce; krótkie powtórki są dozwolone.
    expect(selectTask({ ...input(candidates), nextOrdinal: 12, selectionSeed: 0 })).toEqual(plans[0]);
  });

  it.each([false, true])("czytający zachowuje przypominanie/pisownię i wymowę według mikrofonu=%s", microphoneEnabled => {
    const candidates = numbers(2);
    for (const item of candidates) {
      item.ownPresentationCompleted = true;
      item.usedThisSession = item.presentationsThisSession = 1;
      item.progress.listening = { status: "learning", nextReviewAt: "2026-10-16T12:00:00Z", streak: 1 };
      item.introducedSkills = { recall: false, pronunciation: false };
    }
    const state = { ...input(candidates), microphoneEnabled, nextOrdinal: 3 };
    const recall = selectTask(state)!;
    expect(recall).toMatchObject({ exerciseType: "recall", reason: "stage-introduction" });
    expect(recall.pictureRecall).toBeUndefined();
    const target = candidates.find(item => item.itemRevisionId === recall.itemRevisionId)!;
    const grade = evaluateWritten(target.target, { exerciseType: recall.exerciseType,
      target: target.target, acceptedAnswers: [] }, { receivedAt: state.now, policy,
      firstTry: true, assistance: [], lastExposureAt: null, previousSessionContactAt: null, timezone: "Europe/Warsaw" });
    expect(grade.skills).toMatchObject({ recall: { outcome: "correct" }, spelling: { outcome: "correct" } });
    target.introducedSkills.recall = true;
    const next = selectTask({ ...state, nextOrdinal: 5 });
    if (microphoneEnabled) expect(next).toMatchObject({ exerciseType: "speech", reason: "stage-introduction" });
    else expect(next?.exerciseType).not.toBe("speech");
  });

  it.each(["listening", "reading", "recall", "pronunciation"] as const)("czytający: należne %s przed losowaniem", skill => {
    const candidates = numbers(3);
    for (const item of candidates) item.ownPresentationCompleted = true;
    candidates[1]!.progress[skill] = { status: "learning", nextReviewAt: "2026-10-14T12:00:00Z", streak: 0 };
    for (const selectionSeed of [0, 1, 2, 999]) {
      expect(selectTask({ ...input(candidates), microphoneEnabled: true, selectionSeed }))
        .toMatchObject({ itemRevisionId: "rev-1", reason: skill === "recall" ? "due-check" : "due-review" });
    }
  });

  it("nieczytający z włączonym mikrofonem po opanowaniu słuchania otrzymuje picture_recall i speech", () => {
    const candidates = numbers(2);
    for (const item of candidates) {
      item.ownPresentationCompleted = true;
      item.usedThisSession = item.presentationsThisSession = 1;
      item.progress.listening = { status: "learning", nextReviewAt: "2026-10-16T12:00:00Z", streak: 1 };
      item.introducedSkills = { recall: false, pronunciation: false };
    }
    const state = { ...input(candidates, false), microphoneEnabled: true, nextOrdinal: 3 };
    const recall = selectTask(state)!;
    expect(recall).toMatchObject({
      exerciseType: "recall",
      reason: "stage-introduction",
      pictureRecall: true,
      assessmentSkills: ["recall", "pronunciation"],
    });
    const target = candidates.find((item) => item.itemRevisionId === recall.itemRevisionId)!;
    target.introducedSkills.recall = true;
    const next = selectTask({ ...state, nextOrdinal: 5 });
    expect(next).toMatchObject({
      exerciseType: "speech",
      reason: "stage-introduction",
    });
  });
});

describe("wizualne listening w zwykłym zestawie", () => {
  it("naprzemiennie wybiera zatwierdzony obraz i dotychczasowe listening tekstowe", () => {
    const peers = numbers(3);
    const target = peers[0]!;
    target.ownPresentationCompleted = true;
    target.usedThisSession = 1;
    target.presentationsThisSession = 1;
    target.practiceMix = { listening: 0, reading: 1 };
    target.introducedSkills = { recall: true, pronunciation: true };
    target.visual = { kind: "number", count: 0 };
    peers[1]!.visual = { kind: "number", count: 1 };
    peers[2]!.visual = { kind: "number", count: 2 };
    const base = { ...input([target]), candidates: [target], peers, vocabularyFormat: "standard" as const,
      supportsPictureVocabulary: true, nextOrdinal: 8 };

    const first = selectTask(base);
    expect(first?.exerciseType).toBe("listening");
    expect(first?.options?.every(option => option.visual !== undefined)).toBe(true);

    target.pictureListeningCount = 1;
    target.textListeningCount = 0;
    const second = selectTask(base);
    expect(second?.exerciseType).toBe("listening");
    expect(second?.options?.every(option => option.visual === undefined)).toBe(true);

    target.textListeningCount = 1;
    const third = selectTask(base);
    expect(third?.exerciseType).toBe("listening");
    expect(third?.options?.every(option => option.visual !== undefined)).toBe(true);
  });

  it("dla starego klienta zachowuje tekstowy prompt", () => {
    const peers = numbers(3);
    const target = peers[0]!;
    target.ownPresentationCompleted = true;
    target.usedThisSession = 1;
    target.presentationsThisSession = 1;
    target.practiceMix = { listening: 0, reading: 1 };
    target.introducedSkills = { recall: true, pronunciation: true };
    target.visual = { kind: "number", count: 0 };
    const plan = selectTask({ ...input([target]), candidates: [target], peers,
      vocabularyFormat: "standard", supportsPictureVocabulary: false, nextOrdinal: 8 });
    expect(plan?.exerciseType).toBe("listening");
    expect(plan?.options?.every(option => option.visual === undefined)).toBe(true);
  });

  it("wraca do tekstowego listening gdy nie ma dość wizualnych opcji", () => {
    const candidates = numbers(3);
    for (const item of candidates) {
      item.ownPresentationCompleted = true;
      item.usedThisSession = item.presentationsThisSession = 1;
      item.introducedSkills = { recall: true, pronunciation: true };
    }
    candidates[0]!.visual = { kind: "number", count: 0 };
    candidates[1]!.visual = undefined;
    candidates[2]!.visual = undefined;
    const plan = selectTask({ ...input(candidates), candidates, peers: candidates,
      vocabularyFormat: "standard", supportsPictureVocabulary: true });
    expect(plan?.exerciseType).toBe("listening");
    expect(plan?.options?.every(option => option.visual === undefined)).toBe(true);
  });

  it("nie ujawnia zarezerwowanego słowa jako wizualnego dystraktora", () => {
    const candidates = numbers(3);
    for (const item of candidates) {
      item.ownPresentationCompleted = true;
      item.usedThisSession = item.presentationsThisSession = 1;
      item.introducedSkills = { recall: true, pronunciation: true };
    }
    const reservedKey = computeTargetKey(candidates[2]!.target, candidates[2]!.targetLocale);
    const plan = selectTask({ ...input(candidates), candidates, peers: candidates,
      vocabularyFormat: "standard", supportsPictureVocabulary: true,
      reservedTargetKeys: [reservedKey] });
    expect(plan?.options?.some(option => option.itemRevisionId === candidates[2]!.itemRevisionId)).toBe(false);
    expect(plan?.revealsTargetKeys).not.toContain(reservedKey);
    expect(plan?.keepsReservations).toContain(reservedKey);
  });
});
