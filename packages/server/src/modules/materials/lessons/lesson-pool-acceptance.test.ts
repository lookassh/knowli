import { describe, expect, it } from "vitest";
import { englishChapterSubject } from "../../../domain/lessons/subjects/english-chapter/module";
import { englishGrammarSubject } from "../../../domain/lessons/subjects/english-grammar/module";
import { schoolSubject } from "../../../domain/lessons/subjects/school/module";
import type { SubjectModule } from "../../../domain/lessons/types";
import { toExerciseDraft } from "./lesson-drafts";
import { sanitizeFreshLessonDraft, UNSOLICITED_V3_FIELDS } from "./lesson-pool-acceptance";

const OBJECTIVE_ID = "english_grammar.present_simple.third_person_s";

/** Poprawny kształtowo lesson_choice (surowy obiekt z portu); `stem` odróżnia ćwiczenia. */
function choiceRaw(answer: string, stem = `She ___ ${answer}.`) {
  return {
    exerciseType: "lesson_choice",
    objectiveId: OBJECTIVE_ID,
    instructionPl: "Wybierz.",
    stem,
    answer,
    acceptedAnswers: [],
    focus: [],
    options: [
      { id: "a", text: answer },
      { id: "b", text: `${answer}x` },
    ],
    correctOption: "a",
  };
}

describe("sanitizeFreshLessonDraft (wspólna sanityzacja świeżego ćwiczenia)", () => {
  const draftOf = (raw: Record<string, unknown>) => toExerciseDraft(raw as Parameters<typeof toExerciseDraft>[0]);

  it("usuwa pustą tablicę opcjonalną (options: [])", () => {
    const draft = draftOf({ ...choiceRaw("plays"), options: [] });
    expect(draft.options).toEqual([]);
    expect(sanitizeFreshLessonDraft(draft, englishGrammarSubject, null)).not.toHaveProperty("options");
  });

  it("usuwa dodatki modelu z ćwiczenia słuchowego (polecenie, podpowiedź, piktogram)", () => {
    const draft = draftOf({
      ...choiceRaw("plays"),
      exerciseType: "lesson_listen_choice",
      instructionPl: "Posłuchaj.",
      hint: "Podpowiedź.",
      visualSubject: "cat",
    });
    expect(draft.instructionPl).toBe("Posłuchaj.");
    const out = sanitizeFreshLessonDraft(draft, englishGrammarSubject, null);
    expect(out).not.toHaveProperty("instructionPl");
    expect(out).not.toHaveProperty("hint");
    expect(out).not.toHaveProperty("visualSubject");
  });

  it("familyScope dopisuje sufiks runu do rodziny; null jej nie rusza", () => {
    // Rodziny to pole v3: tylko przedmiot z `usesV3Payload` (szkoła) je zachowuje.
    const draft = draftOf({ ...choiceRaw("plays"), familyId: "f1" });
    expect(sanitizeFreshLessonDraft(draft, schoolSubject, null).familyId).toBe("f1");
    expect(sanitizeFreshLessonDraft(draft, schoolSubject, "3f2a9c1e-0000-4000-8000-000000000000").familyId)
      .toBe("f1-r3f2a9c");
  });

  it("usuwa niezamówione pola v3 (bez calculation) w rozdziale i gramatyce, a w szkole je zostawia", () => {
    const draft = draftOf({ ...choiceRaw("plays"), sourceRefs: [{ quote: "She plays." }], familyId: "f1", questionType: "fact" });
    for (const subject of [englishChapterSubject, englishGrammarSubject]) {
      const out = sanitizeFreshLessonDraft(draft, subject, null);
      for (const field of UNSOLICITED_V3_FIELDS) expect(out, `${subject.id}: ${field}`).not.toHaveProperty(field);
    }
    const school = sanitizeFreshLessonDraft(draft, schoolSubject, null);
    expect(school.sourceRefs).toEqual([{ quote: "She plays." }]);
    expect(school.questionType).toBe("fact");
    expect(UNSOLICITED_V3_FIELDS).not.toContain("calculation");
  });

  it("usuwa wariant redundantny wobec odpowiedzi kanonicznej", () => {
    const draft = draftOf({ ...choiceRaw("plays"), acceptedAnswers: ["plays", "plays"] });
    expect(sanitizeFreshLessonDraft(draft, englishGrammarSubject, null).acceptedAnswers).toEqual([]);
  });

  it("usuwa ton głosu dla przedmiotu bez TTS promptów, a zostawia go dla przedmiotu z TTS", () => {
    const draft = draftOf({ ...choiceRaw("plays"), voiceTone: "curious" });
    expect(draft.voiceTone).toBe("curious");
    expect(sanitizeFreshLessonDraft(draft, englishGrammarSubject, null)).not.toHaveProperty("voiceTone");
    const withTts: SubjectModule = { ...englishGrammarSubject, ttsForPrompts: true };
    expect(sanitizeFreshLessonDraft(draft, withTts, null).voiceTone).toBe("curious");
  });

  it("niepoprawne wyjaśnienie jest usuwane; poprawne zostaje", () => {
    const bad = draftOf({ ...choiceRaw("plays"), explanationPl: "Pierwsze zdanie. Drugie zdanie." });
    expect(sanitizeFreshLessonDraft(bad, englishGrammarSubject, null)).not.toHaveProperty("explanationPl");
    const good = draftOf({ ...choiceRaw("plays"), explanationPl: "Przy he, she, it dodajemy -s." });
    expect(sanitizeFreshLessonDraft(good, englishGrammarSubject, null).explanationPl).toBe("Przy he, she, it dodajemy -s.");
    // Przedmiot bez wyjaśnień: wyjaśnienie usunięte.
    expect(sanitizeFreshLessonDraft(good, schoolSubject, null)).not.toHaveProperty("explanationPl");
  });
});
