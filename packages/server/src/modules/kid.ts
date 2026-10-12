import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import type { KidDeckDto, KidProfileDto } from "@learning/contracts";
import type { Services } from "../config";
import { hasScheduledWork, type DeckWorkloadItem, type SkillSnapshot } from "../domain/scheduler";
import type { Skill } from "../domain/types";
import { assignments, childProfiles, childSkillProgress, deckVersions, decks, familySettings, itemRevisionSkills, itemRevisions, learningSessions } from "../db/schema";
import { AppError } from "../errors";
import { mapStatus } from "./sessions";
import { lessonDeckListValues } from "./lessons/lesson-sessions";
import { hasSafeLessonMockPortion } from "./lessons/lesson-mock-tests";
import { CURRENT_POLICY_ID, ensureLearningPolicy, loadPolicy } from "../policies/registry";
import { readLearningSnapshot } from "./learning-snapshot";

/**
 * Widoki startowe Kid Mode (arch §12): profile dzieci (tylko nazwa i awatar)
 * oraz opublikowane zestawy przypisane dziecku. Model zaufany — bez autoryzacji
 * dziecka (arch §13); wybór profilu nie jest zabezpieczeniem instancji.
 */
export async function listKidProfiles(services: Services): Promise<KidProfileDto[]> {
  const rows = await services.db
    .select({ childId: childProfiles.id, displayName: childProfiles.displayName, avatarKey: childProfiles.avatarKey, recordingMode: childProfiles.recordingMode })
    .from(childProfiles)
    .orderBy(asc(childProfiles.createdAt));
  return rows;
}

export async function listKidDecks(services: Services, childId: string): Promise<KidDeckDto[]> {
  const child = (
    await services.db.select({ id: childProfiles.id, policyId: childProfiles.policyId }).from(childProfiles).where(eq(childProfiles.id, childId))
  )[0];
  if (!child) {
    throw new AppError("not_found");
  }
  const rows = await services.db
    .select({ deckId: decks.id, title: decks.title, kind: decks.kind, testDate: assignments.testDate, testGoals: assignments.testGoals, mockTestTaskCount: assignments.mockTestTaskCount, versionId: decks.publishedVersionId, lessonContext: deckVersions.lessonContext })
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
  if (rows.length === 0) {
    return [];
  }

  // Izolacja lekcji (zadanie 9): rekomendacja i liczniki słówek liczą się TYLKO
  // dla zestawów słówek. Lekcje dostają wartości bezpieczne i tytuł przedmiotu
  // z wstrzykniętego rejestru; prawdziwe liczniki/rekomendację lekcji doda
  // zadanie 13/17. Jedna gałąź po rodzaju zestawu w tym module.
  const vocabRows = rows.filter((row) => row.kind === "vocabulary");

  // Rekomendacja (arch §9.3, §12): czy w wersji jest teraz zaplanowana praca
  // dla tego dziecka? Elementy bez postępu to nowy materiał; rozpoczęte
  // sprawdzamy pod kątem należnych terminów. Utrwalanie dodatkowe jest
  // dostępne zawsze i nie czyni zestawu rekomendowanym.
  const versionIds = vocabRows.map((row) => row.versionId!);
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
  const independentlyRecalledRevisions = new Set<string>();
  for (const row of progressRows) {
    const list = progressByRevision.get(row.revisionId) ?? [];
    list.push({
      skill: row.skill as Skill,
      status: mapStatus(row.status),
      nextReviewAt: row.nextReviewAt?.toISOString() ?? null,
      streak: row.streak ?? 0,
    });
    progressByRevision.set(row.revisionId, list);
    if (row.skill === "recall" && row.status === "mastered") {
      independentlyRecalledRevisions.add(row.revisionId);
    }
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
  const itemsByVersion = new Map<string, DeckWorkloadItem[]>();
  for (const revision of revisions) {
    const list = itemsByVersion.get(revision.versionId) ?? [];
    const learning = snapshotByRevision.get(revision.revisionId);
    const scheduledChecks = [learning?.work.recall?.eligibleAt, learning?.work.spelling?.eligibleAt]
      .filter((value): value is string => value !== null && value !== undefined)
      .sort();
    const recognitionStreak = (progressByRevision.get(revision.revisionId) ?? [])
      .filter((snapshot) => snapshot.skill === "listening" || snapshot.skill === "reading")
      .reduce((best, snapshot) => Math.max(best, snapshot.streak), 0);
    list.push({
      progress: progressByRevision.get(revision.revisionId) ?? [],
      pendingCheckAt: scheduledChecks[0] ?? null,
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
  const [active] = await services.db.select().from(learningSessions).where(and(eq(learningSessions.childId, childId), eq(learningSessions.state, "active")));
  // Lekcje (zadanie 13): prawdziwe liczniki i rekomendacja z silnika lekcji
  // (cele, opanowane cele, czy selektor ma pracę). Jedno wywołanie per lekcja.
  const lessonRows = rows.filter((row) => row.kind === "lesson");
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
  return rows.map((row): KidDeckDto => {
    const activeSession = active?.deckId === row.deckId ? { sessionId: active.id, mode: active.mode } : null;
    if (row.kind === "lesson") {
      // Tytuł przedmiotu z wstrzykniętego rejestru (NIE import globalny); liczniki
      // lekcji z silnika lekcji (zadanie 13).
      const subjectId = (row.lessonContext as { subjectId?: string } | null)?.subjectId;
      const subjectTitle = (subjectId ? services.subjects.getSubject(subjectId)?.titlePl : undefined) ?? null;
      const values = lessonValues.get(row.deckId) ?? { itemCount: 0, independentlyRecalledCount: 0, recommended: false };
      return {
        kind: "lesson",
        subjectTitle,
        mockTestAvailable: lessonMockAvailable.get(row.deckId) ?? false,
        activeSession,
        deckId: row.deckId,
        title: row.title,
        itemCount: values.itemCount,
        independentlyRecalledCount: values.independentlyRecalledCount,
        testDate: row.testDate,
        recommended: values.recommended,
      };
    }
    return {
      kind: "vocabulary",
      subjectTitle: null,
      mockTestAvailable: !!row.testGoals?.length,
      activeSession,
      deckId: row.deckId,
      title: row.title,
      itemCount: itemCountByVersion.get(row.versionId!) ?? 0,
      independentlyRecalledCount: recalledCountByVersion.get(row.versionId!) ?? 0,
      testDate: row.testDate,
      recommended: hasScheduledWork(itemsByVersion.get(row.versionId!) ?? [], now),
    };
  });
}
