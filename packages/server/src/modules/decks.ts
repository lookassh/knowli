import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import {
  DraftInputSchema,
  DraftPatchSchema,
  type DraftDto,
  type DraftItemDto,
  type DraftInput,
  type DraftPatch,
  type VocabularyItemInput,
} from "@learning/contracts";
import type { Services } from "../config";
import type { Tx } from "../db/client";
import {
  deckVersions,
  decks,
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
import { SKILLS, type Skill } from "../domain/types";

interface ItemPayload {
  source: string;
  target: string;
  acceptedAnswers: string[];
  example?: string;
  visualType: string;
  visualData?: Record<string, unknown>;
  sourceLocale: string;
  targetLocale: string;
}

function buildPayload(item: VocabularyItemInput): Record<string, unknown> {
  return {
    source: item.source,
    target: item.target,
    acceptedAnswers: item.acceptedAnswers,
    ...(item.example === undefined ? {} : { example: item.example }),
    visualType: item.visualType,
    ...(item.visualData === undefined ? {} : { visualData: item.visualData }),
    sourceLocale: item.locales.source,
    targetLocale: item.locales.target,
  };
}

function payloadToItem(payload: Record<string, unknown>): VocabularyItemInput {
  const p = payload as unknown as ItemPayload;
  return {
    source: p.source,
    target: p.target,
    acceptedAnswers: p.acceptedAnswers,
    ...(p.example === undefined ? {} : { example: p.example }),
    visualType: p.visualType as VocabularyItemInput["visualType"],
    ...(p.visualData === undefined ? {} : { visualData: p.visualData }),
    locales: { source: p.sourceLocale, target: p.targetLocale },
  };
}

function validateItems(items: VocabularyItemInput[]): void {
  const first = items[0]!.locales;
  if (items.some((i) => i.locales.source !== first.source || i.locales.target !== first.target)) {
    throw new AppError("validation", { message: "all items must share one locale pair" });
  }
  const seen = new Set<string>();
  for (const item of items) {
    const key = computeTargetKey(item.target, item.locales.target);
    if (seen.has(key)) {
      throw new AppError("validation", { message: `duplicate target: ${item.target}` });
    }
    seen.add(key);
  }
}

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
  skillsToCreate: Map<Skill, { revisionNumber: number; predecessorId?: string }>,
): Promise<Map<Skill, string>> {
  const skillIds = new Map<Skill, string>();
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
    skillIds: Map<Skill, string>;
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
  for (const skill of SKILLS) {
    await tx.insert(itemRevisionSkills).values({
      itemRevisionId: revisionId,
      itemId: input.itemId,
      skill,
      skillVersionId: input.skillIds.get(skill)!,
    });
  }
  return revisionId;
}

async function readDraftDto(tx: Tx, versionId: string): Promise<DraftDto> {
  const version = (await tx.select().from(deckVersions).where(eq(deckVersions.id, versionId)))[0]!;
  const revisions = await tx
    .select()
    .from(itemRevisions)
    .where(eq(itemRevisions.deckVersionId, versionId))
    .orderBy(asc(itemRevisions.position));
  const revisionIds = revisions.map((r) => r.id);
  const assets = revisionIds.length
    ? await tx
        .select({
          itemRevisionId: revisionAssets.itemRevisionId,
          role: revisionAssets.role,
          state: revisionAssets.state,
        })
        .from(revisionAssets)
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
    assets,
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
        new Map(SKILLS.map((skill) => [skill, { revisionNumber: 1 }])),
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

interface CurrentRevision {
  revisionId: string;
  itemId: string;
  payload: Record<string, unknown>;
  skills: Map<Skill, { skillVersionId: string; revisionNumber: number }>;
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
          s.skill as Skill,
          { skillVersionId: s.skillVersionId, revisionNumber: s.revisionNumber },
        ]),
      ),
    });
  }
  return result;
}

/** Pozycje tymczasowe (1000+) omijają UNIQUE(deck_version_id, position) przy przepisaniu. */
const TEMP_POSITION_OFFSET = 1000;

async function applyItems(
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
      const toCreate = new Map<Skill, { revisionNumber: number; predecessorId: string }>();
      for (const skill of impact) {
        const prev = existing.skills.get(skill)!;
        toCreate.set(skill, {
          revisionNumber: prev.revisionNumber + 1,
          predecessorId: prev.skillVersionId,
        });
      }
      const created = toCreate.size
        ? await createSkillVersionsForItem(tx, existing.itemId, item, toCreate)
        : new Map<Skill, string>();
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
      for (const skill of SKILLS) {
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
        new Map(SKILLS.map((skill) => [skill, { revisionNumber: 1 }])),
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

    const revisions = await tx
      .select({ id: itemRevisions.id, itemId: itemRevisions.itemId })
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

    // Walidator publikacji: obowiązkowe audio approved+ready, obraz świadomie
    // approved+ready albo omitted. Do zadania 3 testy podpinają fake-ready media.
    const referencedAssetIds = assets
      .map((a) => a.assetId)
      .filter((id): id is string => id !== null);
    const readyAssets = new Set(
      referencedAssetIds.length
        ? (
            await tx
              .select({ id: mediaAssets.id })
              .from(mediaAssets)
              .where(and(inArray(mediaAssets.id, referencedAssetIds), eq(mediaAssets.state, "ready")))
          ).map((a) => a.id)
        : [],
    );

    for (const revision of revisions) {
      const mine = assets.filter((a) => a.itemRevisionId === revision.id);
      const targetAudio = mine.find((a) => a.role === "target_audio");
      if (
        !targetAudio ||
        targetAudio.state !== "approved" ||
        targetAudio.assetId === null ||
        !readyAssets.has(targetAudio.assetId)
      ) {
        throw new AppError("validation", {
          message: `missing ready target audio for revision ${revision.id}`,
        });
      }
      const illustration = mine.find((a) => a.role === "illustration");
      if (!illustration) {
        throw new AppError("validation", {
          message: `illustration not decided for revision ${revision.id}`,
        });
      }
      if (
        illustration.state === "approved" &&
        (illustration.assetId === null || !readyAssets.has(illustration.assetId))
      ) {
        throw new AppError("validation", {
          message: `illustration not ready for revision ${revision.id}`,
        });
      }
      const exampleAudio = mine.find((a) => a.role === "example_audio");
      if (
        exampleAudio &&
        exampleAudio.state === "approved" &&
        (exampleAudio.assetId === null || !readyAssets.has(exampleAudio.assetId))
      ) {
        throw new AppError("validation", {
          message: `example audio not ready for revision ${revision.id}`,
        });
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
