import { describe, expect, it } from "vitest";
import { agentObjectivesOf } from "../../domain/lessons/agent/capable";
import { createLessonAgentState } from "../../domain/lessons/agent/state";
import { cardExposureSources } from "../../domain/lessons/card-exposure-sources";
import { englishChapterSubject } from "../../domain/lessons/subjects/english-chapter/module";
import { englishGrammarSubject } from "../../domain/lessons/subjects/english-grammar/module";
import { schoolSubject } from "../../domain/lessons/subjects/school/module";
import { validateDynamicTopicData } from "../../domain/lessons/topic-resolution";
import type { LessonTopic, SubjectModule } from "../../domain/lessons/types";
import { buildDynamicTopicData, withSubjectObjectiveKinds } from "../../modules/materials/lessons/lesson-drafts";
import { lessonAgentLimits } from "../../modules/materials/lessons/lesson-pool-agent";
import { objectiveAgentInput } from "../../modules/materials/lessons/lesson-pool-agent-input";
import type { LessonObjectiveAgentInput } from "../../ports/ai";
import { FakeLlmProvider } from "../fake";

/**
 * Migawki promptów przebiegu bazowego (paczka i kontrola zamkniętych) na fikcyjnych materiałach z testów;
 * zmiana reguły albo pola przedmiotu widać w diffie PR. Prompt podagenta agenta nie ma już przedmiotu
 * produkcyjnego (rozdział od etapu 5a, szkoła od 5b) — znika z agentem w 5c.
 */

const CHAPTER_MATERIAL = ["Słowa:", "coat — płaszcz", "boots — buty", "scarf — szalik", "gloves — rękawiczki", "Zwroty:", "I am wearing …", "Put on your …"].join("\n");
const SCHOOL_MATERIAL = [
  "Zagadnienie 1: Rzeki Polski",
  "Wisła jest najdłuższą rzeką Polski. Odra płynie na zachodzie kraju.",
  "Zagadnienie 2: Góry Polski",
  "Tatry są najwyższymi górami Polski. Sudety leżą na południowym zachodzie.",
  "Zagadnienie 3: Morze",
  "Bałtyk jest morzem śródlądowym. Hel to półwysep.",
].join("\n");

interface PromptFixture {
  readonly subject: SubjectModule;
  readonly topic: LessonTopic;
  readonly input: LessonObjectiveAgentInput;
}

function fixtureFor(args: {
  subject: SubjectModule;
  topic: LessonTopic;
  material: string;
  objectiveId: string;
  examples?: Readonly<Record<string, readonly string[]>>;
  examplesFixed?: boolean;
}): PromptFixture {
  const { subject, topic } = args;
  const limits = lessonAgentLimits(subject, topic, 0);
  const objectives = agentObjectivesOf(topic);
  const state = createLessonAgentState({ topic, objectives, fixed: [], examples: args.examples ?? {}, fixedSources: cardExposureSources(subject, topic) });
  const objective = objectives.find((candidate) => candidate.id === args.objectiveId)!;
  const input = objectiveAgentInput({
    subject,
    topic,
    state,
    objective,
    limits: limits.get(objective.id)!,
    material: args.material,
    graderAvailable: true,
    examplesFixed: args.examplesFixed ?? false,
    maxSteps: 8,
    callTimeoutMs: 90_000,
  });
  return { subject, topic, input };
}

async function fixtures(): Promise<Record<string, PromptFixture>> {
  // Gramatyka generuje się przebiegiem bazowym (etap 4 #358): prompt agenta mają tylko szkoła i rozdział.
  const { objectives } = await new FakeLlmProvider().generateLessonObjectives({
    subjectTitle: schoolSubject.titlePl,
    topicTitle: "Polska",
    material: SCHOOL_MATERIAL,
    generationRole: schoolSubject.prompts.generationRole,
  });
  const built = buildDynamicTopicData(objectives, schoolSubject.id, "42", "Polska", (objective) =>
    validateDynamicTopicData(schoolSubject, { titlePl: "Polska", objectives: [objective] }),
  );
  const schoolTopic = schoolSubject.buildDynamicTopic!(withSubjectObjectiveKinds(schoolSubject, built.data!));
  const school = fixtureFor({ subject: schoolSubject, topic: schoolTopic, material: SCHOOL_MATERIAL, objectiveId: schoolTopic.objectives[0]!.id });

  // Zagadnienia jak z etapu zagadnień trybu fake (dwa zagadnienia słów i rama), przykłady ustalone.
  const chapterObjectives = [
    { kind: "words", body: "coat, boots", example: "coat" },
    { kind: "words", body: "scarf, gloves", example: "scarf" },
    { kind: "frame", body: "I am wearing …\nPut on your …", example: "I am wearing …" },
  ].map(({ kind, body, example }, index) => ({
    slug: `part_${index + 1}`,
    titlePl: `Część ${index + 1}`,
    descriptionEn: `Part ${index + 1} of Unit 1.`,
    kind,
    cards: [
      { title: kind === "words" ? "Words" : "Frames", body },
      { title: "Topic", body: "Unit 1" },
    ],
    examples: [example],
  }));
  const data = buildDynamicTopicData(chapterObjectives, englishChapterSubject.id, "42", "Unit 1").data!;
  const examples = Object.fromEntries(data.objectives.map((objective, index) => [objective.id, chapterObjectives[index]!.examples]));
  const chapterTopic = englishChapterSubject.buildDynamicTopic!(data);
  const chapter = fixtureFor({
    subject: englishChapterSubject,
    topic: chapterTopic,
    material: CHAPTER_MATERIAL,
    objectiveId: chapterTopic.objectives[0]!.id,
    examples,
    examplesFixed: true,
  });
  return { school, english_chapter: chapter };
}

const FIXTURES = await fixtures();
// Szkoła (etap 5b) i rozdział (5a) nie przechodzą przez agenta — migawki promptu podagenta usunięte.
describe("prompt paczki i kontroli przebiegu bazowego (etap 2, migawki)", () => {
  it("paczka PC affirmative × lesson_choice z przykładami kart i obie kontrole", async () => {
    const { packetInput } = await import("../../modules/materials/lessons/lesson-baseline-pool");
    const { closedCheckPrompt, packetInstructions } = await import("./lesson-pool-agent");
    const topic = englishGrammarSubject.topics.find((candidate) => candidate.id === "present_continuous")!;
    const objective = topic.objectives.find((candidate) => candidate.id === "english_grammar.present_continuous.affirmative")!;
    const input = packetInput({
      subject: englishGrammarSubject,
      topic,
      objective,
      type: "lesson_choice",
      count: 4,
      withExamples: true,
      material: "",
      graderAvailable: true,
      avoidSentences: [],
      timeoutMs: 90_000,
    });
    const prompt = packetInstructions(input);
    // Dydaktyka celu z katalogu (etap 4 #358) stoi zaraz po opisie celu, a bez notatek wiersza nie ma.
    expect(prompt).toContain(`Teaching notes: ${objective.generationNotesEn}`);
    const plain = packetInput({ subject: englishGrammarSubject, topic, objective: { ...objective, generationNotesEn: undefined }, type: "lesson_choice", count: 4, withExamples: false, material: "", graderAvailable: true, avoidSentences: [], timeoutMs: 90_000 });
    expect(packetInstructions(plain)).not.toContain("Teaching notes:");
    expect(prompt).not.toContain("the tool checks");
    expect(prompt).not.toMatch(/\blesson_gap —/u);
    await expect(prompt).toMatchFileSnapshot("./__snapshots__/lesson-packet-prompt.english_grammar_present_continuous.txt");
    const check = [
      closedCheckPrompt({ contract: "choice", items: [{ view: "She ___ reading.\nOptions: are | is" }] }),
      closedCheckPrompt({ contract: "order", items: [{ view: "Ułóż zdanie.\nWord blocks (shuffled): is | reading | She\nArranged answer: She is reading." }] }),
    ].join("\n\n----\n\n");
    await expect(check).toMatchFileSnapshot("./__snapshots__/lesson-closed-check-prompt.txt");
  });

  it("kontrola z materiałem lekcji (szkoła, etap 5b): materiał przed pozycjami, bez „learning English”", async () => {
    const { closedCheckPrompt } = await import("./lesson-pool-agent");
    const material = "Korzeń pobiera wodę z gleby.";
    const check = [
      closedCheckPrompt({ contract: "choice", items: [{ view: "Co pobiera wodę z gleby?\nOptions: korzeń | liść" }], material }),
      closedCheckPrompt({ contract: "order", items: [{ view: "Ułóż kroki.\nWord blocks (shuffled): b | a\nArranged answer: a b" }], material }),
    ];
    for (const prompt of check) {
      expect(prompt).not.toContain("learning English");
      expect(prompt.indexOf("<MATERIAL>")).toBeGreaterThan(-1);
      expect(prompt.indexOf("<MATERIAL>")).toBeLessThan(prompt.indexOf("<ITEMS>"));
    }
    await expect(check.join("\n\n----\n\n")).toMatchFileSnapshot("./__snapshots__/lesson-closed-check-prompt.school.txt");
  });

  it("paczka rozdziału: zagadnienie słów × lesson_cloze (etap 5a #362)", async () => {
    const { packetInput } = await import("../../modules/materials/lessons/lesson-baseline-pool");
    const { packetInstructions } = await import("./lesson-pool-agent");
    const { topic } = FIXTURES.english_chapter!;
    const objective = topic.objectives[0]!;
    expect(objective.exerciseTypes).toContain("lesson_cloze");
    const input = packetInput({
      subject: englishChapterSubject,
      topic,
      objective,
      type: "lesson_cloze",
      count: 4,
      withExamples: true,
      material: CHAPTER_MATERIAL,
      graderAvailable: true,
      avoidSentences: [],
      timeoutMs: 90_000,
    });
    await expect(packetInstructions(input)).toMatchFileSnapshot("./__snapshots__/lesson-packet-prompt.english_chapter_words_cloze.txt");
  });

  it("paczka szkoły: pytania otwarte z keywords tej samej odpowiedzi (etap 5b, wariant A)", async () => {
    const { packetInput } = await import("../../modules/materials/lessons/lesson-baseline-pool");
    const { packetInstructions } = await import("./lesson-pool-agent");
    const { topic, input: base } = FIXTURES.school!;
    const objective = topic.objectives[0]!;
    const input = packetInput({
      subject: schoolSubject,
      topic,
      objective,
      type: "lesson_open_answer",
      companion: "lesson_keywords",
      count: 5,
      withExamples: false,
      material: base.pool.material,
      graderAvailable: true,
      avoidSentences: [],
      timeoutMs: 90_000,
    });
    expect(input.pool.exerciseTypes).toEqual(["lesson_open_answer", "lesson_keywords"]);
    const prompt = packetInstructions(input);
    expect(prompt).toContain("Write it in the same response as the lesson_open_answer exercises");
    await expect(prompt).toMatchFileSnapshot("./__snapshots__/lesson-packet-prompt.school_open_answer.txt");
  });
});
