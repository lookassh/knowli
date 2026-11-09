import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withConfigDefaults } from "@learning/server";
import { probePreflight } from "./probe-preflight";

// Bez sieci i bez `.env`: środowisko budujemy jawnie, a `fetch` rzuca — preflight nie może wołać usług.
const KEY = "sk-or-v1-probe-preflight-test";
const fetchSpy = vi.fn(() => {
  throw new Error("preflight nie może wołać sieci");
});

beforeEach(() => {
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

/** Środowisko jak w próbie (po `withConfigDefaults`), bez żadnego klucza z powłoki. */
function probeEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return withConfigDefaults({ NODE_ENV: "test", ...overrides });
}

describe("probePreflight", () => {
  it("brak klucza OpenRouter → błąd, zanim próba dotknie rejestru albo usług", () => {
    for (const subject of ["chapter", "grammar"] as const) {
      expect(() => probePreflight(probeEnv(), { subject })).toThrow(/Brak klucza OpenRouter/u);
    }
    // Klucz LLM na innym hoście nie jest kluczem generowania lekcji.
    expect(() => probePreflight(probeEnv({ UMIEM_LLM_BASE_URL: "https://api.openai.com/v1", UMIEM_LLM_API_KEY: "sk-proj-x" }), { subject: "chapter" }))
      .toThrow(/Brak klucza OpenRouter/u);
  });

  it("tryb fake i klucz w kształcie OpenAI → błąd z nazwą, bez kosztu", () => {
    expect(() => probePreflight(probeEnv({ OPENROUTER_API_KEY: KEY, UMIEM_FAKE_PROVIDERS: "1" }), { subject: "chapter" })).toThrow(/UMIEM_FAKE_PROVIDERS/u);
    expect(() => probePreflight(probeEnv({ UMIEM_LESSON_AGENT_API_KEY: "sk-proj-abc" }), { subject: "chapter" })).toThrow(/UMIEM_LESSON_AGENT_API_KEY/u);
  });

  it("paczki i kontrola idą na stały OpenRouter; szkoła i rozdział dokładają host UMIEM_LLM", () => {
    expect(probePreflight(probeEnv({ OPENROUTER_API_KEY: KEY }), { subject: "chapter" }).hosts).toEqual(["openrouter.ai"]);
    expect(probePreflight(probeEnv({ OPENROUTER_API_KEY: KEY }), { subject: "school" }).hosts).toEqual(["openrouter.ai"]);
  });

  it("host spoza OpenRouter albo bez https → błąd; inny host tylko przez jawne allowHost", () => {
    const llmElsewhere = probeEnv({ OPENROUTER_API_KEY: KEY, UMIEM_LLM_BASE_URL: "https://llm.example.com/v1", UMIEM_LLM_API_KEY: "local-key" });
    expect(() => probePreflight(llmElsewhere, { subject: "school" })).toThrow(/UMIEM_LLM_BASE_URL: host llm\.example\.com nie jest OpenRouter/u);
    expect(probePreflight(llmElsewhere, { subject: "school", allowHost: "llm.example.com" }).hosts).toEqual(["openrouter.ai", "llm.example.com"]);
    // Rozdział też ma etap zagadnień przez UMIEM_LLM (od etapu 5a), gramatyka nie — host LLM jej nie zatrzymuje.
    expect(() => probePreflight(llmElsewhere, { subject: "chapter" })).toThrow(/UMIEM_LLM_BASE_URL: host llm\.example\.com/u);
    expect(probePreflight(llmElsewhere, { subject: "grammar" }).hosts).toEqual(["openrouter.ai"]);

    // Worker nie woła gradera (etap 5c): jego host nie trafia do listy hostów próby.
    const graderElsewhere = probeEnv({
      OPENROUTER_API_KEY: KEY,
      UMIEM_GRADER_BASE_URL: "https://grader.example.com/v1",
      UMIEM_GRADER_API_KEY: "grader-key",
    });
    expect(probePreflight(graderElsewhere, { subject: "chapter" }).hosts).toEqual(["openrouter.ai"]);
  });

  it("brak pełnego UMIEM_GRADER_* → błąd z nazwą brakującej zmiennej w każdym przedmiocie", () => {
    // Bez `withConfigDefaults` — domyślne wartości uzupełniłyby model i adres.
    const base = { NODE_ENV: "test", OPENROUTER_API_KEY: KEY, UMIEM_LLM_BASE_URL: "https://openrouter.ai/api/v1", UMIEM_GRADER_BASE_URL: "https://openrouter.ai/api/v1", UMIEM_GRADER_MODEL: "google/gemini-3.8-flash" };
    expect(() => probePreflight({ ...base, UMIEM_GRADER_MODEL: undefined }, { subject: "school" })).toThrow(/brak: UMIEM_GRADER_MODEL\./u);
    expect(() => probePreflight({ ...base, UMIEM_GRADER_BASE_URL: "" }, { subject: "school" })).toThrow(/brak: UMIEM_GRADER_BASE_URL, UMIEM_GRADER_API_KEY/u);
    // Klucz agenta osobno, bez wspólnego klucza: grader nie ma klucza.
    const ownAgentKey = { NODE_ENV: "test", UMIEM_LESSON_AGENT_API_KEY: KEY, UMIEM_GRADER_BASE_URL: base.UMIEM_GRADER_BASE_URL, UMIEM_GRADER_MODEL: base.UMIEM_GRADER_MODEL };
    expect(() => probePreflight(ownAgentKey, { subject: "school" })).toThrow(/brak: UMIEM_GRADER_API_KEY/u);
    expect(probePreflight(base, { subject: "school" }).hosts).toEqual(["openrouter.ai"]);
    // Generowanie każdego przedmiotu wymaga gradera (`lessonAgentPublicFromEnv`).
    expect(() => probePreflight({ NODE_ENV: "test", UMIEM_LESSON_AGENT_API_KEY: KEY }, { subject: "grammar" })).toThrow(/brak: UMIEM_GRADER_BASE_URL/u);
    expect(probePreflight({ ...base, UMIEM_LLM_BASE_URL: undefined }, { subject: "grammar" }).hosts).toEqual(["openrouter.ai"]);
  });

  it("szacunek = budżet runu, ×2 z „+N”; zła liczba „+N” → błąd", () => {
    expect(probePreflight(probeEnv({ OPENROUTER_API_KEY: KEY }), { subject: "grammar" }).estimateUsd).toBe(1);
    expect(probePreflight(probeEnv({ OPENROUTER_API_KEY: KEY }), { subject: "grammar", addCount: 12 }).estimateUsd).toBe(2);
    const budget = probeEnv({ OPENROUTER_API_KEY: KEY, UMIEM_LESSON_AGENT_RUN_BUDGET_USD: "0.4" });
    expect(probePreflight(budget, { subject: "chapter" }).estimateUsd).toBeCloseTo(0.4, 10);
    expect(probePreflight(budget, { subject: "chapter", addCount: 5 }).estimateUsd).toBeCloseTo(0.8, 10);
    for (const bad of [0, -1, 2.5, Number.NaN]) {
      expect(() => probePreflight(budget, { subject: "chapter", addCount: bad }), String(bad)).toThrow(/UMIEM_PROBE_ADD_COUNT/u);
    }
    expect(() => probePreflight(probeEnv({ OPENROUTER_API_KEY: KEY, UMIEM_LESSON_AGENT_RUN_BUDGET_USD: "abc" }), { subject: "chapter" }))
      .toThrow(/UMIEM_LESSON_AGENT_RUN_BUDGET_USD/u);
  });
});
