import type { RunCostSink } from "../../../ports/ai";
import { GenerationProviderError } from "../../../ports/generation-error";
import { classifyLessonGenerationFailure } from "./lesson-generation-errors";
import { DEFAULT_LESSON_GENERATION_POLICY } from "./lesson-generation-policy";

/**
 * Polityka generowania puli lekcji (przebieg bazowy): równoległość, terminy i budżet runu. Wartości
 * domyślne w kodzie, nadpisywane z env (`UMIEM_LESSON_AGENT_*`).
 */
export interface LessonAgentPolicy {
  /** Najwyżej tyle wywołań generatora paczek naraz. */
  readonly concurrency: number;
  /** Najwyżej tyle wywołań kontroli zadań zamkniętych naraz. */
  readonly checkerConcurrency: number;
  readonly checkerTimeoutMs: number;
  /** Limit jednego żądania generatora paczki. */
  readonly callTimeoutMs: number;
  /** Przebieg nie trwa dłużej niż kontroler runu (`withLessonGenerationControl`). */
  readonly runTimeoutMs: number;
  /** Budżet wyczerpany przy wydatku ≥ `runBudgetUsd`. */
  readonly runBudgetUsd: number;
  /** Szacunek kosztu żądania o nieznanym koszcie (`record(null)`). */
  readonly unknownCallEstimateUsd: number;
}

export const DEFAULT_LESSON_AGENT_POLICY: LessonAgentPolicy = {
  concurrency: 4,
  checkerConcurrency: 4,
  checkerTimeoutMs: 90_000,
  callTimeoutMs: 90_000,
  runTimeoutMs: DEFAULT_LESSON_GENERATION_POLICY.runTimeoutMs,
  runBudgetUsd: 1,
  unknownCallEstimateUsd: 0.02,
};

/** Powód przerwania terminem runu (`deadlineSignal`). */
export const RUN_TIMEOUT_REASON = "run_timeout";

/** Porażka zagadnienia: kod i ponawialność z klasyfikacji błędów generacji (`classifyLessonGenerationFailure`). */
export interface AgentFailure {
  readonly errorCode: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
}

/**
 * Klasyfikacja porażki przez `classifyLessonGenerationFailure`; przerwanie terminem runu (powód z
 * `deadlineSignal`, nie wyjątek dostawcy) to `provider_timeout` bez ponowienia.
 */
export function agentFailureOf(error: unknown): AgentFailure {
  if (error === RUN_TIMEOUT_REASON) {
    return { errorCode: classifyLessonGenerationFailure(new GenerationProviderError("timeout")).errorCode, retryable: false };
  }
  const { errorCode, retryable, retryAfterMs } = classifyLessonGenerationFailure(error);
  return { errorCode, retryable, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) };
}

/**
 * Licznik wydatku runu (§7.3): `initialSpentUsd` + zgłoszenia adapterów; koszt
 * nieznany (`null` albo wartość nieskończona/ujemna) liczony szacunkiem.
 */
export class RunCostMeter implements RunCostSink {
  private spent: number;
  private unknown = 0;

  constructor(
    initialSpentUsd: number,
    private readonly budgetUsd: number,
    private readonly unknownEstimateUsd: number,
    /** Wołany synchronicznie po każdym zgłoszeniu z bieżącym wydatkiem (zapis best-effort przy przerwaniu, #317). */
    private readonly onSpend?: (spentUsd: number) => void,
  ) {
    this.spent = initialSpentUsd;
  }

  get spentUsd(): number {
    return this.spent;
  }

  get unknownCalls(): number {
    return this.unknown;
  }

  record(usd: number | null): void {
    if (usd === null || !Number.isFinite(usd) || usd < 0) {
      this.unknown += 1;
      this.spent += this.unknownEstimateUsd;
    } else {
      this.spent += usd;
    }
    this.onSpend?.(this.spent);
  }

  exhausted(): boolean {
    return this.spent >= this.budgetUsd;
  }
}
