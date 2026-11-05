import { describe, expect, it } from "vitest";
import { AgentCheckRun, hintKey, openKey } from "./lesson-agent-check-run";
import { DEFAULT_LESSON_AGENT_POLICY } from "./lesson-pool-agent-policy";

describe("AgentCheckRun", () => {
  it("semafor gradera ma graderConcurrency miejsc, pamięci są puste", () => {
    const run = new AgentCheckRun({ ...DEFAULT_LESSON_AGENT_POLICY, graderConcurrency: 2 });
    expect(run.graderSemaphore.limit).toBe(2);
    expect(run.hintMemo.size).toBe(0);
    expect(run.openMemo.size).toBe(0);
    expect(run.graderOpen()).toBe(false);
  });

  it("wyłącznik otwiera się po graderBreakerThreshold kolejnych porażkach i zgłasza to raz", () => {
    const run = new AgentCheckRun(DEFAULT_LESSON_AGENT_POLICY);
    expect(run.recordGraderFailure()).toBe(false);
    expect(run.recordGraderFailure()).toBe(false);
    expect(run.graderOpen()).toBe(false);
    expect(run.recordGraderFailure()).toBe(true);
    expect(run.graderOpen()).toBe(true);
    expect(run.recordGraderFailure()).toBe(false);
    // Otwarty wyłącznik zostaje otwarty do końca runu.
    run.recordGraderSuccess();
    expect(run.graderOpen()).toBe(true);
  });

  it("udane wywołanie zeruje licznik kolejnych porażek", () => {
    const run = new AgentCheckRun(DEFAULT_LESSON_AGENT_POLICY);
    run.recordGraderFailure();
    run.recordGraderFailure();
    run.recordGraderSuccess();
    expect(run.recordGraderFailure()).toBe(false);
    expect(run.recordGraderFailure()).toBe(false);
    expect(run.graderOpen()).toBe(false);
    expect(run.recordGraderFailure()).toBe(true);
  });
});

describe("klucze pamięci runu", () => {
  it("hintKey zależy od każdego pola i nie skleja granic pól", () => {
    const base = hintKey("widok", "odpowiedź", ["a", "b"], "podpowiedź");
    expect(hintKey("widok", "odpowiedź", ["a", "b"], "podpowiedź")).toBe(base);
    expect(hintKey("widok", "odpowiedź", ["a", "b"], "inna")).not.toBe(base);
    expect(hintKey("widok", "odpowiedź", ["a,b"], "podpowiedź")).not.toBe(base);
    expect(hintKey("widokodpowiedź", "", ["a", "b"], "podpowiedź")).not.toBe(base);
  });

  it("openKey zależy od widoku, odpowiedzi, wariantów i kryteriów, nie od podpowiedzi", () => {
    const criteria = { requiredElements: [{ id: "e1", text: "Wisła" }], supplementaryElements: [], commonErrors: [], sourceQuotes: [] };
    const base = openKey("widok", "Wisła", [], criteria);
    expect(openKey("widok", "Wisła", [], { ...criteria })).toBe(base);
    expect(openKey("widok", "Wisła", ["wisła"], criteria)).not.toBe(base);
    expect(openKey("widok", "Wisła", [], { ...criteria, requiredElements: [{ id: "e1", text: "Odra" }] })).not.toBe(base);
    expect(openKey("widok", "Odra", [], criteria)).not.toBe(base);
  });
});
