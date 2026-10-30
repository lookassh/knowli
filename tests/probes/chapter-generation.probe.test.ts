import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, it } from "vitest";
import {
  createGenerationDepsFromEnv,
  createLessonFromMaterial,
  createSchoolLesson,
  createServices,
  executeLessonGeneration,
  publishLessonDraft,
  readGeneration,
  readLessonDeck,
  type LlmProvider,
} from "@learning/server";
import type { LessonDraftDto } from "@learning/contracts";
import { stageOf } from "../../packages/server/src/domain/lessons/stages";
import { testDatabase } from "../integration/helpers";

/**
 * Próba generowania lekcji z materiału rodzica na PRAWDZIWYM modelu (design
 * „Angielski — rozdział” §4 i §9: ryzyko wykonalności generowania). To nie
 * jest test jakości — bez asercji, tylko raport w konsoli: zagadnienia z
 * rodzajami, ćwiczenia per zagadnienie i etap, odrzucenia z powodami, braki
 * pokrycia i wynik próby publikacji. Płatne wywołania, więc plik jest pomijany
 * bez `UMIEM_PROBE_MATERIAL` (i nie należy do konfiguracji unit ani
 * integration). Materiał leży POZA repozytorium i nie może do niego trafić.
 *
 * Zmienne (poza .env z LLM, którego wartości nigdy nie są wypisywane):
 * - `UMIEM_PROBE_MATERIAL` — plik z materiałem (wymagany);
 * - `UMIEM_PROBE_SUBJECT` — `chapter` (domyślnie) albo `school` (porównanie);
 * - `UMIEM_PROBE_POOL_SIZE` — wielkość puli (domyślnie 60, jak w panelu);
 * - `UMIEM_PROBE_TOPIC` — tytuł tematu (domyślnie „Unit 1” / „Mapa”);
 * - `UMIEM_PROBE_DUMP` — plik JSON (poza repozytorium) z pełnym szkicem i
 *   surowym wyjściem modelu do ręcznej oceny jakości.
 */

const materialPath = process.env.UMIEM_PROBE_MATERIAL;

/** Wczytuje .env (wzór `scripts/evaluate-school-grader.mts`) bez nadpisywania środowiska. */
function loadDotEnv(): void {
  let text = "";
  try {
    text = readFileSync(new URL("../../.env", import.meta.url), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^(?:export\s+)?([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && process.env[match[1]!] === undefined) {
      process.env[match[1]!] = match[2]!.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    }
  }
}

interface RecordedCall {
  method: "objectives" | "pool";
  ms: number;
  rawExercises: number;
  failed: boolean;
}

/** Opakowuje prawdziwego providera: liczy wywołania i zachowuje surowe wyjście do analizy. */
function recordingLlm(inner: LlmProvider): { llm: LlmProvider; calls: RecordedCall[]; raw: Array<{ objectiveId: string; exercises: unknown[]; examples: unknown }>; rawObjectives: unknown[][] } {
  const calls: RecordedCall[] = [];
  const raw: Array<{ objectiveId: string; exercises: unknown[]; examples: unknown }> = [];
  const rawObjectives: unknown[][] = [];
  const llm: LlmProvider = {
    name: inner.name,
    model: inner.model,
    generateDeck: (input, signal) => inner.generateDeck(input, signal),
    async generateLessonObjectives(input, signal) {
      const started = Date.now();
      try {
        const result = await inner.generateLessonObjectives(input, signal);
        calls.push({ method: "objectives", ms: Date.now() - started, rawExercises: 0, failed: false });
        rawObjectives.push(result.objectives);
        return result;
      } catch (error) {
        calls.push({ method: "objectives", ms: Date.now() - started, rawExercises: 0, failed: true });
        throw error;
      }
    },
    async generateLessonPool(input, signal) {
      const started = Date.now();
      try {
        const result = await inner.generateLessonPool(input, signal);
        calls.push({ method: "pool", ms: Date.now() - started, rawExercises: result.exercises.length, failed: false });
        raw.push({ objectiveId: input.objectives.map((objective) => objective.id).join(","), exercises: result.exercises, examples: result.examples });
        return result;
      } catch (error) {
        calls.push({ method: "pool", ms: Date.now() - started, rawExercises: 0, failed: true });
        throw error;
      }
    },
  };
  return { llm, calls, raw, rawObjectives };
}

function line(text = ""): void {
  console.log(text);
}

function reportDraft(draft: LessonDraftDto): void {
  const objectives = draft.dynamicTopic?.objectives ?? [];
  line(`Zagadnienia (${objectives.length}):`);
  for (const objective of objectives) {
    line(`  - [${objective.kind ?? "brak rodzaju"}] ${objective.titlePl} (${objective.id})`);
  }
  line("Ćwiczenia per zagadnienie i etap (guided/productive/independent) oraz typy:");
  for (const objective of objectives) {
    const own = draft.exercises.filter((exercise) => exercise.objectiveId === objective.id);
    const stages = { guided: 0, productive: 0, independent: 0 };
    const types: Record<string, number> = {};
    for (const exercise of own) {
      const stage = stageOf(exercise.exerciseType);
      if (stage === "guided" || stage === "productive" || stage === "independent") stages[stage] += 1;
      types[exercise.exerciseType] = (types[exercise.exerciseType] ?? 0) + 1;
    }
    line(`  - ${objective.titlePl}: ${own.length} = ${stages.guided}/${stages.productive}/${stages.independent}  ${JSON.stringify(types)}`);
  }
  const kept = draft.exercises.length;
  const rejectedRate = kept + draft.rejectedCount === 0 ? 0 : draft.rejectedCount / (kept + draft.rejectedCount);
  line(`Ćwiczeń w szkicu: ${kept}; rejectedCount: ${draft.rejectedCount} (${(rejectedRate * 100).toFixed(1)}% wszystkich ocenionych)`);
  const reasons = Object.entries(draft.rejectedReasons ?? {}).sort((a, b) => b[1] - a[1]);
  line(`rejectedReasons (${reasons.length} różnych, top 20):`);
  for (const [reason, count] of reasons.slice(0, 20)) line(`  ${String(count).padStart(3)} × ${reason}`);
  line(`Braki pokrycia (coverage): ${draft.coverage.length === 0 ? "brak" : ""}`);
  for (const gap of draft.coverage) line(`  - ${gap.objectiveId} / ${gap.stage}: ${gap.actual} z ${gap.required}`);
}

describe.skipIf(!materialPath)("próba generowania lekcji na prawdziwym modelu", () => {
  afterAll(async () => {
    if (materialPath) await testDatabase().pool.end();
  });

  it("generuje pulę z materiału i raportuje wynik", async () => {
    loadDotEnv();
    if (process.env.UMIEM_FAKE_PROVIDERS) {
      line("UWAGA: UMIEM_FAKE_PROVIDERS było ustawione — wyłączam je, próba ma użyć prawdziwego modelu.");
      delete process.env.UMIEM_FAKE_PROVIDERS;
    }
    process.env.MEDIA_ROOT ??= mkdtempSync(join(tmpdir(), "knowli-probe-media-"));

    const subjectKind = process.env.UMIEM_PROBE_SUBJECT === "school" ? "school" : "chapter";
    const material = readFileSync(materialPath!, "utf8");
    const poolSize = Number(process.env.UMIEM_PROBE_POOL_SIZE ?? 60);
    const deps = createGenerationDepsFromEnv(process.env);
    if (!deps) throw new Error("Brak konfiguracji LLM (UMIEM_LLM_* / OPENAI_API_KEY) w .env — próba nie ma czego wywołać.");
    const recorded = recordingLlm(deps.llm);
    const services = createServices({
      db: testDatabase().db,
      generation: { ...deps, llm: recorded.llm },
    });

    line("");
    line(`=== Próba generowania: ${subjectKind === "school" ? "szkoła (Geografia)" : "Angielski — rozdział"} ===`);
    line(`model=${recorded.llm.model} pula=${poolSize} materiał=${material.length} znaków`);

    // Odrzucenia reguł puli widać tylko w dzienniku generacji ("walidacja puli ... reguły:").
    const lessonLog: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map(String).join(" ");
      if (text.startsWith("[lesson]")) lessonLog.push(text);
      originalLog(...args);
    };

    const started = Date.now();
    const clientRequestId = randomUUID();
    const topicTitlePl = process.env.UMIEM_PROBE_TOPIC ?? (subjectKind === "school" ? "Mapa" : "Unit 1");
    let runId: string;
    let deckId: string;
    try {
      ({ runId, deckId } = subjectKind === "school"
        ? await createSchoolLesson(services, { subjectTitlePl: "Geografia", topicTitlePl, material, poolSize, clientRequestId })
        : await createLessonFromMaterial(services, { subjectId: "english_chapter", topicTitlePl, material, poolSize, clientRequestId }));
      await executeLessonGeneration(services, runId);
    } finally {
      console.log = originalLog;
    }
    const durationMs = Date.now() - started;

    const run = await readGeneration(services, runId);
    line("");
    line(`Przebieg: stan=${run.state}${run.errorCode ? ` kod=${run.errorCode}` : ""}; czas=${(durationMs / 1000).toFixed(1)} s`);
    const poolCalls = recorded.calls.filter((call) => call.method === "pool");
    line(`Wywołania LLM: zagadnienia=${recorded.calls.filter((call) => call.method === "objectives").length}, pule=${poolCalls.length}; ` +
      `surowych ćwiczeń z modelu: ${poolCalls.reduce((sum, call) => sum + call.rawExercises, 0)}; ` +
      `czasy pul [s]: ${poolCalls.map((call) => (call.ms / 1000).toFixed(0)).join(", ")}; nieudane: ${recorded.calls.filter((call) => call.failed).length}`);

    const deck = await readLessonDeck(services, deckId);
    const draft = deck.draft;
    if (!draft) {
      line("Brak szkicu po generacji — nie ma co raportować.");
      return;
    }
    for (const entry of lessonLog.filter((text) => /walidacja puli|podniesiona|sanityzacja/u.test(text))) {
      line(entry.replace(/run=[0-9a-f-]+ /u, ""));
    }
    reportDraft(draft);

    let publishable: string;
    try {
      await publishLessonDraft(services, draft.id, draft.editNumber);
      publishable = "TAK (publishLessonDraft przeszedł; baza próby jest jednorazowa)";
    } catch (error) {
      const appError = error as { code?: string; message?: string; details?: unknown };
      publishable = `NIE (${appError.code ?? "błąd"}: ${appError.message ?? String(error)})`;
    }
    line(`Publikowalny: ${publishable}`);
    line("");

    const dumpPath = process.env.UMIEM_PROBE_DUMP;
    if (dumpPath) {
      writeFileSync(
        dumpPath,
        JSON.stringify(
          {
            draft,
            rawObjectives: recorded.rawObjectives,
            rawPools: recorded.raw,
            calls: recorded.calls,
            publishable,
            lessonLog,
            durationMs,
          },
          null,
          2,
        ),
        "utf8",
      );
      line(`Zrzut pełnego szkicu i surowego wyjścia modelu: ${dumpPath}`);
    }
  });
});
