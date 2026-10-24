import {
  AppError,
  MAX_DECK_COVER_BYTES,
  acceptVerdictAsVariant,
  archiveDeck,
  clearDeckCover,
  createChild,
  createDraftFromPublished,
  createEmptyDeck,
  createLesson,
  createLessonDraftFromPublished,
  decideLessonVerdict,
  deckIdOfLessonVersion,
  deleteChild,
  editDraft,
  editLessonDraft,
  enqueueDeckGeneration,
  generateDeckCover,
  getLessonMockTestReport,
  getMockTestReport,
  getProgress,
  getPronunciationSettings,
  lessonCatalog,
  lessonObjectiveProgress,
  listChildren,
  listDecks,
  listLessonMockTests,
  listLessonVerdicts,
  listMockTests,
  mockTestKindOfSession,
  omitRevisionAsset,
  publishDraft,
  publishLessonDraft,
  readDeck,
  readDeckKind,
  readDraft,
  readGeneration,
  readLessonDeck,
  readParentWorkCard,
  regenerateObjective,
  regenerateRevisionAsset,
  removeAssignment,
  retryGeneration,
  setDeckCover,
  updateChild,
  updateDeckSettings,
  updatePronunciationBands,
  upsertAssignment,
} from "@learning/server";
import { implement, type Router } from "@orpc/server";
import { parentApiContract } from "../parent/orpc-contract";
import { appErrorMiddleware, parentSessionMiddleware, sameOriginMiddleware, type ORpcContext } from "./base";
import { assertDeclaredBodyCap } from "./request-limits";

/**
 * Router oRPC Parent API montowany z priorytetem w catch-all
 * `/api/v1/parent/[...path]` (wzorzec strangler, migracja oRPC v2). Ten plik
 * implementuje cały kontrakt (`parentApiContract`): profile dzieci, zestawy
 * (decks, w tym okładka ze streamingiem 5 MB), szkice wersji (drafts),
 * kartkówki (mock-tests z dispatchem lekcja/słówka), kartę pracy, lekcje
 * (lessons, lesson-catalog, lesson-verdicts, lesson-drafts), generację
 * (generation), przypisania (assignments) i postępy (progress). Ścieżki spoza
 * kontraktu (`matched === false`) spadają do legacy `handleParentApi` —
 * resztka routera (autoryzacja logowania migruje w zadaniu 12, demontaż
 * fallbacku w 13).
 *
 * Autoryzacja: każda procedura wymaga sesji rodzica (`parentSessionMiddleware`
 * na implementerze — działa przed walidacją inputu, jak w legacy), mutacje
 * dodatkowo kontrolują Origin/CSRF (`sameOriginMiddleware` na procedurze).
 */

/** Dopuszczalne typy MIME wgrywanego obrazu okładki (1:1 z legacy). */
const COVER_MIME_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/webp"]);

const parentOs = implement({
  children: parentApiContract.children,
  decks: parentApiContract.decks,
  drafts: parentApiContract.drafts,
  mockTests: parentApiContract.mockTests,
  workCard: parentApiContract.workCard,
  lessonCatalog: parentApiContract.lessonCatalog,
  lessons: parentApiContract.lessons,
  lessonVerdicts: parentApiContract.lessonVerdicts,
  lessonDrafts: parentApiContract.lessonDrafts,
  generation: parentApiContract.generation,
  assignments: parentApiContract.assignments,
  progress: parentApiContract.progress,
})
  .$context<ORpcContext>()
  .use(appErrorMiddleware)
  .use(parentSessionMiddleware);

/** Odpowiedź 200 z `Cache-Control: no-store` (wzorzec kid-router). */
function noStore<T>(body: T): { headers: { "cache-control": "no-store" }; body: T } {
  return { headers: { "cache-control": "no-store" }, body };
}

/**
 * Czyta strumień obrazu z limitem 5 MB — dokładny port czytnika z legacy
 * `parent/parent-router.ts`: sumowanie chunków, anulowanie readera przy
 * przekroczeniu limitu (nadmiarowe bajty nie trafiają do `setDeckCover`) i
 * sklejanie do jednego `Uint8Array`. Pre-check `content-length` odrzuca
 * nadmiarowe żądanie zanim cokolwiek przeczytamy (klienci z buforem zawsze
 * wysyłają ten nagłówek; strumieniowe ciało pilnuje czytnik).
 */
async function readCappedCoverBytes(body: ReadableStream): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_DECK_COVER_BYTES) {
      await reader.cancel();
      throw new AppError("validation", { message: "Obraz musi mieć maksymalnie 5 MB." });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

const childrenList = parentOs.children.list.handler(async ({ context }) =>
  listChildren(context.services),
);

const childrenCreate = parentOs.children.create
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) => createChild(context.services, input));

const childrenUpdate = parentOs.children.update
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) => {
    const { childId, ...patch } = input;
    return updateChild(context.services, childId, patch);
  });

const childrenRemove = parentOs.children.remove
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) => deleteChild(context.services, input.childId));

const pronunciationGet = parentOs.children.getPronunciation.handler(async ({ context, input }) =>
  getPronunciationSettings(context.services, input.childId),
);

const pronunciationPut = parentOs.children.putPronunciation
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) => {
    const { childId, ...bands } = input;
    await updatePronunciationBands(context.services, childId, bands);
  });

const decksList = parentOs.decks.list.handler(async ({ context }) =>
  listDecks(context.services),
);

const decksGenerate = parentOs.decks.generate
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) => {
    const result = await enqueueDeckGeneration(context.services, input);
    return { generationRunId: result.runId, deckId: result.deckId };
  });

const decksCreate = parentOs.decks.create
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) => {
    const result = await createEmptyDeck(context.services, input);
    // Dynamiczny status sukcesu: 201 przy realnym utworzeniu, 200 gdy
    // ponowienie tego samego deckId bezpiecznie dołączyło do szkicu.
    return { status: result.created ? 201 as const : 200 as const, body: { deckId: result.deckId } };
  });

const decksGet = parentOs.decks.get.handler(async ({ context, input }) =>
  readDeck(context.services, input.deckId),
);

const decksUpdateSettings = parentOs.decks.updateSettings
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) => {
    const { deckId, ...settings } = input;
    return updateDeckSettings(context.services, deckId, settings);
  });

/**
 * Upload okładki: surowy strumień obrazu z detailed input (spike v2:
 * requestBodyHint octet-stream + z.instanceof(ReadableStream) — kodek nie
 * buforuje ciała). Kolejność jak w legacy: MIME → pre-check content-length →
 * ograniczony odczyt → `setDeckCover`. Brama Blob (poza HTTP, wywołania
 * bezpośrednie) buforuje z góry — limit i tak obowiązuje.
 */
const decksSetCover = parentOs.decks.setCover
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) => {
    const mimeType = context.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!COVER_MIME_TYPES.has(mimeType)) {
      throw new AppError("validation", { message: "Wybierz obraz PNG, JPEG lub WebP." });
    }
    assertDeclaredBodyCap(context.headers, MAX_DECK_COVER_BYTES, "cover image exceeds 5 MB");
    const bytes = input.body instanceof ReadableStream
      ? await readCappedCoverBytes(input.body)
      : await cappedCoverBytesFromBlob(input.body);
    const coverAssetId = await setDeckCover(context.services, input.params.deckId, {
      bytes,
      declaredMimeType: mimeType,
    });
    return { coverAssetId };
  });

/** Zapasowa ścieżka Blob (bez HTTP): sprawdzamy rozmiar przed buforem. */
async function cappedCoverBytesFromBlob(blob: Blob): Promise<Uint8Array> {
  if (blob.size > MAX_DECK_COVER_BYTES) {
    throw new AppError("validation", { message: "Obraz musi mieć maksymalnie 5 MB." });
  }
  return new Uint8Array(await blob.arrayBuffer());
}

const decksClearCover = parentOs.decks.clearCover
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) => {
    await clearDeckCover(context.services, input.deckId);
  });

/**
 * Propozycja okładki: binarna odpowiedź z Content-Type obrazu i no-store.
 * Bajty idą jako Blob (serializator OpenAPI przepuszcza je na wire bez
 * JSON-owania); mapowanie błędów 1:1 z legacy — not_found/conflict przechodzą,
 * awaria providera staje się internal bez treści technicznej.
 */
const decksGenerateCover = parentOs.decks.generateCover
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) => {
    try {
      const result = await generateDeckCover(context.services, input.deckId);
      return {
        headers: { "content-type": result.mimeType, "cache-control": "no-store" },
        body: new Blob([new Uint8Array(result.bytes)]),
      };
    } catch (error) {
      if (error instanceof AppError && ["not_found", "conflict"].includes(error.code)) throw error;
      throw new AppError("internal", { message: "Nie udało się wygenerować okładki. Spróbuj ponownie lub wgraj własny obraz." });
    }
  });

const decksCreateDraft = parentOs.decks.createDraft
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) => createDraftFromPublished(context.services, input.deckId));

const decksArchive = parentOs.decks.archive
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) => {
    await archiveDeck(context.services, input.deckId);
  });

const draftsGet = parentOs.drafts.get.handler(async ({ context, input }) =>
  readDraft(context.services, input.draftId),
);

const draftsEdit = parentOs.drafts.edit
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) => {
    const { draftId, ...patch } = input;
    return editDraft(context.services, draftId, patch);
  });

const draftsPublish = parentOs.drafts.publish
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) =>
    publishDraft(context.services, input.draftId, input.expectedEditNumber),
  );

const draftsRegenerateAsset = parentOs.drafts.regenerateAsset
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) => {
    const { draftId, ...command } = input;
    return regenerateRevisionAsset(context.services, { draftId, ...command });
  });

const draftsOmitAsset = parentOs.drafts.omitAsset
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) => {
    await omitRevisionAsset(context.services, input);
  });

/** Lista kartkówek: dispatch po rodzaju zestawu (lekcja vs słówka). */
const mockTestsList = parentOs.mockTests.list.handler(async ({ context, input }) => {
  const kind = await readDeckKind(context.services.db, input.deckId);
  const list = kind === "lesson"
    ? await listLessonMockTests(context.services, input.childId, input.deckId)
    : await listMockTests(context.services, input.childId, input.deckId);
  return noStore(list);
});

/** Raport jednej kartkówki: dispatch po rodzaju sesji (lekcja vs słówka). */
const mockTestsGet = parentOs.mockTests.get.handler(async ({ context, input }) => {
  const kind = await mockTestKindOfSession(context.services.db, input.sessionId);
  const report = kind === "lesson"
    ? await getLessonMockTestReport(context.services, input.sessionId)
    : await getMockTestReport(context.services, input.sessionId);
  return noStore(report);
});

const workCardGet = parentOs.workCard.get.handler(async ({ context, input }) =>
  noStore(await readParentWorkCard(context.services, input)),
);

const lessonCatalogGet = parentOs.lessonCatalog.get.handler(async ({ context }) =>
  lessonCatalog(context.services),
);

const lessonsCreate = parentOs.lessons.create
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) => createLesson(context.services, input));

const lessonsGet = parentOs.lessons.get.handler(async ({ context, input }) =>
  readLessonDeck(context.services, input.deckId),
);

const lessonsProgress = parentOs.lessons.progress.handler(async ({ context, input }) =>
  noStore(await lessonObjectiveProgress(context.services, input.deckId, input.childId)),
);

const lessonsVerdicts = parentOs.lessons.verdicts.handler(async ({ context, input }) =>
  noStore(await listLessonVerdicts(context.services, input.deckId)),
);

const lessonsDraft = parentOs.lessons.draft
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) => createLessonDraftFromPublished(context.services, input.deckId));

const lessonVerdictsDecision = parentOs.lessonVerdicts.decision
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) =>
    decideLessonVerdict(context.services, input.verdictId, input.decision),
  );

const lessonVerdictsAcceptAsVariant = parentOs.lessonVerdicts.acceptAsVariant
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) => acceptVerdictAsVariant(context.services, input.verdictId));

const lessonDraftsEdit = parentOs.lessonDrafts.edit
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) => {
    const { lessonDraftId, ...patch } = input;
    return editLessonDraft(context.services, lessonDraftId, patch);
  });

const lessonDraftsPublish = parentOs.lessonDrafts.publish
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) =>
    publishLessonDraft(context.services, input.lessonDraftId, input.expectedEditNumber),
  );

const lessonDraftsRegenerate = parentOs.lessonDrafts.regenerate
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) => {
    const { lessonDraftId, ...command } = input;
    // regenerateObjective bierze deckId, nie versionId — wyznaczamy go z wersji.
    const deckId = await deckIdOfLessonVersion(context.services, lessonDraftId);
    const result = await regenerateObjective(context.services, { deckId, ...command });
    return { generationRunId: result.runId, deckId: result.deckId };
  });

const generationGet = parentOs.generation.get.handler(async ({ context, input }) =>
  readGeneration(context.services, input.runId),
);

const generationRetry = parentOs.generation.retry
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) => retryGeneration(context.services, input.runId));

const assignmentsPut = parentOs.assignments.put
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) => {
    const { childId, deckId, testDate, ...options } = input;
    await upsertAssignment(context.services, childId, deckId, testDate, options);
  });

const assignmentsRemove = parentOs.assignments.remove
  .use(sameOriginMiddleware)
  .handler(async ({ context, input }) => {
    await removeAssignment(context.services, input.childId, input.deckId);
  });

const progressGet = parentOs.progress.get.handler(async ({ context, input }) =>
  getProgress(context.services, input.childId, input.deckId),
);

export const parentORpcRouter: Router<ORpcContext> = parentOs.router({
  children: {
    list: childrenList,
    create: childrenCreate,
    update: childrenUpdate,
    remove: childrenRemove,
    getPronunciation: pronunciationGet,
    putPronunciation: pronunciationPut,
  },
  decks: {
    list: decksList,
    generate: decksGenerate,
    create: decksCreate,
    get: decksGet,
    updateSettings: decksUpdateSettings,
    setCover: decksSetCover,
    clearCover: decksClearCover,
    generateCover: decksGenerateCover,
    createDraft: decksCreateDraft,
    archive: decksArchive,
  },
  drafts: {
    get: draftsGet,
    edit: draftsEdit,
    publish: draftsPublish,
    regenerateAsset: draftsRegenerateAsset,
    omitAsset: draftsOmitAsset,
  },
  mockTests: {
    list: mockTestsList,
    get: mockTestsGet,
  },
  workCard: {
    get: workCardGet,
  },
  lessonCatalog: {
    get: lessonCatalogGet,
  },
  lessons: {
    create: lessonsCreate,
    get: lessonsGet,
    progress: lessonsProgress,
    verdicts: lessonsVerdicts,
    draft: lessonsDraft,
  },
  lessonVerdicts: {
    decision: lessonVerdictsDecision,
    acceptAsVariant: lessonVerdictsAcceptAsVariant,
  },
  lessonDrafts: {
    edit: lessonDraftsEdit,
    publish: lessonDraftsPublish,
    regenerate: lessonDraftsRegenerate,
  },
  generation: {
    get: generationGet,
    retry: generationRetry,
  },
  assignments: {
    put: assignmentsPut,
    remove: assignmentsRemove,
  },
  progress: {
    get: progressGet,
  },
});
