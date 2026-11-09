import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { BenchTask } from "./suite";

const require = createRequire(import.meta.url);
type Cell = { defects: number; n: number };
const score = require("../blind/score.cjs") as {
  scoreStage2: (groups: { key: BlindKey; verdicts: Verdict[] }[]) => { report: Record<string, Record<string, Cell>>; missing: string[] };
  wilson: (defects: number, n: number) => { low: number; high: number };
  parseCsv: (text: string) => Verdict[];
};

export type KeyRow = { rowId: string; model: string; index: number; type: string; hasExplanation: boolean; family?: string };
export type BlindKey = { seed: string; prefix: string; models: string[]; rows: KeyRow[] };
export type Verdict = { rowId: string; verdict: string; criterion: string; level: string; adjudicatorNote?: string };
/** Plik wyników `probe:chapter` (`chapter-generation-probe-results/v2`); czytamy tylko wymienione pola. */
export type ProbeResults = {
  state?: string;
  publishable?: string;
  durationMs?: number;
  material?: { sha256?: string };
  models?: Record<string, string>;
  costUsd?: { total?: number };
  tokens?: { byModel?: Record<string, { in: number; out: number }> };
  draft?: { coverage?: { actual: number; required: number }[] };
};
export type PoolDump = { materialSha256?: string; effort?: string; exposureLeaks?: unknown[] };
export type GoldDump = { model: string; fixture: string; tally: Record<"correct" | "wrong_key" | "second_correct", { rejected: number; total: number }[]> };

export type RecordMeta = {
  label: string;
  date: string;
  commit: string;
  dirty: boolean;
  diffSha256: string | null;
  note?: string;
  routing: Record<string, string>;
  judge: string;
  judgeVersion?: string;
  rubric: string;
};
export type GenerationInput = { id: string; key: BlindKey; verdicts: Verdict[]; results: ProbeResults[]; dumps: PoolDump[] };
export type GoldInput = { id: string; dump: GoldDump };

const MODEL_FIELDS = ["generator", "objectives", "objectivesReasoning", "checker", "grader"] as const;
const BASELINE_ROW = /^baseline(?:-add)?-r\d+$/u;

const range = (values: number[]) => (values.length === 0 ? null : { min: Math.min(...values), max: Math.max(...values) });
const round = (value: number, digits = 4) => Number(value.toFixed(digits));

/** Jedna wartość pola we wszystkich plikach albo błąd (rekord = jedna konfiguracja). */
function single<T>(values: (T | undefined)[], what: string): T | undefined {
  const distinct = [...new Set(values.filter((value) => value !== undefined).map((value) => JSON.stringify(value)))];
  if (distinct.length > 1) throw new Error(`${what}: różne wartości w jednym rekordzie (${distinct.join(" / ")})`);
  return distinct[0] === undefined ? undefined : (JSON.parse(distinct[0]) as T);
}

function generationEntry(input: GenerationInput) {
  // Przebieg bazowy z „+N” (`baseline-add-rN` to ten sam przebieg); wiersze innych ramion arkusza (`agent-rN`) pomijamy.
  const rows = input.key.rows.filter((row) => BASELINE_ROW.test(row.model)).map((row) => ({ ...row, model: row.model.replace("baseline-add-", "baseline-") }));
  const ids = new Set(rows.map((row) => row.rowId));
  const verdicts = input.verdicts.filter((verdict) => ids.has(verdict.rowId));
  const { report, missing } = score.scoreStage2([{ key: { ...input.key, rows }, verdicts }]);
  if (missing.length > 0) throw new Error(`${input.id}: ${missing.length} wierszy bez werdyktu`);
  const leaks = input.dumps.reduce((sum, dump) => sum + (dump.exposureLeaks?.length ?? 0), 0);
  if (leaks > 0) throw new Error(`${input.id}: exposureLeaks ${leaks} w zrzucie (błąd ścieżki zapisu, nie miara jakości)`);
  const defective = verdicts.filter((verdict) => verdict.verdict.trim() === "defect").length;
  const interval = score.wilson(defective, rows.length);
  const tokens: Record<string, { in: number; out: number }> = {};
  for (const result of input.results) {
    for (const [model, cell] of Object.entries(result.tokens?.byModel ?? {})) {
      const sum = (tokens[model] ??= { in: 0, out: 0 });
      sum.in += cell.in;
      sum.out += cell.out;
    }
  }
  const defects = Object.fromEntries(Object.entries(report.baseline ?? {}).filter(([, cell]) => cell.n > 0).map(([name, cell]) => [name, { defects: cell.defects, n: cell.n }]));
  return {
    materialSha256: single([...input.results.map((result) => result.material?.sha256), ...input.dumps.map((dump) => dump.materialSha256)], `${input.id} materialSha256`) ?? null,
    runs: input.results.length,
    succeeded: input.results.filter((result) => result.state === "succeeded").length,
    publishable: input.results.filter((result) => result.publishable?.startsWith("TAK") === true).length,
    costUsd: range(input.results.map((result) => round(result.costUsd?.total ?? 0))),
    tokens,
    durationS: range(input.results.flatMap((result) => (result.durationMs === undefined ? [] : [Math.round(result.durationMs / 1000)]))),
    coverageGapsBeforeAdd: input.results.reduce((sum, result) => sum + (result.draft?.coverage ?? []).filter((gap) => gap.actual < gap.required).length, 0),
    anyDefect: { defects: defective, n: rows.length, rate: round(rows.length === 0 ? 0 : defective / rows.length), low: round(interval.low), high: round(interval.high) },
    defects,
  };
}

function goldEntry({ dump }: GoldInput) {
  const per = (klass: keyof GoldDump["tally"]) => dump.tally[klass].map((rep) => rep.rejected);
  const total = (klass: keyof GoldDump["tally"]) => single(dump.tally[klass].map((rep) => rep.total), `gold ${klass} total`) ?? 0;
  return {
    fixture: dump.fixture,
    model: dump.model,
    reps: dump.tally.correct.length,
    correctRejected: per("correct"),
    correctTotal: total("correct"),
    wrongKeyDetected: per("wrong_key"),
    wrongKeyTotal: total("wrong_key"),
    secondCorrectDetected: per("second_correct"),
    secondCorrectTotal: total("second_correct"),
  };
}

/**
 * Rekord benchmarka z wejścia w pamięci. Tylko liczby, kody, id zadań i modeli, sha256 materiału:
 * nowy obiekt z listy pól, nigdy kopia wejścia (treść ćwiczeń, materiał, człony zagadnień i notatki sędziego zostają poza repo).
 */
export function buildRecord({ meta, generation, gold }: { meta: RecordMeta; generation: GenerationInput[]; gold: GoldInput[] }) {
  const allResults = generation.flatMap((input) => input.results);
  const models: Record<string, string> = {};
  for (const field of MODEL_FIELDS) {
    const value = single(allResults.map((result) => result.models?.[field]), `models.${field}`);
    if (value !== undefined) models[field] = value;
  }
  const effort = single(generation.flatMap((input) => input.dumps.map((dump) => dump.effort)), "effort");
  if (effort !== undefined) models.effort = effort;
  if (models.checker === undefined && gold.length > 0) models.checker = single(gold.map((item) => item.dump.model), "gold model")!;
  return {
    schema: "probe-bench-record/v1" as const,
    label: meta.label,
    date: meta.date,
    commit: meta.commit,
    dirty: meta.dirty,
    diffSha256: meta.diffSha256,
    ...(meta.note === undefined ? {} : { note: meta.note }),
    models,
    routing: { ...meta.routing },
    judge: meta.judge,
    ...(meta.judgeVersion === undefined ? {} : { judgeVersion: meta.judgeVersion }),
    rubric: meta.rubric,
    generation: Object.fromEntries(generation.map((input) => [input.id, generationEntry(input)])),
    gold: Object.fromEntries(gold.map((input) => [input.id, goldEntry(input)])),
  };
}

export type BenchRecord = ReturnType<typeof buildRecord>;

/** Liczba wierszy CSV (pola w cudzysłowach mogą mieć nowe linie). */
export const csvRowCount = (text: string): number => score.parseCsv(text).length;

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const jsonFiles = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".json")).sort().map((name) => join(dir, name)) : []);

/** Wejście `buildRecord` z katalogu biegu (`<out>`, układ z `bench.ts`); brak arkusza, werdyktów albo zrzutu kontroli → błąd. */
export function readRun(out: string, tasks: readonly BenchTask[], verdictsFile: (task: string) => string): { generation: GenerationInput[]; gold: GoldInput[] } {
  const generation: GenerationInput[] = [];
  const gold: GoldInput[] = [];
  for (const task of tasks) {
    if (task.kind === "gold") {
      gold.push({ id: task.id, dump: readJson<GoldDump>(join(out, "gold", `${task.id}.json`)) });
      continue;
    }
    const dir = join(out, task.id);
    const runDirs = readdirSync(join(dir, "out")).filter((name) => /^r\d+$/u.test(name)).sort();
    generation.push({
      id: task.id,
      key: readJson<BlindKey>(join(dir, "blind", "key.json")),
      verdicts: score.parseCsv(readFileSync(verdictsFile(task.id), "utf8")),
      results: runDirs.flatMap((name) => jsonFiles(join(dir, "out", name)).map((path) => readJson<ProbeResults>(path))),
      dumps: readdirSync(dir).filter((name) => /^baseline-r\d+$/u.test(name) && existsSync(join(dir, name, "dump.json"))).sort().map((name) => readJson<PoolDump>(join(dir, name, "dump.json"))),
    });
  }
  return { generation, gold };
}
