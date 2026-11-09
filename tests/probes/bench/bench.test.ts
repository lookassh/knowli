import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RESULTS_DIR, assertNoProbeEnvInDotEnv, assertPaidAllowed, checkMeta, estimateUsd, inheritedEnv, isPaid, judgeSlug, planSteps, readRecords, validateLabel, type BenchMeta } from "./bench";
import { buildRecord, type BlindKey, type GenerationInput, type ProbeResults, type RecordMeta, type Verdict } from "./record";
import { SUITE, fixturePath, sha256Of, taskById } from "./suite";
import { renderTable } from "./table";

const MARK = "SEKRETNY_ZNACZNIK";

describe("SUITE", () => {
  it("unikalne id, istniejące fixtures, różne materiały poza zamierzonym wspólnym materiałem czasów teraźniejszych", () => {
    const ids = SUITE.map((task) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const task of SUITE) expect(existsSync(fixturePath(task.kind === "gold" ? task.fixture : task.material)), task.id).toBe(true);
    const byHash = new Map<string, string[]>();
    for (const task of SUITE) if (task.kind === "generation") byHash.set(sha256Of(fixturePath(task.material)), [...(byHash.get(sha256Of(fixturePath(task.material))) ?? []), task.id]);
    expect([...byHash.values()].filter((group) => group.length > 1)).toEqual([["grammar-present-simple", "grammar-present-continuous"]]);
  });

  it("materiały z LF (sha256 zgodne ze zrzutami etapów 4–5 niezależnie od core.autocrlf)", () => {
    expect(sha256Of(fixturePath("school-plant-parts.txt"))).toBe("524e9f631e9de70fa5e123fe08358db59a53acb2a038f6b356ffb92c1b1c0a34");
    expect(readFileSync(fixturePath("grammar-to-be.txt"), "utf8")).not.toContain("\r");
  });

  it("taskById zna zadania i odrzuca nieznane", () => {
    expect(taskById("gold-school").kind).toBe("gold");
    expect(() => taskById("nope")).toThrow(/nieznane zadanie/u);
  });
});

const key = (rows: [string, string, string?][]): BlindKey => ({
  seed: "s",
  prefix: "p",
  models: [],
  rows: rows.map(([rowId, model, family], index) => ({ rowId, model, index, type: "lesson_gap", hasExplanation: false, ...(family ? { family } : {}) })),
});
const verdict = (rowId: string, criterion = ""): Verdict => ({ rowId, verdict: criterion ? "defect" : "ok", criterion, level: "", adjudicatorNote: `${MARK} notatka` });
const results = (patch: Partial<ProbeResults> = {}): ProbeResults => ({
  state: "succeeded",
  publishable: "TAK (publishLessonDraft przeszedł)",
  durationMs: 100_400,
  material: { sha256: "abc" },
  models: { generator: "gen/a", checker: "chk/b", grader: "gr/c", objectives: "gen/a", objectivesReasoning: "low" },
  costUsd: { total: 0.25 },
  tokens: { byModel: { "gen/a": { in: 100, out: 10 } } },
  draft: { coverage: [{ actual: 0, required: 2, objective: `${MARK}_slug` } as never, { actual: 2, required: 2 }] },
  ...patch,
});
const META: RecordMeta = { label: "x", date: "2026-11-09", commit: "abc1234", dirty: false, diffSha256: null, routing: {}, judge: "muse:", rubric: "rubric-stage5.md" };
const input = (patch: Partial<GenerationInput> = {}): GenerationInput => ({
  id: "chapter-home-rooms",
  key: key([["p-r001", "baseline-r1", `${MARK}_family|f1`], ["p-r002", "baseline-add-r1"], ["p-r003", "baseline-r2"], ["p-r004", "agent-r1"]]),
  verdicts: [verdict("p-r001", "W5"), verdict("p-r002"), verdict("p-r003", "W2|W5"), verdict("p-r004", "W1")],
  results: [results(), results({ publishable: "NIE (conflict, AppError)", costUsd: { total: 0.3 }, durationMs: 90_000 })],
  dumps: [{ materialSha256: "abc", effort: "low", exposureLeaks: [] }],
  ...patch,
});

describe("buildRecord", () => {
  it("liczy przebieg bazowy z „+N”, pomija ramię agenta, publikowalność, koszty i tokeny", () => {
    const record = buildRecord({ meta: META, generation: [input()], gold: [] });
    const entry = record.generation["chapter-home-rooms"]!;
    expect(entry).toMatchObject({ runs: 2, succeeded: 2, publishable: 1, costUsd: { min: 0.25, max: 0.3 }, durationS: { min: 90, max: 100 }, coverageGapsBeforeAdd: 2, materialSha256: "abc" });
    expect(entry.tokens).toEqual({ "gen/a": { in: 200, out: 20 } });
    expect(entry.anyDefect).toMatchObject({ defects: 2, n: 3 });
    expect(entry.defects.W5).toEqual({ defects: 2, n: 3 });
    expect(entry.defects.W1).toBeUndefined();
    expect(record.models).toEqual({ generator: "gen/a", objectives: "gen/a", objectivesReasoning: "low", checker: "chk/b", grader: "gr/c", effort: "low" });
  });

  it("nie przenosi treści: notatki sędziego, członów zagadnień, rodzin ani materiału", () => {
    const text = JSON.stringify(buildRecord({ meta: META, generation: [input()], gold: [] }));
    expect(text).not.toContain(MARK);
  });

  it("błąd przy wierszu bez werdyktu, ujawnieniu w zrzucie i różnych modelach", () => {
    expect(() => buildRecord({ meta: META, generation: [input({ verdicts: [verdict("p-r001")] })], gold: [] })).toThrow(/bez werdyktu/u);
    expect(() => buildRecord({ meta: META, generation: [input({ dumps: [{ exposureLeaks: [{}] }] })], gold: [] })).toThrow(/exposureLeaks/u);
    expect(() => buildRecord({ meta: META, generation: [input({ results: [results(), results({ models: { generator: "other/x" } })] })], gold: [] })).toThrow(/models.generator/u);
    expect(() => buildRecord({ meta: META, generation: [input({ dumps: [{ materialSha256: "zzz" }] })], gold: [] })).toThrow(/materialSha256/u);
  });

  it("kontrola wzorcowa zachowuje liczby per powtórzenie", () => {
    const tally = { correct: [{ rejected: 0, total: 18 }], wrong_key: [{ rejected: 16, total: 16 }], second_correct: [{ rejected: 4, total: 9 }, { rejected: 8, total: 9 }] };
    const record = buildRecord({ meta: META, generation: [], gold: [{ id: "gold-chapter", dump: { model: "chk/b", fixture: "f.json", tally } }] });
    expect(record.gold["gold-chapter"]).toMatchObject({ secondCorrectDetected: [4, 8], secondCorrectTotal: 9, wrongKeyDetected: [16] });
    expect(record.models.checker).toBe("chk/b");
  });
});

describe("renderTable", () => {
  const recordWith = (label: string, judge: string, sha = "abc") => buildRecord({ meta: { ...META, label, judge }, generation: [input({ results: [results({ material: { sha256: sha } })], dumps: [{ materialSha256: sha }] })], gold: [] });

  it("osobne sekcje sędziów, „—” bez wyniku, znacznik innego materiału", () => {
    const a = recordWith("a", "muse:");
    const b = recordWith("b", "openai/x", "old");
    const c = { ...recordWith("c", "muse:"), generation: {} };
    const table = renderTable([b, a, c], new Map([["chapter-home-rooms", "abc"]]));
    expect(table).toContain("## Sędzia `muse:`");
    expect(table).toContain("## Sędzia `openai/x`");
    expect(table).toMatch(/\| chapter-home-rooms \| pub 1\/1 · wady 66,7%.* \| — \|/u);
    expect(table).toContain("USD *");
    expect(table.indexOf("`muse:`")).toBeLessThan(table.indexOf("`openai/x`"));
  });

  it("results/README.md odpowiada rekordom (wygeneruj: pnpm bench table)", () => {
    expect(readFileSync(join(RESULTS_DIR, "README.md"), "utf8")).toBe(renderTable(readRecords()));
  });
});

describe("CLI", () => {
  const out = "/home/u/bench";
  const plan = (existing: string[] = [], tasks = SUITE, judge = "muse:") =>
    planSteps({ out, tasks, reps: 2, judge, checkerModel: "chk/b", exists: (path) => existing.includes(path), isDirEmpty: () => false, judged: (verdicts) => existing.includes(verdicts) });

  it("plan pomija gotowe powtórzenia (także nieudane z plikiem wyników) i arkusze", () => {
    const tasks = [taskById("chapter-home-rooms")];
    const done = [join(out, "chapter-home-rooms", "out", "r1"), join(out, "chapter-home-rooms", "blind", "key.json")];
    expect(plan(done, tasks).map((step) => `${step.kind}${step.kind === "generate" ? step.rep : ""}`)).toEqual(["generate2", "judge"]);
    expect(plan([...done, join(out, "judge", "chapter-home-rooms.muse.csv")], tasks).map((step) => step.kind)).toEqual(["generate"]);
  });

  it("powtórzenie do zrobienia czyści swoje zrzuty (przerwany proces zostawia zrzut bez pliku wyników)", () => {
    const step = plan([], [taskById("chapter-home-rooms")])[0]!;
    if (step.kind !== "generate") throw new Error("plan");
    expect(step.dumps).toEqual([join(out, "chapter-home-rooms", "baseline-r1"), join(out, "chapter-home-rooms", "baseline-add-r1")]);
  });

  it("env zadań: materiał w --out, „+N” tylko z „+N”, kontrola wzorcowa z UMIEM_PROBE_GOLD", () => {
    const steps = plan();
    const school = steps.find((step) => step.kind === "generate" && step.task.id === "school-plant-parts")!;
    const chapter = steps.find((step) => step.kind === "generate" && step.task.id === "chapter-food-likes")!;
    const gold = steps.find((step) => step.kind === "gold")!;
    if (school.kind !== "generate" || chapter.kind !== "generate" || gold.kind !== "gold") throw new Error("plan");
    expect(school.env).toMatchObject({ UMIEM_PROBE_SUBJECT: "school", UMIEM_PROBE_MATERIAL: join(out, "materials", "school-plant-parts.txt"), UMIEM_PROBE_TOPIC: "Części rośliny i ich zadania" });
    expect(school.env.UMIEM_PROBE_ADD_COUNT).toBeUndefined();
    expect(chapter.env.UMIEM_PROBE_ADD_COUNT).toBe("3");
    expect(gold.env).toMatchObject({ UMIEM_PROBE_GOLD: "1", UMIEM_PROBE_GOLD_FIXTURE: "closed-check-gold-stage5.json", UMIEM_PROBE_AGENT_SOLVER_MODEL: "chk/b" });
  });

  it("dziedziczone UMIEM_PROBE_* nie przechodzą do sond", () => {
    expect(inheritedEnv({ PATH: "p", UMIEM_PROBE_ALLOW_HOST: "evil", UMIEM_PROBE_ADD_COUNT: "9", UMIEM_LLM_MODEL: "m" })).toEqual({ PATH: "p", UMIEM_LLM_MODEL: "m" });
  });

  it("płatne kroki wymagają --cap-usd zgodnego z rejestrem; sędzia Muse nie jest płatny", () => {
    const judgeOnly = plan([...SUITE.flatMap((task) => [join(out, task.id, "out", "r1"), join(out, task.id, "out", "r2"), join(out, task.id, "blind", "key.json"), join(out, "gold", `${task.id}.json`)])], SUITE, "openai/x");
    expect(judgeOnly.every((step) => step.kind === "judge")).toBe(true);
    expect(judgeOnly.filter((step) => isPaid(step, "muse:"))).toHaveLength(0);
    expect(judgeOnly.filter((step) => isPaid(step, "openai/x"))).toHaveLength(judgeOnly.length);
    expect(() => assertPaidAllowed(0, undefined, undefined)).not.toThrow();
    expect(() => assertPaidAllowed(3, undefined, undefined)).toThrow(/--cap-usd/u);
    expect(() => assertPaidAllowed(3, 5, { spentUsd: 5.5 })).toThrow(/wydane 5.50/u);
    expect(() => assertPaidAllowed(3, 5, { spentUsd: 4 })).not.toThrow();
  });

  it("niezgodny bench.json, zła etykieta i slug sędziego", () => {
    const meta: BenchMeta = { label: "a", commit: "c1", dirty: false, diffSha256: null, routing: {}, models: { UMIEM_LESSON_AGENT_MODEL: "gen/a" }, reps: 2 };
    expect(() => checkMeta(meta, { ...meta, commit: "c2" }, true)).toThrow(/commit/u);
    expect(() => checkMeta(meta, { ...meta, routing: { UMIEM_LLM_PROVIDER_ORDER: "anthropic" } }, true)).toThrow(/routing/u);
    expect(() => checkMeta(meta, { ...meta, models: { UMIEM_LESSON_AGENT_MODEL: "gen/b" } }, true)).toThrow(/models/u);
    // Sama ponowna ocena innym sędzią: inny commit (np. po zacommitowaniu rekordu) nie blokuje, inna etykieta tak.
    expect(() => checkMeta(meta, { ...meta, commit: "c2", dirty: true }, false)).not.toThrow();
    expect(() => checkMeta(meta, { ...meta, label: "b" }, false)).toThrow(/label/u);
    expect(() => validateLabel("../x")).toThrow(/--label/u);
    expect(validateLabel("flash-2026-11-09")).toBe("flash-2026-11-09");
    expect(judgeSlug("muse:")).toBe("muse");
    expect(judgeSlug("openai/gpt-5.6")).toBe("openai-gpt-5-6");
  });

  it("szacunek z najnowszego rekordu zadania", () => {
    const record = buildRecord({ meta: META, generation: [input()], gold: [] });
    const steps = plan([], [taskById("chapter-home-rooms"), taskById("chapter-food-likes")]);
    expect(estimateUsd(steps, [record])).toEqual({ usd: 0.6, unknown: ["chapter-food-likes"] });
    const byok = buildRecord({ meta: { ...META, date: "2026-12-01", routing: { UMIEM_LLM_PROVIDER_ORDER: "anthropic" } }, generation: [input({ results: [results({ costUsd: { total: 0.01 } })] })], gold: [] });
    expect(estimateUsd(steps, [record, byok]).usd).toBe(0.6);
  });

  it(".env z UMIEM_PROBE_* jest odrzucany (sondy wczytałyby go z powrotem)", () => {
    expect(() => assertNoProbeEnvInDotEnv(["OPENROUTER_API_KEY", "UMIEM_LLM_MODEL"])).not.toThrow();
    expect(() => assertNoProbeEnvInDotEnv(["UMIEM_PROBE_ALLOW_HOST"])).toThrow(/UMIEM_PROBE_ALLOW_HOST/u);
  });
});
