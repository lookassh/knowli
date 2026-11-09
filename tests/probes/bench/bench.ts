import { createHash } from "node:crypto";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { withConfigDefaults } from "../../../packages/server/src/config-defaults";
import { initCostLedger, readCostLedger } from "../probe-costs";
import { childEnv, loadDotEnv } from "../probe-helpers";
import { buildRecord, readRun, type BenchRecord } from "./record";
import { DEFAULT_REPS, SUITE, fixturePath, taskById, type BenchTask, type GenerationTask } from "./suite";
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

export type Step =
  | { kind: "generate"; task: GenerationTask; rep: number; env: Record<string, string>; done: string; log: string }
  | { kind: "gold"; task: BenchTask; env: Record<string, string>; done: string; log: string }
  | { kind: "sheet"; task: GenerationTask; args: string[]; done: string; log: string }
  | { kind: "judge"; task: GenerationTask; env: Record<string, string>; sheet: string; done: string; log: string };

export const judgeSlug = (judge: string) => judge.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
export const isPaid = (step: Step, judge: string) => step.kind === "generate" || step.kind === "gold" || (step.kind === "judge" && !judge.startsWith(MUSE_PREFIX));

/** Dziedziczone środowisko bez `UMIEM_PROBE_*`: zmienna z powłoki nie zmieni materiału, hosta, rejestru ani „+N” zadania. */
export function inheritedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith("UMIEM_PROBE_")));
}

export function validateLabel(label: string | undefined): string {
  if (label === undefined || !/^[a-z0-9][a-z0-9-]{0,40}$/u.test(label)) throw new Error("--label: małe litery, cyfry i „-”, do 41 znaków (np. flash-2026-11-09)");
  return label;
}

/** Plan kroków dla zadań; `exists` sprawdza pliki (test podaje własną funkcję). Krok gotowy, gdy jest jego plik wyniku. */
export function planSteps(options: { out: string; tasks: readonly BenchTask[]; reps: number; judge: string; checkerModel: string; exists: (path: string) => boolean; isDirEmpty: (path: string) => boolean }): Step[] {
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
      // Plik wyników powstaje także po nieudanym runie: wznowienie nie płaci za niego drugi raz.
      if (exists(outDir) && !isDirEmpty(outDir)) continue;
      steps.push({
        kind: "generate",
        task,
        rep,
        done: outDir,
        log: join(dir, "logs", `r${rep}.log`),
        env: {
          ...task.env,
          UMIEM_PROBE_SUBJECT: task.subject,
          UMIEM_PROBE_MATERIAL: join(out, "materials", task.material),
          UMIEM_PROBE_OUT_DIR: outDir,
          UMIEM_PROBE_POOL_DUMP_OUT: join(dir, `baseline-r${rep}`, "dump.json"),
          UMIEM_PROBE_COSTS: costs,
          ...(task.addCount === undefined ? {} : { UMIEM_PROBE_ADD_COUNT: String(task.addCount) }),
        },
      });
    }
    const key = join(dir, "blind", "key.json");
    const judgeDir = join(out, "judge", task.id);
    if (!exists(key)) steps.push({ kind: "sheet", task, done: key, log: join(dir, "logs", "sheet.log"), args: [dir, task.id, task.id, judgeDir, RUBRIC] });
    const verdicts = join(out, "judge", `${task.id}.${slug}.csv`);
    steps.push({ kind: "judge", task, sheet: join(judgeDir, "sheet.csv"), done: verdicts, log: join(out, "judge", `${task.id}.${slug}.log`), env: { UMIEM_PROBE_JUDGE_DIR: judgeDir, UMIEM_PROBE_JUDGE_MODEL: judge, UMIEM_PROBE_JUDGE_OUT: verdicts, UMIEM_PROBE_COSTS: costs } });
  }
  return steps;
}

/** Liczba wierszy CSV (pola w cudzysłowach mogą mieć nowe linie) — przez `parseCsv` z `score.cjs`. */
function csvRows(path: string): number {
  const { parseCsv } = require("../blind/score.cjs") as { parseCsv: (text: string) => unknown[] };
  return parseCsv(readFileSync(path, "utf8")).length;
}

/** Werdykty gotowe, gdy mają tyle wierszy co arkusz (sędzia dopisuje partiami, więc przerwany bieg zostawia niepełny plik). */
export const verdictsComplete = (verdicts: string, sheet: string) => existsSync(verdicts) && existsSync(sheet) && csvRows(verdicts) === csvRows(sheet);

/** Płatny krok wymaga `--cap-usd`; istniejący rejestr z innym limitem → błąd (`initCostLedger` nie zmienia limitu). */
export function assertPaidAllowed(paidSteps: number, capUsd: number | undefined, ledger: { capUsd: number } | undefined): void {
  if (paidSteps === 0) return;
  if (capUsd === undefined) throw new Error(`${paidSteps} płatnych kroków, a brak --cap-usd (limit rejestru kosztów biegu; ${RESERVE_NOTE})`);
  if (ledger !== undefined && Math.abs(ledger.capUsd - capUsd) > 1e-9) throw new Error(`costs.json ma limit ${ledger.capUsd} USD, a --cap-usd ${capUsd}: podaj ten sam limit albo nowy --out`);
}

export type BenchMeta = { label: string; commit: string; dirty: boolean; diffSha256: string | null; routing: Record<string, string>; reps: number; tasks: string[] };

/** Jeden katalog biegu = jedna konfiguracja: inny commit, stan roboczy, routing albo powtórzenia → błąd. */
export function checkMeta(existing: BenchMeta | undefined, current: BenchMeta): void {
  if (existing === undefined) return;
  for (const field of ["label", "commit", "dirty", "diffSha256", "routing", "reps"] as const) {
    if (JSON.stringify(existing[field]) !== JSON.stringify(current[field])) throw new Error(`bench.json: ${field} różni się od zapisanego (${JSON.stringify(existing[field])}) — jeden katalog biegu to jedna konfiguracja; użyj nowego --out`);
  }
}

/** Szacunek kosztu z najnowszego rekordu z danym zadaniem: max koszt lekcji × liczba powtórzeń do zrobienia. */
export function estimateUsd(steps: Step[], records: BenchRecord[]): { usd: number; unknown: string[] } {
  const byDate = [...records].sort((a, b) => b.date.localeCompare(a.date));
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

export function readRecords(dir: string = RESULTS_DIR): BenchRecord[] {
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".json")).sort().map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as BenchRecord) : [];
}

const git = (...args: string[]) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }).trim();

function currentMeta(label: string, reps: number, tasks: readonly BenchTask[]): BenchMeta {
  const dirty = git("status", "--porcelain") !== "";
  const routing = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => ROUTING.test(entry[0]) && entry[1] !== undefined).sort());
  return { label, commit: git("rev-parse", "--short", "HEAD"), dirty, diffSha256: dirty ? createHash("sha256").update(git("diff", "HEAD", "--", "packages", "tests/probes")).digest("hex") : null, routing, reps, tasks: tasks.map((task) => task.id) };
}

function museVersion(): string | undefined {
  try {
    const args = ["--version"];
    const out = process.platform === "win32" ? execFileSync("cmd.exe", ["/d", "/s", "/c", "muse", ...args], { env: childEnv(), encoding: "utf8" }) : execFileSync("muse", args, { env: childEnv(), encoding: "utf8" });
    return out.split(/\r?\n/u)[0]?.trim() || undefined;
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
  const label = `${step.kind} ${step.task.id}${step.kind === "generate" ? ` r${step.rep}` : ""}`;
  const started = Date.now();
  let status: number;
  if (step.kind === "generate") {
    mkdirSync(step.done, { recursive: true });
    status = spawnLogged(probeArgs("tests/probes/chapter-generation.probe.test.ts"), { ...base, ...step.env }, step.log);
    if (readdirSync(step.done).length === 0) throw new Error(`${label}: brak pliku wyników (kod ${status}); log: ${step.log}`);
  } else if (step.kind === "gold") {
    status = spawnLogged(probeArgs("tests/probes/closed-check-gold.probe.test.ts"), { ...base, ...step.env }, step.log);
    // Zrzut powstaje przed asercjami progów: kod ≠ 0 przy zrzucie to wynik, nie awaria.
    if (!existsSync(step.done)) throw new Error(`${label}: brak zrzutu (kod ${status}); log: ${step.log}`);
  } else if (step.kind === "sheet") {
    status = spawnLogged([SHEET, ...step.args], base, step.log);
    if (!existsSync(step.done)) throw new Error(`${label}: brak arkusza (kod ${status}); log: ${step.log}`);
  } else {
    if (verdictsComplete(step.done, step.sheet)) return;
    if (existsSync(step.done)) renameSync(step.done, step.done.replace(/\.csv$/u, `.partial-${Date.now()}.csv`));
    status = spawnLogged(probeArgs("tests/probes/blind/auto-judge.probe.test.ts"), { ...base, ...step.env }, step.log);
    if (!verdictsComplete(step.done, step.sheet)) throw new Error(`${label}: niepełne werdykty (kod ${status}); log: ${step.log}`);
  }
  console.log(`${label}: gotowe (${Math.round((Date.now() - started) / 1000)} s, kod ${status})`);
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

  const metaPath = join(out, "bench.json");
  const meta = currentMeta(label, reps, tasks);
  const saved = existsSync(metaPath) ? (JSON.parse(readFileSync(metaPath, "utf8")) as BenchMeta) : undefined;
  checkMeta(saved, meta);
  const env = withConfigDefaults(process.env);
  const steps = planSteps({ out, tasks, reps, judge, checkerModel: env.UMIEM_LESSON_AGENT_CHECKER_MODEL!, exists: existsSync, isDirEmpty: (path) => readdirSync(path).length === 0 });
  const paid = steps.filter((step) => isPaid(step, judge));
  const costsPath = join(out, "costs.json");
  const estimate = estimateUsd(steps, readRecords());
  console.log(`plan (${steps.length} kroków, płatnych ${paid.length}):`);
  for (const step of steps) console.log(`- ${step.kind} ${step.task.id}${step.kind === "generate" ? ` r${step.rep}` : ""}${isPaid(step, judge) ? " (płatny)" : ""}`);
  console.log(`szacunek generowania z poprzednich rekordów: ${estimate.usd.toFixed(2)} USD${estimate.unknown.length ? `; bez danych: ${estimate.unknown.join(", ")}` : ""} (kontrola wzorcowa ok. 0,05 USD na zadanie; koszt przy kluczu właściciela BYOK rejestr widzi jako 0)`);
  assertPaidAllowed(paid.length, capUsd, existsSync(costsPath) ? readCostLedger(costsPath) : undefined);

  mkdirSync(out, { recursive: true });
  if (saved === undefined) writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  if (capUsd !== undefined) initCostLedger(costsPath, capUsd);
  else if (!existsSync(costsPath)) initCostLedger(costsPath, 0.01); // tylko sędzia Muse: rejestr wymagany przez sondę, wpisy po 0 USD
  mkdirSync(join(out, "materials"), { recursive: true });
  for (const task of tasks) if (task.kind === "generation") copyFileSync(fixturePath(task.material), join(out, "materials", task.material));
  const base = inheritedEnv(process.env);
  for (const step of steps) execute(step, base);

  const { generation, gold } = readRun(out, tasks, (task) => join(out, "judge", `${task}.${slug}.csv`));
  const record = buildRecord({
    meta: { label, date: new Date().toISOString().slice(0, 10), commit: meta.commit, dirty: meta.dirty, diffSha256: meta.diffSha256, routing: meta.routing, judge, judgeVersion: judge.startsWith(MUSE_PREFIX) ? museVersion() : undefined, rubric: RUBRIC, ...(values.note ? { note: values.note } : {}) },
    generation,
    gold,
  });
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(`rekord: ${recordPath}`);
  writeTable();
}

function main(argv: string[]): void {
  const [command, ...rest] = argv;
  if (command === "run") {
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
