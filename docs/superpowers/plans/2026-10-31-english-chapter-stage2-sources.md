# Etap 2: źródła (materiał źródłowy) — plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rodzic wkleja tekst rozdziału raz jako „źródło” w nowej zakładce „Źródła” i tworzy z niego lekcję rozdziału albo lekcję szkolną; zestaw kopiuje tekst i pamięta odnośnik do źródła.

**Architecture:** Nowa tabela `source_materials` i dwie kolumny `decks` (migracja 0030), przypadki użycia w obszarze `materials/` (`source-materials.ts`), komendy tworzenia lekcji przyjmują `sourceMaterialId` z `expectedSourceRevision` (rewizja treści z podglądu) zamiast tekstu, nowa grupa oRPC `sources`, nowa sekcja panelu rodzica. Kopia tekstu w zestawie — źródło nigdy nie jest czytane po utworzeniu zestawu.

**Tech Stack:** TypeScript strict, Drizzle/PostgreSQL (migracje SQL w `packages/server/drizzle/`), Zod, oRPC, Mantine 9 + TanStack Query (panel rodzica), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-30-english-chapter-design.md` §3 (dane, operacje, tworzenie ze źródła, panel), §7 (kontrakty), §8 (testy źródeł), §10 (etapy).

## Global Constraints

- Gałąź `claude/english-chapter-2-sources`, pierwotnie stos na `claude/english-chapter-1-lesson` (PR #192); po scaleniu #192 do `main` (46e626c0) gałąź przeniesiono na `main`, więc PR Etapu 2 ma bazę `main`.
- Kolejny numer migracji: `0030` (pierwotnie `0029`; przenumerowana przy scaleniu z `main`, bo `0029` zajęła rola `feedback_audio` z #194); wpis w `packages/server/drizzle/meta/_journal.json` (`idx` 30, `when` 1793490000000, o 1e8 większy od 0029); styl jak `0020_deck_session_task_budget.sql`. Migracja nie może naruszyć triggerów `decks_kind_immutable` (0007) ani `decks_cover_asset_guard` (0011).
- `source_materials`: `title` 1–120 po trim, `body` 1–16 000 po trim (`MAX_SCHOOL_MATERIAL_LENGTH`), `revision` (kontrola współbieżności edycji, rośnie przy każdej zmianie) i `body_revision` (rewizja treści, rośnie tylko przy zmianie tekstu), obie od 1; uuid PK nadawany przez aplikację (`randomUUID()`), `timestamps()` jak w schemacie.
- Obszar `materials/` importuje tylko `materials` i `family`; inne obszary i web tylko przez barrele (`modules/materials/index.ts`, `packages/server/src/index.ts`).
- Każda operacja źródeł wymaga sesji rodzica; mutacje `sameOriginMiddleware`. Źródeł nie ma w Kid API ani w MCP.
- Teksty UI po polsku w `packages/contracts/src/messages.ts`; Mantine tylko w `apps/web/src/parent`.
- Materiał z podręcznika nie trafia do repozytorium (fikcyjne teksty w testach).
- Nigdy `npm install`; commity po polsku z linią `Co-Authored-By` zgodną z wytycznymi sesji.

## Review Focus

1. Usunięcie źródła równolegle z tworzeniem lekcji z niego — wynik `not_found` albo poprawny zestaw, nigdy błąd 500 (test w Task 3).
2. Dwie przeglądarki edytują to samo źródło — druga dostaje `conflict`, nic nie nadpisuje po cichu (test w Task 2).
3. Ponowienie utworzenia źródła z tym samym `clientRequestId`: ta sama treść → ten sam rekord; inna treść → `conflict` (test w Task 2).
4. Edycja źródła po utworzeniu lekcji nie zmienia jej materiału, a edytor pokazuje „Źródło zmieniono od utworzenia tego zestawu” (testy w Task 3 i 6).
5. Pięć zakładek panelu na telefonie 320–390 px bez przepełnienia i z celami ≥44/48 px (test w Task 5).

---

### Task 1: Prompt luk z bankiem — limit polecenia (odłożone z Etapu 1)

**Files:** Modify `packages/server/src/domain/lessons/subjects/english-chapter/prompts.ts`, `module.test.ts`.

- [ ] Reguła `lesson_cloze` (typeRules): `instructionPl` ≤120 znaków łącznie z poleceniem; tekst z lukami 2–3 krótkie zdania, żeby polskie znaczenie zmieściło się w limicie. Test asercji tekstu promptu. Run `corepack pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain/lessons` — PASS. Commit.

### Task 2: Tabela źródeł i przypadki użycia

**Files:**
- Modify: `packages/server/src/db/schema.ts` (nowa `sourceMaterials`; `decks` + `sourceMaterialId uuid references sourceMaterials.id onDelete set null`, `sourceMaterialRevision integer`)
- Create: `packages/server/drizzle/0030_source_materials.sql`; Modify `_journal.json`; Modify `docs/schema.sql` (tabela i kolumny)
- Create: `packages/server/src/modules/materials/source-materials.ts`; Modify `modules/materials/index.ts`, `packages/server/src/index.ts`
- Create: `packages/contracts/src/source-materials.ts` (+ export w `packages/contracts/src/index.ts`) i `source-materials.test.ts`
- Create: `tests/integration/source-materials.test.ts`; Modify `tests/integration-buckets.ts` (najlżejszy kosz)

**Interfaces (Produces):**
- Kontrakty: `SourceMaterialInputSchema` (`clientRequestId: uuid`, `title`, `body`; `.strict()`), `SourceMaterialPatchSchema` (`expectedRevision: int ≥1`, `title?`, `body?`, co najmniej jedno z dwóch; `.strict()`), `SourceMaterialSummaryDtoSchema` (`id`, `title`, `revision`, `createdAt`, `updatedAt`, `deckCount`), `SourceMaterialDtoSchema` (summary + `bodyRevision: int ≥1` — rewizja TREŚCI, rośnie tylko przy zmianie tekstu, w odróżnieniu od `revision` rosnącego przy każdej zmianie; formularz lekcji odsyła ją jako `expectedSourceRevision` — + `body` + `decks: { deckId, title, kind: "lesson" | "vocabulary", state: DeckState, copiedRevision: int | null, stale: boolean }[]`, gdzie `copiedRevision` to rewizja treści skopiowana do zestawu).
- Serwer: `createSourceMaterial(services, input): Promise<{ id: string; created: boolean }>`, `updateSourceMaterial(services, id, patch): Promise<SourceMaterialDto>`, `deleteSourceMaterial(services, id): Promise<void>`, `listSourceMaterials(services): Promise<SourceMaterialSummaryDto[]>` (sortowane po `updatedAt` malejąco; `deckCount` bez zarchiwizowanych), `getSourceMaterial(services, id): Promise<SourceMaterialDto>`.

- [ ] **Step 1: Testy (failing).** Kontrakty: limity 1–120 / 1–16 000 po trim, `.strict()`, patch bez pól → błąd. Integracja (Postgres):
  - create idempotentne: ten sam `clientRequestId` i treść → ten sam `id`, `created: false`; inna treść → `conflict`; równoległe dwa create z tym samym `clientRequestId` → jeden rekord;
  - update: `expectedRevision` równe → `revision+1`, `updatedAt` rośnie; zmiana tekstu podbija też `body_revision`, zmiana samego tytułu — nie; edycja bez realnej zmiany niczego nie podbija; nierówne → `conflict`; brak źródła → `not_found`;
  - delete: źródło znika, zestaw z odnośnikiem zostaje z `source_material_id = null` (zestaw wstaw bezpośrednio SQL-em albo przez Task 3 — tu SQL);
  - list/get: `deckCount` pomija zarchiwizowane; `stale` = `copiedRevision < body_revision`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3: Implementacja.** `request_hash` = sha256 z JSON `{title, body}` po trim (lokalnie w materials, bez importu z `learning`). Create: `insert … onConflictDoNothing({ target: clientRequestId })`, potem odczyt i porównanie hasha (różny → `conflict`). Update w transakcji z `FOR UPDATE`. Migracja ręcznie pisana SQL (snapshoty drizzle od 0018 to znany dług — nie generować ich).
- [ ] **Step 4:** Run testy pliku + `corepack pnpm exec vitest run --config vitest.unit.config.ts packages/contracts packages/server/src/modules` + `tests/integration-buckets.test.ts` — PASS.
- [ ] **Step 5:** Commit `Źródła: tabela i przypadki użycia`.

### Task 3: Lekcja ze źródła

**Files:** Modify `packages/contracts/src/lessons.ts` (`SchoolLessonCommandSchema`, `MaterialLessonCommandSchema`, `LessonSourceChangedDetailsSchema`, `LessonDeckDtoSchema`), `packages/server/src/modules/materials/lessons/lesson-drafts.ts` (`MaterialLessonInput`, `createMaterialLesson`), `lesson-api.ts` (`readLessonDeck`/DTO), `packages/server/src/modules/materials/source-materials.ts` (`lockSourceMaterialForCopy`, `isSourceChangedConflict`, `readDeckSource`); tests `packages/contracts/src/lessons.test.ts`, `tests/integration/source-materials.test.ts` (albo `lesson-chapter.test.ts`).

**Interfaces:**
- Komendy: dokładnie jedno z `material` / `sourceMaterialId` (uuid) — `.strict()` + `superRefine`; oba albo żaden → `validation`. `expectedSourceRevision` (int ≥1, rewizja treści z podglądu) jest wymagane razem z `sourceMaterialId` i niedozwolone bez niego (`validation`, błąd przy polu `expectedSourceRevision`).
- `createMaterialLesson`: gdy `sourceMaterialId`, w tej samej transakcji co dziś: `select … from source_materials where id = $1 for key share` → brak → `AppError("not_found")`; `lesson_context.material` i `generation_runs.input.material` = `body`; `decks.source_material_id`/`source_material_revision` = id/`body_revision`.
- Po przeglądzie PR #193 (zrobione): komenda ze `sourceMaterialId` niesie wymagane `expectedSourceRevision` (rewizja treści podglądu, `SourceMaterialDto.bodyRevision`); po blokadzie `FOR KEY SHARE` (`lockSourceMaterialForCopy`, pierwsze zapytanie transakcji) inna `body_revision` → `AppError("conflict")` z `details: { reason: "source_changed" }` (`LessonSourceChangedDetailsSchema`), bez zapisu; ponowienie z tym samym `clientRequestId` zwraca istniejący zestaw przed odczytem źródła (także gdy wcześniejsze żądanie z tym kluczem zatwierdziło zestaw już po sprawdzeniu klucza, a źródło usunięto lub zmieniono przed blokadą — wynikiem jest zestaw tamtego żądania, nie `not_found` ani `conflict`). Panel przy tym 409 odświeża podgląd (ponowny odczyt źródła) i pokazuje `messages.sources.changedBeforeCreate`; ponowne „Utwórz lekcję” jest potwierdzeniem nowego tekstu, a przy 404 (źródło usunięte) panel pokazuje `messages.sources.notFound` bez ponawiania.
- `LessonDeckDtoSchema.source?: { id: string; title: string; copiedRevision: number; currentRevision: number }` (brak, gdy zestaw bez źródła albo źródło usunięte).

- [ ] **Step 1: Testy (failing).** Kontrakty (oba/żaden → błąd; `expectedSourceRevision` wymagane z `sourceMaterialId` i tylko z nim; `LessonSourceChangedDetailsSchema` ścisły). Integracja: lekcja rozdziału i szkolna ze źródła kopiują tekst i rewizję treści; rewizja podglądu inna niż bieżąca rewizja treści (także z przyszłości i po edycji, na którą tworzenie czekało) → `conflict` z `source_changed` bez zapisu, a zmiana samego tytułu nie blokuje; ponowienie po równoległym usunięciu albo zmianie tekstu źródła zwraca zestaw pierwszego żądania; edycja źródła po utworzeniu nie zmienia `lesson_context.material`, a DTO ma `currentRevision > copiedRevision`; usunięcie źródła → DTO bez `source`, lekcja działa (dogenerowanie używa kopii); źródło nieistniejące → `not_found`; równoległe usunięcie w trakcie tworzenia (dwie transakcje) → `not_found` albo zestaw z kopią, nigdy 500; ponowienie tego samego `clientRequestId` → ten sam zestaw.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implementacja. **Step 4:** Run `tests/integration/source-materials.test.ts tests/integration/lesson-chapter.test.ts tests/integration/lesson-generation.test.ts` + unit contracts/server + `corepack pnpm typecheck` — PASS.
- [ ] **Step 5:** Commit `Źródła: lekcja rozdziału i szkolna ze źródła`.

### Task 4: API rodzica `sources`

**Files:** Modify `apps/web/src/parent/orpc-contract.ts`, `apps/web/src/orpc/parent-router.ts` (lista grup `parentOs` i drzewo routera), `apps/web/src/orpc/parent-router.test.ts` (mocki, tabela odczytów bez sesji, tabela CSRF mutacji); integracja HTTP w `tests/integration/source-materials.test.ts` (wzór `manual-decks-api.test.ts`; w tym `POST /lessons/material` i `/lessons/school` ze źródłem: 409 `conflict` z `details.reason = "source_changed"` dla nieaktualnego podglądu, 400 bez `expectedSourceRevision`).

**Interfaces:** `sources.list` GET `/sources`; `sources.get` GET `/sources/{sourceId}`; `sources.create` POST `/sources` (201 utworzone / 200 istniejące, `outputStructure: "detailed"` jak `decks.createEmpty`); `sources.update` PATCH `/sources/{sourceId}`; `sources.delete` DELETE `/sources/{sourceId}` (204). Mutacje z `sameOriginMiddleware`.

- [ ] Testy routera (401 bez sesji, 403 cross-origin, statusy) i HTTP → implementacja → `corepack pnpm exec vitest run --config vitest.unit.config.ts apps/web` + plik integracyjny — PASS → commit `Źródła: API rodzica`.

### Task 5: Zakładka „Źródła” w panelu rodzica

**Files:**
- Modify: `apps/web/src/parent/parent-routes.ts` (+ testy), `ParentShell.tsx` (`SECTION_META`), `ParentIcon.tsx`, `parent-shell.css` (dolny pasek 5 kolumn), `ParentApp.tsx`, `packages/contracts/src/messages.ts`
- Create: `apps/web/src/parent/sources/SourcesPanel.tsx`, `SourcePage.tsx`, `sources-state.ts` (+ testy)
- Modify: `apps/web/src/parent/lessons/NewLessonForm.tsx` (+ test), `DecksPanel.tsx` (odczyt źródła przez `sources.get` i przekazanie go z `bodyRevision` do formularza), `apps/web/src/parent/api.ts` (`isSourceChangedError`), `apps/web/src/parent/lessons/LessonEditor.tsx`
- Modify E2E: `tests/e2e/parent-shell-layout.spec.ts` (`TABS`), nowy `tests/e2e/parent-sources-layout.spec.ts` (mocked) + `tests/e2e/spec-projects.ts`

**Interfaces:**
- Trasy: sekcja `sources` (`/parent/sources`, `/parent/sources/{uuid}`); nowa lekcja ze źródła: `ParentRoute { section: "decks"; newLesson: true; sourceId?: string; subjectId?: string }` ↔ `/parent/lessons/new?source=<uuid>&subject=<id>` (round-trip w `parent-routes.test.ts`; nieprawidłowe parametry ignorowane).
- `NewLessonForm` dostaje opcjonalne `source?: { id: string; title: string; body: string; bodyRevision: number }` i `initialSubjectId?`: zamiast pola materiału pokazuje tytuł i przewijany podgląd (tylko do odczytu) oraz link „Zmień źródło” prowadzi do listy źródeł (wybór innego źródła); przycisk u góry wraca do strony źródła; komenda wysyła `sourceMaterialId` zamiast `material`, a `source.bodyRevision` (rewizja treści widocznego podglądu) mapuje na `expectedSourceRevision` — wymagane razem z `sourceMaterialId`; przy niezgodności serwer odpowiada 409 `conflict` z `details.reason = "source_changed"` (rozpoznawane przez `isSourceChangedError`), a formularz wtedy: zeruje polecenie w toku (następne dostaje nowy `clientRequestId`), wyłącza tworzenie do końca ponownego odczytu źródła (`onSourceChanged` → refetch `sources.get` odświeża podgląd i `bodyRevision`), pokazuje `messages.sources.changedBeforeCreate`, a ponowne „Utwórz lekcję” wysyła nową rewizję. Przy 404 (źródło usunięte) pokazuje `messages.sources.notFound`, wyłącza tworzenie, a „Zmień źródło” i przycisk u góry prowadzą do listy źródeł.
- Komunikaty (`messages.sources`, m.in.): `tab` „Źródła”, `newSource` „Nowe źródło”, `titleLabel` „Tytuł”, `bodyLabel` „Tekst rozdziału”, `bodyHint` „Wklej opracowanie rozdziału (np. z NotebookLM).”, `counter` „{n}/16000 znaków”, `createChapterLesson` „Utwórz lekcję rozdziału”, `createSchoolLesson` „Utwórz lekcję szkolną”, `decksHeading` „Zestawy z tego źródła”, `deleteConfirm` „Usunąć źródło? Zestawy ({n}) zostaną, stracą tylko odnośnik.”, `conflict` „Źródło zmieniono w innym oknie. Odśwież, aby zobaczyć najnowszą wersję.”, `empty` „Nie masz jeszcze źródeł.”, `fromSource` „Ze źródła: {title}”, `sourceChanged` „Źródło zmieniono od utworzenia tego zestawu.”, `changeSource` „Zmień źródło”, `backToSource` „Wróć do źródła”, `notFound` „Nie ma takiego źródła. Mogło zostać usunięte.”, `changedBeforeCreate` „Źródło zmieniono w innym oknie. Sprawdź tekst i utwórz lekcję ponownie.”.
- `LessonEditor`: pod nagłówkiem „Ze źródła: <tytuł>” (link do `/parent/sources/{id}`) i — gdy `currentRevision > copiedRevision` — notka `sourceChanged`.

- [ ] **Step 1: Testy (failing).** Trasy (round-trip, query params), stan formularza ze źródłem (`buildCommand` → `sourceMaterialId` i `expectedSourceRevision` z `source.bodyRevision`, brak `material`; `classifyCreateFailure`: 409 `source_changed` → odświeżenie podglądu, 404 → brak źródła), markup strony źródła (lista zestawów, przyciski, potwierdzenie usunięcia z liczbą), notka w edytorze, `parent-shell-layout` z 5 zakładkami (320/360/390 px: brak przepełnienia poziomego, cele ≥44 px jak dotąd w tym specu), nowy mocked spec źródeł (lista, nowy, edycja z konfliktem 409 → komunikat, usunięcie, przyciski tworzenia → URL nowej lekcji ze źródłem, lekcja ze źródła zmienionego w innym oknie: 409 `source_changed` odświeża podgląd, a ponowne utworzenie wysyła nową `expectedSourceRevision`, lekcja ze źródła usuniętego: 404 bez ponawiania) w 320×640, 390×844, 768×1024, 1280×800.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implementacja (wzorce: `DecksPanel` — komenda w toku w `ref` do ponowienia; `ChildEditor` — `modals.openConfirmModal`; zapytania `orpc.sources.*.queryOptions`, mutacje `parentClient.sources.*`, unieważnianie `sources.list`/`sources.get`/`decks.list`).
- [ ] **Step 4:** Run unit `apps/web` + `tests/parent-mantine-scope.test.ts` + `corepack pnpm build` + `$env:UMIEM_E2E_SKIP_BUILD='1'; corepack pnpm exec playwright test tests/e2e/parent-shell-layout.spec.ts tests/e2e/parent-sources-layout.spec.ts tests/e2e/parent-lessons-layout.spec.ts` — PASS (tryb `dev` nie hydratuje w tym środowisku).
- [ ] **Step 5:** Commit `Źródła: zakładka panelu rodzica`.

### Task 6: E2E przepływu na prawdziwej bazie

**Files:** Create `tests/e2e/parent-sources.spec.ts` (real; najlżejszy kosz `REAL_BUCKETS`), Modify `tests/e2e/spec-projects.ts`.

- [ ] Rodzic: tworzy źródło (fikcyjny tekst rozdziału) → „Utwórz lekcję rozdziału” → formularz bez pola materiału → utworzenie → generacja (fałszywy provider workera) → edytor pokazuje „Ze źródła: …” → edycja źródła → edytor pokazuje notkę zmiany → usunięcie źródła → lekcja zostaje, odnośnik znika. Run `$env:UMIEM_E2E_SKIP_BUILD='1'; corepack pnpm exec playwright test tests/e2e/parent-sources.spec.ts` — PASS; `spec-projects.test.ts` PASS. Commit.

### Task 7: Dokumentacja

**Files:** `docs/SPEC.md` §37 (Etap 2: źródła), `docs/architecture.md` (§19.9/§22: źródła, kopia i odnośnik, blokada `FOR KEY SHARE`, `ON DELETE SET NULL`), `docs/schema.sql`, `docs/folder-structure.md` (nowe pliki), design spec §10 (stan Etapu 2).

- [ ] Opis stanu kodu i tego, co niezweryfikowane. Commit.

### Task 8: Weryfikacja i PR

- [ ] `corepack pnpm typecheck`, `test:unit`, `test:integration`, `test:e2e:shards` (build produkcyjny) — PASS.
- [ ] Niezależny przegląd kilkoma subagentami; jedna fala poprawek; ponowna weryfikacja.
- [ ] Push `claude/english-chapter-2-sources`; PR z bazą `main`; opis: zakres, migracja 0030, wpływ API → MCP → skill (brak), wdrożenie (migracja przed web i worker), sprawdzenia, niezweryfikowane.
