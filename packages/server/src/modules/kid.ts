import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { MeaningVisualSchema, type KidDeckDto, type KidProfileDto } from "@learning/contracts";
import type { Services } from "../config";
import { hasScheduledWork, type DeckWorkloadItem, type SkillSnapshot } from "../domain/scheduler";
import type { Skill } from "../domain/types";
import { assignments, childProfiles, childSkillProgress, deckVersions, decks, familySettings, itemRevisionSkills, itemRevisions, learningSessions, revisionAssets } from "../db/schema";
import { AppError } from "../errors";
import { mapStatus, readEligibleDailyRoundPool } from "./sessions";
import { lessonDeckListValues } from "./lessons/lesson-sessions";
import { hasSafeLessonMockPortion } from "./lessons/lesson-mock-tests";
import { CURRENT_POLICY_ID, ensureLearningPolicy, loadPolicy } from "../policies/registry";
import { readLearningSnapshot } from "./learning-snapshot";
import { payloadToItem } from "./item-payload";
import { readKidRewardSnapshot } from "./reward-activity";
import { hasDailyRoundForDate } from "./daily-round";

/**
 * Widoki startowe Kid Mode (arch §12): profile dzieci (tylko nazwa i awatar)
 * oraz opublikowane zestawy przypisane dziecku. Model zaufany — bez autoryzacji
 * dziecka (arch §13); wybór profilu nie jest zabezpieczeniem instancji.
 */
export async function listKidProfiles(services: Services): Promise<KidProfileDto[]> {
  const rows = await services.db
    .select({ childId: childProfiles.id, displayName: childProfiles.displayName, avatarKey: childProfiles.avatarKey, recordingMode: childProfiles.recordingMode, canRead: childProfiles.canRead })
    .from(childProfiles)
    .orderBy(asc(childProfiles.createdAt));
  return Promise.all(rows.map(async (row) => {
    const rewards = await readKidRewardSnapshot(services, row.childId);
    return { ...row, rewards: {
      earnedPoints: rewards.earnedPoints,
      pointsToUse: rewards.pointsToUse,
      readyXboxPacks: rewards.readyXboxPacks,
      todayCreditedSeconds: rewards.todayCreditedSeconds,
      dailyGoalSeconds: 1800 as const,
      xboxRequest: rewards.xboxRequest,
    } };
  }));
}

export async function listKidDecks(services: Services, childId: string, options: { microphoneEnabled?: boolean } = {}): Promise<KidDeckDto[]> {
  const child = (
    await services.db.select({ id: childProfiles.id, policyId: childProfiles.policyId, canRead: childProfiles.canRead }).from(childProfiles).where(eq(childProfiles.id, childId))
  )[0];
  if (!child) {
    throw new AppError("not_found");
  }
  const rewards = await readKidRewardSnapshot(services, childId);
  const microphoneEnabled = options.microphoneEnabled ?? true;
  const [active] = await services.db.select().from(learningSessions).where(and(eq(learningSessions.childId, childId), eq(learningSessions.state, "active")));
  const [activeVersion] = active
    ? await services.db.select({ vocabularyFormat: deckVersions.vocabularyFormat, deckKind: decks.kind, coverAssetId: decks.coverAssetId })
        .from(deckVersions).innerJoin(decks, eq(deckVersions.deckId, decks.id)).where(eq(deckVersions.id, active.deckVersionId))
    : [];
  const rows = await services.db
    .select({ deckId: decks.id, title: decks.title, kind: decks.kind, coverAssetId: decks.coverAssetId, vocabularyFormat: deckVersions.vocabularyFormat, testDate: assignments.testDate, testGoals: assignments.testGoals, mockTestTaskCount: assignments.mockTestTaskCount, versionId: decks.publishedVersionId, lessonContext: deckVersions.lessonContext })
    .from(assignments)
    .innerJoin(decks, eq(decks.id, assignments.deckId))
    .innerJoin(deckVersions, eq(deckVersions.id, decks.publishedVersionId))
    .where(
      and(
        eq(assignments.childId, childId),
        eq(assignments.active, true),
        isNotNull(decks.publishedVersionId),
      ),
    )
    .orderBy(asc(decks.createdAt));
  const dailyRounds = new Map<string, boolean>();
  const nowForRound = services.clock.now();
  for (const row of rows) {
    const available = await services.db.transaction(async (tx) => {
      const pool = await readEligibleDailyRoundPool(services, tx, childId, row.deckId, nowForRound);
      return pool !== null && !(await hasDailyRoundForDate(tx, childId, pool.date));
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
    dailyRounds.set(row.deckId, available);
  }
  const coverVersionIds = [...new Set([...rows.map((row) => row.versionId).filter((id): id is string => id !== null), ...(active ? [active.deckVersionId] : [])])];
  const coverRevisions = coverVersionIds.length ? await services.db.select({ id: itemRevisions.id, deckVersionId: itemRevisions.deckVersionId, position: itemRevisions.position, payload: itemRevisions.payload })
    .from(itemRevisions).where(inArray(itemRevisions.deckVersionId, coverVersionIds)).orderBy(asc(itemRevisions.position)) : [];
  const illustrationRows = coverRevisions.length ? await services.db.select({ itemRevisionId: revisionAssets.itemRevisionId, assetId: revisionAssets.assetId })
    .from(revisionAssets).where(and(inArray(revisionAssets.itemRevisionId, coverRevisions.map((revision) => revision.id)), eq(revisionAssets.role, "illustration"), eq(revisionAssets.state, "approved"))) : [];
  const illustrationByRevision = new Map(illustrationRows.map((row) => [row.itemRevisionId, row.assetId]));
  const coverVisualByVersion = new Map<string, KidDeckDto["coverVisual"]>();
  const coverRevisionCountByVersion = new Map<string, number>();
  for (const revision of coverRevisions) {
    coverRevisionCountByVersion.set(revision.deckVersionId, (coverRevisionCountByVersion.get(revision.deckVersionId) ?? 0) + 1);
    if (coverVisualByVersion.has(revision.deckVersionId)) continue;
    const item = payloadToItem(revision.payload as Record<string, unknown>);
    const visual = item.visualType === "image"
      ? (illustrationByRevision.get(revision.id) ? { kind: "image" as const, imageAssetId: illustrationByRevision.get(revision.id)! } : null)
      : item.visualType === "color"
        ? { kind: "color" as const, color: item.visualData?.color }
        : item.visualType === "number"
          ? { kind: "number" as const, count: item.visualData?.count }
          : null;
    const parsed = MeaningVisualSchema.safeParse(visual);
    coverVisualByVersion.set(revision.deckVersionId, parsed.success ? parsed.data : null);
  }
  const visibleRows = child.canRead
    ? rows
    : rows.filter((row) => row.kind === "vocabulary" && row.vocabularyFormat === "picture" || active?.deckId === row.deckId);

  // Izolacja lekcji (zadanie 9): rekomendacja i liczniki słówek liczą się TYLKO
  // dla zestawów słówek. Lekcje dostają wartości bezpieczne i tytuł przedmiotu
  // z wstrzykniętego rejestru; prawdziwe liczniki/rekomendację lekcji doda
  // zadanie 13/17. Jedna gałąź po rodzaju zestawu w tym module.
  const vocabRows = visibleRows.filter((row) => row.kind === "vocabulary");

  // Rekomendacja (arch §9.3, §12): czy w wersji jest teraz zaplanowana praca
  // dla tego dziecka? Elementy bez postępu to nowy materiał; rozpoczęte
  // sprawdzamy pod kątem należnych terminów. Utrwalanie dodatkowe jest
  // dostępne zawsze i nie czyni zestawu rekomendowanym.
  const versionIds = [...new Set([
    ...vocabRows.map((row) => row.versionId!),
    ...(active && activeVersion?.deckKind === "vocabulary" ? [active.deckVersionId] : []),
  ])];
  const revisions = versionIds.length
    ? await services.db
        .select({ revisionId: itemRevisions.id, versionId: itemRevisions.deckVersionId })
        .from(itemRevisions)
        .where(inArray(itemRevisions.deckVersionId, versionIds))
    : [];
  const progressRows = revisions.length
    ? await services.db
    .select({
      revisionId: itemRevisionSkills.itemRevisionId,
      skill: itemRevisionSkills.skill,
      status: childSkillProgress.status,
      nextReviewAt: childSkillProgress.nextReviewAt,
      streak: childSkillProgress.independentSuccessStreak,
    })
    .from(itemRevisionSkills)
    .innerJoin(
      childSkillProgress,
      and(
        eq(childSkillProgress.skillVersionId, itemRevisionSkills.skillVersionId),
        eq(childSkillProgress.childId, childId),
      ),
    )
    .where(
      inArray(
        itemRevisionSkills.itemRevisionId,
        revisions.map((r) => r.revisionId),
      ),
    )
    : [];

  const progressByRevision = new Map<string, Array<SkillSnapshot & { skill: Skill }>>();
  for (const row of progressRows) {
    const list = progressByRevision.get(row.revisionId) ?? [];
    list.push({
      skill: row.skill as Skill,
      status: mapStatus(row.status),
      nextReviewAt: row.nextReviewAt?.toISOString() ?? null,
      streak: row.streak ?? 0,
    });
    progressByRevision.set(row.revisionId, list);
  }
  const now = services.clock.now().toISOString();
  await ensureLearningPolicy(services.db);
  const policy = await loadPolicy(services.db, child.policyId ?? CURRENT_POLICY_ID);
  const snapshots = await readLearningSnapshot(services.db, {
    childId,
    revisionIds: revisions.map((revision) => revision.revisionId),
    policy,
    now,
  });
  const snapshotByRevision = new Map(snapshots.map((snapshot) => [snapshot.itemRevisionId, snapshot]));
  for (const snapshot of snapshots) {
    const reconstructed = progressByRevision.get(snapshot.itemRevisionId) ?? [];
    for (const [skill, progress] of Object.entries(snapshot.progress) as [Skill, SkillSnapshot][]) {
      const current = reconstructed.find((row) => row.skill === skill);
      if (current) {
        current.status = progress.status;
        current.nextReviewAt = progress.nextReviewAt;
        current.streak = progress.streak;
      } else {
        reconstructed.push({ skill, ...progress });
      }
    }
    progressByRevision.set(snapshot.itemRevisionId, reconstructed);
  }
  const independentlyRecalledRevisions = new Set<string>();
  for (const [revisionId, skillSnapshots] of progressByRevision.entries()) {
    const isMastered = child.canRead
      ? skillSnapshots.some((s) => s.skill === "recall" && s.status === "mastered")
      : skillSnapshots.some((s) => (s.skill === "listening" || s.skill === "recall") && s.status === "mastered");
    if (isMastered) {
      independentlyRecalledRevisions.add(revisionId);
    }
  }
  const itemsByVersion = new Map<string, DeckWorkloadItem[]>();
  for (const revision of revisions) {
    const list = itemsByVersion.get(revision.versionId) ?? [];
    const learning = snapshotByRevision.get(revision.revisionId);
    const scheduledChecks = [learning?.work.recall?.eligibleAt, learning?.work.spelling?.eligibleAt]
      .filter((value): value is string => value !== null && value !== undefined)
      .sort();
    const recognitionStreak = (progressByRevision.get(revision.revisionId) ?? [])
      .filter((snapshot) => snapshot.skill === "listening" || (child.canRead && snapshot.skill === "reading"))
      .reduce((best, snapshot) => Math.max(best, snapshot.streak), 0);
    list.push({
      progress: progressByRevision.get(revision.revisionId) ?? [],
      pendingCheckAt: scheduledChecks[0] ?? null,
      pendingChecks: (["recall", "spelling"] as const).flatMap((skill) => learning?.work[skill]?.eligibleAt
        ? [{ skill, dueAt: learning.work[skill]!.eligibleAt }]
        : []),
      recallIntroductionNeeded: recognitionStreak >= 1 && !learning?.introducedSkills.recall,
    });
    itemsByVersion.set(revision.versionId, list);
  }
  const itemCountByVersion = new Map<string, number>();
  const recalledCountByVersion = new Map<string, number>();
  for (const revision of revisions) {
    itemCountByVersion.set(revision.versionId, (itemCountByVersion.get(revision.versionId) ?? 0) + 1);
    if (independentlyRecalledRevisions.has(revision.revisionId)) {
      recalledCountByVersion.set(
        revision.versionId,
        (recalledCountByVersion.get(revision.versionId) ?? 0) + 1,
      );
    }
  }
  // Lekcje (zadanie 13): prawdziwe liczniki i rekomendacja z silnika lekcji
  // (cele, opanowane cele, czy selektor ma pracę). Jedno wywołanie per lekcja.
  const lessonRows = visibleRows.filter((row) => row.kind === "lesson");
  const familyTimezone = lessonRows.length
    ? ((await services.db.select({ timezone: familySettings.timezone }).from(familySettings).limit(1))[0]?.timezone ?? "Europe/Warsaw")
    : "Europe/Warsaw";
  const lessonValues = new Map<string, { itemCount: number; independentlyRecalledCount: number; recommended: boolean }>();
  const lessonMockAvailable = new Map<string, boolean>();
  for (const row of lessonRows) {
    lessonValues.set(
      row.deckId,
      await lessonDeckListValues(services, services.db, {
        childId,
        deckVersionId: row.versionId!,
        testDate: row.testDate,
        timezone: familyTimezone,
        now: services.clock.now(),
      }),
    );
    // Kartkówka lekcji (scope 6): cel `lesson` ustawiony ORAZ istnieje bezpieczna
    // porcja (dry-run planera bez utrwalania). Przy mockTestTaskCount z przypisania.
    let available = false;
    if (row.testGoals?.includes("lesson")) {
      available = await services.db.transaction((tx) =>
        hasSafeLessonMockPortion(tx, services, {
          childId,
          deckVersionId: row.versionId!,
          requestedTaskCount: row.mockTestTaskCount ?? 10,
        }),
      );
    }
    lessonMockAvailable.set(row.deckId, available);
  }
  // Zachowujemy kolejność po createdAt (rows), rozgałęziając per rodzaj zestawu.
  const result = visibleRows.map((row): KidDeckDto => {
    const isActive = active?.deckId === row.deckId;
    const versionId = isActive ? active.deckVersionId : row.versionId!;
    const vocabularyFormat = isActive ? activeVersion?.vocabularyFormat ?? row.vocabularyFormat : row.vocabularyFormat;
    const activeSession = isActive ? { sessionId: active.id, mode: active.mode } : null;
    if (row.kind === "lesson") {
      // Tytuł przedmiotu z wstrzykniętego rejestru (NIE import globalny); liczniki
      // lekcji z silnika lekcji (zadanie 13).
      const subjectId = (row.lessonContext as { subjectId?: string } | null)?.subjectId;
      const subjectTitle = (subjectId ? services.subjects.getSubject(subjectId)?.titlePl : undefined) ?? null;
      const values = lessonValues.get(row.deckId) ?? { itemCount: 0, independentlyRecalledCount: 0, recommended: false };
      return {
        kind: "lesson",
        vocabularyFormat,
        coverAssetId: null,
        coverVisual: coverVisualByVersion.get(versionId) ?? null,
        resumeOnly: isActive && (active?.mode === "daily_round" || !child.canRead),
        subjectTitle,
        mockTestAvailable: child.canRead && (lessonMockAvailable.get(row.deckId) ?? false),
        dailyRoundAvailable: dailyRounds.get(row.deckId) ?? false,
        earnedPoints: rewards.pointsByDeck.get(row.deckId) ?? 0,
        activeSession,
        deckId: row.deckId,
        title: row.title,
        itemCount: values.itemCount,
        independentlyRecalledCount: values.independentlyRecalledCount,
        testDate: row.testDate,
        // Lekcje mają własne tekstowe ćwiczenia i nie wymagają mikrofonu.
        recommended: isActive ? false : values.recommended,
      };
    }
    return {
      kind: "vocabulary",
      vocabularyFormat,
      coverAssetId: isActive ? activeVersion?.coverAssetId ?? row.coverAssetId : row.coverAssetId,
      coverVisual: coverVisualByVersion.get(versionId) ?? null,
      resumeOnly: isActive && (active?.mode === "daily_round" || !child.canRead),
      subjectTitle: null,
      mockTestAvailable: child.canRead && !!row.testGoals?.length,
      dailyRoundAvailable: dailyRounds.get(row.deckId) ?? false,
      earnedPoints: rewards.pointsByDeck.get(row.deckId) ?? 0,
      activeSession,
      deckId: row.deckId,
      title: row.title,
      itemCount: isActive ? coverRevisionCountByVersion.get(versionId) ?? 0 : itemCountByVersion.get(versionId) ?? 0,
      independentlyRecalledCount: recalledCountByVersion.get(versionId) ?? 0,
      testDate: row.testDate,
      recommended: !isActive && hasScheduledWork(itemsByVersion.get(row.versionId!) ?? [], now, {
        canRead: child.canRead, microphoneEnabled, vocabularyFormat,
      }),
    };
  });
  if (active && !result.some((deck) => deck.deckId === active.deckId)) {
    const [resumable] = await services.db.select({ title: decks.title, kind: decks.kind, coverAssetId: decks.coverAssetId }).from(decks).where(eq(decks.id, active.deckId));
    const [pinnedVersion] = await services.db.select({ vocabularyFormat: deckVersions.vocabularyFormat }).from(deckVersions).where(eq(deckVersions.id, active.deckVersionId));
    if (resumable && pinnedVersion) {
      const count = await services.db.select({ id: itemRevisions.id }).from(itemRevisions).where(eq(itemRevisions.deckVersionId, active.deckVersionId));
      result.unshift({
        deckId: active.deckId, title: resumable.title, kind: resumable.kind as "vocabulary" | "lesson",
        vocabularyFormat: pinnedVersion.vocabularyFormat, coverAssetId: resumable.coverAssetId, coverVisual: coverVisualByVersion.get(active.deckVersionId) ?? null,
        resumeOnly: true, activeSession: { sessionId: active.id, mode: active.mode }, mockTestAvailable: false,
        dailyRoundAvailable: false,
        earnedPoints: rewards.pointsByDeck.get(active.deckId) ?? 0,
        itemCount: count.length, independentlyRecalledCount: recalledCountByVersion.get(active.deckVersionId) ?? 0, testDate: null, recommended: false,
        ...(resumable.kind === "lesson" ? { subjectTitle: null } : {}),
      });
    }
  }
  return result;
}
