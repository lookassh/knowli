import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isOpenRouterEndpoint } from "../../packages/server/src/providers/chat-request-options";

/**
 * Narzędzia płatnych prób (`*.probe.test.ts`): rejestr kosztów (`costs.json` poza repozytorium),
 * koszty przebiegu agenta puli (per operacja, per run, do rejestru), kontrola hosta usługi i drobne
 * pomocniki odczytu. Bez wywołań modelu; testy w `probe-costs.test.ts` (konfiguracja unit). Żadna
 * funkcja nie pisze na konsolę. Szacunek przed próbą generowania lekcji daje `probePreflight`
 * (`probe-preflight.ts`: budżet runu agenta).
 */

/** Limit łączny prób dla nowego rejestru kosztów. */
export const DEFAULT_COST_CAP_USD = 10;

// ---------------------------------------------------------------------------------------------
// Rejestr kosztów (`costs.json` w katalogu danych próby)

export interface CostEntry {
  at: string;
  probe: string;
  dump: string;
  costUsd: number;
  /** Dostawca nie zwrócił `usage.cost` mimo wywołań — wpisany szacunek zamiast zera. */
  estimated?: boolean;
  /** Identyfikator wpisu tymczasowego (rozliczanego po próbie przez `settleCostEntry`). */
  id?: string;
  /** Wpis tymczasowy: szacunek zapisany przed płatnym wywołaniem; zostaje, gdy proces zginie przed rozliczeniem. */
  provisional?: boolean;
}

export interface CostLedger {
  capUsd: number;
  spentUsd: number;
  entries: CostEntry[];
}

// ---------------------------------------------------------------------------------------------
// Koszty przebiegu agenta puli lekcji (zdarzenia `UsageEvent` z recordera próby)

/** Zdarzenie kosztu próby: operacja i koszt z `usage` oraz run generacji, w którym padło (`null` = poza runem). */
export interface ProbeCostEvent {
  readonly operation?: string;
  readonly providerCostUsd?: number;
  readonly runId: string | null;
}

export interface OperationCost {
  calls: number;
  /** Suma kosztów zwróconych przez dostawcę (`usage.cost`). */
  costUsd: number;
  /** Wywołania bez `usage.cost`. */
  unknownCostCalls: number;
}

/** Operacje liczone do budżetu runu agenta: kroki agenta (`agent_*`) i kontrole (`check_*`, także `check_grade`). */
export function isAgentRunOperation(operation: string | undefined): boolean {
  return operation !== undefined && (operation.startsWith("agent_") || operation.startsWith("check_"));
}

function hasCost(event: ProbeCostEvent): boolean {
  return typeof event.providerCostUsd === "number" && Number.isFinite(event.providerCostUsd);
}

/** Koszt per operacja (`agent_plan`, `agent_objective`, `check_*`, `check_grade`, `lesson_objectives`…); brak nazwy → `unknown`. */
export function costByOperation(events: readonly ProbeCostEvent[]): Record<string, OperationCost> {
  const result: Record<string, OperationCost> = {};
  for (const event of events) {
    const entry = (result[event.operation ?? "unknown"] ??= { calls: 0, costUsd: 0, unknownCostCalls: 0 });
    entry.calls += 1;
    if (hasCost(event)) entry.costUsd = round6(entry.costUsd + event.providerCostUsd!);
    else entry.unknownCostCalls += 1;
  }
  return result;
}

export interface RunCost {
  runId: string | null;
  /** Suma zmierzonych `agent_*` i `check_*` — to porównujemy z budżetem runu. */
  agentUsd: number;
  /** Etap zagadnień szkoły (`lesson_objectives`, UMIEM_LLM) — poza budżetem agenta. */
  lessonObjectivesUsd: number;
  otherUsd: number;
  calls: number;
  unknownCostCalls: number;
  budgetUsd: number;
  /** Zmierzony koszt agenta powyżej budżetu runu (porażka przebiegu kontrolnego, spec §6.4). */
  overBudget: boolean;
}

/** Koszt per run (w kolejności pierwszego zdarzenia): agent i kontrole względem budżetu, `lesson_objectives` osobno. */
export function runCosts(events: readonly ProbeCostEvent[], budgetUsd: number): RunCost[] {
  const runs = new Map<string | null, RunCost>();
  for (const event of events) {
    let run = runs.get(event.runId);
    if (run === undefined) {
      run = { runId: event.runId, agentUsd: 0, lessonObjectivesUsd: 0, otherUsd: 0, calls: 0, unknownCostCalls: 0, budgetUsd, overBudget: false };
      runs.set(event.runId, run);
    }
    run.calls += 1;
    if (!hasCost(event)) {
      run.unknownCostCalls += 1;
      continue;
    }
    const usd = event.providerCostUsd!;
    if (isAgentRunOperation(event.operation)) run.agentUsd = round6(run.agentUsd + usd);
    else if (event.operation === "lesson_objectives") run.lessonObjectivesUsd = round6(run.lessonObjectivesUsd + usd);
    else run.otherUsd = round6(run.otherUsd + usd);
  }
  return [...runs.values()].map((run) => ({ ...run, overBudget: run.agentUsd > budgetUsd + 1e-9 }));
}

/**
 * Koszt próby agenta do rejestru: zmierzony `usage.cost` plus — dla każdego wywołania bez
 * kosztu — szacunek kierownika (`unknownCallEstimateUsd`, dla `check_grade`
 * `unknownGraderCallEstimateUsd`), wtedy z flagą `estimated` (lepiej przeszacować niż wpisać zero).
 */
export function agentLedgerCost(
  events: readonly ProbeCostEvent[],
  estimates: { readonly unknownCallUsd: number; readonly unknownGraderCallUsd: number },
): { costUsd: number; estimated: boolean } {
  let costUsd = 0;
  let estimated = false;
  for (const event of events) {
    if (hasCost(event)) {
      costUsd += Math.max(0, event.providerCostUsd!);
      continue;
    }
    estimated = true;
    costUsd += event.operation === "check_grade" ? estimates.unknownGraderCallUsd : estimates.unknownCallUsd;
  }
  return { costUsd: round6(costUsd), estimated };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Rejestr z pliku. Brak pliku → błąd (literówka w `UMIEM_PROBE_COSTS` nie może założyć nowego
 * rejestru z pełnym limitem); nowy rejestr zakłada tylko `initCostLedger` (`UMIEM_PROBE_COSTS_INIT=1`).
 * Zepsuty plik → błąd (nigdy nie nadpisujemy).
 */
export function readCostLedger(path: string): CostLedger {
  if (!existsSync(path)) {
    throw new Error(`Rejestr kosztów (costs.json) ${path} nie istnieje — sprawdź UMIEM_PROBE_COSTS; nowy rejestr zakłada tylko UMIEM_PROBE_COSTS_INIT=1.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    // Bez komunikatu parsera: może cytować fragment pliku.
    throw new Error(`Rejestr kosztów (costs.json) ${path} jest nieczytelny (${errorClassOf(error)}) — popraw go ręcznie.`);
  }
  const validEntry = (entry: unknown): entry is CostEntry => isRecord(entry) && typeof entry.costUsd === "number" && Number.isFinite(entry.costUsd) &&
    typeof entry.at === "string" && typeof entry.probe === "string" && typeof entry.dump === "string" &&
    (entry.estimated === undefined || typeof entry.estimated === "boolean") &&
    (entry.id === undefined || typeof entry.id === "string") && (entry.provisional === undefined || typeof entry.provisional === "boolean");
  if (!isRecord(raw) || typeof raw.capUsd !== "number" || !Number.isFinite(raw.capUsd) || !Array.isArray(raw.entries) || !raw.entries.every(validEntry)) {
    throw new Error(`Rejestr kosztów (costs.json) ${path} ma zły kształt — oczekiwano { capUsd, spentUsd, entries: [{ at, probe, dump, costUsd, estimated? }] }.`);
  }
  const entries = (raw.entries as CostEntry[]).map(({ id, at, probe, dump, costUsd, estimated, provisional }) => ({
    ...(id === undefined ? {} : { id }), at, probe, dump, costUsd,
    ...(estimated === undefined ? {} : { estimated }), ...(provisional === undefined ? {} : { provisional }),
  }));
  return { capUsd: raw.capUsd, spentUsd: round6(entries.reduce((sum, entry) => sum + entry.costUsd, 0)), entries };
}

function writeLedger(path: string, ledger: CostLedger): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

/**
 * Limit nowego rejestru z `UMIEM_PROBE_COSTS_CAP_USD`: brak albo pusta wartość → domyślne 10 USD;
 * wartość niebędąca dodatnią liczbą skończoną (kropka dziesiętna) → błąd przed jakimkolwiek wywołaniem.
 */
export function costCapFromEnv(value: string | undefined): number {
  const text = value?.trim() ?? "";
  if (text === "") return DEFAULT_COST_CAP_USD;
  const cap = Number(text);
  if (!/^\d+(?:\.\d+)?$/u.test(text) || !Number.isFinite(cap) || cap <= 0) {
    throw new Error(`UMIEM_PROBE_COSTS_CAP_USD musi być dodatnią liczbą USD (np. 2.5), jest: ${JSON.stringify(text)}.`);
  }
  return cap;
}

/**
 * Jawne założenie rejestru (`{ capUsd, spentUsd: 0, entries: [] }`, domyślnie limit 10 USD);
 * istniejący zostaje bez zmian, także jego limit.
 */
export function initCostLedger(path: string, capUsd: number = DEFAULT_COST_CAP_USD): CostLedger {
  if (existsSync(path)) return readCostLedger(path);
  const ledger: CostLedger = { capUsd, spentUsd: 0, entries: [] };
  writeLedger(path, ledger);
  return ledger;
}

/** „Wydane + szacunek > limit → stop”: błąd z liczbami, zanim padnie pierwsze płatne wywołanie. */
export function assertWithinCostCap(ledger: CostLedger, estimateUsd: number, label: string): void {
  if (ledger.spentUsd + estimateUsd > ledger.capUsd + 1e-9) {
    throw new Error(
      `Limit kosztu prób: wydane ${ledger.spentUsd.toFixed(2)} USD + szacunek ${estimateUsd.toFixed(2)} USD (${label}) > limit ${ledger.capUsd.toFixed(2)} USD — próba zatrzymana przed wywołaniem modelu.`,
    );
  }
}

/** Dopisuje wpis do istniejącego rejestru (odczyt → dopisanie → zapis przez plik tymczasowy); `spentUsd` = suma wpisów. */
export function appendCostEntry(path: string, entry: CostEntry): CostLedger {
  const ledger = readCostLedger(path);
  // Zaokrąglenie do mikrodolara: bez ogonów zmiennoprzecinkowych w pliku.
  const entries = [...ledger.entries, { ...entry, costUsd: round6(entry.costUsd) }];
  const next: CostLedger = { capUsd: ledger.capUsd, spentUsd: round6(entries.reduce((sum, item) => sum + item.costUsd, 0)), entries };
  writeLedger(path, next);
  return next;
}

/**
 * Wpis tymczasowy przed płatnym wywołaniem: szacunek (`estimated`, `provisional`) liczy się do
 * wydanych od razu, więc przerwany proces (kill, zawieszenie) nie zaniża rejestru. Zwraca id do
 * `settleCostEntry`.
 */
export function appendProvisionalCostEntry(path: string, entry: Omit<CostEntry, "estimated" | "provisional" | "id">, id: string = randomUUID()): string {
  appendCostEntry(path, { id, ...entry, estimated: true, provisional: true });
  return id;
}

/** Rozliczenie wpisu tymczasowego kosztem po próbie (w tym samym miejscu rejestru); brak wpisu o tym id → dopisanie. */
export function settleCostEntry(path: string, id: string, entry: Omit<CostEntry, "provisional" | "id">): CostLedger {
  const ledger = readCostLedger(path);
  const at = ledger.entries.findIndex((item) => item.id === id);
  if (at === -1) return appendCostEntry(path, { id, ...entry });
  const settled: CostEntry = { id, ...entry, costUsd: round6(entry.costUsd) };
  if (settled.estimated !== true) delete settled.estimated;
  const entries = ledger.entries.map((item, index) => (index === at ? settled : item));
  const next: CostLedger = { capUsd: ledger.capUsd, spentUsd: round6(entries.reduce((sum, item) => sum + item.costUsd, 0)), entries };
  writeLedger(path, next);
  return next;
}

/** Nazwa klasy błędu (bez komunikatu — może zawierać treść pliku albo odpowiedzi). */
export function errorClassOf(error: unknown): string {
  return error instanceof Error ? error.constructor.name || "Error" : typeof error;
}

/**
 * Host usługi próby (do nagłówka, bez ścieżki i klucza): tylko https; OpenRouter zawsze, inny host
 * tylko gdy `allowHost` (`UMIEM_PROBE_ALLOW_HOST`) wskazuje dokładnie ten host — materiał i zdania
 * nie trafią przez pomyłkę konfiguracji do nieznanej usługi.
 */
export function probeEndpointHost(baseUrl: string | undefined, name: string, allowHost?: string): string {
  let url: URL;
  try {
    url = new URL((baseUrl ?? "").trim());
  } catch {
    throw new Error(`${name}: brak albo nieprawidłowy adres usługi — próba nie wywoła modelu.`);
  }
  if (url.protocol !== "https:") throw new Error(`${name}: próba wymaga https:// (host ${url.host}).`);
  if (isOpenRouterEndpoint(url.href)) return url.host;
  const allowed = allowHost?.trim().toLowerCase();
  if (allowed !== undefined && allowed !== "" && allowed === url.host.toLowerCase()) return url.host;
  throw new Error(`${name}: host ${url.host} nie jest OpenRouter — próba wysyła dane tylko tam; inny host wymaga UMIEM_PROBE_ALLOW_HOST=${url.host}.`);
}

/** SHA-256 pliku wejściowego (do README i results.json zamiast treści). */
export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
