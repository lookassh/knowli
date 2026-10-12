import { describe, expect, it } from "vitest";
import {
  projectObjectiveProgress,
  qualifyLessonAttempt,
  type LessonQualificationContext,
  type ObjectiveHistoryEntry,
} from "./progress";
import { LEARNING_V1_POLICY } from "../../policies/learning-v1";
import type { AssistanceKind, SkillOutcome } from "../types";

const POLICY = LEARNING_V1_POLICY;
const OBJ = "english_grammar.present_simple.third_person_s";

function qCtx(overrides: Partial<LessonQualificationContext> = {}): LessonQualificationContext {
  return {
    receivedAt: "2026-10-07T16:00:00.000Z",
    policy: POLICY,
    firstTry: true,
    assistance: [],
    answerPreviouslyExposed: false,
    previousSessionContactAt: null,
    timezone: "Europe/Warsaw",
    ...overrides,
  };
}

describe("qualifyLessonAttempt — niezależność próby celu (req 7.2, SPEC §18.1)", () => {
  it("pierwsza próba bez wsparcia i bez wcześniejszego ujawnienia jest niezależna", () => {
    expect(qualifyLessonAttempt(qCtx())).toEqual({ independent: true, confirmationEligible: false });
  });

  it("kolejna próba w zadaniu nie jest niezależna", () => {
    expect(qualifyLessonAttempt(qCtx({ firstTry: false }))).toMatchObject({
      independent: false,
      reason: "not_first_try",
    });
  });

  it("wsparcie (np. opcje) dyskwalifikuje niezależność", () => {
    const cases: readonly (readonly AssistanceKind[])[] = [["options"], ["hint"], ["answer_reveal"]];
    for (const assistance of cases) {
      expect(qualifyLessonAttempt(qCtx({ assistance }))).toMatchObject({
        independent: false,
        reason: "assisted",
      });
    }
  });

  it("odpowiedź wcześniej ujawniona dziecku dyskwalifikuje niezależność", () => {
    expect(qualifyLessonAttempt(qCtx({ answerPreviouslyExposed: true }))).toMatchObject({
      independent: false,
      reason: "recent_exposure",
    });
  });

  it("kolejność przyczyn: not_first_try przed assisted przed recent_exposure", () => {
    expect(
      qualifyLessonAttempt(
        qCtx({ firstTry: false, assistance: ["options"], answerPreviouslyExposed: true }),
      ).reason,
    ).toBe("not_first_try");
    expect(
      qualifyLessonAttempt(qCtx({ assistance: ["options"], answerPreviouslyExposed: true })).reason,
    ).toBe("assisted");
  });

  it("confirmationEligible po sesji ≥ 12 h i w innym dniu lokalnym", () => {
    expect(
      qualifyLessonAttempt(
        qCtx({
          previousSessionContactAt: "2026-10-06T18:00:00.000Z",
          receivedAt: "2026-10-07T06:00:00.000Z",
        }),
      ).confirmationEligible,
    ).toBe(true);
  });

  it("12 h w tym samym dniu lokalnym nie wystarcza", () => {
    expect(
      qualifyLessonAttempt(
        qCtx({
          previousSessionContactAt: "2026-10-07T06:00:00.000Z",
          receivedAt: "2026-10-07T18:00:00.000Z",
        }),
      ).confirmationEligible,
    ).toBe(false);
  });

  it("zmiana dnia tuż po północy bez 12 h nie kwalifikuje", () => {
    expect(
      qualifyLessonAttempt(
        qCtx({
          previousSessionContactAt: "2026-10-07T21:59:00.000Z",
          receivedAt: "2026-10-07T22:01:00.000Z",
        }),
      ).confirmationEligible,
    ).toBe(false);
  });

  it("DST Europe/Warsaw: 12 h absolutnych wygrywa z 11 h zegarowymi", () => {
    expect(
      qualifyLessonAttempt(
        qCtx({
          previousSessionContactAt: "2026-10-24T21:30:00.000Z",
          receivedAt: "2026-10-25T09:30:00.000Z",
        }),
      ).confirmationEligible,
    ).toBe(true);
  });
});

const NOW = "2026-10-07T20:00:00.000Z";
const D1 = "2026-10-06T16:00:00.000Z";
const D1B = "2026-10-06T16:05:00.000Z";
const D1C = "2026-10-06T16:10:00.000Z";
const D2 = "2026-10-07T16:00:00.000Z";

function entry(
  outcome: SkillOutcome,
  receivedAt: string,
  itemId: string,
  extra: Partial<ObjectiveHistoryEntry> = {},
): ObjectiveHistoryEntry {
  return {
    receivedAt,
    policyVersion: POLICY.version,
    objectiveId: OBJ,
    itemId,
    outcome,
    independent: true,
    confirmationEligible: false,
    ...extra,
  };
}

const ok = (receivedAt: string, itemId: string, extra: Partial<ObjectiveHistoryEntry> = {}) =>
  entry("correct", receivedAt, itemId, extra);
const bad = (receivedAt: string, itemId: string, extra: Partial<ObjectiveHistoryEntry> = {}) =>
  entry("incorrect", receivedAt, itemId, extra);

describe("projectObjectiveProgress — projekcja postępu celu (req 7.3–7.5)", () => {
  it("brak wpisów → brak klucza", () => {
    expect(projectObjectiveProgress([], POLICY, NOW)).toEqual({});
  });

  it("same nieocenione → not_assessed", () => {
    const history = [
      entry("unevaluated", D1, "e1", { reason: "technical", independent: false }),
      entry("unevaluated", D1B, "e2", { reason: "skipped", independent: false }),
    ];
    expect(projectObjectiveProgress(history, POLICY, NOW)[OBJ]).toMatchObject({
      status: "not_assessed",
      streak: 0,
    });
  });

  it("1–2 sukcesy → learning", () => {
    expect(projectObjectiveProgress([ok(D1, "e1")], POLICY, NOW)[OBJ]).toMatchObject({
      status: "learning",
      streak: 1,
    });
    expect(
      projectObjectiveProgress([ok(D1, "e1"), ok(D1B, "e2")], POLICY, NOW)[OBJ],
    ).toMatchObject({ status: "learning", streak: 2 });
  });

  it("3 sukcesy na różnych ćwiczeniach w jednej sesji (bez potwierdzenia) → needs_confirmation", () => {
    const history = [ok(D1, "e1"), ok(D1B, "e2"), ok(D1C, "e3")];
    expect(projectObjectiveProgress(history, POLICY, NOW)[OBJ]).toMatchObject({
      status: "needs_confirmation",
      streak: 3,
    });
  });

  it("3 sukcesy na różnych ćwiczeniach, w tym 1 z potwierdzeniem → mastered", () => {
    const history = [ok(D1, "e1"), ok(D1B, "e2"), ok(D2, "e3", { confirmationEligible: true })];
    expect(projectObjectiveProgress(history, POLICY, NOW)[OBJ]).toMatchObject({
      status: "mastered",
      streak: 3,
    });
  });

  it("3 sukcesy, z czego 2 na tym samym ćwiczeniu → nie mastered (różne itemId wymagane)", () => {
    const history = [ok(D1, "e1"), ok(D1B, "e1"), ok(D2, "e2", { confirmationEligible: true })];
    const result = projectObjectiveProgress(history, POLICY, NOW)[OBJ];
    expect(result?.status).not.toBe("mastered");
  });

  it("ponowny sukces na tym samym ćwiczeniu nie zwiększa okna, ale nie przerywa serii", () => {
    // e1, e1, e2, e3+potwierdzenie: 4 sukcesy, okno różnych ćwiczeń = {e1,e2,e3} → mastered
    const history = [
      ok(D1, "e1"),
      ok(D1B, "e1"),
      ok(D1C, "e2"),
      ok(D2, "e3", { confirmationEligible: true }),
    ];
    expect(projectObjectiveProgress(history, POLICY, NOW)[OBJ]?.status).toBe("mastered");
  });

  it("sukces–błąd–sukces–sukces → seria 2", () => {
    const history = [
      ok(D1, "e1"),
      bad(D1B, "e2"),
      ok(D1C, "e3"),
      ok("2026-10-06T16:15:00.000Z", "e4"),
    ];
    expect(projectObjectiveProgress(history, POLICY, NOW)[OBJ]).toMatchObject({ streak: 2 });
  });

  it("„Nie pamiętam” w niezależnym zastosowaniu przerywa serię (req 7.4)", () => {
    const history = [ok(D1, "e1"), bad(D1B, "e2", { reason: "dont_remember" })];
    expect(projectObjectiveProgress(history, POLICY, NOW)[OBJ]).toMatchObject({
      status: "learning",
      streak: 0,
    });
  });

  it("utrata opanowania → needs_reconfirmation", () => {
    const history = [
      ok(D1, "e1"),
      ok(D1B, "e2"),
      ok(D2, "e3", { confirmationEligible: true }),
      bad("2026-10-07T16:10:00.000Z", "e4"),
    ];
    expect(projectObjectiveProgress(history, POLICY, NOW)[OBJ]).toMatchObject({
      status: "needs_reconfirmation",
      streak: 0,
    });
  });

  it("wpisy innej wersji polityki i z przyszłości są pomijane", () => {
    const history = [
      ok(D1, "e1", { policyVersion: "learning-v0" }),
      ok("2026-10-09T16:00:00.000Z", "e2"),
      ok(D1B, "e3"),
    ];
    expect(projectObjectiveProgress(history, POLICY, NOW)[OBJ]).toMatchObject({ streak: 1 });
  });

  it("niezależne=false jest neutralne (nie zwiększa ani nie przerywa serii)", () => {
    const history = [ok(D1, "e1"), ok(D1B, "e2", { independent: false }), ok(D1C, "e3")];
    expect(projectObjectiveProgress(history, POLICY, NOW)[OBJ]).toMatchObject({ streak: 2 });
  });

  it("kilka celów naraz jest rozdzielonych", () => {
    const OBJ2 = "english_grammar.present_simple.do_does";
    const history = [
      ok(D1, "e1"),
      ok(D1B, "e2"),
      ok(D2, "e3", { confirmationEligible: true }),
      ok(D1, "x1", { objectiveId: OBJ2 }),
    ];
    const result = projectObjectiveProgress(history, POLICY, NOW);
    expect(result[OBJ]?.status).toBe("mastered");
    expect(result[OBJ2]).toMatchObject({ status: "learning", streak: 1 });
  });

  it("nextReviewAt zgodne ze słówkami: 7 dni od potwierdzającego sukcesu dla mastered", () => {
    const history = [ok(D1, "e1"), ok(D1B, "e2"), ok(D2, "e3", { confirmationEligible: true })];
    expect(projectObjectiveProgress(history, POLICY, NOW)[OBJ]?.nextReviewAt).toBe(
      "2026-10-14T16:00:00.000Z",
    );
  });

  it("nextReviewAt: 1 dzień po pojedynczym sukcesie (jak słówka)", () => {
    expect(projectObjectiveProgress([ok(D1, "e1")], POLICY, NOW)[OBJ]?.nextReviewAt).toBe(
      "2026-10-07T16:00:00.000Z",
    );
  });
});
