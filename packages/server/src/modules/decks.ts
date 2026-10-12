import { randomUUID } from "node:crypto";
import { AssignmentPutSchema, type AssignmentGoal, type TestGoal } from "@learning/contracts";
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  CreateEmptyDeckCommandSchema,
  DraftInputSchema,
  DraftPatchSchema,
  isFamilyDate,
  messages,
  type AssignmentDto,
  type CreateEmptyDeckCommand,
  type DeckDto,
  type DeckState,
  type DeckSummaryDto,
  type DraftDto,
  type DraftItemDto,
  type DraftInput,
  type DraftPatch,
  type GenerationDto,
  type VocabularyItemInput,
} from "@learning/contracts";
import type { Services } from "../config";
import type { Executor, Tx } from "../db/client";
import {
  assignments,
  childProfiles,
  deckVersions,
  decks,
  generationRuns,
  itemRevisions,
  itemRevisionSkills,
  learningItems,
  mediaAssets,
  revisionAssets,
  skillVersions,
} from "../db/schema";
import { AppError } from "../errors";
import { buildSkillCriteria, classifyRevisionImpact } from "../domain/revision-impact";
import { computeTargetKey } from "../domain/target-key";
import { VOCABULARY_SKILLS, type VocabularySkill } from "../domain/types";
import { buildPayload, payloadToItem, validateItems } from "./item-payload";
import { assertAssetPublishable, reconcileDraftAssetsTx, requiredAssetsFor } from "./media-reconciliation";

async function lockVersion(tx: Tx, draftId: string) {
  const rows = await tx
    .select()
    .from(deckVersions)
    .where(eq(deckVersions.id, draftId))
    .for("update");
  const version = rows[0];
  if (!version) {
    throw new AppError("not_found");
  }
  return version;
}

/**
 * Tworzy wersje kryteriów dla wskazanych umiejętności itemu. Numery rewizji
 * podaje się per umiejętność — historie poszczególnych kluczy rozjeżdżają się,
 * gdy część umiejętności zmieniała treść częściej niż pozostałe.
 */
async function createSkillVersionsForItem(
  tx: Tx,
  itemId: string,
  item: VocabularyItemInput,
  skillsToCreate: Map<VocabularySkill, { revisionNumber: number; predecessorId?: string }>,
): Promise<Map<VocabularySkill, string>> {
  const skillIds = new Map<VocabularySkill, string>();
  for (const [skill, meta] of skillsToCreate) {
    const { criteria, criteriaHash } = buildSkillCriteria(item, skill);
    const id = randomUUID();
    await tx.insert(skillVersions).values({
      id,
      itemId,
      skill,
      revisionNumber: meta.revisionNumber,
      criteria,
      criteriaHash,
      ...(meta.predecessorId ? { predecessorId: meta.predecessorId } : {}),
    });
    skillIds.set(skill, id);
  }
  return skillIds;
}

/** Rewizja + mapa skill_versions dla nowego itemu w wersji zestawu. */
async function insertRevision(
  tx: Tx,
  input: {
    itemId: string;
    deckId: string;
    deckVersionId: string;
    position: number;
    item: VocabularyItemInput;
    skillIds: Map<VocabularySkill, string>;
  },
): Promise<string> {
  const revisionId = randomUUID();
  await tx.insert(itemRevisions).values({
    id: revisionId,
    itemId: input.itemId,
    deckId: input.deckId,
    deckVersionId: input.deckVersionId,
    position: input.position,
    payload: buildPayload(input.item),
    targetKey: computeTargetKey(input.item.target, input.item.locales.target),
  });
  for (const skill of VOCABULARY_SKILLS) {
    await tx.insert(itemRevisionSkills).values({
      itemRevisionId: revisionId,
      itemId: input.itemId,
      skill,
      skillVersionId: input.skillIds.get(skill)!,
    });
  }
  return revisionId;
}

/**
 * Odczyt wersji w kształcie DTO. Stan zasobu to projekcja: wiersz może być
 * wciąż pending, podczas gdy gotowy blob w media_assets już czeka — rodzic
 * widzi wtedy "approved". Stan omitted pozostaje decyzją, nie projekcją.
 */
async function readDraftDto(db: Executor, versionId: string): Promise<DraftDto> {
  const version = (await db.select().from(deckVersions).where(eq(deckVersions.id, versionId)))[0];
  if (!version) {
    throw new AppError("not_found");
  }
  const revisions = await db
    .select()
    .from(itemRevisions)
    .where(eq(itemRevisions.deckVersionId, versionId))
    .orderBy(asc(itemRevisions.position));
  const revisionIds = revisions.map((r) => r.id);
  const assets = revisionIds.length
    ? await db
        .select({
          itemRevisionId: revisionAssets.itemRevisionId,
          role: revisionAssets.role,
          decisionState: revisionAssets.state,
          assetId: revisionAssets.assetId,
          assetState: mediaAssets.state,
        })
        .from(revisionAssets)
        .leftJoin(mediaAssets, eq(mediaAssets.id, revisionAssets.assetId))
        .where(inArray(revisionAssets.itemRevisionId, revisionIds))
    : [];

  const items: DraftItemDto[] = revisions.map((r) => ({
    ...payloadToItem(r.payload),
    id: r.itemId,
    revisionId: r.id,
  }));

  return {
    id: version.id,
    deckId: version.deckId,
    editNumber: version.editNumber,
    status: version.state as DraftDto["status"],
    title: version.title,
    items,
    assets: assets.map((a) => ({
      itemRevisionId: a.itemRevisionId,
      role: a.role,
      state:
        a.decisionState === "omitted"
          ? "omitted"
          : a.assetState === "ready"
            ? "approved"
            : a.assetState === "failed"
              ? "failed"
              : "pending",
      assetId: a.assetId,
    })),
  };
}

export async function createDraft(services: Services, input: DraftInput): Promise<DraftDto> {
  const valid = DraftInputSchema.parse(input);
  validateItems(valid.items);

  const deckId = randomUUID();
  const versionId = randomUUID();

  return services.db.transaction(async (tx) => {
    await tx.insert(decks).values({ id: deckId, title: valid.title });
    await tx.insert(deckVersions).values({
      id: versionId,
      deckId,
      versionNumber: 1,
      editNumber: 1,
      state: "draft",
      title: valid.title,
      sourceLocale: valid.items[0]!.locales.source,
      targetLocale: valid.items[0]!.locales.target,
    });
    for (const [position, item] of valid.items.entries()) {
      const itemId = randomUUID();
      await tx.insert(learningItems).values({ id: itemId, deckId });
      const skillIds = await createSkillVersionsForItem(
        tx,
        itemId,
        item,
        new Map(VOCABULARY_SKILLS.map((skill) => [skill, { revisionNumber: 1 }])),
      );
      await insertRevision(tx, {
        itemId,
        deckId,
        deckVersionId: versionId,
        position,
        item,
        skillIds,
      });
    }
    return readDraftDto(tx, versionId);
  });
}

/**
 * Tworzy ręczny, jeszcze pusty szkic. UUID decku jest kluczem idempotencji:
 * retry nie resetuje treści, niezależnie od tego, jak daleko zaszedł zestaw.
 */
export async function createEmptyDeck(
  services: Services,
  input: CreateEmptyDeckCommand,
): Promise<{ deckId: string; created: boolean }> {
  const command = CreateEmptyDeckCommandSchema.parse(input);
  const title = command.title ?? messages.decks.defaultTitle;
  const versionId = randomUUID();

  return services.db.transaction(async (tx) => {
    const inserted = await tx
      .insert(decks)
      .values({ id: command.deckId, title })
      .onConflictDoNothing({ target: decks.id })
      .returning({ id: decks.id });

    if (inserted.length === 0) {
      return { deckId: command.deckId, created: false };
    }

    await tx.insert(deckVersions).values({
      id: versionId,
      deckId: command.deckId,
      versionNumber: 1,
      editNumber: 1,
      state: "draft",
      title,
      sourceLocale: "pl-PL",
      targetLocale: "en-GB",
    });

    return { deckId: command.deckId, created: true };
  });
}

interface CurrentRevision {
  revisionId: string;
  itemId: string;
  payload: Record<string, unknown>;
  skills: Map<VocabularySkill, { skillVersionId: string; revisionNumber: number }>;
}

/**
 * Nowy edytowalny szkic z aktualnie opublikowanej wersji zestawu
 * (architecture.md §12: POST /decks/:id/draft, SPEC §84). Kopiuje rewizje
 * z tymi samymi kluczami umiejętności i decyzjami o mediach — dopiero edycja
 * szkicu tworzy nowe skill_versions z predecessorami. Opublikowana wersja
 * pozostaje nietknięta i prowadzi sesje dziecka do publikacji nowej.
 */
export async function createDraftFromPublished(
  services: Services,
  deckId: string,
): Promise<DraftDto> {
  const id = z.uuid().parse(deckId);
  return services.db.transaction(async (tx) => {
    // blokada wiersza zestawu serializuje równoległe forki (indeks częściowy
    // one_editable_version_per_deck to ostateczny strażnik) i wyścig z archiwum
    const deck = (await tx.select().from(decks).where(eq(decks.id, id)).for("update"))[0];
    if (!deck) {
      throw new AppError("not_found");
    }
    if (deck.archivedAt) {
      throw new AppError("conflict");
    }
    if (!deck.publishedVersionId) {
      throw new AppError("validation", { message: "deck is not published" });
    }
    const editable = (
      await tx
        .select({ id: deckVersions.id })
        .from(deckVersions)
        .where(and(eq(deckVersions.deckId, id), inArray(deckVersions.state, ["draft", "review"])))
    )[0];
    if (editable) {
      throw new AppError("conflict");
    }
    const source = (
      await tx.select().from(deckVersions).where(eq(deckVersions.id, deck.publishedVersionId))
    )[0]!;
    const maxVersion = (
      await tx
        .select({ max: sql<number>`max(${deckVersions.versionNumber})::int` })
        .from(deckVersions)
        .where(eq(deckVersions.deckId, id))
    )[0]!;

    const versionId = randomUUID();
    await tx.insert(deckVersions).values({
      id: versionId,
      deckId: id,
      versionNumber: maxVersion.max + 1,
      editNumber: 1,
      state: "draft",
      title: source.title,
      sourceLocale: source.sourceLocale,
      targetLocale: source.targetLocale,
    });

    const revisions = await tx
      .select()
      .from(itemRevisions)
      .where(eq(itemRevisions.deckVersionId, source.id))
      .orderBy(asc(itemRevisions.position));
    const revisionIds = revisions.map((r) => r.id);
    const skills = revisionIds.length
      ? await tx
          .select({
            itemRevisionId: itemRevisionSkills.itemRevisionId,
            skill: itemRevisionSkills.skill,
            skillVersionId: itemRevisionSkills.skillVersionId,
          })
          .from(itemRevisionSkills)
          .where(inArray(itemRevisionSkills.itemRevisionId, revisionIds))
      : [];
    const assets = revisionIds.length
      ? await tx.select().from(revisionAssets).where(inArray(revisionAssets.itemRevisionId, revisionIds))
      : [];

    for (const revision of revisions) {
      const copyId = randomUUID();
      await tx.insert(itemRevisions).values({
        id: copyId,
        itemId: revision.itemId,
        deckId: id,
        deckVersionId: versionId,
        position: revision.position,
        payload: revision.payload,
        targetKey: revision.targetKey,
      });
      for (const skill of skills.filter((row) => row.itemRevisionId === revision.id)) {
        await tx.insert(itemRevisionSkills).values({
          itemRevisionId: copyId,
          itemId: revision.itemId,
          skill: skill.skill,
          skillVersionId: skill.skillVersionId,
        });
      }
      // decyzje rodzica o mediach (approved/omitted, fingerprinty) przechodzą
      // do szkicu; uzgodnienie przy każdej edycji zadba o zmiany treści
      for (const asset of assets.filter((row) => row.itemRevisionId === revision.id)) {
        await tx.insert(revisionAssets).values({
          itemRevisionId: copyId,
          role: asset.role,
          assetId: asset.assetId,
          expectedFingerprint: asset.expectedFingerprint,
          state: asset.state,
        });
      }
    }
    return readDraftDto(tx, versionId);
  });
}

async function loadCurrentRevisions(tx: Tx, versionId: string): Promise<CurrentRevision[]> {
  const revisions = await tx
    .select()
    .from(itemRevisions)
    .where(eq(itemRevisions.deckVersionId, versionId))
    .orderBy(asc(itemRevisions.position));
  const result: CurrentRevision[] = [];
  for (const r of revisions) {
    const skills = await tx
      .select({
        skill: itemRevisionSkills.skill,
        skillVersionId: itemRevisionSkills.skillVersionId,
        revisionNumber: skillVersions.revisionNumber,
      })
      .from(itemRevisionSkills)
      .innerJoin(skillVersions, eq(skillVersions.id, itemRevisionSkills.skillVersionId))
      .where(eq(itemRevisionSkills.itemRevisionId, r.id));
    result.push({
      revisionId: r.id,
      itemId: r.itemId,
      payload: r.payload,
      skills: new Map(
        skills.map((s) => [
          s.skill as VocabularySkill,
          { skillVersionId: s.skillVersionId, revisionNumber: s.revisionNumber },
        ]),
      ),
    });
  }
  return result;
}

/** Pozycje tymczasowe (1000+) omijają UNIQUE(deck_version_id, position) przy przepisaniu. */
const TEMP_POSITION_OFFSET = 1000;

/** Nadpisuje elementy wersji szkicu; używane też przy zapisie wyniku generacji. */
export async function applyItems(
  tx: Tx,
  versionId: string,
  deckId: string,
  items: VocabularyItemInput[],
): Promise<void> {
  validateItems(items);
  const current = await loadCurrentRevisions(tx, versionId);
  const currentByItemId = new Map(current.map((c) => [c.itemId, c]));

  const referencedIds = new Set(
    items.map((i) => i.id).filter((id): id is string => id !== undefined),
  );
  for (const id of referencedIds) {
    if (!currentByItemId.has(id)) {
      throw new AppError("validation", { message: `unknown item id: ${id}` });
    }
  }

  // elementy usunięte z listy znikają ze szkicu; powiązania zasobów odpinamy
  for (const c of current) {
    if (!referencedIds.has(c.itemId)) {
      await tx.delete(revisionAssets).where(eq(revisionAssets.itemRevisionId, c.revisionId));
      await tx.delete(itemRevisionSkills).where(eq(itemRevisionSkills.itemRevisionId, c.revisionId));
      await tx.delete(itemRevisions).where(eq(itemRevisions.id, c.revisionId));
    }
  }

  for (const [position, item] of items.entries()) {
    const tempPosition = TEMP_POSITION_OFFSET + position;
    if (item.id) {
      const existing = currentByItemId.get(item.id)!;
      const oldItem = payloadToItem(existing.payload);
      const impact = classifyRevisionImpact(oldItem, item);
      const toCreate = new Map<VocabularySkill, { revisionNumber: number; predecessorId: string }>();
      for (const skill of impact) {
        const prev = existing.skills.get(skill)!;
        toCreate.set(skill, {
          revisionNumber: prev.revisionNumber + 1,
          predecessorId: prev.skillVersionId,
        });
      }
      const created = toCreate.size
        ? await createSkillVersionsForItem(tx, existing.itemId, item, toCreate)
        : new Map<VocabularySkill, string>();
      await tx
        .update(itemRevisions)
        .set({
          payload: buildPayload(item),
          targetKey: computeTargetKey(item.target, item.locales.target),
          position: tempPosition,
        })
        .where(eq(itemRevisions.id, existing.revisionId));
      await tx
        .delete(itemRevisionSkills)
        .where(eq(itemRevisionSkills.itemRevisionId, existing.revisionId));
      for (const skill of VOCABULARY_SKILLS) {
        await tx.insert(itemRevisionSkills).values({
          itemRevisionId: existing.revisionId,
          itemId: existing.itemId,
          skill,
          skillVersionId: created.get(skill) ?? existing.skills.get(skill)!.skillVersionId,
        });
      }
    } else {
      const itemId = randomUUID();
      await tx.insert(learningItems).values({ id: itemId, deckId });
      const skillIds = await createSkillVersionsForItem(
        tx,
        itemId,
        item,
        new Map(VOCABULARY_SKILLS.map((skill) => [skill, { revisionNumber: 1 }])),
      );
      await insertRevision(tx, {
        itemId,
        deckId,
        deckVersionId: versionId,
        position: tempPosition,
        item,
        skillIds,
      });
    }
  }

  await tx
    .update(itemRevisions)
    .set({ position: sql`${itemRevisions.position} - ${TEMP_POSITION_OFFSET}` })
    .where(eq(itemRevisions.deckVersionId, versionId));
}

export async function editDraft(
  services: Services,
  draftId: string,
  input: DraftPatch,
): Promise<DraftDto> {
  const valid = DraftPatchSchema.parse(input);
  if (valid.title === undefined && valid.items === undefined) {
    throw new AppError("validation", { message: "patch must change title or items" });
  }

  return services.db.transaction(async (tx) => {
    const version = await lockVersion(tx, draftId);
    if (version.state === "published") {
      throw new AppError("immutable");
    }
    if (version.editNumber !== valid.expectedEditNumber) {
      throw new AppError("conflict");
    }
    if (valid.title !== undefined) {
      await tx.update(deckVersions).set({ title: valid.title }).where(eq(deckVersions.id, draftId));
    }
    if (valid.items !== undefined) {
      await applyItems(tx, draftId, version.deckId, valid.items);
    }
    await tx
      .update(deckVersions)
      .set({ editNumber: sql`${deckVersions.editNumber} + 1` })
      .where(eq(deckVersions.id, draftId));
    // każda edycja uzgadnia powiązania zasobów w tej samej transakcji
    await reconcileDraftAssetsTx(tx, services, version);
    return readDraftDto(tx, draftId);
  });
}

export async function publishDraft(
  services: Services,
  draftId: string,
  expectedEditNumber: number,
): Promise<{ deckVersionId: string }> {
  return services.db.transaction(async (tx) => {
    const version = await lockVersion(tx, draftId);
    if (version.state === "published") {
      throw new AppError("conflict");
    }
    if (version.editNumber !== expectedEditNumber) {
      throw new AppError("conflict");
    }
    // Publikacja uzgadnia powiązania zasobów jak każda edycja: promuje gotowe
    // bloby do approved i zleca brakujące, zanim walidator oceni gotowość.
    // Bez tego zestaw opublikowany zaraz po generacji zostawiałby target_audio
    // w stanie pending i sesje dziecka nie znajdowałyby gotowego audio.
    await reconcileDraftAssetsTx(tx, services, version);

    const revisions = await tx
      .select({
        id: itemRevisions.id,
        itemId: itemRevisions.itemId,
        payload: itemRevisions.payload,
      })
      .from(itemRevisions)
      .where(eq(itemRevisions.deckVersionId, draftId))
      .orderBy(asc(itemRevisions.position));
    if (revisions.length === 0) {
      throw new AppError("validation", { message: "deck has no items" });
    }
    const revisionIds = revisions.map((r) => r.id);
    const assets = await tx
      .select()
      .from(revisionAssets)
      .where(inArray(revisionAssets.itemRevisionId, revisionIds));

    // Walidator publikacji: obowiązkowe audio gotowe i zgodne z fingerprintem,
    // obraz świadomie pominięty albo gotowy. Wymagany TTS nie może być pominięty.
    const settings = services.media;
    for (const revision of revisions) {
      const mine = assets.filter((a) => a.itemRevisionId === revision.id);
      const requiredHere = settings
        ? new Map(
            requiredAssetsFor(payloadToItem(revision.payload), settings).map((r) => [r.role, r]),
          )
        : null;

      const checkLinked = async (
        role: "target_audio" | "example_audio" | "illustration",
      ): Promise<void> => {
        const row = mine.find((a) => a.role === role);
        if (!row || row.assetId === null) {
          throw new AppError("validation", {
            message: `missing ready ${role} for revision ${revision.id}`,
          });
        }
        await assertAssetPublishable(tx, {
          itemRevisionId: revision.id,
          role,
          assetId: row.assetId,
          expectedFingerprint: row.expectedFingerprint,
        });
        const required = requiredHere?.get(role);
        if (requiredHere && (!required || required.fingerprint !== row.expectedFingerprint)) {
          throw new AppError("validation", {
            message: `stale ${role} link for revision ${revision.id}`,
          });
        }
      };

      await checkLinked("target_audio");

      // decyzja o obrazie jest potrzebna tylko, gdy karta naprawdę go wymaga;
      // kolor/liczba/sekwencja renderują się deterministycznie
      const illustration = mine.find((a) => a.role === "illustration");
      const illustrationRequired = requiredHere ? requiredHere.has("illustration") : true;
      if (illustrationRequired) {
        if (!illustration) {
          throw new AppError("validation", {
            message: `illustration not decided for revision ${revision.id}`,
          });
        }
        if (illustration.state !== "omitted") {
          await checkLinked("illustration");
        }
      }

      const exampleAudio = mine.find((a) => a.role === "example_audio");
      if (exampleAudio && exampleAudio.state !== "omitted") {
        await checkLinked("example_audio");
      }
    }

    const now = services.clock.now();
    await tx
      .update(deckVersions)
      .set({ state: "published", publishedAt: now })
      .where(eq(deckVersions.id, draftId));
    await tx
      .update(decks)
      .set({ publishedVersionId: draftId, title: version.title })
      .where(eq(decks.id, version.deckId));
    await tx
      .update(learningItems)
      .set({ retiredAt: now })
      .where(
        and(
          eq(learningItems.deckId, version.deckId),
          isNull(learningItems.retiredAt),
          notInArray(
            learningItems.id,
            revisions.map((r) => r.itemId),
          ),
        ),
      );
    return { deckVersionId: draftId };
  });
}

/** Odczyt istniejącego szkicu/wersji — podgląd i polling po odświeżeniu strony. */
export async function readDraft(services: Services, draftId: string): Promise<DraftDto> {
  return readDraftDto(services.db, z.uuid().parse(draftId));
}

/** Najnowszy run generacji zestawu dla wersji; brak runów daje null. */
async function latestDeckRun(services: Services, deckVersionId: string): Promise<GenerationDto | null> {
  const run = (
    await services.db
      .select()
      .from(generationRuns)
      .where(and(eq(generationRuns.deckVersionId, deckVersionId), eq(generationRuns.kind, "deck")))
      .orderBy(desc(generationRuns.createdAt))
      .limit(1)
  )[0];
  if (!run) {
    return null;
  }
  return {
    id: run.id,
    deckId: (
      await services.db
        .select({ deckId: deckVersions.deckId })
        .from(deckVersions)
        .where(eq(deckVersions.id, deckVersionId))
    )[0]?.deckId ?? null,
    deckVersionId: run.deckVersionId ?? null,
    state: run.state as GenerationDto["state"],
    attempts: run.attempts,
    errorCode: run.errorCode ?? null,
  };
}

async function deckAssignments(services: Services, deckId: string): Promise<AssignmentDto[]> {
  return services.db
    .select({
      childId: assignments.childId,
      displayName: childProfiles.displayName,
      testDate: assignments.testDate,
      testGoals: assignments.testGoals,
      mockTestTaskCount: assignments.mockTestTaskCount,
      active: assignments.active,
    })
    .from(assignments)
    .innerJoin(childProfiles, eq(childProfiles.id, assignments.childId))
    .where(eq(assignments.deckId, deckId))
    .orderBy(asc(childProfiles.createdAt), asc(childProfiles.id));
}

function deckStateOf(deck: { archivedAt: Date | null; publishedVersionId: string | null }, editableState: "draft" | "review" | null): DeckState {
  if (deck.archivedAt) {
    return "archived";
  }
  if (editableState) {
    return editableState;
  }
  return deck.publishedVersionId ? "published" : "draft";
}

/**
 * Pełny widok zestawu dla panelu rodzica: edytowalny szkic, opublikowana wersja,
 * najnowszy run generacji szkicu i przypisania dzieci z terminami.
 */
export async function readDeck(services: Services, deckId: string): Promise<DeckDto> {
  const id = z.uuid().parse(deckId);
  const deck = (await services.db.select().from(decks).where(eq(decks.id, id)))[0];
  if (!deck) {
    throw new AppError("not_found");
  }
  const editable = (
    await services.db
      .select()
      .from(deckVersions)
      .where(and(eq(deckVersions.deckId, id), inArray(deckVersions.state, ["draft", "review"])))
  )[0];
  const publishedVersionId = deck.publishedVersionId ?? null;
  return {
    id: deck.id,
    title: deck.title,
    state: deckStateOf(deck, editable ? (editable.state as "draft" | "review") : null),
    draft: editable ? await readDraftDto(services.db, editable.id) : null,
    published: publishedVersionId ? await readDraftDto(services.db, publishedVersionId) : null,
    generation: editable ? await latestDeckRun(services, editable.id) : null,
    assignments: await deckAssignments(services, id),
  };
}

/** Lista zestawów najnowszymi pierwszymi; stan wynika z wersji i archiwum. */
export async function listDecks(services: Services): Promise<DeckSummaryDto[]> {
  const rows = await services.db
    .select({
      id: decks.id,
      title: decks.title,
      kind: decks.kind,
      archivedAt: decks.archivedAt,
      publishedVersionId: decks.publishedVersionId,
    })
    .from(decks)
    .orderBy(desc(decks.createdAt));
  const editable = await services.db
    .select({ deckId: deckVersions.deckId, id: deckVersions.id, state: deckVersions.state })
    .from(deckVersions)
    .where(inArray(deckVersions.state, ["draft", "review"]));
  const editableByDeck = new Map(editable.map((v) => [v.deckId, v]));
  return rows.map((row) => {
    const edit = editableByDeck.get(row.id);
    return {
      deckId: row.id,
      title: row.title,
      kind: row.kind as "vocabulary" | "lesson",
      state: deckStateOf(row, edit ? (edit.state as "draft" | "review") : null),
      editableVersionId: edit?.id ?? null,
      publishedVersionId: row.publishedVersionId ?? null,
    };
  });
}

const UpsertAssignmentSchema = z.object({
  childId: z.uuid(),
  deckId: z.uuid(),
  testDate: z
    .string()
    .nullable()
    .refine((value) => value === null || isFamilyDate(value), {
      message: "testDate must be YYYY-MM-DD or null",
    }),
});

/**
 * Przypisanie (lub aktualizacja terminu) zestawu dziecku. Termin sprawdzianu
 * jest opcjonalny i należy do pary dziecko–zestaw: jedno zestaw, różne daty.
 * Archiwum wycofano z nowych sesji; nieopublikowany zestaw nie jest jeszcze
 * materiałem dziecka.
 */
export async function upsertAssignment(
  services: Services,
  childId: string,
  deckId: string,
  testDate: string | null,
  options: { testGoals?: AssignmentGoal[] | null; mockTestTaskCount?: number } = {},
): Promise<void> {
  const valid = UpsertAssignmentSchema.parse({ childId, deckId, testDate });
  const settings = AssignmentPutSchema.parse({ testDate, ...options });
  const configuration = {
    ...(settings.testGoals === undefined ? {} : { testGoals: settings.testGoals }),
    ...(settings.mockTestTaskCount === undefined ? {} : { mockTestTaskCount: settings.mockTestTaskCount }),
  };
  const deck = (
    await services.db.select().from(decks).where(eq(decks.id, valid.deckId))
  )[0];
  if (!deck) {
    throw new AppError("not_found");
  }
  if (deck.archivedAt) {
    throw new AppError("conflict");
  }
  if (!deck.publishedVersionId) {
    throw new AppError("validation", { message: "deck is not published" });
  }
  try {
    await services.db
      .insert(assignments)
      .values({
        id: randomUUID(),
        childId: valid.childId,
        deckId: valid.deckId,
        testDate: valid.testDate,
        ...configuration,
        active: true,
      })
      .onConflictDoUpdate({
        target: [assignments.childId, assignments.deckId],
        set: { testDate: valid.testDate, active: true, ...configuration },
      });
  } catch (error) {
    // nieznany profil dziecka: FK zamiast mglistego błędu sterownika (drizzle
    // opakowuje błąd pg, kod ConstraintErrorCode siedzi w cause)
    const pgCode =
      (error as { code?: string }).code ??
      (error as { cause?: { code?: string } }).cause?.code;
    if (pgCode === "23503") {
      throw new AppError("not_found");
    }
    throw error;
  }
}

/** Wycofanie zestawu z nowych sesji; idempotentne, historia zostaje. */
export async function archiveDeck(services: Services, deckId: string): Promise<void> {
  const id = z.uuid().parse(deckId);
  const deck = (await services.db.select().from(decks).where(eq(decks.id, id)))[0];
  if (!deck) {
    throw new AppError("not_found");
  }
  if (deck.archivedAt === null) {
    await services.db
      .update(decks)
      .set({ archivedAt: services.clock.now() })
      .where(eq(decks.id, id));
  }
}
