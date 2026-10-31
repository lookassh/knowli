import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  SourceMaterialInputSchema,
  SourceMaterialPatchSchema,
  UuidSchema,
  type LessonDeckSourceDto,
  type SourceMaterialDto,
  type SourceMaterialInput,
  type SourceMaterialPatch,
  type SourceMaterialSummaryDto,
} from "@learning/contracts";
import type { Services } from "../../config";
import type { Executor, Tx } from "../../db/client";
import { deckVersions, decks, sourceMaterials } from "../../db/schema";
import { AppError } from "../../errors";
import { deckStateOf } from "./decks";

/**
 * Źródła — materiał źródłowy rodzica (design 2026-10-30 „Angielski — rozdział”,
 * §3). Właścicielem tabeli `source_materials` i kolumn pochodzenia zestawu
 * (`decks.source_material_id`, `decks.source_material_revision`) jest ten
 * obszar. Zestaw KOPIUJE tekst przy tworzeniu — źródło nie jest czytane po
 * utworzeniu zestawu, a jego edycja nie zmienia istniejących zestawów.
 *
 * Dwie rewizje źródła: `revision` (kontrola współbieżności — rośnie przy każdej
 * zmianie, `expectedRevision` edycji) i `body_revision` (wersja treści — rośnie
 * tylko przy zmianie tekstu). Zestaw zapisuje skopiowaną rewizję treści, więc
 * zmiana samego tytułu nie oznacza go jako utworzonego ze starszej wersji.
 *
 * Operacje są dostępne tylko rodzicowi (autoryzacja w warstwie HTTP); źródeł nie
 * ma w Kid API ani w MCP.
 */

/** Skrót znormalizowanego (po trim) tytułu i treści z żądania tworzenia. */
function requestHashOf(title: string, body: string): string {
  return createHash("sha256").update(JSON.stringify({ title, body })).digest("hex");
}

/** Ile razy ponowić wstawienie, gdy konfliktujący wiersz zniknął przed odczytem. */
const CREATE_ATTEMPTS = 3;

/**
 * Tworzy źródło idempotentnie po `clientRequestId`: ponowienie z tą samą treścią
 * zwraca istniejący rekord (`created: false`), z inną treścią kończy się
 * `conflict`. Równoległe żądania z tym samym identyfikatorem dają jeden rekord
 * — drugie `INSERT` czeka na pierwsze i trafia w `ON CONFLICT DO NOTHING`.
 * Ponowienie po usunięciu źródła tworzy je od nowa (świadomie, bez nagrobków).
 */
export async function createSourceMaterial(
  services: Services,
  input: SourceMaterialInput,
): Promise<{ id: string; created: boolean }> {
  const command = SourceMaterialInputSchema.parse(input);
  const requestHash = requestHashOf(command.title, command.body);
  const now = services.clock.now();

  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt += 1) {
    const id = randomUUID();
    const inserted = await services.db
      .insert(sourceMaterials)
      .values({
        id,
        clientRequestId: command.clientRequestId,
        requestHash,
        title: command.title,
        body: command.body,
        revision: 1,
        bodyRevision: 1,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: sourceMaterials.clientRequestId })
      .returning({ id: sourceMaterials.id });
    if (inserted.length > 0) {
      return { id, created: true };
    }

    const [existing] = await services.db
      .select({ id: sourceMaterials.id, requestHash: sourceMaterials.requestHash })
      .from(sourceMaterials)
      .where(eq(sourceMaterials.clientRequestId, command.clientRequestId));
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new AppError("conflict");
      }
      return { id: existing.id, created: false };
    }
    // Konfliktujący rekord został usunięty między INSERT a SELECT — wstaw ponownie.
  }
  throw new AppError("conflict");
}

/**
 * Edytuje tytuł i/lub treść z kontrolą rewizji. Wiersz jest blokowany
 * `FOR UPDATE`, więc dwie przeglądarki edytujące tę samą rewizję są
 * serializowane: pierwsza zapisuje i podnosi `revision`, druga dostaje
 * `conflict` i niczego nie nadpisuje. Zmiana tekstu podnosi też
 * `body_revision`; zmiana samego tytułu — nie. Edycja, w której każde podane
 * pole równa się zapisanemu (po trim), zwraca bieżące źródło bez zapisu (bez
 * podbicia rewizji i `updated_at`); nieaktualna `expectedRevision` jest wtedy
 * nadal `conflict`. Brak źródła → `not_found`.
 */
export async function updateSourceMaterial(
  services: Services,
  id: string,
  patch: SourceMaterialPatch,
): Promise<SourceMaterialDto> {
  const sourceId = UuidSchema.parse(id);
  const command = SourceMaterialPatchSchema.parse(patch);

  return services.db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        title: sourceMaterials.title,
        body: sourceMaterials.body,
        revision: sourceMaterials.revision,
        bodyRevision: sourceMaterials.bodyRevision,
      })
      .from(sourceMaterials)
      .where(eq(sourceMaterials.id, sourceId))
      .for("update");
    if (!current) {
      throw new AppError("not_found");
    }
    if (current.revision !== command.expectedRevision) {
      throw new AppError("conflict");
    }
    const titleChanged = command.title !== undefined && command.title !== current.title;
    const bodyChanged = command.body !== undefined && command.body !== current.body;
    if (titleChanged || bodyChanged) {
      await tx
        .update(sourceMaterials)
        .set({
          ...(titleChanged ? { title: command.title } : {}),
          ...(bodyChanged ? { body: command.body, bodyRevision: current.bodyRevision + 1 } : {}),
          revision: current.revision + 1,
          updatedAt: services.clock.now(),
        })
        .where(eq(sourceMaterials.id, sourceId));
    }
    return readSourceMaterial(tx, sourceId);
  });
}

/**
 * Usuwa źródło. Zestawy zostają: klucz obcy `decks.source_material_id` ma
 * `ON DELETE SET NULL`, a treść zestawu jest jego własną kopią. Równoległe
 * tworzenie lekcji ze źródła trzyma `FOR KEY SHARE`, więc usunięcie na nie
 * czeka. Brak źródła → `not_found`.
 */
export async function deleteSourceMaterial(services: Services, id: string): Promise<void> {
  const sourceId = UuidSchema.parse(id);
  const deleted = await services.db
    .delete(sourceMaterials)
    .where(eq(sourceMaterials.id, sourceId))
    .returning({ id: sourceMaterials.id });
  if (deleted.length === 0) {
    throw new AppError("not_found");
  }
}

/**
 * Odczyt źródła do skopiowania do nowego zestawu (design §3.3): jedno
 * zapytanie `FOR KEY SHARE` w transakcji tworzenia zestawu. Blokada trzyma się
 * do jej końca, więc równoległe `deleteSourceMaterial` (blokada `FOR UPDATE`)
 * czeka na zatwierdzenie zestawu i dopiero potem zeruje jego odnośnik — zamiast
 * unieważnić klucz obcy w trakcie wstawiania zestawu. Równoległa edycja
 * (`updateSourceMaterial`, też `FOR UPDATE`) jest serializowana tak samo, a
 * `body` i `bodyRevision` (rewizja treści — to ją zapisuje zestaw) pochodzą
 * z jednej wersji wiersza. Źródło usunięte przed odczytem → `not_found` (nigdy
 * błąd 500 z naruszenia klucza obcego).
 * Wołać wyłącznie w transakcji domyślnej izolacji (read committed), w której
 * zapytanie blokujące ponownie ocenia wiersz po czekaniu na cudzą blokadę.
 */
export async function lockSourceMaterialForCopy(tx: Tx, id: string): Promise<{ body: string; bodyRevision: number }> {
  const [source] = await tx
    .select({ body: sourceMaterials.body, bodyRevision: sourceMaterials.bodyRevision })
    .from(sourceMaterials)
    .where(eq(sourceMaterials.id, id))
    .for("key share");
  if (!source) {
    throw new AppError("not_found");
  }
  return source;
}

/**
 * Pochodzenie zestawu z żywego źródła (`LessonDeckDto.source`): tytuł źródła
 * oraz rewizja treści skopiowana i bieżąca; `undefined`, gdy zestaw powstał z
 * wklejonego tekstu albo źródło usunięto (odnośnik jest wtedy `null`).
 */
export async function readDeckSource(
  db: Executor,
  deck: { sourceMaterialId: string | null; sourceMaterialRevision: number | null },
): Promise<LessonDeckSourceDto | undefined> {
  if (deck.sourceMaterialId === null || deck.sourceMaterialRevision === null) {
    return undefined;
  }
  const [source] = await db
    .select({ id: sourceMaterials.id, title: sourceMaterials.title, bodyRevision: sourceMaterials.bodyRevision })
    .from(sourceMaterials)
    .where(eq(sourceMaterials.id, deck.sourceMaterialId));
  if (!source) {
    return undefined;
  }
  return {
    id: source.id,
    title: source.title,
    copiedRevision: deck.sourceMaterialRevision,
    currentRevision: source.bodyRevision,
  };
}

/**
 * Lista źródeł, ostatnio zmieniane pierwsze. `deckCount` liczy zestawy
 * niezarchiwizowane utworzone z danego źródła.
 */
export async function listSourceMaterials(services: Services): Promise<SourceMaterialSummaryDto[]> {
  return services.db.transaction(
    async (tx) => {
      const rows = await tx
        .select({
          id: sourceMaterials.id,
          title: sourceMaterials.title,
          revision: sourceMaterials.revision,
          createdAt: sourceMaterials.createdAt,
          updatedAt: sourceMaterials.updatedAt,
        })
        .from(sourceMaterials)
        .orderBy(desc(sourceMaterials.updatedAt), asc(sourceMaterials.id));
      const counts = await tx
        .select({ sourceId: decks.sourceMaterialId, count: sql<number>`count(*)::int` })
        .from(decks)
        .where(and(isNotNull(decks.sourceMaterialId), isNull(decks.archivedAt)))
        .groupBy(decks.sourceMaterialId);
      const countBySource = new Map(counts.map((row) => [row.sourceId, row.count]));
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        revision: row.revision,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        deckCount: countBySource.get(row.id) ?? 0,
      }));
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/** Pełny tekst źródła i zestawy utworzone z niego. Brak źródła → `not_found`. */
export async function getSourceMaterial(services: Services, id: string): Promise<SourceMaterialDto> {
  const sourceId = UuidSchema.parse(id);
  return services.db.transaction((tx) => readSourceMaterial(tx, sourceId), {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
}

/**
 * Odczyt źródła razem z zestawami (także zarchiwizowanymi — mają stan
 * „archived”, ale nie wchodzą do `deckCount`). Zestawy: najnowsze pierwsze.
 * `stale` — skopiowana rewizja treści jest starsza od bieżącej `body_revision`.
 */
async function readSourceMaterial(db: Executor, id: string): Promise<SourceMaterialDto> {
  const [source] = await db.select().from(sourceMaterials).where(eq(sourceMaterials.id, id));
  if (!source) {
    throw new AppError("not_found");
  }

  const deckRows = await db
    .select({
      id: decks.id,
      title: decks.title,
      kind: decks.kind,
      archivedAt: decks.archivedAt,
      publishedVersionId: decks.publishedVersionId,
      copiedRevision: decks.sourceMaterialRevision,
    })
    .from(decks)
    .where(eq(decks.sourceMaterialId, id))
    .orderBy(desc(decks.createdAt), asc(decks.id));
  const editableByDeck = new Map(
    deckRows.length
      ? (
          await db
            .select({ deckId: deckVersions.deckId, state: deckVersions.state })
            .from(deckVersions)
            .where(
              and(
                inArray(deckVersions.deckId, deckRows.map((row) => row.id)),
                inArray(deckVersions.state, ["draft", "review"]),
              ),
            )
        ).map((version): [string, "draft" | "review"] => [version.deckId, version.state as "draft" | "review"])
      : [],
  );

  return {
    id: source.id,
    title: source.title,
    body: source.body,
    revision: source.revision,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
    deckCount: deckRows.filter((row) => row.archivedAt === null).length,
    decks: deckRows.map((row) => ({
      deckId: row.id,
      title: row.title,
      kind: row.kind as "lesson" | "vocabulary",
      state: deckStateOf(row, editableByDeck.get(row.id) ?? null),
      copiedRevision: row.copiedRevision,
      stale: row.copiedRevision !== null && row.copiedRevision < source.bodyRevision,
    })),
  };
}
