import { describe, expect, it } from "vitest";
import { assessSpeechEvidence, MIN_STT_CONFIDENCE } from "./speech";
import { LEARNING_V1_POLICY } from "../policies/learning-v1";
import type { SpeechEvidence } from "../ports/ai";
import type { AnswerKey, EvaluationContext, Policy } from "../domain/types";

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

function bandedPolicy(): Policy {
  return {
    ...LEARNING_V1_POLICY,
    pronunciationBands: { "fake-pron": { scaleMax: 100, correctMinScore: 70, partialMinScore: 40 } },
  };
}

function recallKey(overrides: Partial<AnswerKey> = {}): AnswerKey {
  return { exerciseType: "recall", target: "Thursday", acceptedAnswers: [], ...overrides };
}

function speechKey(): AnswerKey {
  return { exerciseType: "speech", target: "Thursday", acceptedAnswers: [] };
}

function evidence(overrides: Partial<SpeechEvidence> = {}): SpeechEvidence {
  return {
    sttProvider: "fake-stt",
    transcription: { status: "ok", text: "Thursday", confidence: 0.9 },
    pronunciation: { status: "ok", overallScore: 95, recognizedText: "Thursday", provider: "fake-pron", expectedText: "Thursday" },
    ...overrides,
  };
}

describe("assessSpeechEvidence — treść z transkrypcji, wymowa osobno (SPEC §23, arch §11)", () => {
  it("wiarygodna transkrypcja zalicza Recall, a wymowa z pasm daje wynik tej umiejętności", () => {
    const grade = assessSpeechEvidence(evidence(), recallKey(), ctx({ policy: bandedPolicy() }));
    expect(grade.skills.recall?.outcome).toBe("correct");
    expect(grade.skills.recall?.independent).toBe(true);
    expect(grade.skills.pronunciation?.outcome).toBe("correct");
    expect(grade.skills.pronunciation?.details?.pronunciation).toEqual({
      provider: "fake-pron",
      score: 95,
      band: "correct",
    });
    // mowa nie dowodzi pisowni — pisana umiejętność pozostaje nieoceniona
    expect(grade.skills.spelling).toBeUndefined();
  });

  it("Review Focus 3: Tuesday z wysokim score wymowy Thursday nie zalicza Recall ani wymowy", () => {
    const grade = assessSpeechEvidence(
      evidence({
        transcription: { status: "ok", text: "Tuesday", confidence: 0.95 },
        pronunciation: { status: "ok", overallScore: 98, recognizedText: "Tuesday", provider: "fake-pron", expectedText: "Thursday" },
      }),
      recallKey(),
      ctx(),
    );
    expect(grade.skills.recall?.outcome).toBe("incorrect");
    // wynik wymowy oczekiwanego słowa jest nieadekwatny — w ogóle nie powstaje ocena
    expect(grade.skills.pronunciation).toBeUndefined();
  });

  it("zatwierdzony wariant zalicza Recall, a wymowy względem innego tekstu nie przenosi się (sofa/couch)", () => {
    const grade = assessSpeechEvidence(
      evidence({
        transcription: { status: "ok", text: "couch", confidence: 0.9 },
        pronunciation: null,
      }),
      recallKey({ target: "sofa", acceptedAnswers: ["couch"] }),
      ctx({ policy: bandedPolicy() }),
    );
    expect(grade.skills.recall?.outcome).toBe("correct");
    // oceniono względem sofa, powiedziano couch — pronunciation pozostaje nieocenione
    expect(grade.skills.pronunciation?.outcome).toBe("unevaluated");
    expect(grade.skills.pronunciation?.details).toBeUndefined();
  });

  it("niepewne rozpoznanie nie jest błędem wiedzy ani myloną parą (SPEC §13.4)", () => {
    const grade = assessSpeechEvidence(
      evidence({
        transcription: { status: "ok", text: "Tuesday", confidence: MIN_STT_CONFIDENCE - 0.01 },
        pronunciation: null,
      }),
      recallKey(),
      ctx(),
    );
    expect(grade.skills.recall?.outcome).toBe("unevaluated");
    expect(grade.skills.recall?.reason).toBe("ambiguous");
    expect(grade.skills.pronunciation?.outcome).toBe("unevaluated");
  });

  it("cisza i awaria dają wynik techniczny, który nie obniża umiejętności", () => {
    const silence = assessSpeechEvidence(
      evidence({ transcription: { status: "no_speech", text: null, confidence: null }, pronunciation: null }),
      recallKey(),
      ctx(),
    );
    expect(silence.skills.recall).toMatchObject({ outcome: "unevaluated", reason: "technical" });

    const failure = assessSpeechEvidence(
      evidence({ transcription: { status: "failed", text: null, confidence: null }, pronunciation: null }),
      recallKey(),
      ctx(),
    );
    expect(failure.skills.recall).toMatchObject({ outcome: "unevaluated", reason: "technical" });
  });

  it("poprawne słowo i awaria oceny wymowy dają wynik częściowy (SPEC §13.5)", () => {
    const grade = assessSpeechEvidence(
      evidence({
        pronunciation: { status: "failed", overallScore: null, recognizedText: null, provider: "fake-pron", expectedText: "Thursday" },
      }),
      recallKey(),
      ctx(),
    );
    expect(grade.skills.recall?.outcome).toBe("correct");
    expect(grade.skills.pronunciation).toMatchObject({ outcome: "unevaluated", reason: "technical" });
  });

  it("bez skalibrowanych pasm wynik wymowy zapisuje się jako dane bez oceny (SPEC §18)", () => {
    const grade = assessSpeechEvidence(evidence(), recallKey(), ctx());
    expect(grade.skills.pronunciation?.outcome).toBe("unevaluated");
    expect(grade.skills.pronunciation?.reason).toBeUndefined();
    expect(grade.skills.pronunciation?.details?.pronunciation).toEqual({ provider: "fake-pron", score: 95 });
  });

  it("pasma rozróżniają wynik pełny, częściowy i niewystarczający", () => {
    const partial = assessSpeechEvidence(
      evidence({ pronunciation: { status: "ok", overallScore: 50, recognizedText: "Thursday", provider: "fake-pron", expectedText: "Thursday" } }),
      recallKey(),
      ctx({ policy: bandedPolicy() }),
    );
    expect(partial.skills.pronunciation?.outcome).toBe("incorrect");
    expect(partial.skills.pronunciation?.details?.pronunciation?.band).toBe("partial");

    const below = assessSpeechEvidence(
      evidence({ pronunciation: { status: "ok", overallScore: 20, recognizedText: "Thursday", provider: "fake-pron", expectedText: "Thursday" } }),
      recallKey(),
      ctx({ policy: bandedPolicy() }),
    );
    expect(below.skills.pronunciation?.outcome).toBe("unevaluated");
    expect(below.skills.pronunciation?.details?.pronunciation?.band).toBe("below");
  });

  it("ćwiczenie wymowy ocenia samą wymowę, nie znajomość odpowiedzi (SPEC §12.6)", () => {
    const grade = assessSpeechEvidence(evidence(), speechKey(), ctx({ policy: bandedPolicy() }));
    expect(grade.skills.pronunciation?.outcome).toBe("correct");
    expect(grade.skills.recall).toBeUndefined();
  });

  it("wsparcie modelu w ćwiczeniu wymowy nie dyskwalifikuje próby (SPEC §13.2)", () => {
    const grade = assessSpeechEvidence(
      evidence(),
      speechKey(),
      ctx({ policy: bandedPolicy(), assistance: ["model_audio"], previousSessionContactAt: "2026-10-06T10:00:00.000Z" }),
    );
    expect(grade.skills.pronunciation?.independent).toBe(true);
    expect(grade.skills.pronunciation?.confirmationEligible).toBe(true);
  });

  it("wsparcie w zadaniu Recall dyskwalifikuje niezależność odpowiedzi ustnej", () => {
    const grade = assessSpeechEvidence(evidence(), recallKey(), ctx({ assistance: ["model_audio"] }));
    expect(grade.skills.recall?.independent).toBe(false);
    expect(grade.skills.pronunciation?.independent).toBe(false);
  });
});

describe("pasma wymowy (design 2026-10-09)", () => {
  it("band correct z fonemami daje speechFragments, a rozjazd słowa używa fallbacku", () => {
    const aligned = evidence({
      pronunciation: {
        status: "ok",
        overallScore: 90,
        recognizedText: "Thursday",
        provider: "fake-pron",
        expectedText: "Thursday",
        words: [{
          text: "thursday",
          accuracyScore: 90,
          errorType: null,
          phonemes: [
            { phoneme: "θ", accuracyScore: 95 },
            { phoneme: "ɜː", accuracyScore: 40 },
            { phoneme: "r", accuracyScore: 92 },
            { phoneme: "s", accuracyScore: 91 },
            { phoneme: "d", accuracyScore: 93 },
            { phoneme: "eɪ", accuracyScore: 92 },
          ],
        }],
      },
    });
    const grade = assessSpeechEvidence(aligned, speechKey(), ctx({ policy: bandedPolicy() }));
    expect(grade.speechFragments).toEqual([
      { text: "th", verdict: "good" },
      { text: "u", verdict: "almost" },
      { text: "rsday", verdict: "good" },
    ]);

    const mismatched = assessSpeechEvidence(
      evidence({ pronunciation: { ...aligned.pronunciation!, words: [{ ...aligned.pronunciation!.words![0]!, text: "Tuesday" }] } }),
      speechKey(),
      ctx({ policy: bandedPolicy() }),
    );
    expect(mismatched.speechFragments).toEqual([{ text: "Thursday", verdict: "good" }]);
  });

  it("below pozostaje nieocenione — niepewna ocena, nie błąd wiedzy", () => {
    const grade = assessSpeechEvidence(
      evidence({
        pronunciation: { status: "ok", overallScore: 30, recognizedText: "Thursday", provider: "fake-pron", expectedText: "Thursday" },
      }),
      speechKey(),
      ctx({ policy: bandedPolicy() }),
    );
    expect(grade.skills.pronunciation?.outcome).toBe("unevaluated");
    expect(grade.skills.pronunciation?.details?.pronunciation).toMatchObject({ score: 30, band: "below" });
  });

  it("speechAttempt jest obecny przy ocenie z pasm — treść domyka zadanie niezależnie od bandu", () => {
    for (const overallScore of [95, 45, 30]) {
      const grade = assessSpeechEvidence(
        evidence({
          pronunciation: { status: "ok", overallScore, recognizedText: "Thursday", provider: "fake-pron", expectedText: "Thursday" },
        }),
        speechKey(),
        ctx({ policy: bandedPolicy() }),
      );
      expect(grade.speechAttempt).toEqual({ contentMatched: true });
    }
  });

  it("partial to trudność (incorrect z bandem), correct zalicza", () => {
    const partial = assessSpeechEvidence(
      evidence({
        pronunciation: { status: "ok", overallScore: 45, recognizedText: "Thursday", provider: "fake-pron", expectedText: "Thursday" },
      }),
      speechKey(),
      ctx({ policy: bandedPolicy() }),
    );
    expect(partial.skills.pronunciation?.outcome).toBe("incorrect");
    expect(partial.skills.pronunciation?.details?.pronunciation).toMatchObject({ band: "partial" });
    expect(partial.skills.pronunciation?.confirmationEligible).toBe(false);

    const correct = assessSpeechEvidence(
      evidence({
        pronunciation: { status: "ok", overallScore: 80, recognizedText: "Thursday", provider: "fake-pron", expectedText: "Thursday" },
      }),
      speechKey(),
      ctx({ policy: bandedPolicy(), previousSessionContactAt: "2026-10-06T10:00:00.000Z" }),
    );
    expect(correct.skills.pronunciation?.outcome).toBe("correct");
    expect(correct.skills.pronunciation?.confirmationEligible).toBe(true);
  });
});
