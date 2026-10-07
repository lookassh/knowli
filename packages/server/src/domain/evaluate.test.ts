import { describe, expect, it } from "vitest";
import { evaluateNonAnswer, evaluateWritten } from "./evaluate";
import { LEARNING_V1_POLICY } from "../policies/learning-v1";
import type { AnswerKey, EvaluationContext } from "./types";

function ctx(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    receivedAt: "2026-10-07T16:00:00.000Z",
    policy: LEARNING_V1_POLICY,
    lastExposureAt: null,
    firstTry: true,
    assistance: [],
    previousSessionContactAt: null,
    timezone: "Europe/Warsaw",
    ...overrides,
  };
}

function key(overrides: Partial<AnswerKey> = {}): AnswerKey {
  return { exerciseType: "spelling", target: "Thursday", acceptedAnswers: [], ...overrides };
}

describe("evaluateWritten — pisownia i przypominanie z jednej odpowiedzi (SPEC §12.8, §18)", () => {
  it("dokładna odpowiedź zalicza Recall i pełną pisownię", () => {
    const grade = evaluateWritten("Thursday", key(), ctx());
    expect(grade.attempt).toEqual({ independent: true, confirmationEligible: false });
    expect(grade.skills.recall?.outcome).toBe("correct");
    expect(grade.skills.spelling?.outcome).toBe("correct");
    expect(grade.skills.spelling?.details?.spelling).toEqual({
      matchedVariant: "Thursday",
      wordMatched: true,
      letterOrderMatched: true,
      capitalizationCorrect: true,
      capitalizationOnlyDefect: false,
    });
  });

  it("„monday” potwierdza właściwe słowo, ale nie pełną pisownię (A35)", () => {
    const grade = evaluateWritten("monday", key({ target: "Monday" }), ctx());
    expect(grade.skills.recall?.outcome).toBe("correct");
    expect(grade.skills.spelling?.outcome).toBe("incorrect");
    expect(grade.skills.spelling?.details?.spelling).toMatchObject({
      matchedVariant: "Monday",
      wordMatched: true,
      letterOrderMatched: true,
      capitalizationCorrect: false,
      capitalizationOnlyDefect: true,
    });
  });

  it("sukces niezależny po przerwie ≥ 12 godzin niesie flagę potwierdzenia", () => {
    const grade = evaluateWritten("Thursday", key(), ctx({ previousSessionContactAt: "2026-10-06T10:00:00.000Z" }));
    expect(grade.skills.recall?.confirmationEligible).toBe(true);
    expect(grade.skills.spelling?.confirmationEligible).toBe(true);
  });

  it("flaga potwierdzenia nie przysługuje błędnej pisowni ani próbie bez przerwy", () => {
    const wrong = evaluateWritten("monday", key({ target: "Monday" }), ctx());
    expect(wrong.skills.spelling?.confirmationEligible).toBe(false);
    const sameSession = evaluateWritten("Thursday", key(), ctx());
    expect(sameSession.skills.recall?.confirmationEligible).toBe(false);
  });

  it("usuwa przypadkowe spacje na początku i końcu odpowiedzi", () => {
    const grade = evaluateWritten("  Thursday  ", key(), ctx());
    expect(grade.skills.recall?.outcome).toBe("correct");
    expect(grade.skills.spelling?.outcome).toBe("correct");
  });

  it("zatwierdzony wariant jest oceniany według zapisanego kontraktu, bez LLM (A36)", () => {
    const friday = key({ target: "Friday", acceptedAnswers: ["Fri."] });
    const exact = evaluateWritten("Fri.", friday, ctx());
    expect(exact.skills.recall?.outcome).toBe("correct");
    expect(exact.skills.spelling?.outcome).toBe("correct");
    expect(exact.skills.spelling?.details?.spelling?.matchedVariant).toBe("Fri.");

    const lower = evaluateWritten("fri.", friday, ctx());
    expect(lower.skills.recall?.outcome).toBe("correct");
    expect(lower.skills.spelling?.outcome).toBe("incorrect");
    expect(lower.skills.spelling?.details?.spelling?.capitalizationOnlyDefect).toBe(true);
  });

  it("przypadkowo podobny wyraz nie jest samoczynnie poprawny (A16)", () => {
    const grade = evaluateWritten("Wensday", key(), ctx());
    expect(grade.skills.recall?.outcome).toBe("incorrect");
    expect(grade.skills.spelling?.outcome).toBe("incorrect");
    expect(grade.skills.spelling?.details?.spelling).toMatchObject({
      matchedVariant: null,
      wordMatched: false,
      letterOrderMatched: false,
    });
  });

  it("299 sekund od ujawnienia nie kwalifikuje Recall; 300 sekund spełnia warunek czasu", () => {
    const late299 = evaluateWritten("Thursday", key(), ctx({ lastExposureAt: "2026-10-07T15:55:01.000Z" }));
    expect(late299.attempt).toEqual({ independent: false, confirmationEligible: false, reason: "recent_exposure" });
    expect(late299.skills.recall?.outcome).toBe("correct");
    expect(late299.skills.recall?.independent).toBe(false);
    expect(late299.skills.recall?.confirmationEligible).toBe(false);

    const exact300 = evaluateWritten("Thursday", key(), ctx({ lastExposureAt: "2026-10-07T15:55:00.000Z" }));
    expect(exact300.attempt.independent).toBe(true);
  });

  it("zadanie słuchowe ocenia wyłącznie listening", () => {
    const grade = evaluateWritten("poniedziałek", key({ exerciseType: "listening", target: "poniedziałek" }), ctx());
    expect(grade.skills.listening?.outcome).toBe("correct");
    expect(grade.skills.spelling).toBeUndefined();
    expect(grade.skills.recall).toBeUndefined();
  });

  it("ocena reading zapisuje kierunek w details (arch §9.3)", () => {
    const forward = evaluateWritten("poniedziałek", key({ exerciseType: "reading", target: "poniedziałek" }), ctx());
    expect(forward.skills.reading?.details?.direction).toBe("target_to_source");

    const reverse = evaluateWritten("Monday", key({ exerciseType: "reverse_recognition", target: "Monday" }), ctx());
    expect(reverse.skills.reading?.details?.direction).toBe("source_to_target");

    const explicit = evaluateWritten(
      "poniedziałek",
      key({ exerciseType: "reading", target: "poniedziałek", direction: "source_to_target" }),
      ctx(),
    );
    expect(explicit.skills.reading?.details?.direction).toBe("source_to_target");
  });

  it("uzupełnianie liter z widocznymi literami to wsparcie, nie samodzielna pisownia (A26, §12.7)", () => {
    const grade = evaluateWritten(
      "Monday",
      key({ exerciseType: "letter_completion", target: "Monday" }),
      ctx({ assistance: ["visible_letters"] }),
    );
    expect(grade.attempt.reason).toBe("assisted");
    expect(grade.skills.recall?.outcome).toBe("correct");
    expect(grade.skills.recall?.independent).toBe(false);
    expect(grade.skills.spelling?.outcome).toBe("correct");
    expect(grade.skills.spelling?.independent).toBe(false);
  });

  it("pusta odpowiedź tekstowa pozostaje nieoceniona jako niejednoznaczna", () => {
    const grade = evaluateWritten("   ", key(), ctx());
    expect(grade.skills.recall).toMatchObject({ outcome: "unevaluated", reason: "ambiguous" });
    expect(grade.skills.spelling).toMatchObject({ outcome: "unevaluated", reason: "ambiguous" });
  });
});

describe("evaluateNonAnswer — „Nie pamiętam” i „Pomiń” (arch §9.1a, SPEC §15.1)", () => {
  it("„Nie pamiętam” w niezależnym kontekście to trudność: incorrect + dont_remember + independent", () => {
    const grade = evaluateNonAnswer("dont_remember", key(), ctx());
    expect(grade.skills.recall).toMatchObject({ outcome: "incorrect", reason: "dont_remember", independent: true });
    expect(grade.skills.spelling).toMatchObject({ outcome: "incorrect", reason: "dont_remember", independent: true });
  });

  it("„Nie pamiętam” we wspomaganym kontekście nie przerywa serii kwalifikującej", () => {
    const grade = evaluateNonAnswer("dont_remember", key(), ctx({ assistance: ["model_audio"] }));
    expect(grade.skills.recall?.independent).toBe(false);
  });

  it("„Pomiń” nie udaje błędu wiedzy: bez oceny, z reason skipped (A32)", () => {
    const grade = evaluateNonAnswer("skip", key(), ctx());
    expect(grade.skills.recall).toMatchObject({ outcome: "unevaluated", reason: "skipped" });
    expect(grade.skills.spelling).toMatchObject({ outcome: "unevaluated", reason: "skipped" });
  });
});
