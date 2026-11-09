import { lessonAgentPolicyFromEnv } from "@learning/server";
import { lessonAgentDepsFromEnv } from "@learning/server/lesson-agent";
import { OPENROUTER_BASE_URL } from "../../packages/server/src/providers/openai/lesson-pool-agent";
import { DEFAULT_BASE_URL as LLM_DEFAULT_BASE_URL } from "../../packages/server/src/providers/openai/llm";
import { endpointKeyFromEnv } from "../../packages/server/src/providers/openrouter-key";
import { probeEndpointHost } from "./probe-costs";

/**
 * Kontrola przed płatną próbą generowania lekcji (`chapter-generation.probe.test.ts`,
 * spec etapu 3 §6.3). Czysta: bez sieci, bez `.env` i bez konsoli — dostaje gotowe `env`
 * (próba podaje je po `withConfigDefaults`) i tylko składa adaptery, nie wywołując ich. Próba
 * woła ją przed rejestrem kosztów i przed wpisem tymczasowym, więc każdy błąd tutaj kończy próbę
 * bez kosztu. Testy: `probe-preflight.test.ts` (konfiguracja unit).
 *
 * - tryb fake (`UMIEM_FAKE_PROVIDERS=1`) → błąd (próba ma mierzyć prawdziwe modele);
 * - brak pełnego `UMIEM_GRADER_*` → błąd z nazwami brakujących zmiennych (bez gradera w web
 *   generowanie lekcji jest niedostępne, `lessonAgentPublicFromEnv`; worker go nie woła);
 * - `lessonAgentDepsFromEnv` → `LessonAgentUnavailable` → błąd „brak klucza OpenRouter”; błędna
 *   konfiguracja generowania rzuca tak jak przy starcie workera (z nazwą zmiennej);
 * - strażnik hostów ({@link probeEndpointHost}: tylko https, OpenRouter albo jawne
 *   `allowHost`): paczki i kontrola zamkniętych na stałym adresie OpenRouter, `UMIEM_LLM_BASE_URL`
 *   w szkole i rozdziale (etap zagadnień `generateDynamicObjectives`);
 * - szacunek = budżet runu (`UMIEM_LESSON_AGENT_RUN_BUDGET_USD`), ×2 z „+N”
 *   (`addCount`: drugi run tej samej lekcji z własnym budżetem).
 */

export type ProbeSubjectKind = "chapter" | "school" | "grammar";

export interface ProbePreflight {
  /** Górny koszt próby (budżet runu, ×2 z „+N”) — wpis tymczasowy i kontrola limitu rejestru. */
  readonly estimateUsd: number;
  /** Hosty usług, do których próba wyśle dane (bez ścieżek i kluczy), bez powtórzeń. */
  readonly hosts: string[];
}

export function probePreflight(
  env: Record<string, string | undefined>,
  options: { subject: ProbeSubjectKind; addCount?: number; allowHost?: string },
): ProbePreflight {
  if (env.UMIEM_FAKE_PROVIDERS === "1") {
    throw new Error("UMIEM_FAKE_PROVIDERS=1 — próba mierzy prawdziwe modele; usuń tryb fake ze środowiska próby.");
  }
  if (options.addCount !== undefined && !(Number.isInteger(options.addCount) && options.addCount > 0)) {
    throw new Error(`UMIEM_PROBE_ADD_COUNT musi być dodatnią liczbą całkowitą, jest: ${String(options.addCount)}.`);
  }
  // Etap zagadnień z materiału (`UMIEM_LLM_*`): szkoła i od etapu 5a rozdział; gramatyka ma tematy z katalogu.
  const objectivesStage = options.subject !== "grammar";
  const deps = lessonAgentDepsFromEnv(env);
  if ("unavailable" in deps) {
    throw new Error("Brak klucza OpenRouter dla generowania lekcji (UMIEM_LESSON_AGENT_API_KEY / OPENROUTER_API_KEY) — próba nie ma czego wywołać.");
  }

  // Generowanie lekcji jest dostępne tylko z pełnym graderem w web (`lessonAgentPublicFromEnv`); próba odwzorowuje ten warunek.
  const graderBaseUrl = env.UMIEM_GRADER_BASE_URL?.trim() || undefined;
  const missing = [
    ...(graderBaseUrl === undefined ? ["UMIEM_GRADER_BASE_URL"] : []),
    ...(env.UMIEM_GRADER_MODEL?.trim() ? [] : ["UMIEM_GRADER_MODEL"]),
    ...(endpointKeyFromEnv(env, "UMIEM_GRADER", graderBaseUrl) === undefined ? ["UMIEM_GRADER_API_KEY (albo OPENROUTER_API_KEY przy https OpenRouter)"] : []),
  ];
  if (missing.length > 0) {
    throw new Error(`Generowanie lekcji wymaga pełnego UMIEM_GRADER_* (bez niego panel wyłącza generowanie); brak: ${missing.join(", ")}.`);
  }

  const allowHost = options.allowHost;
  const hosts = [
    probeEndpointHost(OPENROUTER_BASE_URL, "UMIEM_LESSON_AGENT (paczki i kontrola zamkniętych)", allowHost),
    ...(objectivesStage ? [probeEndpointHost(env.UMIEM_LLM_BASE_URL?.trim() || LLM_DEFAULT_BASE_URL, "UMIEM_LLM_BASE_URL", allowHost)] : []),
  ];

  const runBudgetUsd = lessonAgentPolicyFromEnv(env).runBudgetUsd;
  if (runBudgetUsd === undefined) throw new Error("Brak budżetu runu (UMIEM_LESSON_AGENT_RUN_BUDGET_USD).");
  return { estimateUsd: runBudgetUsd * (options.addCount === undefined ? 1 : 2), hosts: [...new Set(hosts)] };
}
