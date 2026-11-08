import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { closedCheckContract, closedCheckItem, closedCheckVerdict } from "../../packages/server/src/domain/lessons/closed-check";
import { validateLessonExerciseIssues } from "../../packages/server/src/domain/lessons/pool-validation";
import type { LessonExerciseDraft, LessonTopic } from "../../packages/server/src/domain/lessons/types";
import { parseLessonRecord } from "../../packages/server/src/modules/materials/lessons/lesson-pool-agent-tools";
import { DEFAULT_LESSON_AGENT_POLICY } from "../../packages/server/src/modules/materials/lessons/lesson-pool-agent-policy";
import type { RunCostSink } from "../../packages/server/src/ports/ai";
import { AiSdkExerciseChecker, OPENROUTER_BASE_URL } from "../../packages/server/src/providers/openai/lesson-pool-agent";
import { englishGrammarSubject } from "../../packages/server/src/domain/lessons/subjects/english-grammar/module";
import { appendProvisionalCostEntry, assertWithinCostCap, costCapFromEnv, initCostLedger, readCostLedger, settleCostEntry } from "./probe-costs";
import { loadDotEnv, probeApiKey, resolveOutsideRepoPath } from "./probe-helpers";

/**
 * Ćwiczenia wzorcowe kontroli zadań zamkniętych (spec etapu 2 §6). Część bez sieci (w `pnpm check`):
 * liczności klas i walidacja struktury każdego przypadku. Część płatna (`pnpm probe:gold`, tylko z
 * `UMIEM_PROBE_GOLD=1` i kluczem OpenRouter): 3 powtórzenia kontroli bez generatora, wynik per klasa
 * i powtórzenie, progi §6. Zmienne: `UMIEM_PROBE_AGENT_SOLVER_MODEL` (wymagany), `UMIEM_PROBE_COSTS`
 * (rejestr poza repozytorium, jak w sondzie agenta), `UMIEM_PROBE_GOLD_DUMP` (zrzut poza repozytorium).
 * Na konsolę tylko liczby.
 */

interface GoldCase {
  readonly id: string;
  readonly class: "correct" | "wrong_key" | "second_correct";
  readonly draft: unknown;
}

const GOLD = JSON.parse(readFileSync(join(__dirname, "fixtures", "closed-check-gold.json"), "utf8")) as { cases: GoldCase[] };
// Moduł gramatyki od etapu 4 (#358) nie ma heurystyk językowych — ten sam stan co dawny moduł sondy.
const subject = englishGrammarSubject;
const topic: LessonTopic = subject.topics.find((candidate) => candidate.id === "present_continuous")!;
const REPETITIONS = 3;

/** Szkic przypadku po tej samej walidacji struktury co w przebiegu bazowym; błąd = zły przypadek wzorcowy. */
function draftOf(entry: GoldCase): LessonExerciseDraft {
  const raw = entry.draft as { objectiveId: string };
  const parsed = parseLessonRecord(raw, raw.objectiveId, subject, null);
  if (!parsed.ok) throw new Error(`${entry.id}: ${parsed.rejection.code}`);
  const issues = validateLessonExerciseIssues(parsed.draft, subject, topic, { agent: true });
  if (issues.length > 0) throw new Error(`${entry.id}: ${issues.map((issue) => issue.rule).join(",")}`);
  return parsed.draft;
}

describe("ćwiczenia wzorcowe kontroli zamkniętych (bez sieci)", () => {
  it("has the class sizes of the spec and every case passes the structure check", () => {
    const count = (name: GoldCase["class"]) => GOLD.cases.filter((entry) => entry.class === name).length;
    expect([count("correct"), count("wrong_key"), count("second_correct")]).toEqual([22, 22, 12]);
    expect(new Set(GOLD.cases.map((entry) => entry.id)).size).toBe(GOLD.cases.length);
    for (const entry of GOLD.cases) {
      const draft = draftOf(entry);
      expect(closedCheckItem(draft, topic), entry.id).not.toBeNull();
    }
    const orders = GOLD.cases.filter((entry) => entry.class === "correct" && (entry.draft as { exerciseType: string }).exerciseType === "lesson_order");
    expect(orders).toHaveLength(10);
  });

  it("an ideal checker passes every correct case and rejects its mechanical wrong-key twin", () => {
    const keyText = (draft: LessonExerciseDraft) =>
      draft.exerciseType === "lesson_notice" ? draft.correctOption! : draft.options!.find((option) => option.id === draft.correctOption)!.text;
    for (const entry of GOLD.cases.filter((item) => item.class === "correct")) {
      const draft = draftOf(entry);
      const twin = draftOf(GOLD.cases.find((item) => item.id === entry.id.replace("c-", "w-"))!);
      const order = draft.exerciseType === "lesson_order";
      const ideal = order ? { verdict: "yes" } : { answers: [keyText(draft)] };
      expect(closedCheckVerdict(draft, ideal, subject.normalizer).pass, entry.id).toBe(true);
      expect(closedCheckVerdict(twin, order ? { verdict: "no" } : ideal, subject.normalizer).pass, `${entry.id} twin`).toBe(false);
    }
  });
});

// `.env` tylko przy płatnym biegu: część bez sieci jest w `pnpm check` i nie może zmieniać `process.env` innych testów.
if (process.env.UMIEM_PROBE_GOLD === "1") loadDotEnv();
const apiKey = process.env.UMIEM_PROBE_GOLD === "1" ? probeApiKey() : undefined;
const paid = apiKey !== undefined;

describe.skipIf(!paid)("ćwiczenia wzorcowe na prawdziwym modelu kontroli (płatne)", () => {
  it("detects every wrong key, ≥80% second correct answers and rejects ≤10% correct exercises", async () => {
    const model = process.env.UMIEM_PROBE_AGENT_SOLVER_MODEL?.trim();
    if (!model) throw new Error("UMIEM_PROBE_AGENT_SOLVER_MODEL jest wymagany");
    const costsPath = resolveOutsideRepoPath(process.env.UMIEM_PROBE_COSTS, "UMIEM_PROBE_COSTS");
    if (costsPath === undefined) throw new Error("UMIEM_PROBE_COSTS jest wymagany");
    const dumpPath = resolveOutsideRepoPath(process.env.UMIEM_PROBE_GOLD_DUMP, "UMIEM_PROBE_GOLD_DUMP");
    if (dumpPath !== undefined && existsSync(dumpPath)) throw new Error(`${dumpPath} już istnieje`);
    const cases = GOLD.cases.map((entry) => ({ entry, draft: draftOf(entry) }));
    const checker = new AiSdkExerciseChecker({
      apiKey: "",
      model,
      effort: "low",
      languageModel: createOpenRouter({ apiKey, baseURL: OPENROUTER_BASE_URL }).chat(model, { usage: { include: true } }),
    });
    const reserveUsd = 0.2;
    const ledger = process.env.UMIEM_PROBE_COSTS_INIT === "1" ? initCostLedger(costsPath, costCapFromEnv(process.env.UMIEM_PROBE_COSTS_CAP_USD)) : readCostLedger(costsPath);
    assertWithinCostCap(ledger, reserveUsd, "gold");
    const provisional = appendProvisionalCostEntry(costsPath, { at: new Date().toISOString(), probe: "gold", dump: "closed-check-gold.json", costUsd: reserveUsd });
    let spent = 0;
    let unknown = 0;
    const sink: RunCostSink = { record: (usd) => (usd === null ? (unknown += 1) : (spent += usd)) };
    const tally: Record<GoldCase["class"], { rejected: number; total: number }[]> = { correct: [], wrong_key: [], second_correct: [] };
    const verdicts: { repetition: number; id: string; pass: boolean; code?: string }[] = [];
    try {
      for (let repetition = 1; repetition <= REPETITIONS; repetition += 1) {
        for (const klass of Object.keys(tally) as GoldCase["class"][]) tally[klass].push({ rejected: 0, total: 0 });
        // Jedna paczka = jeden typ ćwiczenia, jak w przebiegu bazowym.
        const types = [...new Set(cases.map((item) => item.draft.exerciseType))];
        for (const type of types) {
          const packet = cases.filter((item) => item.draft.exerciseType === type);
          const contract = closedCheckContract(type)!;
          const items = packet.map((item) => ({ view: closedCheckItem(item.draft, topic)! }));
          const { results } = await checker.checkClosed({ contract, items, timeoutMs: DEFAULT_LESSON_AGENT_POLICY.checkerTimeoutMs }, sink, new AbortController().signal);
          packet.forEach((item, index) => {
            const verdict = closedCheckVerdict(item.draft, results[index], subject.normalizer);
            const row = tally[item.entry.class][repetition - 1]!;
            row.total += 1;
            if (!verdict.pass) row.rejected += 1;
            verdicts.push({ repetition, id: item.entry.id, pass: verdict.pass, ...(verdict.pass ? {} : { code: verdict.code }) });
          });
        }
      }
    } finally {
      const costUsd = spent + unknown * DEFAULT_LESSON_AGENT_POLICY.unknownCallEstimateUsd;
      settleCostEntry(costsPath, provisional, { at: new Date().toISOString(), probe: "gold", dump: "closed-check-gold.json", costUsd, ...(unknown > 0 ? { estimated: true } : {}) });
      console.log(`koszt=${costUsd.toFixed(4)} USD (bez kosztu: ${unknown})`);
    }
    for (const [klass, rows] of Object.entries(tally)) console.log(`${klass}: ${rows.map((row) => `${row.rejected}/${row.total}`).join(" ")} odrzucone`);
    if (dumpPath !== undefined) {
      mkdirSync(dirname(dumpPath), { recursive: true });
      writeFileSync(dumpPath, `${JSON.stringify({ model, tally, verdicts }, null, 2)}\n`, "utf8");
    }
    const sum = (rows: { rejected: number; total: number }[]) => rows.reduce((acc, row) => ({ rejected: acc.rejected + row.rejected, total: acc.total + row.total }), { rejected: 0, total: 0 });
    for (const row of tally.wrong_key) expect(row.rejected).toBe(row.total);
    const second = sum(tally.second_correct);
    expect(second.rejected / second.total).toBeGreaterThanOrEqual(0.8);
    const correct = sum(tally.correct);
    expect(correct.rejected / correct.total).toBeLessThanOrEqual(0.1);
  });
});
