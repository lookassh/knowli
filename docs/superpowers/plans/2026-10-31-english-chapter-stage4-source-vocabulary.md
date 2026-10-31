# Etap 4: słówka ze źródła — plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rodzic tworzy zestaw słówek ze źródła (tekstu rozdziału z zakładki „Źródła”): model wypisuje wyłącznie słowa i stałe zwroty z tekstu, serwer odrzuca pojedyncze pozycje spoza tekstu i zostawia resztę. Tryb „z opisu” (np. „przedmioty codziennego użytku, dni tygodnia”) działa bez zmian.

**Architecture:** `GenerationCommand` dostaje drugi tryb (`sourceMaterialId` + `expectedSourceRevision` + `instruction`), wzajemnie wykluczający z `prompt`. Tworzenie zestawu kopiuje tekst źródła pod `FOR KEY SHARE` jak lekcja ze źródła (Etap 2) i zapisuje odnośnik `decks.source_material_id/revision`. Worker w trybie materiału waliduje elementy pojedynczo (schemat, reguły formatu, dopasowanie frazy do tekstu) i zapisuje liczbę odrzuceń w nowej kolumnie `generation_runs.rejected_count` (migracja 0031). Panel rodzica: przycisk na stronie źródła, formularz, notka źródła i liczba odrzuceń w edytorze zestawu.

**Tech Stack:** TypeScript strict, Zod, Drizzle/PostgreSQL, Next.js + Mantine 9 (panel rodzica), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-30-english-chapter-design.md` §6 (tryb ze źródła), §7 (kontrakty), §8 („Słówka ze źródła”), §10 („Uwagi dla Etapu 4”).

## Global Constraints

- Gałąź `claude/english-chapter-4-source-vocab` (stos na `claude/english-chapter-3-readback`, #201); PR z bazą `claude/english-chapter-3-readback`, po scaleniu poprzednich — `main`.
- Tryb „z opisu”: `prompt` ≤ 4000 znaków, walidacja wszystko-albo-nic, tytuł z początku `prompt` — bez zmian zachowania i testów.
- Tryb ze źródła: `instruction` ≤ 500 znaków (zawężenie, np. „tylko pogoda”); `maxItems` ≤ `MAX_DECK_ITEMS` (100); para języków stała `pl-PL` → `en-GB` (`locales` zabronione z `sourceMaterialId`); domyślny tytuł = tytuł źródła.
- Element z tekstu: `target` występuje w tekście źródła jako fraza na granicach słów po normalizacji: małe litery, interpunkcja i apostrofy jak w lekcji rozdziału (§4.4), pominięte wiodące `a`/`an`/`the`/`to`, skróty przez normalizator angielski, prosta odmiana (`stemsOf` z `english-chapter/lexicon.ts`). Ramy z lukami (`…`, `...`, `___`, nawiasy) nie są elementami.
- Polecenie zawężające nie może dodać słów spoza tekstu — gwarancją jest walidacja serwera, nie prompt.
- Zero poprawnych elementów = porażka runu z kodem `no_source_items`; elementy ponad `maxItems` są obcinane, nie liczone jako odrzucone.
- Nieaktualny podgląd: `expectedSourceRevision` ≠ `body_revision` → 409 `conflict` z `details.reason = "source_changed"` i bez zapisu (jak `createMaterialLesson`); ponowienie tego samego `idempotencyKey` po zmianie lub usunięciu źródła zwraca utworzony zestaw.
- Bez cyklu importów: `deckStateOf` przenieść do pliku-liścia przed importem kodu źródeł w `decks.ts`; wspólny schemat odnośnika do źródła w `packages/contracts/src/decks.ts` (niżej niż `lessons.ts` i `source-materials.ts`).
- Panel rodzica tylko Mantine; teksty w `packages/contracts/src/messages.ts`. Kid UI bez zmian. API → MCP → skill: brak wpływu (`learning-overview` nie używa `GenerationCommand`/`GenerationDto`) — uzasadnić w PR.
- Kolejna migracja: `0031`; wpis w `_journal.json` (`idx` 31, `when` 1793590000000); `docs/schema.sql` zaktualizowany.
- Nigdy `npm install`; commity po polsku z linią `Co-Authored-By` zgodną z wytycznymi sesji.

## Review Focus

1. Źródło edytowane w innym oknie między otwarciem formularza a „Utwórz zestaw” → 409, odświeżony podgląd, ponowne „Utwórz” tworzy zestaw z nowego tekstu (Task 4).
2. Model zwraca formy z rodzajnikiem i odmianą („the coats”, „wearing”) oraz ramy „I'm wearing (a) …” → pierwsze przyjęte, gdy są w tekście, ramy odrzucone (Task 1b, Task 3).
3. Zawężenie próbuje dodać słowa („dodaj kolory”), a model je dopisuje → pozycje spoza tekstu odrzucone, `rejectedCount` widoczny w edytorze (Task 3, Task 4).
4. Niepewny zapis ponowiony po usunięciu lub edycji źródła → ten sam zestaw, nie 404/409 (Task 2).
5. Tekst źródła 16 000 znaków ze skrótami → dopasowanie poprawne i szybkie (Task 1b: test na długim tekście z limitem czasu).

---

### Task 1a: Kontrakty

**Files:** Modify `packages/contracts/src/generation.ts`, `packages/contracts/src/decks.ts`, `packages/contracts/src/lessons.ts` (alias), `packages/contracts/src/limits.ts`; Test `packages/contracts/src/generation.test.ts` (nowy), `packages/contracts/src/decks.test.ts` lub istniejący test DTO.

**Interfaces (Produces):**
- `GenerationCommandSchema`: `prompt` opcjonalny (≤ 4000), `sourceMaterialId?: Uuid`, `expectedSourceRevision?: int ≥ 1`, `instruction?: string 1..MAX_GENERATION_INSTRUCTION_LENGTH (500)`; `superRefine`: dokładnie jedno z `prompt`/`sourceMaterialId`; `expectedSourceRevision` ⇔ `sourceMaterialId`; `instruction` i brak `locales` tylko przy `sourceMaterialId`. Schemat nadal bez `.strict()` (jak dziś). `GenerationCommand = z.input<…>`.
- `DeckSourceDtoSchema = { id, title, copiedRevision: int ≥ 1, currentRevision: int ≥ 1 }.strict()` w `decks.ts`; `LessonDeckSourceDtoSchema` w `lessons.ts` = alias tego schematu (bez zmiany kształtu).
- `DeckDtoSchema.source?: DeckSourceDtoSchema` (tylko zestaw słówek ze źródła). `DeckSummaryDtoSchema` (lista) bez odnośnika — strona źródła już wymienia swoje zestawy, więc bez zbiorczego `readDeckSource`.
- `GenerationDtoSchema.rejectedCount?: int ≥ 0 | null`.
- `MAX_GENERATION_INSTRUCTION_LENGTH = 500` w `limits.ts`.

- [ ] Testy (failing): `prompt` sam — OK (dzisiejsze komendy przechodzą); `sourceMaterialId` + `expectedSourceRevision` — OK; oba źródła / żadne — błąd; `sourceMaterialId` bez rewizji i rewizja bez źródła — błąd; `instruction` 500 OK, 501 błąd, `instruction` z `prompt` — błąd; `locales` z `sourceMaterialId` — błąd; `prompt` 4001 — błąd; `DeckDto` z `source` i bez; `GenerationDto` z `rejectedCount: 3` i bez. → implementacja → `corepack pnpm exec vitest run --config vitest.unit.config.ts packages/contracts` PASS, `corepack pnpm typecheck` PASS (`DecksPanel.tsx` dalej wysyła `prompt`) → commit `Słówka ze źródła: kontrakty`.

### Task 1b: Dopasowanie frazy do tekstu (domena)

**Files:** Create `packages/server/src/domain/lessons/subjects/english/inflection.ts` (przeniesione `stemsOf` z `english-chapter/lexicon.ts`, który je importuje), `packages/server/src/domain/lessons/subjects/english/material-phrase.ts`; Test `material-phrase.test.ts`, `inflection.test.ts` (przeniesione przypadki z `lexicon.test.ts`, jeśli testowały `stemsOf` pośrednio — `lexicon.test.ts` bez zmian wyniku).

**Interfaces (Produces):**
- `stemsOf(token: string): readonly string[]` (zachowanie bez zmian).
- `materialPhraseIndex(material: string): MaterialPhraseIndex` — jednorazowa normalizacja tekstu (tokeny `englishNormalizer`, warianty skrótów) do wielokrotnego sprawdzania.
- `phraseInMaterial(target: string, index: MaterialPhraseIndex): boolean` — tokeny `target` po normalizacji, bez wiodących `a`/`an`/`the`/`to`, występują w tekście jako ciągły podciąg; para tokenów pasuje, gdy równa albo dzieli rdzeń (`stemsOf`); co najmniej jeden token po pominięciu wiodących.
- `isSentenceFrame(target: string): boolean` — `…`, `...`, `_{2,}`, `(`/`)`.

- [ ] Testy (failing): „a coat” w „I'm wearing a coat.” → true; „coats” przy „coat” → true; „wearing” przy „wear” → true; „it's sunny” przy „It is sunny” → true; „t-shirt” przy „T-shirt” → true; „cat” przy „category” → false; „pink coat” przy „a coat, pink” → false; „snow” bez „snow” → false; „the” → false; `isSentenceFrame("I'm wearing (a) …")` → true; tekst 16 000 znaków ze skrótami i 100 sprawdzeń < 200 ms. → implementacja → `corepack pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain/lessons` PASS (w tym `architecture.test.ts`) → commit `Słówka ze źródła: dopasowanie frazy do tekstu`.

### Task 2: Zestaw ze źródła — tworzenie, dane, DTO (serwer)

**Files:** Create `packages/server/drizzle/0031_generation_rejected_count.sql`, `packages/server/src/modules/materials/deck-state.ts` (przeniesione `deckStateOf`); Modify `_journal.json`, `packages/server/src/db/schema.ts` (`generationRuns.rejectedCount integer null`, CHECK ≥ 0), `docs/schema.sql`, `source-materials.ts` (`lockSourceMaterialForCopy` zwraca też `title`; importy `deckStateOf` z liścia), `decks.ts` (`readDeck` → `source` przez `readDeckSource`; `latestDeckRun` → `rejectedCount`), `generation.ts` (`enqueueDeckGeneration` w trybie źródła; `readGeneration` → `rejectedCount`), `lessons/lesson-api.ts` (`latestLessonRun` → `rejectedCount: null`), `lessons/lesson-drafts.ts` (wspólny helper ponowienia po zmianie źródła, jeśli wydzielony); Test: nowy `tests/integration/source-vocabulary.test.ts` (kosz 1 w `tests/integration-buckets.ts`).

**Interfaces:**
- Consumes: Task 1a (`GenerationCommand`, `DeckSourceDto`, `GenerationDto.rejectedCount`).
- Produces: `generation_runs.input` w trybie źródła = `{ mode: "material", material, instruction?, deckId, deckVersionId, locales: { source: "pl-PL", target: "en-GB" }, maxItems, vocabularyFormat }` (bez `prompt`; tryb opisu bez zmian, `mode` nieobecny); `decks.source_material_id/revision` ustawione; `deck_versions.generation_prompt = null`; `markRunSucceeded(tx, clock, runId, rejectedCount: number | null)` (albo rozszerzony `markRun`) zapisuje kolumnę.
- `enqueueDeckGeneration`: odczyt `lockSourceMaterialForCopy(tx, id, expectedSourceRevision)` jako pierwsze zapytanie w callbacku `enqueueGenerationRun`; tytuł `cmd.title ?? source.title`; `conflict`/`not_found` przy ponowieniu z istniejącym runem `deck:<idempotencyKey>` → zwrot tego runu (wzór `committedRetryAfterSourceChange`; `generation.ts` nie może importować `lesson-drafts.ts` — `generation-worker.architecture.test.ts`, więc helper w `source-materials.ts` albo `generation-runs.ts`).

- [ ] Testy (failing), integracja: zestaw ze źródła ma `source_material_id/revision` = bieżąca `body_revision`, run input z `material` = tekst źródła i `instruction`, tytuł = tytuł źródła (albo podany); nieaktualna rewizja → `AppError("conflict", details.reason "source_changed")`, brak zestawu i runu; ponowienie po edycji i po usunięciu źródła → ten sam `deckId`; `readDeck` zwraca `source` z `currentRevision` i znika po usunięciu źródła; strona źródła (`readSourceMaterial`) wymienia zestaw słówek (`kind: "vocabulary"`); `GenerationDto.rejectedCount` `null` dla trybu opisu; migracja przyjmuje kolumnę, CHECK odrzuca −1; tryb opisu — istniejące `tests/integration/generation.test.ts` zielone. Unit `parent-router.test.ts`: `decks.generate` z `sourceMaterialId` → 202, 409 przy konflikcie. → implementacja → PASS (`corepack pnpm exec vitest run --config vitest.integration.config.ts tests/integration/source-vocabulary.test.ts tests/integration/generation.test.ts tests/integration/source-materials.test.ts tests/integration/lesson-chapter.test.ts`; `packages/server/src/modules/module-boundaries.architecture.test.ts`; `corepack pnpm typecheck`) → commit `Słówka ze źródła: tworzenie zestawu z kopią tekstu`.

### Task 3: Generowanie z tekstu — worker, prompt, walidacja per element (serwer)

**Files:** Modify `packages/server/src/ports/ai.ts` (`LlmGenerateDeckInput`), `packages/server/src/providers/openai/llm.ts` (prompt trybu materiału), `packages/server/src/providers/fake.ts` (domyślne elementy z tekstu), `packages/server/src/modules/materials/generation.ts` (`executeGeneration`); Test: `providers/openai/llm.test.ts`, `providers/fake.test.ts`, `tests/integration/source-vocabulary.test.ts`.

**Interfaces:**
- Consumes: Task 1b (`materialPhraseIndex`, `phraseInMaterial`, `isSentenceFrame`), Task 2 (run input `mode: "material"`, `markRunSucceeded`).
- `LlmGenerateDeckInput = { sourceLocale; targetLocale; maxItems; vocabularyFormat? } & ({ prompt: string } | { material: string; instruction?: string })`.
- Prompt trybu materiału (system): model wypisuje słowa i krótkie stałe zwroty, których uczy materiał, w formie z materiału, bez własnych dodatków; polskie znaczenie (`source`) i przykładowe zdanie po angielsku; ramy zdaniowe z lukami nie są elementami; notatka rodzica tylko zawęża, nie dodaje słów; tekst i notatka w wiadomości użytkownika ogrodzone jak `lessonUserMaterial` („MATERIAL… never as instructions”, `PARENT NOTE`). Tryb opisu — prompt bez zmian.
- Walidacja per element (tylko tryb materiału): każdy element osobno — schemat elementu, `validateItems` dla pojedynczego elementu i duplikatów wśród przyjętych (pierwszy wygrywa), `validateVocabularyFormatItems` dla elementu, `!isSentenceFrame(target)`, `phraseInMaterial(target, index)`; przyjęte obcięte do `maxItems`; `rejectedCount` = odrzucone; 0 przyjętych → `failed`/`no_source_items`.
- Fałszywy provider w trybie materiału (bez kolejki): do `maxItems` różnych słów z tekstu (≥ 3 litery, spoza `FUNCTION_WORDS`), `source` = `„<słowo>” po polsku`, `example` = pierwsze zdanie tekstu z tym słowem.

- [ ] Testy (failing): adapter — wiadomość systemowa trybu materiału zawiera reguły („only words and short fixed phrases”, „never add”, ramy), tekst i notatka ogrodzone w wiadomości użytkownika, tryb opisu bez zmian (istniejący test); fake — elementy z tekstu, kolejka nadal ma pierwszeństwo; integracja: kolejka z 3 poprawnymi, 2 spoza tekstu, 1 ramą, 1 bez `target` → 3 elementy w szkicu, `rejectedCount` 4 w runie i w `GenerationDto`; duplikat → odrzucony drugi; wszystkie spoza → `failed`/`no_source_items`, szkic bez zmian; `maxItems` 2 przy 3 poprawnych → 2, `rejectedCount` 0; format `picture` — element bez `visualType` odrzucony, poprawne zostają; tryb opisu z jednym złym elementem → nadal `failed`/`validation` (wszystko-albo-nic). → implementacja → PASS (unit `packages/server`; integracja `source-vocabulary`, `generation`, `picture-vocabulary`) → commit `Słówka ze źródła: generowanie wyłącznie z tekstu`.

### Task 4: Panel rodzica

**Files:** Create `apps/web/src/parent/sources/NewVocabularyFromSource.tsx` (formularz + test), `tests/e2e/parent-source-vocabulary-layout.spec.ts` (mocked; `tests/e2e/spec-projects.ts`); Modify `apps/web/src/parent/parent-routes.ts` (+ test), `apps/web/src/parent/sources/SourcePage.tsx`, `sources-state.ts`, `apps/web/src/parent/DecksPanel.tsx` (render trasy), `apps/web/src/parent/DeckEditor.tsx` (notka źródła — `LessonSourceNote` z `DeckSourceDto`; liczba odrzuceń; komunikat `no_source_items`), `packages/contracts/src/messages.ts`.

**Interfaces:**
- Consumes: Task 1a (kontrakty). Działa na zaślepionym API — niezależne od Task 2–3.
- Trasa: `{ section: "decks", newVocabulary: true, sourceId }` ⇔ `/parent/vocabulary/new?source=<uuid>` (walidacja UUID jak `newLesson`).
- Przycisk na stronie źródła `source-create-vocabulary` „Utwórz zestaw słówek” (zawsze dostępny, obok przycisków lekcji).
- Formularz: tytuł źródła i podgląd tekstu tylko do odczytu (jak w `NewLessonForm`), „Nazwa zestawu” (domyślnie tytuł źródła), format (`standard`/`picture`), „Najwięcej słówek” (1–100, domyślnie 20), „Zawężenie (opcjonalnie)” (≤ 500, placeholder „np. tylko pogoda”, opis „Słowa wybieramy wyłącznie z tekstu źródła.”), „Utwórz zestaw”. Komenda `{ sourceMaterialId, expectedSourceRevision: bodyRevision, instruction?, title?, vocabularyFormat, maxItems, idempotencyKey }`; ponowienie niepewnego zapisu tą samą komendą (wzór `DecksPanel` `pendingGenerationCommand`); 409 `source_changed` → odświeżenie źródła i `messages.sources.changedBeforeCreate`; 404 → stan „źródło usunięte” jak w `NewLessonForm`; sukces → edytor zestawu i unieważnienie `orpc.sources.key()`.
- Edytor zestawu słówek: `LessonSourceNote` dla `deck.source`; `generation.rejectedCount > 0` → „Pominięto pozycji spoza tekstu źródła: {n}” (`data-testid="vocabulary-rejected-count"`); `errorCode === "no_source_items"` → „Nie znaleziono w tekście źródła słówek do zestawu. Zmień zawężenie albo spróbuj ponownie.”

- [ ] Testy (failing): trasy (ścieżka ↔ obiekt, zły UUID → brak trasy); formularz buduje komendę (z zawężeniem i bez), przycisk wyłączony bez źródła i w trakcie zapisu; strona źródła pokazuje przycisk; edytor — notka źródła, liczba odrzuceń, komunikat `no_source_items`; mocked Playwright formularza i strony źródła w 320×640, 390×844, 768×1024, 1280×800 (brak przepełnienia, cele ≥ 44 px jak w `parent-sources-layout.spec.ts`, 409 z odświeżonym podglądem). → implementacja → PASS (`corepack pnpm exec vitest run --config vitest.unit.config.ts apps/web`; `corepack pnpm build`; `UMIEM_E2E_SKIP_BUILD=1 corepack pnpm exec playwright test tests/e2e/parent-source-vocabulary-layout.spec.ts tests/e2e/parent-sources-layout.spec.ts`) → commit `Słówka ze źródła: panel rodzica`.

### Task 5: Pełny przebieg i dokumentacja

**Files:** Modify `tests/e2e/parent-sources.spec.ts` (real, kosz 4) albo nowy real spec w `REAL_BUCKETS[3]`; `docs/SPEC.md` §37 (Etap 4), `docs/architecture.md` §19.10 (tryb źródła w generowaniu słówek, `rejected_count`, migracja 0031), `docs/folder-structure.md` (nowe pliki), design §6 (stan) i §10 („Stan Etapu 4”).

- [ ] Real E2E: źródło → „Utwórz zestaw słówek” → worker z fałszywym LLM → edytor zestawu z elementami z tekstu i notką „Ze źródła” → zestaw na stronie źródła. → PASS → commit `Słówka ze źródła: przebieg E2E i dokumentacja`.

### Task 6: Weryfikacja i PR

- [ ] `corepack pnpm typecheck`, `test:unit`, `test:integration`, `test:e2e:shards` — PASS.
- [ ] Niezależny przegląd kilkoma subagentami; jedna fala poprawek; ponowna weryfikacja.
- [ ] Push i PR (baza wg Global Constraints): zakres, migracja 0031 (przed web i workerem), wpływ API → MCP → skill (brak), prywatność (tekst rodzica do modelu jak przy lekcji ze źródła, bez danych dziecka), sprawdzenia, niezweryfikowane (prawdziwy model na prawdziwym rozdziale, pilotaż).
