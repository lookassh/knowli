import { describe, expect, it } from "vitest";
import { defaultMediaSettings } from "../../config";
import { requiredAssetsForLessonExercise } from "./media-reconciliation";

describe("requiredAssetsForLessonExercise — nagranie pytania (design szkoły §11.2)", () => {
  const choice = {
    exerciseType: "lesson_choice",
    instructionPl: "Wybierz odpowiedź.",
    stem: "Ile nóg ma pająk?",
    options: [{ id: "a", text: "osiem" }, { id: "b", text: "sześć" }],
    answer: "osiem",
    answerLocale: "pl-PL",
  };

  it("`ttsForPrompts` zleca `prompt_audio` po polsku z polecenia i pytania, bez opcji", () => {
    const required = requiredAssetsForLessonExercise(choice, defaultMediaSettings, { ttsForAnswers: false, ttsForPrompts: true });
    expect(required.map((asset) => asset.role)).toEqual(["prompt_audio"]);
    expect(required[0]!.metadata).toMatchObject({ kind: "tts", text: "Wybierz odpowiedź. Ile nóg ma pająk?", locale: "pl-PL" });
  });

  it("zmiana treści pytania zmienia fingerprint (nowe nagranie przy edycji)", () => {
    const flags = { ttsForAnswers: false, ttsForPrompts: true };
    const before = requiredAssetsForLessonExercise(choice, defaultMediaSettings, flags)[0]!.fingerprint;
    const after = requiredAssetsForLessonExercise({ ...choice, stem: "Ile nóg ma owad?" }, defaultMediaSettings, flags)[0]!.fingerprint;
    expect(after).not.toBe(before);
  });

  it("bez flag nic nie zleca; obliczenia nie mają nagrania pytania", () => {
    expect(requiredAssetsForLessonExercise(choice, defaultMediaSettings, { ttsForAnswers: false, ttsForPrompts: false })).toEqual([]);
    expect(requiredAssetsForLessonExercise({ exerciseType: "lesson_calculation", instructionPl: "Oblicz.", prompt: "3/4 + 1/2", answer: "5/4", answerLocale: "pl-PL" },
      defaultMediaSettings, { ttsForAnswers: false, ttsForPrompts: true })).toEqual([]);
  });

  it("`ttsForAnswers` nadal zleca `target_audio` odpowiedzi", () => {
    const required = requiredAssetsForLessonExercise({ ...choice, answerLocale: "en-GB", answer: "eight" }, defaultMediaSettings, { ttsForAnswers: true, ttsForPrompts: false });
    expect(required.map((asset) => asset.role)).toEqual(["target_audio"]);
  });
});
