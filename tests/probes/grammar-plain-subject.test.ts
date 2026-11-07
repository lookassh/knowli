import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentObjectivesOf } from "../../packages/server/src/domain/lessons/agent/capable";
import { createLessonAgentState } from "../../packages/server/src/domain/lessons/agent/state";
import { cardExposureSources } from "../../packages/server/src/domain/lessons/card-exposure-sources";
import { createSubjectRegistry } from "../../packages/server/src/domain/lessons/registry";
import { englishGrammarSubject } from "../../packages/server/src/domain/lessons/subjects/english-grammar/module";
import { GRAMMAR_RULES } from "../../packages/server/src/domain/lessons/subjects/english-grammar/rules";
import type { LessonRule } from "../../packages/server/src/domain/lessons/rules/catalog";
import type { SubjectModule } from "../../packages/server/src/domain/lessons/types";
import { lessonAgentLimits } from "../../packages/server/src/modules/materials/lessons/lesson-pool-agent";
import { objectiveAgentInput } from "../../packages/server/src/modules/materials/lessons/lesson-pool-agent-input";
import { objectiveInstructions } from "../../packages/server/src/providers/openai/lesson-pool-agent";
import { GUIDANCE_TEXTS, grammarPlainSubject, probeVariantOf } from "./grammar-plain-subject";
import { resolveOutsideRepoPath } from "./probe-helpers";

const production = GRAMMAR_RULES as Readonly<Record<string, LessonRule>>;

function promptOf(subject: SubjectModule, topicId: string, objectiveId: string): string {
  const topic = subject.topics.find((candidate) => candidate.id === topicId)!;
  const objectives = agentObjectivesOf(topic);
  const state = createLessonAgentState({ topic, objectives, fixed: [], examples: {}, fixedSources: cardExposureSources(subject, topic) });
  const input = objectiveAgentInput({
    subject,
    topic,
    state,
    objective: objectives.find((candidate) => candidate.id === objectiveId)!,
    limits: lessonAgentLimits(subject, topic, 0).get(objectiveId)!,
    material: "",
    graderAvailable: true,
    examplesFixed: false,
    maxSteps: 8,
    callTimeoutMs: 90_000,
  });
  return objectiveInstructions(input);
}

describe("grammarPlainSubject (sonda etapu 2)", () => {
  it("registers, has no subject validator and keeps only guidance under the same rule ids and fields", () => {
    const plain = grammarPlainSubject();
    expect(() => createSubjectRegistry([plain])).not.toThrow();
    expect(plain.validateExercise({} as never, {} as never)).toEqual([]);
    const rules = plain.rules as Readonly<Record<string, LessonRule>>;
    expect(Object.keys(rules).length).toBeGreaterThan(0);
    for (const [id, rule] of Object.entries(rules)) {
      const source = production[id]!;
      expect(source, id).toBeDefined();
      for (const field of ["field", "kind", "types", "when", "priority"] as const) expect(rule[field], `${id}.${field}`).toBe(source[field]);
      const texts = GUIDANCE_TEXTS.filter((text) => (source.description as string).includes(text));
      expect(rule.description, id).toBe(texts.map((text) => text.trim()).join(" "));
    }
    for (const text of GUIDANCE_TEXTS) {
      expect(Object.values(rules).some((rule) => (rule.description as string).includes(text.trim()))).toBe(true);
    }
  });

  it("reads the probe variant", () => {
    expect(probeVariantOf(undefined)).toBe("agent");
    expect(probeVariantOf(" baseline ")).toBe("baseline");
    expect(probeVariantOf("agent_plain")).toBe("agent_plain");
    expect(() => probeVariantOf("other")).toThrow();
  });

  it("the to-be fixture lists the catalog objectives of to_be v1 without contractions (owner decision 2026-11-07)", () => {
    const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures", "to-be-objectives.json"), "utf8")) as { topicId: string; topicVersion: number; objectives: { id: string }[] };
    const topic = englishGrammarSubject.topics.find((candidate) => candidate.id === fixture.topicId && candidate.version === fixture.topicVersion)!;
    const expected = topic.objectives.map((objective) => objective.id).filter((id) => id !== "english_grammar.to_be.contractions");
    expect(fixture.objectives.map((objective) => objective.id)).toEqual(expected);
  });

  it("writes agent vs agent_plain prompts for every objective when UMIEM_PROBE_PROMPT_DIFF_OUT is set", () => {
    const out = resolveOutsideRepoPath(process.env.UMIEM_PROBE_PROMPT_DIFF_OUT, "UMIEM_PROBE_PROMPT_DIFF_OUT");
    const plain = grammarPlainSubject();
    const rows: string[] = [];
    for (const topic of englishGrammarSubject.topics) {
      for (const objective of topic.objectives) {
        const agent = promptOf(englishGrammarSubject, topic.id, objective.id);
        const agentPlain = promptOf(plain, topic.id, objective.id);
        expect(agentPlain.length, objective.id).toBeLessThan(agent.length);
        rows.push(`${objective.id}\tagent=${agent.length}\tagent_plain=${agentPlain.length}`);
        if (out !== undefined) {
          mkdirSync(out, { recursive: true });
          writeFileSync(join(out, `${objective.id}.agent.txt`), agent, "utf8");
          writeFileSync(join(out, `${objective.id}.agent_plain.txt`), agentPlain, "utf8");
        }
      }
    }
    if (out !== undefined) writeFileSync(join(out, "chars.tsv"), `${rows.join("\n")}\n`, "utf8");
  });
});
