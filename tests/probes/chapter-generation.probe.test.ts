import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, describe, expect, it } from "vitest";
import {
  MAX_AUTOMATIC_ATTEMPTS,
  createGenerationDepsFromEnv,
  createLesson,
  createLessonFromMaterial,
  createProductionSubjectRegistry,
  createSchoolLesson,
  createServices,
  executeLessonGeneration,
  publishLessonDraft,
  readGeneration,
  readLessonDeck,
  regenerateObjective,
  schema,
  withConfigDefaults,
  withUsageScope,
  type UsageEvent,
  type UsageRecorder,
} from "@learning/server";
import { lessonAgentDepsFromEnv } from "@learning/server/lesson-agent";
import type { LessonDraftDto } from "@learning/contracts";
import { DEFAULT_LESSON_AGENT_POLICY } from "../../packages/server/src/modules/materials/lessons/lesson-pool-agent-policy";
import { stageOf } from "../../packages/server/src/domain/lessons/stages";
import type { DynamicTopicData } from "../../packages/server/src/domain/lessons/types";
import { testDatabase } from "../integration/helpers";
import {
  agentLedgerCost,
  appendProvisionalCostEntry,
  assertWithinCostCap,
  costByOperation,
  costCapFromEnv,
  errorClassOf,
  initCostLedger,
  readCostLedger,
  runCosts,
  settleCostEntry,
  sha256File,
  type CostLedger,
} from "./probe-costs";
import { loadDotEnv, resolveOutsideRepoPath } from "./probe-helpers";
import { probePreflight } from "./probe-preflight";

const { eq } = createRequire(new URL("../../packages/server/package.json", import.meta.url))("drizzle-orm") as typeof import("../../packages/server/node_modules/drizzle-orm");

/**
 * Próba generowania lekcji agentem puli na PRAWDZIWYCH modelach (spec etapu 3 #237 §6.3–6.4):
 * przypadki użycia z bazą jak w workerze, agent i checker z `lessonAgentDepsFromEnv`
 * (`@learning/server/lesson-agent`). To nie jest test jakości — bez asercji poza końcem runu,
 * tylko raport w konsoli (liczby i ostatnie człony identyfikatorów zagadnień) i plik wyników:
 * zagadnienia z rodzajami, ćwiczenia per zagadnienie i etap, odrzucenia (kody), liczniki kontroli,
 * braki pokrycia, koszt per operacja i per run, próby i oczekiwania kolejki, wynik „+N” i próby
 * publikacji. Płatne wywołania, więc plik jest pomijany bez `UMIEM_PROBE_MATERIAL` (gramatyka:
 * bez `UMIEM_PROBE_SUBJECT=grammar`) i nie należy do konfiguracji unit ani integration.
 * Materiał leży POZA repozytorium i nie może do niego trafić.
 *
 * Zanim padnie cokolwiek płatnego (rejestr, wpis tymczasowy, wywołanie): {@link probePreflight}
 * — brak klucza OpenRouter, tryb fake, host spoza OpenRouter albo szkoła bez pełnego
 * `UMIEM_GRADER_*` kończą próbę bez kosztu. Szacunek do rejestru = budżet runu agenta
 * (`UMIEM_LESSON_AGENT_RUN_BUDGET_USD`, ×2 z „+N”).
 *
 * Zmienne (poza .env z kluczem, którego wartości nigdy nie są wypisywane):
 * - `UMIEM_PROBE_MATERIAL` — plik z materiałem (wymagany dla `chapter` i `school`; dla
 *   `grammar` opcjonalny — bez niego krótki wbudowany materiał zdań w Present Simple);
 * - `UMIEM_PROBE_SUBJECT` — `chapter` (domyślnie), `school` (Geografia) albo `grammar`
 *   (`english_grammar`, temat `present_simple` z katalogu, wszystkie jego zagadnienia);
 * - `UMIEM_PROBE_POOL_SIZE` — wielkość puli (domyślnie 60, jak w panelu);
 * - `UMIEM_PROBE_TOPIC` — tytuł tematu (domyślnie „Unit 1” / „Mapa”; gramatyka: z katalogu);
 * - `UMIEM_PROBE_ADD_COUNT` — po udanym runie „+N” (`regenerateObjective`) z tą liczbą dla
 *   pierwszego zagadnienia: osobny wpis tymczasowy rejestru i raport `addedExercises`;
 * - `UMIEM_PROBE_OUT_DIR` — katalog wyników poza repozytorium (wymagany): plik
 *   `chapter-<czas>.json` na każde uruchomienie (liczby, braki pokrycia, koszt; tu też treść
 *   tytułów zagadnień i odpowiedzi luk oraz wiersze dzienników `[lesson]`/`[lesson-agent]` — tylko
 *   w pliku);
 * - `UMIEM_PROBE_COSTS` — rejestr kosztów prób `costs.json` (wymagany, musi istnieć; nowy zakłada
 *   tylko `UMIEM_PROBE_COSTS_INIT=1`, z limitem `UMIEM_PROBE_COSTS_CAP_USD`, domyślnie 10 USD): przed startem
 *   „wydane + szacunek (z „+N”) > limit → stop”, przed każdym runem wpis tymczasowy z budżetem runu
 *   (zabity proces nadal się liczy), po runie (także po błędzie) zastąpiony kosztem z `usage.cost`;
 *   wywołanie bez kosztu liczone szacunkiem kierownika agenta z flagą `estimated`;
 * - `UMIEM_PROBE_ALLOW_HOST` — host usługi inny niż OpenRouter dopuszczony jawnie (domyślnie próba
 *   odmawia wywołania innego hosta i każdego adresu bez https); nagłówek próby wypisuje modele i hosty;
 * - `UMIEM_PROBE_DUMP` — plik JSON z pełnym szkicem, podsumowaniem runu i dziennikiem do ręcznej oceny;
 * - `UMIEM_PROBE_POOL_DUMP_OUT` — zrzut szkicu po runie agenta (przed „+N”) w formacie arkusza
 *   `blind/gen-blind-sheet.cjs` (`subjectId`, `objectives[]` z `title`, `kind`, `card`,
 *   `examples`, `exercises[]`), w tym samym pliku zagadnienia z kartami jako tablicą
 *   (`objectives[].cards: { title, body }[]`, `descriptionEn`), temat i materiał — wejście
 *   `UMIEM_PROBE_AGENT_OBJECTIVES_DUMP` próby `probe:agent`. Istniejący plik nie jest nadpisywany.
 * Wszystkie ścieżki plików przechodzą przez `resolveOutsideRepoPath` (ścieżka w checkoucie
 * kończy próbę błędem, zanim zostanie wywołany model).
 */

// .env przed odczytem zmiennych próby (decyzja o pominięciu i o rodzaju przedmiotu).
loadDotEnv();
const materialEnv = process.env.UMIEM_PROBE_MATERIAL?.trim() || undefined;
const subjectEnv = process.env.UMIEM_PROBE_SUBJECT?.trim() || "chapter";
const enabled = Boolean(materialEnv) || subjectEnv === "grammar";

/** Krótki materiał gramatyki (Present Simple), gdy próba nie dostała pliku — tekst własny, nie z podręcznika. */
const DEFAULT_GRAMMAR_MATERIAL = [
  "Tom gets up at seven o'clock. He washes his face and brushes his teeth.",
  "His sister Ann doesn't like milk, so she drinks orange juice for breakfast.",
  "They walk to school together. Their school starts at eight.",
  "Does Tom play football after school? Yes, he does. Ann watches cartoons and tidies her room.",
  "We don't go to school on Sundays. My dad cooks lunch and we visit our grandparents.",
].join("\n");

/** Prefiksy dzienników generacji, które próba zbiera do pliku wyników zamiast na konsolę. */
const LOG_PREFIXES = ["[lesson]", "[lesson-agent]"] as const;

function line(text = ""): void {
  console.log(text);
}

const slugOf = (objectiveId: string) => objectiveId.split(".").at(-1) ?? objectiveId;

/** Raport szkicu: na konsolę liczby i człony identyfikatorów; treść (tytuły, odpowiedzi luk) tylko do pliku wyników. */
function reportDraft(draft: LessonDraftDto): Record<string, unknown> {
  const objectives = draft.dynamicTopic?.objectives ?? [];
  const objectiveIds = objectives.length > 0 ? objectives.map((objective) => objective.id) : [...new Set(draft.exercises.map((exercise) => exercise.objectiveId))];
  const kindOf = (id: string) => objectives.find((objective) => objective.id === id)?.kind;
  line(`Zagadnienia (${objectiveIds.length}): ${objectiveIds.map((id) => `${slugOf(id)}[${kindOf(id) ?? "-"}]`).join(", ")}`);
  line("Ćwiczenia per zagadnienie i etap (guided/productive/independent) oraz typy:");
  const perObjective = objectiveIds.map((id) => {
    const own = draft.exercises.filter((exercise) => exercise.objectiveId === id);
    const stages = { guided: 0, productive: 0, independent: 0 };
    const types: Record<string, number> = {};
    for (const exercise of own) {
      const stage = stageOf(exercise.exerciseType);
      if (stage === "guided" || stage === "productive" || stage === "independent") stages[stage] += 1;
      types[exercise.exerciseType] = (types[exercise.exerciseType] ?? 0) + 1;
    }
    line(`  - ${slugOf(id)}: ${own.length} = ${stages.guided}/${stages.productive}/${stages.independent}  ${JSON.stringify(types)}`);
    // Odpowiedzi luk (treść) — tylko do pliku.
    const gaps = new Map<string, number>();
    for (const exercise of own) {
      if (exercise.exerciseType !== "lesson_gap") continue;
      const key = exercise.answer.toLowerCase();
      gaps.set(key, (gaps.get(key) ?? 0) + 1);
    }
    return {
      objective: slugOf(id),
      kind: kindOf(id) ?? null,
      titlePl: objectives.find((objective) => objective.id === id)?.titlePl ?? null,
      count: own.length,
      stages,
      types,
      gapAnswers: Object.fromEntries([...gaps.entries()].sort((a, b) => b[1] - a[1])),
    };
  });
  const orders = draft.exercises.filter((exercise) => exercise.exerciseType === "lesson_order");
  line(`Układanki (lesson_order): ${orders.length}; klocki: ${orders.map((exercise) => (exercise.items ?? []).length).join(", ") || "-"}; ` +
    `z kropką/pytajnikiem na końcu klocka: ${orders.filter((exercise) => (exercise.items ?? []).some((item) => /[.?!]$/u.test(item.text))).length}`);
  const kept = draft.exercises.length;
  line(`Ćwiczeń w szkicu: ${kept}; rejectedCount (usunięte po przyjęciu): ${draft.rejectedCount}`);
  const reasons = Object.entries(draft.rejectedReasons ?? {}).sort((a, b) => b[1] - a[1]);
  // Etykiety powodów tylko w pliku wyników; na konsolę same liczby (kody odrzuceń agenta — z punktu kontrolnego).
  line(`rejectedReasons: ${reasons.length} różnych, łącznie ${reasons.reduce((sum, [, count]) => sum + count, 0)} (etykiety w pliku wyników)`);
  const coverage = draft.coverage.map((gap) => ({ objective: slugOf(gap.objectiveId), stage: gap.stage, actual: gap.actual, required: gap.required }));
  line(`Braki pokrycia (coverage): ${coverage.length === 0 ? "brak" : coverage.map((gap) => `${gap.objective}/${gap.stage}: ${gap.actual} z ${gap.required}`).join("; ")}`);
  const gaps = (draft.generationGaps ?? []).map((gap) => ({ ...gap, objectiveId: slugOf(gap.objectiveId) }));
  line(`generationGaps: ${gaps.length === 0 ? "brak" : gaps.length}`);
  return { perObjective, exercises: kept, rejectedCount: draft.rejectedCount, rejectedReasons: Object.fromEntries(reasons), coverage, generationGaps: gaps, lessonOrder: orders.length };
}

/**
 * Podsumowanie punktu kontrolnego runu agenta bez treści: statusy i liczby zagadnień, histogram
 * kodów odrzuceń, liczniki kontroli, wydatek, próby. Postęp po porażce (`kind: "progress"`) niesie
 * ćwiczenia i materiał — z niego bierzemy wyłącznie liczby.
 */
async function agentRunSummary(runId: string): Promise<Record<string, unknown> | null> {
  const rows = await testDatabase()
    .db.select({ checkpoint: schema.generationRuns.agentCheckpoint })
    .from(schema.generationRuns)
    .where(eq(schema.generationRuns.id, runId));
  const value = rows[0]?.checkpoint as
    | { kind?: string; objectives?: Record<string, { status?: string; accepted?: number; exercises?: unknown[]; failureCode?: string }>; rejectionCodes?: Record<string, number>; checkCounters?: Record<string, number>; totalSpentUsd?: number; attempts?: number }
    | null
    | undefined;
  if (value === null || value === undefined) return null;
  return {
    kind: value.kind ?? null,
    objectives: Object.fromEntries(Object.entries(value.objectives ?? {}).map(([id, entry]) => [slugOf(id), {
      status: entry.status ?? null,
      accepted: entry.accepted ?? entry.exercises?.length ?? 0,
      ...(entry.failureCode === undefined ? {} : { failureCode: entry.failureCode }),
    }])),
    rejectionCodes: value.rejectionCodes ?? {},
    checkCounters: value.checkCounters ?? null,
    totalSpentUsd: value.totalSpentUsd ?? null,
    attempts: value.attempts ?? null,
  };
}

/**
 * Zagadnienia końcowego szkicu z kartami jako tablicą i `descriptionEn`: temat dynamiczny z
 * `lesson_context` wersji (DTO szkicu nie niesie `descriptionEn`), temat katalogowy z rejestru
 * (tylko zagadnienia szkicu).
 */
async function draftObjectives(draft: LessonDraftDto): Promise<{ topicTitle: string; objectives: DynamicTopicData["objectives"] }> {
  const rows = await testDatabase()
    .db.select({ lessonContext: schema.deckVersions.lessonContext })
    .from(schema.deckVersions)
    .where(eq(schema.deckVersions.id, draft.id));
  const dynamicTopic = (rows[0]?.lessonContext as { dynamicTopic?: DynamicTopicData } | null | undefined)?.dynamicTopic;
  if (dynamicTopic !== undefined) return { topicTitle: dynamicTopic.titlePl, objectives: dynamicTopic.objectives };
  const topic = createProductionSubjectRegistry()
    .getSubject(draft.subjectId)
    ?.topics.find((candidate) => candidate.id === draft.topicId && candidate.version === draft.topicVersion);
  if (topic === undefined) throw new Error(`Brak tematu ${draft.topicId} v${draft.topicVersion} — zrzut puli niemożliwy`);
  const ids = new Set(draft.objectiveIds);
  return {
    topicTitle: topic.titlePl,
    objectives: topic.objectives
      .filter((objective) => ids.has(objective.id))
      .map((objective) => ({ id: objective.id, titlePl: objective.titlePl, descriptionEn: objective.descriptionEn, cards: objective.cards })),
  };
}

/** Zrzut punktu odniesienia: format arkusza `gen-blind-sheet.cjs` + karty jako tablica, temat i materiał (wejście próby agenta). */
async function poolDumpOf(draft: LessonDraftDto, material: string, meta: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { topicTitle, objectives } = await draftObjectives(draft);
  return {
    schema: "lesson-pool-dump/v1",
    source: "agent",
    ...meta,
    subjectId: draft.subjectId,
    topicId: draft.topicId,
    topicVersion: draft.topicVersion,
    topicTitle,
    material,
    objectives: objectives.map((objective) => ({
      id: objective.id,
      title: objective.titlePl,
      kind: objective.kind ?? null,
      descriptionEn: objective.descriptionEn,
      card: objective.cards.map((card) => `[${card.title}] ${card.body}`).join("\n"),
      cards: objective.cards.map((card) => ({ title: card.title, body: card.body })),
      examples: draft.examples[objective.id] ?? [],
    })),
    exercises: draft.exercises,
    coverage: draft.coverage,
    rejectedCount: draft.rejectedCount,
    exposureLeaks: draft.exposureLeaks ?? [],
  };
}

describe.skipIf(!enabled)("próba generowania lekcji agentem puli na prawdziwych modelach", () => {
  afterAll(async () => {
    if (enabled) await testDatabase().pool.end();
  });

  it("generuje pulę i raportuje wynik", async () => {
    if (process.env.UMIEM_FAKE_PROVIDERS) {
      line("UWAGA: UMIEM_FAKE_PROVIDERS było ustawione — wyłączam je, próba ma użyć prawdziwych modeli.");
      delete process.env.UMIEM_FAKE_PROVIDERS;
    }
    // Bezwarunkowo, po wczytaniu .env: próba nigdy nie wskaże prawdziwego wolumenu mediów.
    process.env.MEDIA_ROOT = mkdtempSync(join(tmpdir(), "knowli-probe-media-"));
    // Przed wywołaniem modelu: zła ścieżka, rodzaj przedmiotu, konfiguracja albo limit kosztu nie mogą kosztować przebiegu.
    if (subjectEnv !== "chapter" && subjectEnv !== "school" && subjectEnv !== "grammar") {
      throw new Error("UMIEM_PROBE_SUBJECT: chapter | school | grammar");
    }
    const subjectKind = subjectEnv;
    const materialPath = resolveOutsideRepoPath(materialEnv, "UMIEM_PROBE_MATERIAL");
    if (materialPath === undefined && subjectKind !== "grammar") throw new Error("UMIEM_PROBE_MATERIAL jest wymagany dla chapter i school");
    const dumpPath = resolveOutsideRepoPath(process.env.UMIEM_PROBE_DUMP, "UMIEM_PROBE_DUMP");
    const poolDumpPath = resolveOutsideRepoPath(process.env.UMIEM_PROBE_POOL_DUMP_OUT, "UMIEM_PROBE_POOL_DUMP_OUT");
    const outDir = resolveOutsideRepoPath(process.env.UMIEM_PROBE_OUT_DIR, "UMIEM_PROBE_OUT_DIR");
    const costsPath = resolveOutsideRepoPath(process.env.UMIEM_PROBE_COSTS, "UMIEM_PROBE_COSTS");
    if (outDir === undefined) throw new Error("UMIEM_PROBE_OUT_DIR jest wymagany (katalog wyników poza repozytorium)");
    if (costsPath === undefined) throw new Error("UMIEM_PROBE_COSTS jest wymagany (rejestr kosztów costs.json poza repozytorium)");
    if (poolDumpPath !== undefined && existsSync(poolDumpPath)) throw new Error(`${poolDumpPath} już istnieje — zrzut płatnego generowania nie jest nadpisywany`);
    const addCountEnv = process.env.UMIEM_PROBE_ADD_COUNT?.trim() || undefined;
    const addCount = addCountEnv === undefined ? undefined : Number(addCountEnv);

    const material = materialPath === undefined ? DEFAULT_GRAMMAR_MATERIAL : readFileSync(materialPath, "utf8");
    const poolSize = Number(process.env.UMIEM_PROBE_POOL_SIZE ?? 60);
    const env = withConfigDefaults({ ...process.env });
    const allowHost = process.env.UMIEM_PROBE_ALLOW_HOST;
    // Kontrola przed rejestrem i wpisem tymczasowym: brak klucza, tryb fake, obcy host, szkoła bez gradera → stop bez kosztu.
    const preflight = probePreflight(env, { subject: subjectKind, ...(addCount === undefined ? {} : { addCount }), ...(allowHost === undefined ? {} : { allowHost }) });
    const runBudgetUsd = preflight.estimateUsd / (addCount === undefined ? 1 : 2);

    // Zdarzenia kosztów z runem, w którym padły (próba wykonuje runy po kolei, jak worker jeden run naraz).
    const events: Array<UsageEvent & { runId: string | null }> = [];
    let activeRunId: string | null = null;
    const usage: UsageRecorder = {
      record: (event) => void events.push({ ...event, runId: activeRunId }),
      flush: async () => undefined,
    };
    const base = createGenerationDepsFromEnv(env, usage);
    if (!base) throw new Error("Brak konfiguracji zależności generacji (OPENAI_API_KEY dla obrazów / UMIEM_LLM_*) w .env.");
    const lessonAgent = lessonAgentDepsFromEnv(env, usage);
    if ("unavailable" in lessonAgent) throw new Error("Brak klucza OpenRouter dla agenta puli — próba nie ma czego wywołać.");
    const models = {
      generator: lessonAgent.agent.model,
      checker: env.UMIEM_LESSON_AGENT_CHECKER_MODEL ?? null,
      grader: lessonAgent.grader === undefined ? null : env.UMIEM_GRADER_MODEL ?? null,
      ...(subjectKind === "school" ? { objectives: base.llm.model } : {}),
    };

    const ledger =
      process.env.UMIEM_PROBE_COSTS_INIT === "1"
        ? initCostLedger(costsPath, costCapFromEnv(process.env.UMIEM_PROBE_COSTS_CAP_USD))
        : readCostLedger(costsPath);
    // Cały szacunek (z „+N”) od razu: limit nie może zatrzymać próby po pierwszym, już zapłaconym runie.
    assertWithinCostCap(ledger, preflight.estimateUsd, `generowanie ${subjectKind}${addCount === undefined ? "" : ` + „+${addCount}”`}`);
    const costEntry = {
      probe: `chapter:${subjectKind}`,
      dump: materialPath === undefined ? "default-grammar-material" : basename(materialPath),
    };
    // Katalogi wszystkich plików wyjściowych przed płatnym wywołaniem: brak katalogu nie może zmarnować generowania.
    for (const directory of [outDir, ...[poolDumpPath, dumpPath].flatMap((path) => (path === undefined ? [] : [dirname(path)]))]) {
      mkdirSync(directory, { recursive: true });
    }

    const services = createServices({
      db: testDatabase().db,
      generation: { ...base, lessonAgent },
    });

    const titleOf = { chapter: "Angielski — rozdział", school: "szkoła (Geografia)", grammar: "Angielski — gramatyka (Present Simple)" } as const;
    line("");
    line(`=== Próba generowania agentem puli: ${titleOf[subjectKind]} ===`);
    line(`modele=${JSON.stringify(models)} hosty=${preflight.hosts.join(", ")} pula=${poolSize} materiał=${material.length} znaków; ` +
      `openCheck=${lessonAgent.grader === undefined ? "off" : "on"}; budżet runu=${runBudgetUsd.toFixed(2)} USD${addCount === undefined ? "" : ` (+N=${addCount}: drugi run)`}, ` +
      `wydane dotąd=${ledger.spentUsd.toFixed(4)} z ${ledger.capUsd} USD`);

    // Wiersze dzienników generacji (mogą nieść kody i liczby, a w błędach — szczegóły) tylko do pliku wyników, nie na konsolę.
    const lessonLog: string[] = [];
    const original = { log: console.log, warn: console.warn, error: console.error };
    const capture = (write: (...args: unknown[]) => void) => (...args: unknown[]) => {
      const text = args.map(String).join(" ");
      if (LOG_PREFIXES.some((prefix) => text.startsWith(prefix))) {
        lessonLog.push(text);
        return;
      }
      write(...args);
    };
    console.log = capture(original.log);
    console.warn = capture(original.warn);
    console.error = capture(original.error);
    const restoreConsole = () => Object.assign(console, original);

    /**
     * Run jak w workerze: dopóki jest `queued`, czeka do `next_attempt_at` (odczyt z bazy — DTO
     * runu go nie niesie) i woła `executeLessonGeneration` w zakresie kosztów runu, najwyżej
     * `MAX_AUTOMATIC_ATTEMPTS` razy.
     */
    const driveRun = async (runId: string): Promise<{ attempts: number; waitedMs: number }> => {
      let attempts = 0;
      let waitedMs = 0;
      for (;;) {
        const row = (await testDatabase()
          .db.select({ state: schema.generationRuns.state, nextAttemptAt: schema.generationRuns.nextAttemptAt })
          .from(schema.generationRuns)
          .where(eq(schema.generationRuns.id, runId)))[0];
        if (row === undefined || row.state !== "queued" || attempts >= MAX_AUTOMATIC_ATTEMPTS) return { attempts, waitedMs };
        const waitMs = Math.max(0, (row.nextAttemptAt?.getTime() ?? 0) - Date.now());
        if (waitMs > 0) {
          // Zegar bazy i procesu: drobny zapas, żeby przejęcie nie trafiło tuż przed `next_attempt_at`.
          await sleep(waitMs + 250);
          waitedMs += waitMs + 250;
        }
        activeRunId = runId;
        try {
          await withUsageScope({ generationRunId: runId }, () => executeLessonGeneration(services, runId));
        } finally {
          activeRunId = null;
        }
        attempts += 1;
      }
    };

    /** Rozliczenie wpisu tymczasowego runu kosztem jego zdarzeń (także po błędzie — pieniądze są wydane). */
    const settleRun = (provisionalId: string, probe: string, runId: string | undefined, label: string): CostLedger => {
      const own = events.filter((event) => runId !== undefined && event.runId === runId);
      const { costUsd, estimated } = agentLedgerCost(own, {
        unknownCallUsd: DEFAULT_LESSON_AGENT_POLICY.unknownCallEstimateUsd,
        unknownGraderCallUsd: DEFAULT_LESSON_AGENT_POLICY.unknownGraderCallEstimateUsd,
      });
      if (estimated) line(`UWAGA (${label}): wywołania bez usage.cost — do rejestru wpisany koszt z szacunkiem ${costUsd.toFixed(4)} USD`);
      const updated = settleCostEntry(costsPath, provisionalId, { at: new Date().toISOString(), ...costEntry, probe, costUsd, ...(estimated ? { estimated } : {}) });
      line(`koszt ${label}=${costUsd.toFixed(4)} USD; łącznie wydane=${updated.spentUsd.toFixed(4)} z ${updated.capUsd} USD`);
      return updated;
    };

    const started = Date.now();
    const resultsPath = join(outDir, `chapter-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`);
    /** Części pliku wyników liczone przy każdym zapisie: koszt (per operacja i per run), tokeny, dziennik generacji. */
    const liveParts = (): Record<string, unknown> => ({
      costUsd: {
        total: events.reduce((sum, event) => sum + (event.providerCostUsd ?? 0), 0),
        byOperation: costByOperation(events),
        runs: runCosts(events, runBudgetUsd),
      },
      tokens: {
        in: events.reduce((sum, event) => sum + (event.inputTokens ?? 0), 0),
        out: events.reduce((sum, event) => sum + (event.outputTokens ?? 0), 0),
      },
      lessonLog: lessonLog.map((text) => text.replace(/run=[0-9a-f-]+ /u, "")),
    });
    /** Plik wyników: wspólna część (wejście, modele, szacunek) i stan przebiegu; koszt i dziennik dokłada zapis. */
    const resultsOf = (run: Record<string, unknown>): Record<string, unknown> => ({
      schema: "chapter-generation-probe-results/v2",
      at: new Date().toISOString(),
      subjectKind,
      material: materialPath === undefined ? { file: null, chars: material.length } : { file: basename(materialPath), sha256: sha256File(materialPath), chars: material.length },
      models,
      hosts: preflight.hosts,
      openCheck: lessonAgent.grader !== undefined,
      poolSize,
      estimateUsd: preflight.estimateUsd,
      runBudgetUsd,
      ...run,
    });
    const writeResultsFile = (results: Record<string, unknown>) =>
      writeFileSync(resultsPath, `${JSON.stringify({ ...results, ...liveParts() }, null, 2)}\n`, "utf8");

    let runId: string | undefined;
    let deckId: string | undefined;
    let main: { attempts: number; waitedMs: number } = { attempts: 0, waitedMs: 0 };
    // Wpis tymczasowy (budżet runu) przed pierwszym płatnym wywołaniem: zabity proces nadal liczy się do limitu.
    const provisionalId = appendProvisionalCostEntry(costsPath, { at: new Date().toISOString(), ...costEntry, costUsd: runBudgetUsd });
    try {
      const clientRequestId = randomUUID();
      if (subjectKind === "grammar") {
        const subject = createProductionSubjectRegistry().getSubject("english_grammar");
        const topic = subject?.topics.filter((candidate) => candidate.id === "present_simple").sort((a, b) => b.version - a.version)[0];
        if (topic === undefined) throw new Error("Katalog english_grammar nie ma tematu present_simple");
        ({ runId, deckId } = await createLesson(services, {
          subjectId: "english_grammar",
          topicId: topic.id,
          objectiveIds: topic.objectives.map((objective) => objective.id),
          material,
          poolSize,
          clientRequestId,
        }));
      } else {
        const topicTitlePl = process.env.UMIEM_PROBE_TOPIC ?? (subjectKind === "school" ? "Mapa" : "Unit 1");
        ({ runId, deckId } = subjectKind === "school"
          ? await createSchoolLesson(services, { subjectTitlePl: "Geografia", topicTitlePl, material, poolSize, clientRequestId })
          : await createLessonFromMaterial(services, { subjectId: "english_chapter", topicTitlePl, material, poolSize, clientRequestId }));
      }
      main = await driveRun(runId);
    } catch (error) {
      restoreConsole();
      // Wyjątek przebiegu: plik wyników (czas, koszt, klasa błędu) powstaje przed ponownym rzuceniem.
      // Komunikat błędu (może cytować treść) nie trafia ani do pliku, ani na konsolę z próby.
      writeResultsFile(resultsOf({ state: "threw", errorCode: null, errorClass: errorClassOf(error), durationMs: Date.now() - started, ...main }));
      line(`Przebieg zakończony wyjątkiem (${errorClassOf(error)}); wyniki: ${resultsPath}`);
      throw error;
    } finally {
      restoreConsole();
      settleRun(provisionalId, costEntry.probe, runId, "runu");
    }
    const durationMs = Date.now() - started;
    if (runId === undefined || deckId === undefined) throw new Error("Brak runu po utworzeniu lekcji");

    const run = await readGeneration(services, runId);
    line("");
    line(`Przebieg: stan=${run.state}${run.errorCode ? ` kod=${run.errorCode}` : ""}; czas=${(durationMs / 1000).toFixed(1)} s; ` +
      `próby=${main.attempts}, oczekiwanie kolejki=${(main.waitedMs / 1000).toFixed(1)} s`);
    const agentSummary = await agentRunSummary(runId);
    if (agentSummary !== null) {
      line(`Agent: zagadnienia ${JSON.stringify(agentSummary.objectives)}; kody odrzuceń ${JSON.stringify(agentSummary.rejectionCodes)}; ` +
        `kontrole ${JSON.stringify(agentSummary.checkCounters)}`);
    }
    const results = resultsOf({ state: run.state, errorCode: run.errorCode ?? null, durationMs, attempts: main.attempts, waitedMs: main.waitedMs, agent: agentSummary });
    const writeResults = () => writeResultsFile(results);
    // Próba raportuje jakość bez asercji; wymaga tylko, by generacja się zakończyła (`queued` po wyczerpaniu prób to porażka).
    if (!["succeeded", "failed"].includes(run.state)) writeResults();
    expect(["succeeded", "failed"]).toContain(run.state);
    for (const cost of runCosts(events, runBudgetUsd).filter((entry) => entry.runId === runId)) {
      line(`Koszt runu: agent+kontrole=${cost.agentUsd.toFixed(4)} z budżetu ${cost.budgetUsd.toFixed(2)} USD${cost.overBudget ? " — POWYŻEJ BUDŻETU" : ""}; ` +
        `lesson_objectives=${cost.lessonObjectivesUsd.toFixed(4)}; wywołań ${cost.calls}, bez usage.cost ${cost.unknownCostCalls}`);
    }

    const deck = await readLessonDeck(services, deckId);
    let draft = deck.draft;
    if (!draft) {
      writeResults();
      if (poolDumpPath !== undefined) throw new Error(`Brak szkicu po generacji (stan=${run.state}) — brak puli do zrzutu ${basename(poolDumpPath)}`);
      line("Brak szkicu po generacji — nie ma co raportować.");
      return;
    }
    line(`Dziennik generacji: ${lessonLog.length} wierszy (tylko w pliku wyników)`);
    results.draft = reportDraft(draft);

    // Zrzut szkicu po runie agenta (przed „+N” i próbą publikacji).
    if (poolDumpPath !== undefined) {
      const poolDump = await poolDumpOf(draft, material, {
        probe: "chapter-generation",
        at: new Date().toISOString(),
        subjectKind,
        materialSha256: materialPath === undefined ? null : sha256File(materialPath),
        models,
        runState: run.state,
        phase: "draft after the lesson agent run (before +N and publish attempt)",
      });
      writeFileSync(poolDumpPath, `${JSON.stringify(poolDump, null, 2)}\n`, "utf8");
      results.poolDump = { file: basename(poolDumpPath), sha256: sha256File(poolDumpPath), exercises: draft.exercises.length, objectives: (poolDump.objectives as unknown[]).length };
      line(`Zrzut puli i zagadnień (${draft.exercises.length} ćwiczeń, ${(poolDump.objectives as unknown[]).length} zagadnień): ${poolDumpPath}`);
    }

    // „+N” na pierwszym zagadnieniu: osobny run z własnym wpisem tymczasowym i kontrolą limitu.
    if (addCount !== undefined && run.state === "succeeded") {
      const objectiveId = draft.dynamicTopic?.objectives[0]?.id ?? draft.objectiveIds[0];
      if (objectiveId === undefined) throw new Error("Szkic bez zagadnień — „+N” niemożliwe");
      const before = draft.exercises.filter((exercise) => exercise.objectiveId === objectiveId).length;
      assertWithinCostCap(readCostLedger(costsPath), runBudgetUsd, `„+${addCount}”`);
      const addProbe = `${costEntry.probe}:add`;
      const addProvisionalId = appendProvisionalCostEntry(costsPath, { at: new Date().toISOString(), ...costEntry, probe: addProbe, costUsd: runBudgetUsd });
      const addStarted = Date.now();
      let addRunId: string | undefined;
      let add: { attempts: number; waitedMs: number } = { attempts: 0, waitedMs: 0 };
      console.log = capture(original.log);
      console.warn = capture(original.warn);
      console.error = capture(original.error);
      try {
        ({ runId: addRunId } = await regenerateObjective(services, {
          deckId: deckId,
          objectiveId,
          count: addCount,
          expectedEditNumber: draft.editNumber,
          clientRequestId: randomUUID(),
        }));
        add = await driveRun(addRunId);
      } catch (error) {
        restoreConsole();
        results.add = { state: "threw", errorClass: errorClassOf(error), objective: slugOf(objectiveId), requested: addCount, ...add };
        writeResults();
        line(`„+N” zakończone wyjątkiem (${errorClassOf(error)}); wyniki: ${resultsPath}`);
        throw error;
      } finally {
        restoreConsole();
        settleRun(addProvisionalId, addProbe, addRunId, "„+N”");
      }
      const addRun = await readGeneration(services, addRunId);
      const afterDraft = (await readLessonDeck(services, deckId)).draft;
      const after = afterDraft?.exercises.filter((exercise) => exercise.objectiveId === objectiveId).length ?? before;
      results.add = {
        state: addRun.state,
        errorCode: addRun.errorCode ?? null,
        objective: slugOf(objectiveId),
        requested: addCount,
        addedExercises: after - before,
        durationMs: Date.now() - addStarted,
        ...add,
        agent: await agentRunSummary(addRunId),
      };
      line(`„+${addCount}” (${slugOf(objectiveId)}): stan=${addRun.state}${addRun.errorCode ? ` kod=${addRun.errorCode}` : ""}; ` +
        `dodane ćwiczenia=${after - before}; próby=${add.attempts}`);
      if (afterDraft) draft = afterDraft;
    }

    // Próba publikacji końcowego szkicu (po „+N”; baza próby jest jednorazowa).
    let publishable: string;
    try {
      await publishLessonDraft(services, draft.id, draft.editNumber);
      publishable = "TAK (publishLessonDraft przeszedł; baza próby jest jednorazowa)";
    } catch (error) {
      // Na konsolę tylko kod i klasa błędu; komunikat (może cytować ćwiczenia) wyłącznie w pliku wyników.
      const appError = error as { code?: string; message?: string; details?: unknown };
      publishable = `NIE (${appError.code ?? "błąd"}, ${errorClassOf(error)})`;
      results.publishableMessage = appError.message ?? null;
    }
    line(`Publikowalny: ${publishable}`);
    results.publishable = publishable;
    writeResults();
    line(`Wyniki: ${resultsPath}`);
    line("");

    if (dumpPath) {
      writeFileSync(dumpPath, JSON.stringify({ draft, agent: agentSummary, publishable, lessonLog, durationMs }, null, 2), "utf8");
      line(`Zrzut pełnego szkicu i dziennika: ${dumpPath}`);
    }
  });
});
