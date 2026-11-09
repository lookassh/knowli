import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { groupItemsInViewOrder } from "../../packages/server/src/domain/lessons/agent/solver";
import { closedCheckContract, closedCheckItems, closedCheckVerdict } from "../../packages/server/src/domain/lessons/closed-check";
import { validateLessonExerciseIssues } from "../../packages/server/src/domain/lessons/pool-validation";
import { englishChapterSubject } from "../../packages/server/src/domain/lessons/subjects/english-chapter/module";
import { englishGrammarSubject } from "../../packages/server/src/domain/lessons/subjects/english-grammar/module";
import { schoolSubject } from "../../packages/server/src/domain/lessons/subjects/school/module";
import type { DynamicTopicData, LessonExerciseDraft, LessonTopic, SubjectModule } from "../../packages/server/src/domain/lessons/types";
import { parseLessonRecord } from "../../packages/server/src/modules/materials/lessons/lesson-pool-agent-tools";
import { DEFAULT_LESSON_AGENT_POLICY } from "../../packages/server/src/modules/materials/lessons/lesson-pool-agent-policy";
import type { RunCostSink } from "../../packages/server/src/ports/ai";
import { AiSdkExerciseChecker, OPENROUTER_BASE_URL } from "../../packages/server/src/providers/openai/lesson-pool-agent";
import { appendProvisionalCostEntry, assertWithinCostCap, costCapFromEnv, initCostLedger, readCostLedger, settleCostEntry } from "./probe-costs";
import { loadDotEnv, probeApiKey, resolveOutsideRepoPath } from "./probe-helpers";

/**
 * Ćwiczenia wzorcowe kontroli zadań zamkniętych (spec etapu 2 §6, etapu 5 §7.3). Fixture'y: gramatyka
 * (`closed-check-gold.json`, Present Continuous z katalogu) i rozdział (`closed-check-gold-stage5.json`,
 * temat dynamiczny z fixture'u). Część bez sieci (w `pnpm check`): liczności klas, walidacja struktury
 * każdego przypadku i idealna kontrola. Część płatna (`pnpm probe:gold`, tylko z `UMIEM_PROBE_GOLD=1`
 * i kluczem OpenRouter): 3 powtórzenia kontroli bez generatora dla fixture'u `UMIEM_PROBE_GOLD_FIXTURE`
 * (nazwa pliku w `fixtures/`, domyślnie gramatyka), wynik per klasa i powtórzenie, progi §6 / §7.3.
 * Błędny klucz o widoku identycznym z poprawnym ćwiczeniem (model nie widzi klucza) dostaje werdykt
 * z odpowiedzi na poprawne ćwiczenie, bez osobnego wywołania; wywołania z mutacją ma tylko rozsypanka.
 * Zmienne: `UMIEM_PROBE_AGENT_SOLVER_MODEL` (wymagany), `UMIEM_PROBE_COSTS` (rejestr poza
 * repozytorium), `UMIEM_PROBE_GOLD_DUMP` (zrzut poza repozytorium). Na konsolę tylko liczby.
 */

interface GoldCase {
  readonly id: string;
  readonly class: "correct" | "wrong_key" | "second_correct";
  readonly draft: unknown;
  /** Keywords: pytanie otwarte rodziny (wiersz `Question:` kontroli, etap 5b). */
  readonly familyPrompt?: string;
  /** Druga poprawna szkoły: cytat materiału, który czyni drugą odpowiedź poprawną (dla autora i przeglądu). */
  readonly justification?: string;
}

interface GoldFixture {
  readonly subject?: "english_chapter" | "school";
  readonly dynamicTopic?: DynamicTopicData;
  /** Szkoła: materiał lekcji (oczyszczenie cytatów, uziemienie, kontrola z materiałem). */
  readonly material?: string;
  readonly cases: GoldCase[];
}

interface LoadedFixture {
  readonly cases: GoldCase[];
  readonly subject: SubjectModule;
  readonly topic: LessonTopic;
  readonly material: string;
}

/** Przedmiot i temat fixture'u: gramatyka (Present Continuous) albo rozdział / szkoła z tematem dynamicznym. */
function loadFixture(name: string): LoadedFixture {
  const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8")) as GoldFixture;
  const material = fixture.material ?? "";
  if (fixture.subject === "english_chapter" || fixture.subject === "school") {
    const subject = fixture.subject === "school" ? schoolSubject : englishChapterSubject;
    return { cases: fixture.cases, subject, topic: subject.buildDynamicTopic!(fixture.dynamicTopic!), material };
  }
  // Moduł gramatyki od etapu 4 (#358) nie ma heurystyk językowych — ten sam stan co dawny moduł sondy.
  return { cases: fixture.cases, subject: englishGrammarSubject, topic: englishGrammarSubject.topics.find((candidate) => candidate.id === "present_continuous")!, material };
}

const FIXTURES = { "closed-check-gold.json": [22, 22, 12], "closed-check-gold-stage5.json": [18, 16, 9], "closed-check-gold-school.json": [18, 18, 14] } as const;
const REPETITIONS = 3;

/** Szkic przypadku po tym samym oczyszczeniu i walidacji struktury co w przebiegu bazowym; błąd = zły przypadek. */
function draftOf(entry: GoldCase, { subject, topic, material }: LoadedFixture): LessonExerciseDraft {
  const raw = entry.draft as { objectiveId: string };
  const parsed = parseLessonRecord(raw, raw.objectiveId, subject, null);
  if (!parsed.ok) throw new Error(`${entry.id}: ${parsed.rejection.code}`);
  const draft = subject.sanitize?.(parsed.draft, { material }).draft ?? parsed.draft;
  const issues = validateLessonExerciseIssues(draft, subject, topic, { agent: true });
  if (issues.length > 0) throw new Error(`${entry.id}: ${issues.map((issue) => issue.rule).join(",")}`);
  // Cytaty szkoły: uziemienie w materiale fixture'u (reguły puli `school.quote_*`).
  const quoteIssues = (subject.validatePoolExtra?.([draft], { material }).get(0) ?? []).filter((issue) => issue.rule.startsWith("school.quote"));
  if (quoteIssues.length > 0) throw new Error(`${entry.id}: ${quoteIssues.map((issue) => issue.rule).join(",")}`);
  return draft;
}

const itemsOf = (entry: GoldCase, draft: LessonExerciseDraft, topic: LessonTopic) => closedCheckItems(draft, topic, entry.familyPrompt);

/** Wyniki idealnej kontroli dla klucza ćwiczenia (po jednym na pozycję `closedCheckItems`). */
function idealResults(draft: LessonExerciseDraft): unknown[] {
  switch (draft.exerciseType) {
    case "lesson_order":
      return [{ verdict: "yes" }];
    case "lesson_notice":
      return [{ answers: [draft.correctOption!] }];
    case "lesson_match":
      return draft.pairs!.map((pair) => ({ answers: [pair.right] }));
    case "lesson_group":
      return groupItemsInViewOrder(draft).map((item) => ({ answers: [draft.groups!.find((entry) => entry.id === item.groupId)!.label] }));
    case "lesson_cloze":
      return draft.gapAnswers!.map((answer) => ({ answers: [answer] }));
    case "lesson_keywords":
      return [{ answers: draft.keyOptionIds!.map((id) => draft.keywordOptions!.find((option) => option.id === id)!.text) }];
    default:
      return [{ answers: [draft.options!.find((option) => option.id === draft.correctOption)!.text] }];
  }
}

const twinOf = (cases: readonly GoldCase[], entry: GoldCase) => cases.find((item) => item.id === entry.id.replace("w-", "c-"));

describe.each(Object.entries(FIXTURES))("ćwiczenia wzorcowe kontroli zamkniętych %s (bez sieci)", (name, sizes) => {
  const fixture = loadFixture(name);
  const { cases, subject, topic } = fixture;

  it("has the class sizes of the spec and every case passes the structure check", () => {
    const count = (klass: GoldCase["class"]) => cases.filter((entry) => entry.class === klass).length;
    expect([count("correct"), count("wrong_key"), count("second_correct")]).toEqual([...sizes]);
    expect(new Set(cases.map((entry) => entry.id)).size).toBe(cases.length);
    for (const entry of cases) expect(itemsOf(entry, draftOf(entry, fixture), topic), entry.id).not.toBeNull();
  });

  it("an ideal checker passes every correct case and rejects its mechanical wrong-key twin", () => {
    for (const entry of cases.filter((item) => item.class === "wrong_key")) {
      const draft = draftOf(twinOf(cases, entry)!, fixture);
      const twin = draftOf(entry, fixture);
      const ideal = idealResults(draft);
      expect(closedCheckVerdict(draft, ideal, subject.normalizer).pass, entry.id).toBe(true);
      const order = draft.exerciseType === "lesson_order";
      expect(closedCheckVerdict(twin, order ? [{ verdict: "no" }] : ideal, subject.normalizer).pass, `${entry.id} twin`).toBe(false);
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
    const fixtureName = process.env.UMIEM_PROBE_GOLD_FIXTURE?.trim() || "closed-check-gold.json";
    if (!(fixtureName in FIXTURES)) throw new Error(`nieznany fixture ${fixtureName}`);
    const fixture = loadFixture(fixtureName);
    const { cases: goldCases, subject, topic, material } = fixture;
    const costsPath = resolveOutsideRepoPath(process.env.UMIEM_PROBE_COSTS, "UMIEM_PROBE_COSTS");
    if (costsPath === undefined) throw new Error("UMIEM_PROBE_COSTS jest wymagany");
    const dumpPath = resolveOutsideRepoPath(process.env.UMIEM_PROBE_GOLD_DUMP, "UMIEM_PROBE_GOLD_DUMP");
    if (dumpPath !== undefined && existsSync(dumpPath)) throw new Error(`${dumpPath} już istnieje`);
    const cases = goldCases.map((entry) => {
      const draft = draftOf(entry, fixture);
      return { entry, draft, views: itemsOf(entry, draft, topic)! };
    });
    // Błędny klucz z widokiem jak u poprawnego ćwiczenia: werdykt z jego odpowiedzi, bez wywołania.
    const viewsOf = new Map(cases.map((item) => [item.entry.id, JSON.stringify(item.views)]));
    const reuses = (item: (typeof cases)[number]) =>
      item.entry.class === "wrong_key" && viewsOf.get(twinOf(goldCases, item.entry)!.id) === JSON.stringify(item.views);
    const checker = new AiSdkExerciseChecker({
      apiKey: "",
      model,
      effort: "low",
      languageModel: createOpenRouter({ apiKey, baseURL: OPENROUTER_BASE_URL }).chat(model, { usage: { include: true } }),
    });
    const reserveUsd = 0.2;
    const ledger = process.env.UMIEM_PROBE_COSTS_INIT === "1" ? initCostLedger(costsPath, costCapFromEnv(process.env.UMIEM_PROBE_COSTS_CAP_USD)) : readCostLedger(costsPath);
    assertWithinCostCap(ledger, reserveUsd, "gold");
    const provisional = appendProvisionalCostEntry(costsPath, { at: new Date().toISOString(), probe: "gold", dump: fixtureName, costUsd: reserveUsd });
    let spent = 0;
    let unknown = 0;
    const sink: RunCostSink = { record: (usd) => (usd === null ? (unknown += 1) : (spent += usd)) };
    const tally: Record<GoldCase["class"], { rejected: number; total: number }[]> = { correct: [], wrong_key: [], second_correct: [] };
    const verdicts: { repetition: number; id: string; pass: boolean; code?: string }[] = [];
    try {
      for (let repetition = 1; repetition <= REPETITIONS; repetition += 1) {
        for (const klass of Object.keys(tally) as GoldCase["class"][]) tally[klass].push({ rejected: 0, total: 0 });
        const answers = new Map<string, readonly unknown[]>();
        const called = cases.filter((item) => !reuses(item));
        // Jedna paczka = jeden typ ćwiczenia, jak w przebiegu bazowym.
        for (const type of [...new Set(called.map((item) => item.draft.exerciseType))]) {
          const packet = called.filter((item) => item.draft.exerciseType === type);
          const items = packet.flatMap((item) => item.views.map((view) => ({ view })));
          const withMaterial = subject.checkerNeedsMaterial ? { material } : {};
          const { results } = await checker.checkClosed(
            { contract: closedCheckContract(type)!, items, timeoutMs: DEFAULT_LESSON_AGENT_POLICY.checkerTimeoutMs, ...withMaterial },
            sink,
            new AbortController().signal,
          );
          let offset = 0;
          for (const item of packet) {
            answers.set(item.entry.id, results.slice(offset, offset + item.views.length));
            offset += item.views.length;
          }
        }
        for (const item of cases) {
          const results = answers.get(reuses(item) ? twinOf(goldCases, item.entry)!.id : item.entry.id)!;
          const verdict = closedCheckVerdict(item.draft, results, subject.normalizer);
          const row = tally[item.entry.class][repetition - 1]!;
          row.total += 1;
          if (!verdict.pass) row.rejected += 1;
          verdicts.push({ repetition, id: item.entry.id, pass: verdict.pass, ...(verdict.pass ? {} : { code: verdict.code }) });
        }
      }
    } finally {
      const costUsd = spent + unknown * DEFAULT_LESSON_AGENT_POLICY.unknownCallEstimateUsd;
      settleCostEntry(costsPath, provisional, { at: new Date().toISOString(), probe: "gold", dump: fixtureName, costUsd, ...(unknown > 0 ? { estimated: true } : {}) });
      console.log(`koszt=${costUsd.toFixed(4)} USD (bez kosztu: ${unknown})`);
    }
    for (const [klass, rows] of Object.entries(tally)) console.log(`${klass}: ${rows.map((row) => `${row.rejected}/${row.total}`).join(" ")} odrzucone`);
    // Per przypadek (k/3 odrzuceń): powtórzenia są skorelowane, więc liczy się też, które przypadki zawodzą.
    const perCase = new Map<string, number>();
    for (const entry of verdicts) if (!entry.pass) perCase.set(entry.id, (perCase.get(entry.id) ?? 0) + 1);
    console.log(`odrzucone per przypadek: ${[...perCase].map(([id, rejected]) => `${id} ${rejected}/${REPETITIONS}`).join(", ") || "-"}`);
    if (dumpPath !== undefined) {
      mkdirSync(dirname(dumpPath), { recursive: true });
      writeFileSync(dumpPath, `${JSON.stringify({ model, fixture: fixtureName, tally, verdicts }, null, 2)}\n`, "utf8");
    }
    const sum = (rows: { rejected: number; total: number }[]) => rows.reduce((acc, row) => ({ rejected: acc.rejected + row.rejected, total: acc.total + row.total }), { rejected: 0, total: 0 });
    for (const row of tally.wrong_key) expect(row.rejected).toBe(row.total);
    const second = sum(tally.second_correct);
    expect(second.rejected / second.total).toBeGreaterThanOrEqual(0.8);
    const correct = sum(tally.correct);
    expect(correct.rejected / correct.total).toBeLessThanOrEqual(0.1);
  });
});
