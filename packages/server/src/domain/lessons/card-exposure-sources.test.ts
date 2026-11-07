import { describe, expect, it } from "vitest";
import { cardExposureSources } from "./card-exposure-sources";
import { englishCardSentences } from "./subjects/english/card-sentences";
import { englishChapterSubject } from "./subjects/english-chapter/module";
import { englishGrammarSubject } from "./subjects/english-grammar/module";
import { schoolSubject } from "./subjects/school/module";
import type { LearningObjective, LessonTopic, SubjectModule } from "./types";

function objective(id: string, body: string): LearningObjective {
  return {
    id,
    titlePl: id,
    descriptionEn: id,
    cards: [{ title: "Karta", body }],
    errorCategories: [],
    hints: {},
    exerciseTypes: [],
  };
}

const topic: Pick<LessonTopic, "objectives"> = {
  objectives: [objective("o1", "Card one."), objective("o2", "Card two."), objective("o3", "x")],
};

const subject: Pick<SubjectModule, "cardExposureTexts"> = {
  cardExposureTexts: (cards) => cards.map((card) => card.body).filter((body) => body.endsWith(".")),
};

describe("cardExposureSources", () => {
  it("zagadnienie → teksty z kart; zagadnienia bez tekstów pomijane", () => {
    expect(cardExposureSources(subject, topic)).toEqual({ o1: ["Card one."], o2: ["Card two."] });
  });

  it("przedmiot bez haka nie daje źródeł", () => {
    expect(cardExposureSources({}, topic)).toEqual({});
  });

  it("rozdział i gramatyka (#328) mają wspólny hak zdań angielskich; przedmioty szkolne go nie mają", () => {
    expect(englishChapterSubject.cardExposureTexts).toBe(englishCardSentences);
    expect(englishGrammarSubject.cardExposureTexts).toBe(englishCardSentences);
    expect(schoolSubject.cardExposureTexts).toBeUndefined();
  });

  it("gramatyka: zdania z kart każdego tematu są źródłami, karta bez zdań i szablon {{examples}} nie", () => {
    const pc = englishGrammarSubject.topics.find((item) => item.id === "present_continuous")!;
    const sources = cardExposureSources(englishGrammarSubject, pc);
    expect(sources["english_grammar.present_continuous.now_or_usually"]).toEqual(
      expect.arrayContaining(["Dad cooks dinner every day.", "Dad is cooking now.", "Tom rides his bike every day."]),
    );
    expect(Object.values(sources).flat().some((text) => text.includes("{{"))).toBe(false);
    // Świadomy koszt (#328): ekstraktor dzieli prozę kart po znakach, więc przechodzą też krótkie formy
    // („Do / Does.” → „Does.”) i polskie frazy bez diakrytyków. Odpowiedź samodzielna gramatyki to angielskie zdanie.
    expect(sources["english_grammar.present_continuous.now_or_usually_more"]).toEqual(expect.arrayContaining(["Does.", "teraz."]));
    expect(sources["english_grammar.present_continuous.now_or_usually"]).toContain("Tom jedzie na rowerze");
    const toBe = cardExposureSources(englishGrammarSubject, englishGrammarSubject.topics.find((item) => item.id === "to_be")!);
    // Zdania po „→” (przekształcenia i krótkie odpowiedzi) też są źródłami.
    expect(toBe["english_grammar.to_be.questions"]).toEqual(expect.arrayContaining(["Is she happy?", "Are they ready?"]));
    expect(toBe["english_grammar.to_be.short_answers"]).toEqual(expect.arrayContaining(["Yes, I am.", "No, they aren't."]));
    for (const topic of englishGrammarSubject.topics) expect(Object.keys(cardExposureSources(englishGrammarSubject, topic)).length).toBeGreaterThan(0);
  });
});
