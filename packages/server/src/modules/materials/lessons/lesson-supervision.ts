import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  LessonVerdictDecisionSchema,
  UuidSchema,
  type LessonVerdictDecision,
  type LessonVerdictDto,
  type ObjectiveProgressDto,
} from "@learning/contracts";
import type { Services } from "../../../config";
import type { Executor } from "../../../db/client";
import {
  childObjectiveProgress,
  childProfiles,
  deckVersions,
  decks,
  eventExposures,
  itemRevisions,
  itemRevisionSkills,
  learningEvents,
  lessonVerdicts,
  skillVersions,
} from "../../../db/schema";
import { AppError } from "../../../errors";
import { mapObjectiveStatus } from "../../../domain/lessons/progress-status";
import { BASE_ERROR_CATEGORIES } from "../../../domain/lessons/base-error-categories";
import type { LearningObjective, LessonTopic, SubjectModule } from "../../../domain/lessons/types";
import { reconcileDraftAssetsTx } from "../media-reconciliation";
import { bumpEditNumber, lockVersion } from "../version-ops";
import { createLessonDraftFromPublished } from "./lesson-api";
import { buildLessonPayload, buildObjectiveCriteria, toExerciseDraft } from "./lesson-drafts";

/**
 * Nadzór rodzica nad lekcją (zadanie 16): odczyt postępu celów z przykładami
 * błędów TYLKO tego dziecka, lista werdyktów modelu dla ćwiczeń lekcji oraz
 * decyzje rodzica (potwierdzenie/nadpisanie, dodanie wariantu). Decyzje NIE
 * przepisują zakończonych ocen (`assessments`) ani nie przeliczają projekcji
 * (`child_objective_progress`) — zmieniają tylko `parent_decision`, które przy
 * NASTĘPNEJ identycznej odpowiedzi jest nadrzędne (patrz lesson-attempts).
 */

/** Status bazy → status DTO rodzica (słownik domeny), z zapasem not_assessed. */
function toDtoStatus(dbStatus: string | null): ObjectiveProgressDto["status"] {
  return dbStatus === null ? "not_assessed" : mapObjectiveStatus(dbStatus);
}

/** Pola `lesson_context` czytane tu (temat przypięty + lista celów). */
interface LessonContextView {
  subjectId: string;
  topicId: string;
  topicVersion: number;
  objectiveIds: string[];
}

function readLessonContext(raw: Record<string, unknown> | null): LessonContextView {
  const ctx = (raw ?? {}) as Partial<LessonContextView>;
  return {
    subjectId: ctx.subjectId ?? "",
    topicId: ctx.topicId ?? "",
    topicVersion: ctx.topicVersion ?? 1,
    objectiveIds: ctx.objectiveIds ?? [],
  };
}

function requireSubject(services: Services, subjectId: string): SubjectModule {
  const subject = services.subjects.getSubject(subjectId);
  if (!subject) throw new AppError("internal", { message: `lesson subject missing: ${subjectId}` });
  return subject;
}

function requireTopic(subject: SubjectModule, topicId: string, version: number): LessonTopic {
  const topic = subject.topics.find((t) => t.id === topicId && t.version === version)
    ?? subject.topics.find((t) => t.id === topicId);
  if (!topic) throw new AppError("internal", { message: `lesson topic missing: ${subject.id}/${topicId}@${version}` });
  return topic;
}

/** Etykiety kategorii błędów dla tematu: bazowe ∪ przedmiotu ∪ tematu, po kodzie. */
function categoryLabels(subject: SubjectModule, topic: LessonTopic): Map<string, string> {
  const labels = new Map<string, string>();
  for (const category of BASE_ERROR_CATEGORIES) labels.set(category.code, category.labelPl);
  for (const category of subject.errorCategories) labels.set(category.code, category.labelPl);
  for (const category of topic.extraErrorCategories) labels.set(category.code, category.labelPl);
  return labels;
}

/** Rozwiązuje aktywną (opublikowaną, inaczej edytowalną) wersję lekcji deckId. */
async function activeLessonVersion(
  db: Executor,
  deckId: string,
): Promise<{ versionId: string; context: LessonContextView }> {
  const deck = (await db.select().from(decks).where(eq(decks.id, deckId)))[0];
  if (!deck) throw new AppError("not_found");
  if (deck.kind !== "lesson") throw new AppError("deck_kind_mismatch", { message: "nie jest zestawem lekcji" });
  const versionId = deck.publishedVersionId
    ?? (await db
      .select({ id: deckVersions.id })
      .from(deckVersions)
      .where(and(eq(deckVersions.deckId, deckId), inArray(deckVersions.state, ["draft", "review"])))
      .orderBy(desc(deckVersions.editNumber))
      .limit(1))[0]?.id;
  if (!versionId) throw new AppError("not_found");
  const version = (await db.select().from(deckVersions).where(eq(deckVersions.id, versionId)))[0]!;
  return { versionId, context: readLessonContext(version.lessonContext) };
}

interface ObjectiveErrorRow {
  objectiveId: string;
  category: string;
  answer: string | null;
  count: number;
}

/**
 * Postęp celów lekcji dla rodzica. Statusy z `child_objective_progress`,
 * najczęstsze kategorie błędów z `assessments` (skill=objective) tego dziecka na
 * ćwiczeniach tej lekcji z do 3 PRZYKŁADAMI odpowiedzi tylko tego dziecka, oraz
 * flaga wyczerpania puli (brak jeszcze niewidzianych ćwiczeń celu). Przykłady i
 * błędy są izolowane per dziecko — żadne dane innego dziecka tu nie wchodzą.
 */
export async function lessonObjectiveProgress(
  services: Services,
  deckId: string,
  childId: string,
): Promise<ObjectiveProgressDto[]> {
  const deck = UuidSchema.parse(deckId);
  const child = UuidSchema.parse(childId);
  const profile = (await services.db.select({ id: childProfiles.id }).from(childProfiles).where(eq(childProfiles.id, child)))[0];
  if (!profile) throw new AppError("not_found");

  const { versionId, context } = await activeLessonVersion(services.db, deck);
  const subject = requireSubject(services, context.subjectId);
  const topic = requireTopic(subject, context.topicId, context.topicVersion);
  const labels = categoryLabels(subject, topic);
  const objectiveById = new Map<string, LearningObjective>();
  for (const o of topic.objectives) objectiveById.set(o.id, o);

  // Rewizje ćwiczeń tej wersji z celem i target_key (do puli i izolacji błędów).
  const revisions = await services.db
    .select({ id: itemRevisions.id, targetKey: itemRevisions.targetKey, payload: itemRevisions.payload })
    .from(itemRevisions)
    .where(eq(itemRevisions.deckVersionId, versionId));
  const targetKeysByObjective = new Map<string, Set<string>>();
  for (const r of revisions) {
    const objectiveId = toExerciseDraft(r.payload).objectiveId;
    const keys = targetKeysByObjective.get(objectiveId) ?? new Set<string>();
    keys.add(r.targetKey);
    targetKeysByObjective.set(objectiveId, keys);
  }

  // Statusy per cel z projekcji.
  const progressRows = await services.db
    .select({
      objectiveId: childObjectiveProgress.objectiveId,
      status: childObjectiveProgress.status,
      nextReviewAt: childObjectiveProgress.nextReviewAt,
      lastIndependentAt: childObjectiveProgress.lastIndependentAt,
    })
    .from(childObjectiveProgress)
    .where(and(eq(childObjectiveProgress.childId, child), eq(childObjectiveProgress.subjectId, context.subjectId)));
  const progressByObjective = new Map(progressRows.map((r) => [r.objectiveId, r]));

  // Kategorie błędów tego dziecka na ćwiczeniach tej lekcji (skill=objective),
  // z odpowiedzią dziecka (attempts.answer->>text) jako przykładem. Scoped do
  // rewizji tej wersji → nie miesza innych lekcji ani innych dzieci.
  const revisionIds = revisions.map((r) => r.id);
  const errorRows: ObjectiveErrorRow[] = revisionIds.length
    ? (await services.db.execute<{ objectiveId: string | null; category: string | null; answer: string | null; count: number }>(sql`
        select n.details->>'objectiveId' as "objectiveId",
               n.details->>'errorCategory' as category,
               a.answer->>'text' as answer,
               count(*)::int as count
          from learning_app.assessments n
          join learning_app.attempts a on a.id = n.attempt_id
         where n.child_id = ${child}
           and n.skill = 'objective'
           and n.item_revision_id = any(${sql.param(revisionIds)}::uuid[])
           and n.details ? 'errorCategory'
         group by 1, 2, 3
      `)).rows.map((r) => ({ objectiveId: r.objectiveId ?? "", category: r.category ?? "", answer: r.answer, count: r.count }))
    : [];

  // Agregacja: per (objective, category) suma i do 3 przykładów (najczęstsze
  // odpowiedzi dziecka najpierw).
  interface Agg { count: number; examples: { answer: string; count: number }[] }
  const byObjectiveCategory = new Map<string, Map<string, Agg>>();
  for (const row of errorRows) {
    if (!row.category) continue;
    const perObjective = byObjectiveCategory.get(row.objectiveId) ?? new Map<string, Agg>();
    const agg = perObjective.get(row.category) ?? { count: 0, examples: [] };
    agg.count += row.count;
    if (row.answer) agg.examples.push({ answer: row.answer, count: row.count });
    perObjective.set(row.category, agg);
    byObjectiveCategory.set(row.objectiveId, perObjective);
  }

  // Pula wyczerpana: wszystkie target_key ćwiczeń celu były już ujawnione dziecku
  // (dowolna sesja/lekcja). Ekspozycje zapieczętowane.
  const allTargetKeys = [...new Set(revisions.map((r) => r.targetKey))];
  const exposedTargetKeys = allTargetKeys.length
    ? new Set((await services.db
        .selectDistinct({ targetKey: eventExposures.targetKey })
        .from(eventExposures)
        .innerJoin(learningEvents, eq(learningEvents.id, eventExposures.eventId))
        .where(and(
          eq(eventExposures.childId, child),
          eq(learningEvents.sealed, true),
          inArray(eventExposures.targetKey, allTargetKeys),
        ))).map((r) => r.targetKey))
    : new Set<string>();

  // Kolejność celów jak w temacie, przefiltrowana do celów lekcji.
  const orderedObjectiveIds = topic.objectives.map((o) => o.id).filter((id) => context.objectiveIds.includes(id));
  return orderedObjectiveIds.map((objectiveId) => {
    const progress = progressByObjective.get(objectiveId);
    const categoryAggs = byObjectiveCategory.get(objectiveId) ?? new Map<string, Agg>();
    const topErrors = [...categoryAggs.entries()]
      .map(([category, agg]) => ({
        category,
        labelPl: labels.get(category) ?? category,
        count: agg.count,
        examples: agg.examples
          .sort((a, b) => b.count - a.count || a.answer.localeCompare(b.answer, "pl"))
          .slice(0, 3)
          .map((e) => e.answer),
      }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
      .slice(0, 5);
    const targetKeys = targetKeysByObjective.get(objectiveId) ?? new Set<string>();
    const poolExhausted = targetKeys.size > 0 && [...targetKeys].every((k) => exposedTargetKeys.has(k));
    return {
      objectiveId,
      titlePl: objectiveById.get(objectiveId)?.titlePl ?? objectiveId,
      status: toDtoStatus(progress?.status ?? null),
      lastIndependentAt: progress?.lastIndependentAt?.toISOString() ?? null,
      nextReviewAt: progress?.nextReviewAt?.toISOString() ?? null,
      poolExhausted,
      topErrors,
    } satisfies ObjectiveProgressDto;
  });
}

/**
 * Werdykty modelu dla ćwiczeń tej lekcji (opublikowana + edytowalna wersja),
 * najnowsze najpierw, z flagą decyzji rodzica. `childAnswer` to
 * `normalized_answer` (materiał wspólny, bez kolumn dziecka). Bez sekretów.
 */
export async function listLessonVerdicts(services: Services, deckId: string): Promise<LessonVerdictDto[]> {
  const deck = UuidSchema.parse(deckId);
  const deckRow = (await services.db.select({ kind: decks.kind, publishedVersionId: decks.publishedVersionId }).from(decks).where(eq(decks.id, deck)))[0];
  if (!deckRow) throw new AppError("not_found");
  if (deckRow.kind !== "lesson") throw new AppError("deck_kind_mismatch", { message: "nie jest zestawem lekcji" });

  // Wszystkie wersje tej lekcji (werdykt należy do rewizji, która żyje w wersji).
  const versionIds = (await services.db.select({ id: deckVersions.id }).from(deckVersions).where(eq(deckVersions.deckId, deck))).map((v) => v.id);
  if (versionIds.length === 0) return [];
  const revisionRows = await services.db
    .select({ id: itemRevisions.id, payload: itemRevisions.payload })
    .from(itemRevisions)
    .where(inArray(itemRevisions.deckVersionId, versionIds));
  if (revisionRows.length === 0) return [];
  const objectiveByRevision = new Map(revisionRows.map((r) => [r.id, toExerciseDraft(r.payload).objectiveId]));
  const revisionIds = revisionRows.map((r) => r.id);

  const rows = await services.db
    .select()
    .from(lessonVerdicts)
    .where(inArray(lessonVerdicts.itemRevisionId, revisionIds))
    .orderBy(desc(lessonVerdicts.createdAt), desc(lessonVerdicts.id));

  return rows.map((row) => ({
    id: row.id,
    exerciseRevisionId: row.itemRevisionId,
    objectiveId: objectiveByRevision.get(row.itemRevisionId) ?? "",
    childAnswer: row.normalizedAnswer,
    verdict: row.verdict as LessonVerdictDto["verdict"],
    errorCategory: row.errorCategory,
    note: row.note ?? "",
    graderModel: row.graderModel,
    parentDecision: (row.parentDecision as LessonVerdictDecision | null) ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * Decyzja rodzica nad werdyktem: zapis `parent_decision` + `parent_decided_at`.
 * NIE zmienia `assessments` i NIE przelicza `child_objective_progress`. Działa
 * dopiero przy NASTĘPNEJ identycznej odpowiedzi (cache verdictFromCacheRow).
 */
export async function decideLessonVerdict(
  services: Services,
  verdictId: string,
  decision: LessonVerdictDecision,
): Promise<LessonVerdictDto> {
  const id = UuidSchema.parse(verdictId);
  const parsed = LessonVerdictDecisionSchema.parse(decision);
  const updated = await services.db
    .update(lessonVerdicts)
    .set({ parentDecision: parsed, parentDecidedAt: services.clock.now() })
    .where(eq(lessonVerdicts.id, id))
    .returning();
  if (updated.length === 0) throw new AppError("not_found");
  const row = updated[0]!;
  const objectiveId = await objectiveOfRevision(services, row.itemRevisionId);
  return {
    id: row.id,
    exerciseRevisionId: row.itemRevisionId,
    objectiveId,
    childAnswer: row.normalizedAnswer,
    verdict: row.verdict as LessonVerdictDto["verdict"],
    errorCategory: row.errorCategory,
    note: row.note ?? "",
    graderModel: row.graderModel,
    parentDecision: (row.parentDecision as LessonVerdictDecision | null) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Cel ćwiczenia (po rewizji) — do DTO werdyktu po decyzji. */
async function objectiveOfRevision(services: Services, revisionId: string): Promise<string> {
  const row = (await services.db.select({ payload: itemRevisions.payload }).from(itemRevisions).where(eq(itemRevisions.id, revisionId)))[0];
  return row ? toExerciseDraft(row.payload).objectiveId : "";
}

/** Deck id werdyktu (po rewizji → wersja → deck). */
async function deckOfVerdict(services: Services, revisionId: string): Promise<string | null> {
  const row = (await services.db
    .select({ deckId: deckVersions.deckId })
    .from(itemRevisions)
    .innerJoin(deckVersions, eq(deckVersions.id, itemRevisions.deckVersionId))
    .where(eq(itemRevisions.id, revisionId)))[0];
  return row?.deckId ?? null;
}

/**
 * Dodaje znormalizowaną odpowiedź jako zatwierdzony wariant ćwiczenia w BIEŻĄCYM
 * szkicu (tworzy szkic z opublikowanej, jeśli trzeba — reużywa mechanizmu z
 * zadania 11, `createLessonDraftFromPublished`). Idempotentne: wariant już obecny
 * → bez zmian. Edycja jest CHIRURGICZNA — dotyka tylko docelowego ćwiczenia (po
 * `itemId` werdyktu): dopisuje wariant do payloadu i — jak każda zmiana
 * wariantów w zadaniu 11 — tworzy NOWĄ `skill_version` celu (predecessor +
 * revision_number+1), potem bumpEditNumber i uzgodnienie mediów. Nie przepisuje
 * ani nie rewaliduje pozostałych ćwiczeń szkicu.
 */
export async function acceptVerdictAsVariant(services: Services, verdictId: string): Promise<{ deckVersionId: string; added: boolean }> {
  const id = UuidSchema.parse(verdictId);
  const verdict = (await services.db.select().from(lessonVerdicts).where(eq(lessonVerdicts.id, id)))[0];
  if (!verdict) throw new AppError("not_found");

  const deckId = await deckOfVerdict(services, verdict.itemRevisionId);
  if (!deckId) throw new AppError("not_found");

  // Tożsamość ćwiczenia (itemId) z rewizji werdyktu — wariant dodajemy do tego
  // samego learning_item w bieżącym szkicu, nie do rewizji werdyktu (która może
  // należeć do opublikowanej wersji).
  const sourceRevision = (await services.db
    .select({ itemId: itemRevisions.itemId })
    .from(itemRevisions)
    .where(eq(itemRevisions.id, verdict.itemRevisionId)))[0];
  if (!sourceRevision) throw new AppError("not_found");
  const itemId = sourceRevision.itemId;
  const normalized = verdict.normalizedAnswer;

  // Upewnij się, że istnieje edytowalny szkic (utwórz z opublikowanej, jak zadanie 11).
  const deck = (await services.db.select().from(decks).where(eq(decks.id, deckId)))[0]!;
  let draftVersionId = (await services.db
    .select({ id: deckVersions.id })
    .from(deckVersions)
    .where(and(eq(deckVersions.deckId, deckId), inArray(deckVersions.state, ["draft", "review"])))
    .orderBy(desc(deckVersions.editNumber))
    .limit(1))[0]?.id;
  if (!draftVersionId) {
    if (!deck.publishedVersionId) throw new AppError("conflict", { message: "lesson has no editable or published version" });
    const draft = await createLessonDraftFromPublished(services, deckId);
    draftVersionId = draft.id;
  }

  return services.db.transaction(async (tx) => {
    const version = await lockVersion(tx, draftVersionId!);
    if (version.state === "published") throw new AppError("conflict");
    const context = readLessonContext(version.lessonContext);
    const subject = requireSubject(services, context.subjectId);

    const target = (await tx
      .select({ id: itemRevisions.id, payload: itemRevisions.payload })
      .from(itemRevisions)
      .where(and(eq(itemRevisions.deckVersionId, draftVersionId!), eq(itemRevisions.itemId, itemId))))[0];
    if (!target) {
      // Ćwiczenie usunięte w szkicu — nic do zrobienia (idempotentnie bez zmian).
      return { deckVersionId: draftVersionId!, added: false };
    }

    const draft = toExerciseDraft(target.payload);
    const normalize = (text: string): string => {
      const seqs = subject.normalizer.normalize(text).filter((s) => s.length > 0);
      return seqs[0]?.join(" ") ?? text.trim().toLowerCase();
    };
    const alreadyPresent = [draft.answer, ...draft.acceptedAnswers].some((v) => normalize(v) === normalized);
    if (alreadyPresent) {
      return { deckVersionId: draftVersionId!, added: false };
    }

    const nextDraft = { ...draft, acceptedAnswers: [...draft.acceptedAnswers, normalized] };
    const payload = buildLessonPayload(nextDraft, subject);

    // Zmiana wariantów = nowa skill_version celu (jak applyLessonExercisesEdit).
    const existingSkill = (await tx
      .select({ skillVersionId: itemRevisionSkills.skillVersionId, revisionNumber: skillVersions.revisionNumber })
      .from(itemRevisionSkills)
      .innerJoin(skillVersions, eq(skillVersions.id, itemRevisionSkills.skillVersionId))
      .where(and(eq(itemRevisionSkills.itemRevisionId, target.id), eq(itemRevisionSkills.skill, "objective"))))[0];
    const { criteria, criteriaHash } = buildObjectiveCriteria(nextDraft, subject, context.topicVersion);
    const newSkillVersionId = randomUUID();
    await tx.insert(skillVersions).values({
      id: newSkillVersionId,
      itemId,
      skill: "objective",
      revisionNumber: (existingSkill?.revisionNumber ?? 1) + 1,
      criteria,
      criteriaHash,
      ...(existingSkill?.skillVersionId ? { predecessorId: existingSkill.skillVersionId } : {}),
    });
    await tx.update(itemRevisions).set({ payload }).where(eq(itemRevisions.id, target.id));
    await tx.delete(itemRevisionSkills).where(eq(itemRevisionSkills.itemRevisionId, target.id));
    await tx.insert(itemRevisionSkills).values({
      itemRevisionId: target.id,
      itemId,
      skill: "objective",
      skillVersionId: newSkillVersionId,
    });
    await bumpEditNumber(tx, draftVersionId!);
    await reconcileDraftAssetsTx(tx, services, { id: version.id, state: version.state });
    return { deckVersionId: draftVersionId!, added: true };
  });
}
