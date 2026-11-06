import { describe, expect, it } from "vitest";
import { normalizeTokens } from "../../normalize";
import type { LessonTopic } from "../../types";
import { englishGrammarSubject } from "./module";
import { grammarTypeExamples } from "./type-examples";

/**
 * Przykłady typów tematu Present Continuous (`agentPolicy.typeExamples`) nie powtarzają zdań z kart tematu:
 * model kopiuje przykłady, a ćwiczenie równe przykładowi karty niczego nie sprawdza (ślepa ocena
 * sondy Present Continuous: „Tom isn't playing football now.” jak na karcie). Walidację przykładów
 * w ich celach sprawdza `rules/type-cards.test.ts`.
 */

/** Najkrótszy fragment karty traktowany jako zdanie (krótsze to formy, np. „she is”). */
const MIN_SENTENCE_TOKENS = 3;

const joined = (text: string): string => normalizeTokens(text).join(" ");

/** Zdania kart tematu: fragmenty między znakami końca zdania, dwukropkiem, przecinkiem i myślnikiem. */
function cardSentences(topic: LessonTopic): string[] {
  return topic.objectives
    .flatMap((objective) => objective.cards.flatMap((card) => card.body.split(/[.!?:;,—→]/u)))
    .map(joined)
    .filter((sentence) => sentence.split(" ").length >= MIN_SENTENCE_TOKENS);
}

/** Angielskie teksty przykładu: rozwiązanie (luka wypełniona kluczem), bodźce, opcje i klocki. */
function exampleTexts(example: Readonly<Record<string, unknown>>): string[] {
  const answer = String(example.answer ?? "");
  const stem = typeof example.stem === "string" ? [example.stem.replace("___", answer)] : [];
  const fields = ["statement", "prompt"].flatMap((key) => (typeof example[key] === "string" ? [example[key] as string] : []));
  const options = Array.isArray(example.options) ? (example.options as { text: string }[]).map((option) => option.text) : [];
  const segments = Array.isArray(example.noticeSegments) ? (example.noticeSegments as string[][]).map((words) => words.join(" ")) : [];
  return [answer, ...stem, ...fields, ...options, ...segments].map(joined).filter((text) => text !== "");
}

// Karty „to be” wymieniają gołe formy po przecinku („I am not, she is not”), więc test dotyczy tematu Present Continuous.
describe("przykłady typów tematu present_continuous", () => {
  const topicId = "present_continuous";
  const topic = englishGrammarSubject.topics.find((candidate) => candidate.id === topicId)!;
  const sentences = cardSentences(topic);

  it("karty tematu mają zdania do porównania", () => {
    expect(sentences.length).toBeGreaterThan(0);
  });

  it.each(topic.objectives.map((objective) => objective.id))("%s: żaden przykład nie zawiera zdania karty ani nie jest jego częścią", (objectiveId) => {
    const examples = grammarTypeExamples({ topicId, objectiveId });
    expect(examples, objectiveId).toBeDefined();
    const repeated = Object.entries(examples!).flatMap(([type, example]) =>
      exampleTexts(example!).flatMap((text) =>
        sentences
          .filter((sentence) =>
            ` ${text} `.includes(` ${sentence} `) ||
            (text.split(" ").length >= MIN_SENTENCE_TOKENS && ` ${sentence} `.includes(` ${text} `)))
          .map((sentence) => `${type}: „${text}” ~ karta „${sentence}”`),
      ),
    );
    expect(repeated).toEqual([]);
  });
});
