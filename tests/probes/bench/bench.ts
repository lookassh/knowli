import { createHash } from "node:crypto";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { withConfigDefaults } from "../../../packages/server/src/config-defaults";
import { initCostLedger, readCostLedger } from "../probe-costs";
import { loadDotEnv, runMuse } from "../probe-helpers";
import { buildRecord, csvRowCount, readRun, type BenchRecord } from "./record";
import { DEFAULT_REPS, SUITE, fixturePath, taskById, type BenchTask, type GenerationTask, type GoldTask } from "./suite";
import { renderTable } from "./table";

const require = createRequire(import.meta.url);
const { probePath } = require("../blind/paths.cjs") as { probePath: (raw: string | undefined, name: string) => string };

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
export const RESULTS_DIR = fileURLToPath(new URL("../results/", import.meta.url));
const VITEST = join(REPO, "node_modules", "vitest", "vitest.mjs");
const SHEET = join(REPO, "tests", "probes", "blind", "gen-blind-sheet.cjs");
const RUBRIC = "rubric-stage5.md";
const MUSE_PREFIX = "muse:";
/** Rezerwa sondy generowania przed każdym powtórzeniem: budżet runu ×2 z „+N” (`probe-preflight.ts`). */
const RESERVE_NOTE = "sonda generowania rezerwuje przed każdym powtórzeniem cały budżet runu (2 USD z „+N”), więc limit potrzebuje zapasu ≥ 2 USD ponad spodziewany koszt";
/** Zmienne routingu dostawców zapisywane w rekordzie: decydują o dostawcy, a przy kluczu właściciela (BYOK) o koszcie. */
const ROUTING = /^UMIEM_(LLM|LESSON_AGENT(_CHECKER)?)_PROVIDER_/u;
/** Modele i wysiłek, które sondy biorą z env (z domyślnymi z `config-defaults.ts`); zmiana przy wznowieniu = inna konfiguracja. */
const MODEL_ENV = ["UMIEM_LESSON_AGENT_MODEL", "UMIEM_LESSON_AGENT_REASONING", "UMIEM_LESSON_AGENT_CHECKER_MODEL", "UMIEM_LLM_MODEL", "UMIEM_LLM_REASONING"] as const;
/** Kod, od którego zależy wynik; `tests/probes/results` pomijamy, bo bieg sam tam zapisuje rekord i tabelę. */
const CODE_PATHS = ["--", "packages", "tests/probes", ":(exclude)tests/probes/results"];

export type Step =
  | { kind: "generate"; task: GenerationTask; rep: number; env: Record<string, string>; done: string; log: string; dumps: string[] }
  | { kind: "gold"; task: GoldTask; env: Record<string, string>; done: string; log: string }
  | { kind: "sheet"; task: GenerationTask; args: string[]; done: string; log: string }
  | { kind: "judge"; task: GenerationTask; env: Record<string, string>; sheet: string; done: string; log: string };

export const judgeSlug = (judge: string) => judge.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
export const isPaid = (step: Step, judge: string) => step.kind === "generate" || step.kind === "gold" || (step.kind === "judge" && !judge.startsWith(MUSE_PREFIX));
const stepName = (step: Step) => `${step.kind} ${step.task.id}${step.kind === "generate" ? ` r${step.rep}` : ""}`;

/** Środowisko sond bez `UMIEM_PROBE_*` z powłoki: o materiale, hoście, rejestrze i „+N” decyduje wyłącznie zadanie. */
export function inheritedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith("UMIEM_PROBE_")));
}

/** `UMIEM_PROBE_*` w `.env` wróciłyby do sond (każda sama wczytuje `.env`), więc benchmark ich nie przyjmuje. */
export function assertNoProbeEnvInDotEnv(dotEnvKeys: string[]): void {
  const probe = dotEnvKeys.filter((key) => key.startsWith("UMIEM_PROBE_"));
  if (probe.length > 0) throw new Error(`.env ustawia ${probe.join(", ")} — sondy wczytałyby je z powrotem; usuń je z .env przed benchmarkiem`);
}

export function validateLabel(label: string | undefined): string {
  if (label === undefined || !/^[a-z0-9][a-z0-9-]{0,40}$/u.test(label)) throw new Error("--label: małe litery, cyfry i „-”, do 41 znaków (np. flash-2026-11-09)");
  return label;
}

/**
 * Plan kroków dla zadań; `exists` i `judged` sprawdzają pliki (test podaje własne funkcje). Krok jest gotowy, gdy jest jego
 * plik wyniku: powtórzenie z plikiem wyników (także nieudanego runu, żeby wznowienie nie płaciło drugi raz), kompletne werdykty.
 */
export function planSteps(options: { out: string; tasks: readonly BenchTask[]; reps: number; judge: string; checkerModel: string; exists: (path: string) => boolean; isDirEmpty: (path: string) => boolean; judged: (verdicts: string, sheet: string) => boolean }): Step[] {
  const { out, tasks, reps, judge, exists, isDirEmpty } = options;
  const costs = join(out, "costs.json");
  const slug = judgeSlug(judge);
  const steps: Step[] = [];
  for (const task of tasks) {
    if (task.kind === "gold") {
      const dump = join(out, "gold", `${task.id}.json`);
      if (!exists(dump)) {
        steps.push({ kind: "gold", task, done: dump, log: join(out, "gold", `${task.id}.log`), env: { UMIEM_PROBE_GOLD: "1", UMIEM_PROBE_GOLD_FIXTURE: task.fixture, UMIEM_PROBE_GOLD_DUMP: dump, UMIEM_PROBE_AGENT_SOLVER_MODEL: options.checkerModel, UMIEM_PROBE_COSTS: costs } });
      }
      continue;
    }
    const dir = join(out, task.id);
    for (let rep = 1; rep <= reps; rep += 1) {
      const outDir = join(dir, "out", `r${rep}`);
      if (exists(outDir) && !isDirEmpty(outDir)) continue;
      const dump = join(dir, `baseline-r${rep}`, "dump.json");
      steps.push({
        kind: "generate",
        task,
        rep,
        done: outDir,
        log: join(dir, "logs", `r${rep}.log`),
        // Zrzut bez pliku wyników (przerwany proces) blokowałby powtórzenie („już istnieje”), a i tak trzeba je opłacić od nowa.
        dumps: [join(dir, `baseline-r${rep}`), join(dir, `baseline-add-r${rep}`)],
        env: {
          ...task.env,
          UMIEM_PROBE_SUBJECT: task.subject,
          UMIEM_PROBE_MATERIAL: join(out, "materials", task.material),
          UMIEM_PROBE_OUT_DIR: outDir,
          UMIEM_PROBE_POOL_DUMP_OUT: dump,
          UMIEM_PROBE_COSTS: costs,
          ...(task.addCount === undefined ? {} : { UMIEM_PROBE_ADD_COUNT: String(task.addCount) }),
        },
      });
    }
    const key = join(dir, "blind", "key.json");
    const judgeDir = join(out, "judge", task.id);
    if (!exists(key)) steps.push({ kind: "sheet", task, done: key, log: join(dir, "logs", "sheet.log"), args: [dir, task.id, task.id, judgeDir, RUBRIC] });
    const sheet = join(judgeDir, "sheet.csv");
    const verdicts = join(out, "judge", `${task.id}.${slug}.csv`);
    if (!options.judged(verdicts, sheet)) {
      steps.push({ kind: "judge", task, sheet, done: verdicts, log: join(out, "judge", `${task.id}.${slug}.log`), env: { UMIEM_PROBE_JUDGE_DIR: judgeDir, UMIEM_PROBE_JUDGE_MODEL: judge, UMIEM_PROBE_JUDGE_OUT: verdicts, UMIEM_PROBE_COSTS: costs } });
    }
  }
  return steps;
}

/** Werdykty gotowe, gdy mają tyle wierszy co arkusz (sędzia dopisuje partiami, więc przerwany bieg zostawia niepełny plik). */
export const verdictsComplete = (verdicts: string, sheet: string) => existsSync(verdicts) && existsSync(sheet) && csvRowCount(readFileSync(verdicts, "utf8")) === csvRowCount(readFileSync(sheet, "utf8"));

/** Płatny krok wymaga `--cap-usd`; nowy limit nie może być niższy niż już wydane w rejestrze biegu. */
export function assertPaidAllowed(paidSteps: number, capUsd: number | undefined, ledger: { spentUsd: number } | undefined): void {
  if (paidSteps === 0) return;
  if (capUsd === undefined) throw new Error(`${paidSteps} płatnych kroków, a brak --cap-usd (limit rejestru kosztów biegu; ${RESERVE_NOTE})`);
  if (ledger !== undefined && capUsd < ledger.spentUsd) throw new Error(`costs.json: wydane ${ledger.spentUsd.toFixed(2)} USD, więcej niż --cap-usd ${capUsd}`);
}

export type BenchMeta = { label: string; commit: string; dirty: boolean; diffSha256: string | null; routing: Record<string, string>; models: Record<string, string>; reps: number };

/**
 * Jeden katalog biegu = jedna konfiguracja. Etykieta zawsze ta sama; kod, routing, modele i powtórzenia porównujemy tylko,
 * gdy plan jeszcze generuje (sama ponowna ocena innym sędzią może biec na innym commicie — rekord bierze zapisaną konfigurację).
 */
export function checkMeta(existing: BenchMeta | undefined, current: BenchMeta, generates: boolean): void {
  if (existing === undefined) return;
  const fields = generates ? (["label", "commit", "dirty", "diffSha256", "routing", "models", "reps"] as const) : (["label"] as const);
  for (const field of fields) {
    if (JSON.stringify(existing[field]) !== JSON.stringify(current[field])) throw new Error(`bench.json: ${field} różni się od zapisanego (${JSON.stringify(existing[field])}) — jeden katalog biegu to jedna konfiguracja; użyj nowego --out`);
  }
}

/** Szacunek kosztu z najnowszego rekordu z danym zadaniem (bez rekordów z routingiem BYOK, których koszt jest niepełny). */
export function estimateUsd(steps: Step[], records: BenchRecord[]): { usd: number; unknown: string[] } {
  const byDate = records.filter((record) => Object.keys(record.routing).length === 0).sort((a, b) => b.date.localeCompare(a.date));
  let usd = 0;
  const unknown = new Set<string>();
  for (const step of steps) {
    if (step.kind !== "generate") continue;
    const cost = byDate.find((record) => record.generation[step.task.id]?.costUsd)?.generation[step.task.id]?.costUsd;
    if (cost) usd += cost.max;
    else unknown.add(step.task.id);
  }
  return { usd, unknown: [...unknown] };
}

export function readRecords(): BenchRecord[] {
  return existsSync(RESULTS_DIR) ? readdirSync(RESULTS_DIR).filter((name) => name.endsWith(".json")).sort().map((name) => JSON.parse(readFileSync(join(RESULTS_DIR, name), "utf8")) as BenchRecord) : [];
}

const git = (...args: string[]) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }).trim();

function currentMeta(label: string, reps: number): BenchMeta {
  const dirty = git("status", "--porcelain", ...CODE_PATHS) !== "";
  let diffSha256: string | null = null;
  if (dirty) {
    // Diff śledzonych plików i treść nowych (nieśledzonych): nowy prompt w `packages` też zmienia hash.
    const hash = createHash("sha256").update(git("diff", "HEAD", ...CODE_PATHS));
    for (const file of git("ls-files", "--others", "--exclude-standard", ...CODE_PATHS).split("\n").filter(Boolean).sort()) hash.update(file).update(readFileSync(join(REPO, file)));
    diffSha256 = hash.digest("hex");
  }
  const routing = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => ROUTING.test(entry[0]) && entry[1] !== undefined).sort());
  const env = withConfigDefaults(process.env);
  const models = Object.fromEntries(MODEL_ENV.flatMap((name) => (env[name] === undefined ? [] : [[name, env[name]!]])));
  return { label, commit: git("rev-parse", "--short", "HEAD"), dirty, diffSha256, routing, models, reps };
}

function museVersion(): string | undefined {
  try {
    const line = runMuse(["--version"]).split(/\r?\n/u)[0]?.trim() ?? "";
    // Do rekordu w repo trafia tylko krótka linia wersji, nie baner ani ścieżka.
    return /^[\w .()-]{1,80}$/u.test(line) ? line : undefined;
  } catch {
    return undefined;
  }
}

/** Podproces bez powłoki: `node vitest.mjs` albo `node <skrypt>.cjs`; stdout i stderr do logu kroku. */
function spawnLogged(args: string[], env: Record<string, string>, log: string): number {
  mkdirSync(dirname(log), { recursive: true });
  const fd = openSync(log, "w");
  try {
    return spawnSync(process.execPath, args, { cwd: REPO, env, stdio: ["ignore", fd, fd] }).status ?? 1;
  } finally {
    closeSync(fd);
  }
}

const probeArgs = (file: string) => [VITEST, "run", "--config", "vitest.probe.config.ts", file];

function execute(step: Step, base: Record<string, string>): void {
  const started = Date.now();
  let status: number;
  if (step.kind === "generate") {
    for (const dir of step.dumps) rmSync(dir, { recursive: true, force: true });
    mkdirSync(step.done, { recursive: true });
    status = spawnLogged(probeArgs("tests/probes/chapter-generation.probe.test.ts"), { ...base, ...step.env }, step.log);
    if (readdirSync(step.done).length === 0) throw new Error(`${stepName(step)}: brak pliku wyników (kod ${status}); log: ${step.log}`);
  } else if (step.kind === "gold") {
    status = spawnLogged(probeArgs("tests/probes/closed-check-gold.probe.test.ts"), { ...base, ...step.env }, step.log);
    // Zrzut powstaje przed asercjami progów: kod ≠ 0 przy zrzucie to wynik, nie awaria.
    if (!existsSync(step.done)) throw new Error(`${stepName(step)}: brak zrzutu (kod ${status}); log: ${step.log}`);
  } else if (step.kind === "sheet") {
    status = spawnLogged([SHEET, ...step.args], base, step.log);
    if (!existsSync(step.done)) throw new Error(`${stepName(step)}: brak arkusza (kod ${status}); log: ${step.log}`);
  } else {
    // Sonda nie dopisuje do istniejącego pliku: niepełny odkładamy, a sędzia ocenia arkusz od nowa (płatny sędzia płaci ponownie).
    if (existsSync(step.done)) renameSync(step.done, step.done.replace(/\.csv$/u, `.partial-${Date.now()}.csv`));
    status = spawnLogged(probeArgs("tests/probes/blind/auto-judge.probe.test.ts"), { ...base, ...step.env }, step.log);
    if (!verdictsComplete(step.done, step.sheet)) throw new Error(`${stepName(step)}: niepełne werdykty (kod ${status}); log: ${step.log}`);
  }
  console.log(`${stepName(step)}: gotowe (${Math.round((Date.now() - started) / 1000)} s, kod ${status})`);
}

function writeTable(): void {
  writeFileSync(join(RESULTS_DIR, "README.md"), renderTable(readRecords()), "utf8");
  console.log(`tabela: ${join(RESULTS_DIR, "README.md")}`);
}

function run(argv: string[]): void {
  const { values } = parseArgs({ args: argv, options: { out: { type: "string" }, label: { type: "string" }, judge: { type: "string", default: MUSE_PREFIX }, "cap-usd": { type: "string" }, reps: { type: "string" }, tasks: { type: "string" }, note: { type: "string" } } });
  const out = probePath(values.out, "--out");
  const label = validateLabel(values.label);
  const judge = values.judge!.trim();
  const reps = values.reps === undefined ? DEFAULT_REPS : Number(values.reps);
  if (!Number.isInteger(reps) || reps < 1 || reps > 5) throw new Error("--reps: liczba całkowita 1–5");
  const capUsd = values["cap-usd"] === undefined ? undefined : Number(values["cap-usd"]);
  if (capUsd !== undefined && !(Number.isFinite(capUsd) && capUsd > 0)) throw new Error("--cap-usd: dodatnia liczba USD");
  const tasks = values.tasks === undefined ? SUITE : values.tasks.split(",").map((id) => taskById(id.trim()));
  const slug = judgeSlug(judge);
  const recordPath = join(RESULTS_DIR, `${label}.${slug}.json`);
  if (existsSync(recordPath)) throw new Error(`${recordPath} już istnieje`);

  const env = withConfigDefaults(process.env);
  const steps = planSteps({ out, tasks, reps, judge, checkerModel: env.UMIEM_LESSON_AGENT_CHECKER_MODEL!, exists: existsSync, isDirEmpty: (path) => readdirSync(path).length === 0, judged: verdictsComplete });
  const metaPath = join(out, "bench.json");
  const saved = existsSync(metaPath) ? (JSON.parse(readFileSync(metaPath, "utf8")) as BenchMeta) : undefined;
  const meta = currentMeta(label, reps);
  checkMeta(saved, meta, steps.some((step) => step.kind === "generate" || step.kind === "gold"));
  const config = saved ?? meta;
  const paid = steps.filter((step) => isPaid(step, judge));
  const costsPath = join(out, "costs.json");
  const ledger = existsSync(costsPath) ? readCostLedger(costsPath) : undefined;
  const estimate = estimateUsd(steps, readRecords());
  console.log(`plan (${steps.length} kroków, płatnych ${paid.length}):`);
  for (const step of steps) console.log(`- ${stepName(step)}${isPaid(step, judge) ? " (płatny)" : ""}`);
  console.log(`szacunek generowania z poprzednich rekordów: ${estimate.usd.toFixed(2)} USD${estimate.unknown.length ? `; bez danych: ${estimate.unknown.join(", ")}` : ""} (kontrola wzorcowa ok. 0,05 USD na zadanie; koszt przy kluczu właściciela BYOK rejestr widzi jako 0)`);
  assertPaidAllowed(paid.length, capUsd, ledger);

  mkdirSync(out, { recursive: true });
  if (saved === undefined) writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  if (ledger === undefined) initCostLedger(costsPath, capUsd ?? 0.01); // bez płatnych kroków (sędzia Muse) rejestr tylko dla sondy, wpisy po 0 USD
  else if (capUsd !== undefined && ledger.capUsd !== capUsd) {
    writeFileSync(costsPath, `${JSON.stringify({ ...ledger, capUsd }, null, 2)}\n`, "utf8");
    console.log(`costs.json: limit ${ledger.capUsd} → ${capUsd} USD (wydane ${ledger.spentUsd.toFixed(2)})`);
  }
  mkdirSync(join(out, "materials"), { recursive: true });
  for (const task of tasks) if (task.kind === "generation") copyFileSync(fixturePath(task.material), join(out, "materials", task.material));
  const base = inheritedEnv(process.env);
  for (const step of steps) execute(step, base);

  const { generation, gold } = readRun(out, tasks, (task) => join(out, "judge", `${task}.${slug}.csv`));
  const record = buildRecord({
    meta: { label, date: new Date().toISOString().slice(0, 10), commit: config.commit, dirty: config.dirty, diffSha256: config.diffSha256, routing: config.routing, judge, judgeVersion: judge.startsWith(MUSE_PREFIX) ? museVersion() : undefined, rubric: RUBRIC, ...(values.note ? { note: values.note } : {}) },
    generation,
    gold,
  });
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(`rekord: ${recordPath}`);
  writeTable();
}

/** Klucze ustawione w `.env` repozytorium (bez wartości). */
function dotEnvKeys(): string[] {
  const path = join(REPO, ".env");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\r?\n/u).flatMap((line) => /^(?:export\s+)?([A-Z0-9_]+)=/u.exec(line.trim())?.[1] ?? []);
}

function main(argv: string[]): void {
  const [command, ...rest] = argv;
  if (command === "run") {
    assertNoProbeEnvInDotEnv(dotEnvKeys());
    loadDotEnv();
    run(rest);
  } else if (command === "table") writeTable();
  else {
    console.log("Użycie: pnpm bench run --out <katalog poza repo> --label <slug> [--judge muse:] [--cap-usd N] [--reps N] [--tasks a,b] [--note tekst]\n       pnpm bench table\nInstrukcja: tests/probes/README.md");
    process.exitCode = command === undefined || command === "--help" ? 0 : 1;
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`bench: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
