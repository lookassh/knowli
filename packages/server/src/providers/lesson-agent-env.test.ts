import { afterEach, describe, expect, it, vi } from "vitest";
import { withConfigDefaults } from "../config-defaults";
import { createProductionSubjectRegistry } from "../domain/lessons/subjects";
import { FakeLlmProvider } from "./fake";
import { FakeExerciseChecker, FakeLessonPoolAgent } from "./fake-lesson-agent";
import { lessonAgentDepsFromEnv } from "./lesson-agent-env";
import { createTestRecorder } from "./usage/test-recorder";

const subjects = createProductionSubjectRegistry();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lessonAgentDepsFromEnv", () => {
  it("tryb fake z listą → fake'i bez klucza: agent „jak LLM”, checker niedostępny, polityka z env", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const llm = new FakeLlmProvider();
    const env = withConfigDefaults({
      UMIEM_FAKE_PROVIDERS: "1",
      UMIEM_LESSON_AGENT_SUBJECTS: "english_chapter, english_grammar",
      UMIEM_LESSON_AGENT_MAX_STEPS: "5",
    });
    const deps = lessonAgentDepsFromEnv(env, subjects, createTestRecorder(), llm)!;
    expect(deps.subjects).toEqual(new Set(["english_chapter", "english_grammar"]));
    expect(deps.agent).toBeInstanceOf(FakeLessonPoolAgent);
    expect(deps.checker).toBeInstanceOf(FakeExerciseChecker);
    expect(deps.policy).toMatchObject({ maxStepsPerObjective: 5, planMaxSteps: 5, concurrency: 4 });
    const solved = await deps.checker.solve({ items: [{ view: "v", expectedAnswers: 1 }] }, { record: () => undefined }, new AbortController().signal);
    expect(solved.answers).toEqual([null]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("tryb fake waliduje listę: nieznany przedmiot to błąd startu", () => {
    expect(() =>
      lessonAgentDepsFromEnv({ UMIEM_FAKE_PROVIDERS: "1", UMIEM_LESSON_AGENT_SUBJECTS: "history" }, subjects),
    ).toThrow(/UMIEM_LESSON_AGENT_SUBJECTS/u);
  });

  it("bez listy → undefined (tryb fake i z kluczem)", () => {
    expect(lessonAgentDepsFromEnv(withConfigDefaults({ UMIEM_FAKE_PROVIDERS: "1" }), subjects)).toBeUndefined();
    expect(lessonAgentDepsFromEnv(withConfigDefaults({ OPENROUTER_API_KEY: "sk-or-v1-test" }), subjects)).toBeUndefined();
  });

  it("lista bez klucza poza trybem fake → undefined (potok)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(lessonAgentDepsFromEnv(withConfigDefaults({ UMIEM_LESSON_AGENT_SUBJECTS: "english_chapter" }), subjects)).toBeUndefined();
  });

  it("z kluczem → instancje adaptera AI SDK z modelami z env", () => {
    const env = withConfigDefaults({
      OPENROUTER_API_KEY: "sk-or-v1-test",
      UMIEM_LESSON_AGENT_SUBJECTS: "english_chapter",
      UMIEM_LESSON_AGENT_MODEL: "google/gemini-test",
      UMIEM_LESSON_AGENT_CHECKER_MODEL: "deepseek/deepseek-test",
      UMIEM_LESSON_AGENT_CONCURRENCY: "2",
    });
    const deps = lessonAgentDepsFromEnv(env, subjects, createTestRecorder())!;
    expect(deps.subjects).toEqual(new Set(["english_chapter"]));
    // Adapter bez importu w teście: jedynym importerem adaptera jest lesson-agent-env.ts (test architektury).
    expect(deps.agent.constructor.name).toBe("AiSdkLessonPoolAgent");
    expect(deps.agent.name).toBe("ai-sdk-openrouter");
    expect(deps.agent.model).toBe("google/gemini-test");
    expect(deps.checker.constructor.name).toBe("AiSdkExerciseChecker");
    expect(deps.checker.model).toBe("deepseek/deepseek-test");
    expect(deps.policy).toMatchObject({ concurrency: 2 });
  });
});
