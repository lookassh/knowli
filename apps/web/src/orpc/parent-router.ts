import {
  AppError,
  MAX_DECK_COVER_BYTES,
  archiveDeck,
  clearDeckCover,
  createChild,
  createDraftFromPublished,
  createEmptyDeck,
  deleteChild,
  editDraft,
  enqueueDeckGeneration,
  generateDeckCover,
  getPronunciationSettings,
  listChildren,
  listDecks,
  omitRevisionAsset,
  publishDraft,
  readDeck,
  readDraft,
  regenerateRevisionAsset,
  setDeckCover,
  updateChild,
  updateDeckSettings,
  updatePronunciationBands,
} from "@learning/server";
import { implement, type Router } from "@orpc/server";
import { parentApiContract } from "../parent/orpc-contract";
import { appErrorMiddleware, parentSessionMiddleware, sameOriginMiddleware, type ORpcContext } from "./base";
import { assertDeclaredBodyCap } from "./request-limits";

/**
 * Router oRPC Parent API montowany z priorytetem w catch-all
 * `/api/v1/parent/[...path]` (wzorzec strangler, migracja oRPC v2). Ten plik
 * implementuje cz. 1 kontraktu (`parentApiContract`): profile dzieci, zestawy
 * (decks, w tym okładka ze streamingiem 5 MB) i szkice wersji (drafts).
 * Ścieżki spoza kontraktu (`matched === false`) spadają do legacy
 * `handleParentApi` — pozostałe grupy migruje zadanie 11.
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
})
  .$context<ORpcContext>()
  .use(appErrorMiddleware)
  .use(parentSessionMiddleware);

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
});
