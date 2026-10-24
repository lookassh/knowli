import { z } from "zod";
import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import {
  ChildDtoSchema,
  ChildInputSchema,
  ChildPatchSchema,
  CreateEmptyDeckCommandSchema,
  CreateEmptyDeckResultSchema,
  DeckDtoSchema,
  DeckSettingsPatchSchema,
  DeckSummaryDtoSchema,
  DraftDtoSchema,
  DraftPatchSchema,
  GenerationCommandSchema,
  OmitIllustrationSchema,
  PronunciationBandsInputSchema,
  PronunciationSettingsDtoSchema,
  PublishCommandSchema,
  RevisionAssetCommandSchema,
  UuidSchema,
} from "@learning/contracts";

/**
 * Kontrakt Parent API cz. 1 (children, decks, drafts) pod /api/v1/parent —
 * WEWNĘTRZNY dla apps/web (plan oRPC v2: kontrakt parent nie trafia do
 * @learning/contracts, bo klient jest wyłącznie panel w tej samej aplikacji).
 * Schematy, ścieżki, metody, statusy (201/202/204) i nagłówki odwzorowują
 * dekomisjonowane ręczne trasy (`parent/parent-router.ts` + trasy children);
 * prefix montowania dokleja handler przy `handle()`.
 *
 * Upload okładki: surowy strumień obrazu (octet-stream). Kontraktowym typem
 * ciała jest `ReadableStream | Blob` — serwer z meta `requestBodyHint:
 * "octet-stream"` zawsze dostaje surowy strumień (limit 5 MB egzekwuje
 * procedura), a klient panelu może wysłać `File` bez konwersji (Blob jest
 * przepuszczany przez serializator OpenAPILink). `inputStructure: "detailed"`
 * jest obowiązkowe — compact z parametrem ścieżki gubi strumieniowe ciało
 * (spike v2, dywergencja 5).
 */

/** Parametr ścieżki `{childId}` dla operacji na profilu dziecka. */
const ChildPathSchema = z.object({ childId: UuidSchema });
/** Parametr ścieżki `{deckId}` dla operacji na zestawie. */
const DeckPathSchema = z.object({ deckId: UuidSchema });
/** Parametr ścieżki `{draftId}` dla operacji na szkicu wersji. */
const DraftPathSchema = z.object({ draftId: UuidSchema });

/** Wejście PATCH /children/{childId}: ścieżka + częściowa edycja profilu. */
const ChildUpdateInputSchema = ChildPatchSchema.extend({ childId: UuidSchema }).strict();
/** Wejście PUT /children/{childId}/pronunciation: ścieżka + progi wymowy. */
const PronunciationPutInputSchema = PronunciationBandsInputSchema.extend({ childId: UuidSchema });
/** Wejście PATCH /decks/{deckId}: ścieżka + ustawienia sesji nauki. */
const DeckSettingsInputSchema = DeckSettingsPatchSchema.extend({ deckId: UuidSchema });
/** Wejście PATCH /drafts/{draftId}: ścieżka + poprawki szkicu. */
const DraftEditInputSchema = DraftPatchSchema.extend({ draftId: UuidSchema });
/** Wejście POST /drafts/{draftId}/publish: ścieżka + optimistic locking. */
const DraftPublishInputSchema = PublishCommandSchema.extend({ draftId: UuidSchema });
/** Wejście POST /drafts/{draftId}/assets/regenerate: ścieżka + polecenie. */
const RevisionAssetInputSchema = RevisionAssetCommandSchema.extend({ draftId: UuidSchema });
/** Wejście POST /drafts/{draftId}/assets/omit: ścieżka + pomijana ilustracja. */
const OmitAssetInputSchema = OmitIllustrationSchema.extend({ draftId: UuidSchema });

/** Ciało uploadu okładki: surowe bajty obrazu poza JSON-em. */
const CoverBodySchema = z.union([z.instanceof(ReadableStream), z.instanceof(Blob)]);

/** Detailed input uploadu okładki: params + opcjonalne nagłówki + strumień. */
const CoverUploadInputSchema = z.object({
  params: DeckPathSchema,
  headers: z.object({ "content-type": z.string() }).optional(),
  body: CoverBodySchema,
});

/** Binarna propozycja okładki z Content-Type obrazu i no-store. */
const CoverProposalOutputSchema = z.object({
  status: z.literal(200).optional(),
  headers: z.object({ "content-type": z.string() }).loose(),
  body: z.instanceof(Blob),
});

/**
 * Kontrakt Parent API cz. 1 — zagnieżdżenie odzwierciedla grupy URL.
 * Kolejne zadania (T11) dopisują tu lekcje, werdykty, generation,
 * assignments, progress, mock-tests i work-card.
 */
export const parentApiContract = {
  children: {
    list: oc
      .output(ChildDtoSchema.array())
      .meta(openapi({ method: "GET", path: "/children" })),

    create: oc
      .input(ChildInputSchema)
      .output(ChildDtoSchema)
      .meta(openapi({ method: "POST", path: "/children", successStatus: 201 })),

    update: oc
      .input(ChildUpdateInputSchema)
      .output(ChildDtoSchema)
      .meta(openapi({ method: "PATCH", path: "/children/{childId}" })),

    remove: oc
      .input(ChildPathSchema)
      .output(z.void())
      .meta(openapi({ method: "DELETE", path: "/children/{childId}", successStatus: 204 })),

    getPronunciation: oc
      .input(ChildPathSchema)
      .output(PronunciationSettingsDtoSchema)
      .meta(openapi({ method: "GET", path: "/children/{childId}/pronunciation" })),

    putPronunciation: oc
      .input(PronunciationPutInputSchema)
      .output(z.void())
      .meta(openapi({ method: "PUT", path: "/children/{childId}/pronunciation", successStatus: 204 })),
  },

  decks: {
    list: oc
      .output(DeckSummaryDtoSchema.array())
      .meta(openapi({ method: "GET", path: "/decks" })),

    generate: oc
      .input(GenerationCommandSchema)
      .output(z.object({ generationRunId: UuidSchema, deckId: UuidSchema }))
      .meta(openapi({ method: "POST", path: "/decks/generate", successStatus: 202 })),

    create: oc
      .input(CreateEmptyDeckCommandSchema)
      // 201 przy utworzeniu, 200 przy bezpiecznym ponowieniu tego samego
      // polecenia — status wynika z `created` w wyniku przypadku użycia.
      .output(z.object({
        status: z.union([z.literal(201), z.literal(200)]),
        headers: z.record(z.string(), z.string()).optional(),
        body: CreateEmptyDeckResultSchema,
      }))
      .meta(openapi({ method: "POST", path: "/decks", outputStructure: "detailed" })),

    get: oc
      .input(DeckPathSchema)
      .output(DeckDtoSchema)
      .meta(openapi({ method: "GET", path: "/decks/{deckId}" })),

    updateSettings: oc
      .input(DeckSettingsInputSchema)
      .output(DeckSettingsPatchSchema)
      .meta(openapi({ method: "PATCH", path: "/decks/{deckId}" })),

    setCover: oc
      .input(CoverUploadInputSchema)
      .output(z.object({ coverAssetId: UuidSchema }))
      .meta(openapi({
        method: "POST",
        path: "/decks/{deckId}/cover",
        inputStructure: "detailed",
        requestBodyHint: "octet-stream",
      })),

    clearCover: oc
      .input(DeckPathSchema)
      .output(z.void())
      .meta(openapi({ method: "DELETE", path: "/decks/{deckId}/cover", successStatus: 204 })),

    generateCover: oc
      .input(DeckPathSchema)
      .output(CoverProposalOutputSchema)
      .meta(openapi({
        method: "POST",
        path: "/decks/{deckId}/cover/generate",
        outputStructure: "detailed",
        responseBodyHint: "file",
      })),

    createDraft: oc
      .input(DeckPathSchema)
      .output(DraftDtoSchema)
      .meta(openapi({ method: "POST", path: "/decks/{deckId}/draft", successStatus: 201 })),

    archive: oc
      .input(DeckPathSchema)
      .output(z.void())
      .meta(openapi({ method: "POST", path: "/decks/{deckId}/archive", successStatus: 204 })),
  },

  drafts: {
    get: oc
      .input(DraftPathSchema)
      .output(DraftDtoSchema)
      .meta(openapi({ method: "GET", path: "/drafts/{draftId}" })),

    edit: oc
      .input(DraftEditInputSchema)
      .output(DraftDtoSchema)
      .meta(openapi({ method: "PATCH", path: "/drafts/{draftId}" })),

    publish: oc
      .input(DraftPublishInputSchema)
      .output(z.object({ deckVersionId: UuidSchema }))
      .meta(openapi({ method: "POST", path: "/drafts/{draftId}/publish" })),

    regenerateAsset: oc
      .input(RevisionAssetInputSchema)
      .output(z.object({ assetId: UuidSchema }))
      .meta(openapi({ method: "POST", path: "/drafts/{draftId}/assets/regenerate", successStatus: 202 })),

    omitAsset: oc
      .input(OmitAssetInputSchema)
      .output(z.void())
      .meta(openapi({ method: "POST", path: "/drafts/{draftId}/assets/omit", successStatus: 204 })),
  },
};
