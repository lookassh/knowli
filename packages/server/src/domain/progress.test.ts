import { describe, expect, it } from "vitest";
import { projectProgress } from "./progress";
import { LEARNING_V1_POLICY } from "../policies/learning-v1";
import type { History, HistoryEntry, Skill, SkillOutcome } from "./types";

const D1 = "2026-10-06T16:00:00.000Z";
const D1B = "2026-10-06T16:05:00.000Z";
const D2 = "2026-10-07T16:00:00.000Z";
const NOW = "2026-10-07T20:00:00.000Z";

function e(
  skill: Skill,
  outcome: SkillOutcome,
  receivedAt: string,
  extra: Partial<HistoryEntry> = {},
): HistoryEntry {
  return {
    receivedAt,
    policyVersion: LEARNING_V1_POLICY.version,
    skill,
    outcome,
    independent: true,
    confirmationEligible: false,
    ...extra,
  };
}

function success(skill: Skill, receivedAt: string, extra: Partial<HistoryEntry> = {}): HistoryEntry {
  return e(skill, "correct", receivedAt, extra);
}

function failure(skill: Skill, receivedAt: string, extra: Partial<HistoryEntry> = {}): HistoryEntry {
  return e(skill, "incorrect", receivedAt, extra);
}

describe("projectProgress — seria trzech sukcesów i potwierdzenie (SPEC §18.2–3, A17, A29, A30)", () => {
  it("pusta historia nie zawiera rzadnych umiejętności", () => {
    const progress = projectProgress([], LEARNING_V1_POLICY, NOW);
    expect(progress.skills).toEqual({});
  });

  it("trzy sukcesy z jednej sesji nie zastępują potwierdzenia po przerwie (A17)", () => {
    const history: History = [success("recall", D1), success("recall", D1B), success("recall", D2)];
    const progress = projectProgress(history, LEARNING_V1_POLICY, NOW);
    expect(progress.skills.recall).toMatchObject({ status: "needs_confirmation", streak: 3 });
  });

  it("trzy kwalifikujące sukcesy z przerwą ≥ 12 godzin opanowują umiejętność", () => {
    const history: History = [
      success("recall", D1),
      success("recall", D1B),
      success("recall", D2, { confirmationEligible: true }),
    ];
    const progress = projectProgress(history, LEARNING_V1_POLICY, NOW);
    expect(progress.skills.recall).toMatchObject({ status: "mastered", streak: 3 });
    // Odstęp po sukcesie (arch §9.3): 7 dni od potwierdzającego sukcesu.
    expect(progress.skills.recall?.nextReviewAt).toBe("2026-10-14T16:00:00.000Z");
  });

  it("sukces–błąd–sukces nie daje serii trzech; dowolne trzy historyczne sukcesy nie wystarczą (A29)", () => {
    const history: History = [
      success("recall", D1),
      success("recall", D1B),
      failure("recall", "2026-10-06T16:10:00.000Z"),
      success("recall", D2, { confirmationEligible: true }),
    ];
    const progress = projectProgress(history, LEARNING_V1_POLICY, NOW);
    expect(progress.skills.recall).toMatchObject({ status: "learning", streak: 1 });
  });

  it("trzy ostatnie sukcesy po wcześniejszym błędzie opanowują umiejętność", () => {
    const history: History = [
      success("recall", D1),
      failure("recall", D1B),
      success("recall", "2026-10-06T17:00:00.000Z"),
      success("recall", "2026-10-06T17:05:00.000Z"),
      success("recall", D2, { confirmationEligible: true }),
    ];
    const progress = projectProgress(history, LEARNING_V1_POLICY, NOW);
    expect(progress.skills.recall?.status).toBe("mastered");
  });

  it("próby nieocenione nie zwiększają ani nie przerywają serii (SPEC §18.4)", () => {
    const history: History = [
      success("recall", D1),
      e("recall", "unevaluated", D1B, { reason: "technical" }),
      success("recall", D2),
    ];
    const progress = projectProgress(history, LEARNING_V1_POLICY, NOW);
    expect(progress.skills.recall?.streak).toBe(2);
  });

  it("próby wspomagane nie liczą się do serii kwalifikującej (SPEC §18.4)", () => {
    const history: History = [
      success("recall", D1),
      success("recall", D1B, { independent: false }),
      success("recall", D2),
    ];
    const progress = projectProgress(history, LEARNING_V1_POLICY, NOW);
    expect(progress.skills.recall?.streak).toBe(2);
  });

  it("„Nie pamiętam” w niezależnym sprawdzaniu przerywa serię (SPEC §15.1)", () => {
    const history: History = [
      success("recall", D1),
      failure("recall", D1B, { reason: "dont_remember" }),
    ];
    const progress = projectProgress(history, LEARNING_V1_POLICY, NOW);
    expect(progress.skills.recall).toMatchObject({ status: "learning", streak: 0 });
  });

  it("błąd po opanowaniu wymaga ponownego potwierdzenia (SPEC §18.5)", () => {
    const history: History = [
      success("recall", D1),
      success("recall", D1B),
      success("recall", D2, { confirmationEligible: true }),
      failure("recall", "2026-10-07T16:10:00.000Z"),
    ];
    const progress = projectProgress(history, LEARNING_V1_POLICY, NOW);
    expect(progress.skills.recall).toMatchObject({ status: "needs_reconfirmation", streak: 0 });
    // Po trudności powrót następnego dnia (arch §9.3).
    expect(progress.skills.recall?.nextReviewAt).toBe("2026-10-08T16:10:00.000Z");
  });

  it("błędna pisownia nie kasuje poprawnego Recall — serie są osobne (SPEC §18)", () => {
    const history: History = [
      // Jedna odpowiedź „monday”: Recall poprawny, pisownia nie.
      success("recall", D1),
      failure("spelling", D1),
      success("recall", D1B),
      success("spelling", D1B),
      success("recall", D2, { confirmationEligible: true }),
      success("spelling", D2),
    ];
    const progress = projectProgress(history, LEARNING_V1_POLICY, NOW);
    expect(progress.skills.recall?.status).toBe("mastered");
    expect(progress.skills.spelling).toMatchObject({ status: "learning", streak: 2 });
  });
});

describe("projectProgress — kierunki reading (arch §9.3)", () => {
  it("trzy kwalifikujące sukcesy w jednym kierunku nie opanowują umiejętności", () => {
    const history: History = [
      success("reading", D1, { details: { direction: "target_to_source" } }),
      success("reading", D1B, { details: { direction: "target_to_source" } }),
      success("reading", D2, {
        confirmationEligible: true,
        details: { direction: "target_to_source" },
      }),
    ];
    const progress = projectProgress(history, LEARNING_V1_POLICY, NOW);
    expect(progress.skills.reading).toMatchObject({ status: "needs_confirmation", streak: 3 });
    expect(progress.skills.reading?.directions).toEqual({ target_to_source: 3, source_to_target: 0 });
  });

  it("opanowanie wymaga obu kierunków wśród trzech ostatnich sukcesów", () => {
    const history: History = [
      success("reading", D1, { details: { direction: "target_to_source" } }),
      success("reading", D1B, { details: { direction: "source_to_target" } }),
      success("reading", D2, {
        confirmationEligible: true,
        details: { direction: "target_to_source" },
      }),
    ];
    const progress = projectProgress(history, LEARNING_V1_POLICY, NOW);
    expect(progress.skills.reading?.status).toBe("mastered");
    expect(progress.skills.reading?.directions).toEqual({ target_to_source: 2, source_to_target: 1 });
  });

  it("brak potwierdzenia po przerwie wstrzymuje opanowanie także przy obu kierunkach", () => {
    const history: History = [
      success("reading", D1, { details: { direction: "target_to_source" } }),
      success("reading", D1B, { details: { direction: "source_to_target" } }),
      success("reading", "2026-10-06T16:10:00.000Z", { details: { direction: "target_to_source" } }),
    ];
    const progress = projectProgress(history, LEARNING_V1_POLICY, NOW);
    expect(progress.skills.reading?.status).toBe("needs_confirmation");
  });
});

describe("projectProgress — projekcja i porządek danych", () => {
  it("oceny innej wersji polityki nie interpretujemy bieżącą regułą (SPEC §20)", () => {
    const history: History = [
      e("recall", "correct", D1, { policyVersion: "learning-v0" }),
    ];
    const progress = projectProgress(history, LEARNING_V1_POLICY, NOW);
    expect(progress.skills).toEqual({});
  });

  it("oceny z przyszłości względem `now` są ignorowane", () => {
    const history: History = [success("recall", D1), success("recall", "2026-10-09T16:00:00.000Z")];
    const progress = projectProgress(history, LEARNING_V1_POLICY, NOW);
    expect(progress.skills.recall?.streak).toBe(1);
  });

  it("listening opanowuje tymi samymi regułami, bez kierunków", () => {
    const history: History = [
      success("listening", D1),
      success("listening", D1B),
      success("listening", D2, { confirmationEligible: true }),
    ];
    const progress = projectProgress(history, LEARNING_V1_POLICY, NOW);
    expect(progress.skills.listening).toMatchObject({ status: "mastered", streak: 3 });
    expect(progress.skills.listening?.directions).toBeUndefined();
  });

  it("odstępy powtórek po sukcesach: 1 dzień, 3 dni, 7 dni (arch §9.3)", () => {
    const one = projectProgress([success("recall", D1)], LEARNING_V1_POLICY, NOW);
    expect(one.skills.recall?.nextReviewAt).toBe("2026-10-07T16:00:00.000Z");

    const two = projectProgress(
      [success("recall", D1), success("recall", D1B)],
      LEARNING_V1_POLICY,
      NOW,
    );
    expect(two.skills.recall?.nextReviewAt).toBe("2026-10-09T16:05:00.000Z");
  });

  it("po trudności powrót następnego dnia", () => {
    const history: History = [success("recall", D1), failure("recall", D1B)];
    const progress = projectProgress(history, LEARNING_V1_POLICY, NOW);
    expect(progress.skills.recall).toMatchObject({ status: "learning", streak: 0 });
    expect(progress.skills.recall?.nextReviewAt).toBe("2026-10-07T16:05:00.000Z");
  });

  it("umiejętność z samymi próbami wspomaganymi jest w nauce, bez serii", () => {
    const history: History = [
      success("recall", D1, { independent: false }),
      e("recall", "unevaluated", D1B, { reason: "skipped" }),
    ];
    const progress = projectProgress(history, LEARNING_V1_POLICY, NOW);
    expect(progress.skills.recall).toMatchObject({ status: "learning", streak: 0 });
  });
});
