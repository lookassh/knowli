import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AttemptDto } from "@learning/contracts";
import { createChild, createServices, startSession, submitAttempt } from "@learning/server";
import { graderFromEnv } from "../../packages/server/src/config";
import { withConfigDefaults } from "../../packages/server/src/config-defaults";
import { materializeExercise, type LoadedExercise } from "../../packages/server/src/modules/learning/lessons/lesson-materialize";
import { requireTopic } from "../../packages/server/src/modules/learning/lessons/lesson-sessions";
import { createTestRecorder } from "../../packages/server/src/providers/usage/test-recorder";
import { ManualClock, testDatabase } from "../integration/helpers";
import { GRADING_SAMPLES, SAMPLE_EXERCISES, SCHOOL_BUTTERFLY, SCHOOL_TEA, type GradingSample, type SampleGroup } from "./fixtures/grading-samples";
import { appendProvisionalCostEntry, assertWithinCostCap, costCapFromEnv, initCostLedger, readCostLedger, settleCostEntry } from "./probe-costs";
import { loadDotEnv, resolveOutsideRepoPath } from "./probe-helpers";

/**
 * Odbiór oceny odpowiedzi na PRAWDZIWYM graderze (etap 3 #360, spec etapu §12;
 * `UMIEM_PROBE_GRADING=1 UMIEM_PROBE_COSTS=<costs.json poza repo> pnpm probe:grading`).
 * Bez własnych reguł: zasiewa lekcje z ćwiczeniami próbek, wydaje zadania tak jak selektor
 * (`materializeExercise`) i wysyła odpowiedzi przez `submitAttempt` — dopasowanie → cache →
 * model oceniający. Każda próbka idzie dwa razy (drugi raz w nowym zadaniu tej samej rewizji,
 * czyli z cache). KOSZTY: płatne wywołania OpenRouter; przebieg wymaga zgody właściciela
 * (zgoda 2026-11-07, limit rejestru 0,20 USD). Raport nie zawiera danych dziecka.
 */

loadDotEnv();
const enabled = process.env.UMIEM_PROBE_GRADING === "1";
/** Szacunek przebiegu (ok. 30 wywołań Gemini Flash) i wartość za wywołanie bez `usage.cost`. */
const RUN_ESTIMATE_USD = 0.1;
const UNKNOWN_CALL_USD = 0.002;

interface Outcome {
  readonly verdict: string;
  readonly outcome: string;
  readonly feedback: string;
  readonly calls: number;
}

const GROUP_CONTEXT: Record<SampleGroup, Record<string, unknown>> = {
  present_simple: { subjectId: "english_grammar", topicId: "present_simple", topicVersion: 1 },
  to_be: { subjectId: "english_grammar", topicId: "to_be", topicVersion: 1 },
  present_continuous: { subjectId: "english_grammar", topicId: "present_continuous", topicVersion: 1 },
  chapter: {
    subjectId: "english_chapter", topicId: "dynamic", topicVersion: 1, material: "Penguins live in Antarctica. The penguin eats fish. It likes colourful fish.",
    dynamicTopic: { titlePl: "Pingwiny", objectives: [{ id: "english_chapter.dprobe.penguins", titlePl: "Co robi pingwin", descriptionEn: "Say what a penguin does and likes with the verbs eat and like.", cards: [{ title: "Pingwin", body: "The penguin eats fish." }], kind: "words" }] },
  },
  school: {
    subjectId: "school", topicId: "dynamic", topicVersion: 1, subjectTitlePl: "Przyroda", material: "Kroki parzenia herbaty i etapy rozwoju motyla.",
    dynamicTopic: {
      titlePl: "Kolejność kroków",
      objectives: [
        { id: SCHOOL_TEA, titlePl: "Parzenie herbaty", descriptionEn: "Order the steps of making tea: water must boil before pouring.", cards: [{ title: "Herbata", body: "Najpierw zagotuj wodę, potem zalej torebkę." }] },
        { id: SCHOOL_BUTTERFLY, titlePl: "Rozwój motyla", descriptionEn: "Life cycle of a butterfly: egg, caterpillar, pupa, butterfly.", cards: [{ title: "Motyl", body: "Jajo, gąsienica, poczwarka, motyl." }] },
      ],
    },
  },
};

describe.skipIf(!enabled)("sonda oceny odpowiedzi (etap 3 #360)", () => {
  it("próbki z §12 przez pełną ścieżkę oceny spełniają progi", async () => {
    const env = withConfigDefaults(process.env);
    const recorder = createTestRecorder();
    const graderDeps = graderFromEnv(env, recorder);
    if (!graderDeps) throw new Error("Brak konfiguracji gradera (UMIEM_GRADER_* albo OPENROUTER_API_KEY).");
    // Klocki próbek muszą być klockami ćwiczenia — sprawdzenie przed pierwszym płatnym wywołaniem.
    for (const sample of GRADING_SAMPLES) {
      if (typeof sample.answer === "string") continue;
      const items = (SAMPLE_EXERCISES[sample.exercise]!.payload.items as { text: string }[]).map((item) => item.text).sort();
      if (JSON.stringify([...sample.answer].sort()) !== JSON.stringify(items)) throw new Error(`Próbka #${sample.id}: klocki spoza ćwiczenia.`);
    }
    const costsPath = resolveOutsideRepoPath(process.env.UMIEM_PROBE_COSTS, "UMIEM_PROBE_COSTS");
    if (!costsPath) throw new Error("UMIEM_PROBE_COSTS jest wymagane (rejestr kosztów poza repo).");
    const ledger = process.env.UMIEM_PROBE_COSTS_INIT === "1" ? initCostLedger(costsPath, costCapFromEnv(process.env.UMIEM_PROBE_COSTS_CAP_USD)) : readCostLedger(costsPath);
    assertWithinCostCap(ledger, RUN_ESTIMATE_USD, "sonda oceny odpowiedzi");
    const entry = { probe: "grading", dump: `model=${graderDeps.provider.model}` };
    const provisionalId = appendProvisionalCostEntry(costsPath, { at: new Date().toISOString(), ...entry, costUsd: RUN_ESTIMATE_USD });

    let calls = 0;
    const provider = { ...graderDeps.provider, grade: (...args: Parameters<typeof graderDeps.provider.grade>) => { calls += 1; return graderDeps.provider.grade(...args); } };
    const { db, pool } = testDatabase();
    const services = createServices({ db, clock: new ManualClock(), grader: { ...graderDeps, provider } });

    try {
      // Lekcja na grupę: rewizja na ćwiczenie, opublikowana i przypisana osobnemu dziecku (jedna aktywna sesja na dziecko).
      const revisions = new Map<string, { revisionId: string; itemId: string; versionId: string; sessionId: string; childId: string }>();
      for (const group of Object.keys(GROUP_CONTEXT) as SampleGroup[]) {
        const exercises = Object.entries(SAMPLE_EXERCISES).filter(([, ex]) => ex.group === group);
        const objectiveIds = [...new Set(exercises.map(([, ex]) => String(ex.payload.objectiveId)))];
        const deckId = randomUUID();
        const versionId = randomUUID();
        await pool.query("insert into learning_app.decks (id, title, kind) values ($1, $2, 'lesson')", [deckId, `Sonda ${group}`]);
        await pool.query(
          `insert into learning_app.deck_versions (id, deck_id, version_number, edit_number, state, title, lesson_context)
           values ($1, $2, 1, 1, 'draft', $3, $4::jsonb)`,
          [versionId, deckId, `Sonda ${group}`, JSON.stringify({ ...GROUP_CONTEXT[group], objectiveIds, poolSize: 20, examples: {} })],
        );
        const answerLocale = group === "school" ? "pl-PL" : "en-GB";
        for (const [position, [name, ex]] of exercises.entries()) {
          const itemId = randomUUID();
          const revisionId = randomUUID();
          const skillVersionId = randomUUID();
          await pool.query("insert into learning_app.learning_items (id, deck_id, kind) values ($1, $2, 'lesson_exercise')", [itemId, deckId]);
          await pool.query(
            `insert into learning_app.item_revisions (id, item_id, deck_id, deck_version_id, position, payload_version, payload, target_key)
             values ($1, $2, $3, $4, $5, 2, $6::jsonb, $7)`,
            [revisionId, itemId, deckId, versionId, position, JSON.stringify({ ...ex.payload, answerLocale, promptLocale: "pl-PL" }), `probe-${revisionId}`],
          );
          await pool.query(
            `insert into learning_app.skill_versions (id, item_id, skill, revision_number, criteria, criteria_hash) values ($1, $2, 'objective', 1, $3::jsonb, $4)`,
            [skillVersionId, itemId, JSON.stringify({ objectiveId: ex.payload.objectiveId }), `probe-${skillVersionId}`],
          );
          await pool.query(
            "insert into learning_app.item_revision_skills (item_revision_id, item_id, skill, skill_version_id) values ($1, $2, 'objective', $3)",
            [revisionId, itemId, skillVersionId],
          );
          revisions.set(name, { revisionId, itemId, versionId, sessionId: "", childId: "" });
        }
        await pool.query("update learning_app.deck_versions set state = 'published', published_at = now() where id = $1", [versionId]);
        await pool.query("update learning_app.decks set published_version_id = $1 where id = $2", [versionId, deckId]);
        const child = await createChild(services, { displayName: `Sonda ${group}`, avatarKey: "owl" });
        await pool.query("insert into learning_app.assignments (id, child_id, deck_id) values ($1, $2, $3)", [randomUUID(), child.id, deckId]);
        const session = await startSession(services, { childId: child.id, deckId, microphoneEnabled: false });
        for (const [name] of exercises) revisions.set(name, { ...revisions.get(name)!, sessionId: session.sessionId, childId: child.id });
      }

      let ordinal = 1000;
      const answer = async (sample: GradingSample): Promise<Outcome> => {
        const ex = SAMPLE_EXERCISES[sample.exercise]!;
        const seeded = revisions.get(sample.exercise)!;
        const context = { ...GROUP_CONTEXT[ex.group], objectiveIds: [] } as unknown as Parameters<typeof requireTopic>[1];
        const { subject, topic } = requireTopic(services, context);
        const loaded: LoadedExercise = {
          revisionId: seeded.revisionId, itemId: seeded.itemId, position: 0, targetKey: `probe-${seeded.revisionId}`, audioAssetId: null,
          payload: { ...ex.payload, answerLocale: ex.group === "school" ? "pl-PL" : "en-GB", promptLocale: "pl-PL" } as LoadedExercise["payload"],
        };
        const taskId = randomUUID();
        const task = materializeExercise({ independentCheck: false, reason: "practice" }, taskId, loaded, topic, subject);
        await pool.query(
          `insert into learning_app.session_tasks (id, session_id, child_id, deck_version_id, item_revision_id, ordinal, exercise_type, state, public_prompt, answer_key, context, issued_at)
           values ($1, $2, $3, $4, $5, $6, $7, 'issued', $8::jsonb, $9::jsonb, $10::jsonb, now())`,
          [taskId, seeded.sessionId, seeded.childId, seeded.versionId, seeded.revisionId, ordinal++, task.exerciseType,
            JSON.stringify(task.prompt), JSON.stringify(task.answerKey), JSON.stringify(task.context)],
        );
        const before = calls;
        let dto: AttemptDto;
        if (typeof sample.answer === "string") {
          dto = await submitAttempt(services, { taskId, clientAttemptId: randomUUID(), modality: "text", text: sample.answer });
        } else {
          const values = task.answerKey.itemValues as Record<string, string>;
          const free = new Set(Object.keys(values));
          const itemIds = sample.answer.map((text) => {
            const id = [...free].find((candidate) => values[candidate] === text)!;
            free.delete(id);
            return id;
          });
          dto = await submitAttempt(services, { taskId, clientAttemptId: randomUUID(), modality: "sequence", itemIds });
        }
        // Nieocenione zostawia zadanie `issued`, a sesja ma najwyżej jedno takie — zamykamy je poza ścieżką oceny.
        await pool.query("update learning_app.session_tasks set state = 'skipped' where id = $1 and state = 'issued'", [taskId]);
        const row = (await pool.query<{ outcome: string; details: { verdict?: string } }>("select outcome, details from learning_app.assessments where attempt_id = $1", [dto.attemptId])).rows[0];
        return { verdict: row?.details.verdict ?? "-", outcome: row?.outcome ?? "-", feedback: dto.feedback?.kind ?? "-", calls: calls - before };
      };

      const first = new Map<string, Outcome>();
      for (const sample of GRADING_SAMPLES) first.set(sample.id, await answer(sample));
      const second = new Map<string, Outcome>();
      for (const sample of GRADING_SAMPLES) second.set(sample.id, await answer(sample));

      // Progi §12 specu etapu.
      const result = (o: Outcome) => (o.verdict === "model_off_target" ? "off_target" : o.outcome === "correct" ? "pass" : "fail");
      const violations: string[] = [];
      for (const sample of GRADING_SAMPLES) {
        const o = first.get(sample.id)!;
        const r = result(o);
        if (sample.expect !== "fail" && o.outcome === "incorrect") violations.push(`#${sample.id} próg 1: poprawna oceniona jako błąd`);
        if ((sample.guard === "negation" || sample.guard === "wrong_form" || sample.guard === "bad_contraction") && r !== "fail") violations.push(`#${sample.id} próg 2: ${r}`);
        if (sample.guard === "not_done" && (o.feedback === "great" || o.feedback === "lesson_precision_hint")) violations.push(`#${sample.id} próg 3: feedback sukcesu`);
        if (sample.expect === "pass" && r === "off_target") violations.push(`#${sample.id} próg 4: ćwiczona forma jako bez ćwiczonej formy`);
        if (sample.expect === "off_target" && r === "pass") violations.push(`#${sample.id} próg 4: bez ćwiczonej formy zaliczone`);
        const again = second.get(sample.id)!;
        const cached = o.verdict !== "unavailable";
        if (cached && (again.calls !== 0 || result(again) !== r)) violations.push(`#${sample.id} próg 5: powtórka bez cache albo inny wynik`);
        if (sample.noModel && o.calls !== 0) violations.push(`#${sample.id}: oczekiwane dopasowanie bez modelu`);
      }
      const pairRows = await pool.query<{ n: string }>(
        `select count(*) as n from learning_app.lesson_verdicts where item_revision_id = any($1::uuid[])`,
        [[revisions.get("annaPairA1")!.revisionId, revisions.get("annaPairA2")!.revisionId]],
      );
      if (Number(pairRows.rows[0]!.n) !== 4) violations.push(`para A próg 5: ${pairRows.rows[0]!.n} wierszy cache zamiast 4`);

      const lines = GRADING_SAMPLES.map((sample) => {
        const o = first.get(sample.id)!;
        const again = second.get(sample.id)!;
        return `| ${sample.id} | ${sample.cls} | ${sample.expect} | ${result(o)} (${o.verdict}, ${o.outcome}, ${o.feedback}) | ${o.calls} | ${again.calls === 0 ? "cache" : "model"} ${result(again)} |`;
      });
      console.log(["| # | klasa | oczekiwanie | wynik (werdykt, ocena, feedback) | wywołania | powtórka |", "|---|---|---|---|---|---|", ...lines].join("\n"));
      console.log(`wywołania gradera: ${calls}; naruszenia progów: ${violations.length}`);
      for (const violation of violations) console.log(`NARUSZENIE ${violation}`);
      expect(violations).toEqual([]);
    } finally {
      const known = recorder.events.reduce((sum, event) => sum + (event.providerCostUsd ?? 0), 0);
      const unknown = recorder.events.filter((event) => event.providerCostUsd === undefined).length;
      const costUsd = known + unknown * UNKNOWN_CALL_USD;
      const updated = settleCostEntry(costsPath, provisionalId, { at: new Date().toISOString(), ...entry, costUsd, ...(unknown > 0 ? { estimated: true } : {}) });
      console.log(`koszt=${costUsd.toFixed(4)} USD (${recorder.events.length} żądań, bez usage.cost: ${unknown}); łącznie wydane=${updated.spentUsd.toFixed(4)} z ${updated.capUsd} USD`);
    }
  });
});
