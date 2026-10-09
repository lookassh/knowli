import { describe, expect, it } from "vitest";
import { LEARNING_V1_POLICY } from "../policies/learning-v1";
import { computeTargetKey } from "./target-key";
import { selectTask, type ScheduleCandidate, type ScheduleInput, type SchedulePeer } from "./scheduler";

const NOW = "2026-10-08T22:00:00.000Z";
const THURSDAY_KEY = computeTargetKey("Thursday", "en-GB");

function candidate(overrides: Partial<ScheduleCandidate> = {}): ScheduleCandidate {
  return {
    itemRevisionId: "rev-known",
    itemId: "item-known",
    position: 1,
    target: "Thursday",
    source: "czwartek",
    acceptedAnswers: [],
    targetLocale: "en-GB",
    progress: {
      listening: { status: "learning", nextReviewAt: "2026-10-10T22:00:00.000Z", streak: 1 },
      spelling: { status: "learning", nextReviewAt: "2026-10-10T22:00:00.000Z", streak: 0 },
    },
    failuresThisSession: 0,
    supportedThisSession: false,
    usedThisSession: 0,
    presentationsThisSession: 0,
    lastContactAt: null,
    lastUsedOrdinal: null,
    readingDirections: {},
    practiceMix: { listening: 0, reading: 0 },
    introducedSkills: { recall: false, pronunciation: false },
    ...overrides,
  };
}

function peer(overrides: Partial<SchedulePeer> = {}): SchedulePeer {
  return {
    itemRevisionId: "rev-known",
    position: 1,
    target: "Thursday",
    source: "czwartek",
    targetLocale: "en-GB",
    ...overrides,
  };
}

function input(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    now: NOW,
    policy: LEARNING_V1_POLICY,
    microphoneEnabled: false,
    assessedRemaining: 12,
    nextOrdinal: 0,
    candidates: [],
    peers: [],
    reservedTargetKeys: [],
    ...overrides,
  };
}

describe("selectTask — przygotowanie do sprawdzianu", () => {
  it("offers a known written recall before earlier unseen material in the test window", () => {
    const known = candidate({ hasBeenPresented: true });
    const unseen = candidate({
      itemRevisionId: "rev-unseen",
      itemId: "item-unseen",
      position: 0,
      target: "Friday",
      source: "piątek",
      progress: {},
      hasBeenPresented: false,
    });

    const plan = selectTask(input({
      candidates: [unseen, known],
      peers: [peer(unseen), peer(known)],
      testPreparation: { testDate: "2026-10-11", timezone: "Europe/Warsaw" },
    }));

    expect(plan).toMatchObject({
      itemRevisionId: known.itemRevisionId,
      exerciseType: "recall",
      reason: "test-preparation",
      assessed: true,
      revealsTargetKeys: [],
    });
  });

  it("keeps ordinary new-material behavior outside the window or without a date", () => {
    const known = candidate({ hasBeenPresented: true });
    const unseen = candidate({ itemRevisionId: "rev-unseen", position: 0, target: "Friday", source: "piątek", progress: {} });
    const common = { candidates: [unseen, known], peers: [peer(unseen), peer(known)] };

    expect(selectTask(input({ ...common, testPreparation: { testDate: "2026-10-11", timezone: "Europe/Warsaw" }, now: "2026-10-08T21:59:59.999Z" })))
      .toMatchObject({ itemRevisionId: "rev-unseen", reason: "new-material" });
    expect(selectTask(input({ ...common, testPreparation: { testDate: null, timezone: "Europe/Warsaw" } })))
      .toMatchObject({ itemRevisionId: "rev-unseen", reason: "new-material" });
  });

  it("does not replace due checks, support, or an already-settled target", () => {
    const due = candidate({
      hasBeenPresented: true,
      progress: {
        listening: { status: "learning", nextReviewAt: "2026-10-10T22:00:00.000Z", streak: 1 },
        spelling: { status: "needs_confirmation", nextReviewAt: "2026-10-07T00:00:00.000Z", streak: 2 },
      },
    });
    const duePlan = selectTask(input({
      candidates: [due],
      peers: [peer(due)],
      testPreparation: { testDate: "2026-10-11", timezone: "Europe/Warsaw" },
    }));
    expect(duePlan).toMatchObject({ reason: "due-check", itemRevisionId: due.itemRevisionId });

    const supported = candidate({ hasBeenPresented: true, failuresThisSession: 2 });
    const supportPlan = selectTask(input({
      candidates: [supported],
      peers: [peer(supported)],
      testPreparation: { testDate: "2026-10-11", timezone: "Europe/Warsaw" },
    }));
    expect(supportPlan).toMatchObject({ reason: "support" });

    const settledPlan = selectTask(input({
      candidates: [candidate({ hasBeenPresented: true }), candidate({
        itemRevisionId: "rev-unseen", itemId: "item-unseen", position: 0, target: "Friday", source: "piątek", progress: {},
      })],
      peers: [peer(), peer({ itemRevisionId: "rev-unseen", position: 0, target: "Friday", source: "piątek" })],
      settledCheckTargetKeys: [THURSDAY_KEY],
      testPreparation: { testDate: "2026-10-11", timezone: "Europe/Warsaw" },
    }));
    expect(settledPlan).toMatchObject({ itemRevisionId: "rev-unseen", reason: "new-material" });
  });

  it("keeps the spaced retry after support ahead of test preparation", () => {
    const supported = candidate({
      hasBeenPresented: true,
      supportedThisSession: true,
      usedThisSession: 1,
      lastUsedOrdinal: 0,
    });
    const plan = selectTask(input({
      candidates: [supported],
      peers: [peer(supported)],
      nextOrdinal: 2,
      testPreparation: { testDate: "2026-10-11", timezone: "Europe/Warsaw" },
    }));
    expect(plan).toMatchObject({ itemRevisionId: supported.itemRevisionId, reason: "retry-after-support" });
  });

  it("sorts reconfirmation and spelling needs before recall and position", () => {
    const recallOnly = candidate({
      itemRevisionId: "rev-recall",
      position: 0,
      target: "Friday",
      source: "piątek",
      hasBeenPresented: true,
      progress: {
        listening: { status: "learning", nextReviewAt: "2026-10-10T22:00:00.000Z", streak: 1 },
        recall: { status: "learning", nextReviewAt: "2026-10-10T22:00:00.000Z", streak: 0 },
      },
    });
    const spelling = candidate({ hasBeenPresented: true });
    const reconfirmation = candidate({
      itemRevisionId: "rev-confirm",
      position: 2,
      target: "Monday",
      source: "poniedziałek",
      hasBeenPresented: true,
      progress: {
        listening: { status: "learning", nextReviewAt: "2026-10-10T22:00:00.000Z", streak: 1 },
        recall: { status: "needs_confirmation", nextReviewAt: "2026-10-10T22:00:00.000Z", streak: 2 },
        spelling: { status: "needs_confirmation", nextReviewAt: "2026-10-10T22:00:00.000Z", streak: 2 },
      },
    });

    const plan = selectTask(input({
      candidates: [recallOnly, spelling, reconfirmation],
      peers: [peer(recallOnly), peer(spelling), peer(reconfirmation)],
      testPreparation: { testDate: "2026-10-11", timezone: "Europe/Warsaw" },
    }));
    expect(plan).toMatchObject({ itemRevisionId: "rev-confirm", reason: "test-preparation" });

    const spellingFirst = selectTask(input({
      candidates: [recallOnly, spelling],
      peers: [peer(recallOnly), peer(spelling)],
      testPreparation: { testDate: "2026-10-11", timezone: "Europe/Warsaw" },
    }));
    expect(spellingFirst).toMatchObject({ itemRevisionId: spelling.itemRevisionId, reason: "test-preparation" });
  });

  it("inserts safe easy recognition after two consecutive preparation assessments", () => {
    const known = candidate({ hasBeenPresented: true, usedThisSession: 1, introducedSkills: { recall: true, pronunciation: true } });
    const unseen = candidate({ itemRevisionId: "rev-unseen", itemId: "item-unseen", position: 0, target: "Friday", source: "piątek", progress: {} });
    const reservedDistractor = peer({ itemRevisionId: "rev-reserved", position: 2, target: "Wednesday", source: "środa" });
    const plan = selectTask(input({
      candidates: [unseen, known],
      peers: [peer(unseen), peer(known), reservedDistractor],
      recentAssessedReasons: ["test-preparation", "test-preparation"],
      reservedTargetKeys: [computeTargetKey("Wednesday", "en-GB")],
      testPreparation: { testDate: "2026-10-11", timezone: "Europe/Warsaw" },
    }));

    expect(plan).toMatchObject({ itemRevisionId: known.itemRevisionId, exerciseType: "listening", reason: "test-preparation-break" });
    expect(plan!.revealsTargetKeys).toEqual([THURSDAY_KEY]);
    expect(plan!.options!.map((option) => option.text)).not.toContain("środa");
  });

  it("does not prepare unseen, mastered, issued, or reserved targets", () => {
    const mastered = candidate({
      hasBeenPresented: true,
      progress: {
        listening: { status: "mastered", nextReviewAt: "2026-10-10T22:00:00.000Z", streak: 3 },
        recall: { status: "mastered", nextReviewAt: "2026-10-10T22:00:00.000Z", streak: 3 },
        spelling: { status: "mastered", nextReviewAt: "2026-10-10T22:00:00.000Z", streak: 3 },
      },
    });
    const issued = candidate({ itemRevisionId: "rev-issued", itemId: "item-issued", position: 2, target: "Monday", source: "poniedziałek", hasBeenPresented: true, testPreparationIssued: true });
    const unseen = candidate({ itemRevisionId: "rev-unseen", itemId: "item-unseen", position: 0, target: "Friday", source: "piątek", progress: {} });
    const plan = selectTask(input({
      candidates: [unseen, mastered, issued],
      peers: [peer(unseen), peer(mastered), peer(issued)],
      reservedTargetKeys: ["Monday|en-gb"],
      testPreparation: { testDate: "2026-10-11", timezone: "Europe/Warsaw" },
    }));

    expect(plan).toMatchObject({ itemRevisionId: "rev-unseen", reason: "new-material" });
  });

  it("falls back to normal scheduling when there is no safe known break candidate", () => {
    const known = candidate({ hasBeenPresented: true, usedThisSession: 0 });
    const unseen = candidate({ itemRevisionId: "rev-unseen", itemId: "item-unseen", position: 0, target: "Friday", source: "piątek", progress: {} });
    const plan = selectTask(input({
      candidates: [unseen, known],
      peers: [peer(unseen), peer(known)],
      recentAssessedReasons: ["test-preparation", "test-preparation"],
      reservedTargetKeys: [THURSDAY_KEY],
      testPreparation: { testDate: "2026-10-11", timezone: "Europe/Warsaw" },
    }));
    expect(plan).toMatchObject({ itemRevisionId: "rev-unseen", reason: "new-material" });
  });
});
