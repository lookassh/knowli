# Ręczne tworzenie zestawu od zera — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Delegacja i superpowers:subagent-driven-development są dostępne wyłącznie po wyraźnej zgodzie właściciela, zgodnie z AGENTS.md.

**Goal:** Rodzic tworzy pusty zestaw Umiem!, wpisuje własne słówka w istniejącym edytorze i publikuje je bez generowania treści przez LLM.

**Architecture:** Nowe POST Parent API tworzy atomowo deck i pusty draft. UUID klienta pozwala bezpiecznie ponawiać żądanie bez dodatkowej tabeli i generation_run. Obecny PATCH przygotowuje media, a obecna publikacja sprawdza kompletność materiału.

**Tech Stack:** TypeScript strict, React, Next.js App Router, Zod, Drizzle/PostgreSQL, pnpm, Vitest, Playwright. Bez nowych zależności.

**Spec:** `docs/superpowers/specs/2026-10-09-manual-deck-creation-design.md` — zatwierdzona przez właściciela 2026-10-09; commit dokumentu `39dbe2d`.

## Global Constraints

- Typ materiału vocabulary; locale `pl-PL → en-GB`; polski interfejs i marka Umiem!.
- Tytuł po trim: 1–200 znaków, domyślnie „Nowy zestaw”; do 50 elementów.
- Nowa trasa wymaga sesji rodzica i istniejącej kontroli Origin.
- Pusty szkic nie tworzy learning_items, rewizji, kluczy umiejętności, mediów, generation_run ani zadań Graphile Worker.
- Brak migracji; nie osłabiać minimum jednego elementu w DraftInputSchema i DraftPatchSchema.items.
- Publikacja wymaga zapisanego niepustego materiału oraz wymaganych mediów; szkice są niedostępne dziecku.
- Testy używają syntetycznych słówek, kontrolowanego zegara i fake-providerów; integracja korzysta z PostgreSQL, nie PGlite.
- Zachować istniejący przepływ AI, optimistic locking i niezmienność opublikowanych wersji.
- Przed implementacją zatwierdzić ten plan i wybrać wykonanie. Nie uruchamiać subagentów bez zgody.

## Review Focus

1. Odpowiedź POST zaginęła po zapisie: ponowienie otwiera ten sam deck, również po jego edycji — zadania 1 i 3.
2. GET listy nie działa po udanym POST: edytor mimo to otwiera utworzony deck — zadanie 3.
3. Puste spacje i tytuł długości 201: odpowiednio domyślny tytuł w UI i odrzucenie za długiego wejścia, bez częściowego zapisu — zadania 1–3.
4. Dwa równoległe POST z jednym UUID: jedna wersja, jedna odpowiedź 201, druga 200, bez nadpisania tytułu — zadania 1–2.
5. Odświeżenie danych edytora podczas pisania lub zapis w toku: polling nie kasuje wpisów, a publikacja nie omija niezapisanej treści — zadanie 3.

## Mapa plików

| Plik | Rola |
| --- | --- |
| `packages/contracts/src/decks.ts` | Nowe schematy polecenia i odpowiedzi |
| `packages/contracts/src/messages.ts` | Etykiety i komunikaty ręcznej ścieżki |
| `packages/contracts/src/manual-decks.test.ts` (nowy) | Walidacja nowego kontraktu |
| `packages/server/src/modules/decks.ts` | createEmptyDeck w istniejącym module |
| `packages/server/src/index.ts` | Eksport funkcji i typu wyniku |
| `tests/integration/manual-decks.test.ts` (nowy) | Transakcja, deduplikacja, zapis i publikacja |
| `apps/web/src/parent/parent-router.ts` | Jawna nowa trasa |
| `tests/integration/manual-decks-api.test.ts` (nowy) | HTTP i zabezpieczenia |
| `apps/web/src/parent/DecksPanel.tsx` | Przycisk, retry i otwarcie edytora |
| `apps/web/src/parent/DeckEditor.tsx` | Pusty stan, zapis tytułu i blokady publikacji |
| `tests/e2e/manual-deck-flow.spec.ts` (nowy) | Przepływ i awarie UI |
| `docs/{SPEC,architecture,folder-structure,implementation-plan}.md` | Uzgodniony kontrakt i kryteria odbioru |

Istniejące helpers.ts, fakes.ts i testy AI/mediów służą jako wzorce i regresje.
Nie zmieniać konfiguracji runnerów bez stwierdzonej potrzeby.

### Task 1: Kontrakt i atomowe tworzenie pustego szkicu

**Pliki:** kontrakty i messages z mapy, server/modules/decks.ts, server/index.ts; nowe manual-decks.test.ts w contracts oraz tests/integration.

**Interfaces:**
- Consumes: Services, testDatabase(), ManualClock, fakeGeneration(), readDeck(), editDraft(), publishDraft(), runDueGenerationWork().
- Produces: `CreateEmptyDeckCommandSchema`, `type CreateEmptyDeckCommand = { deckId: string; title?: string }`, `CreateEmptyDeckResultSchema`, `type CreateEmptyDeckResult = { deckId: string }`.
- Produces: `createEmptyDeck(services: Services, input: CreateEmptyDeckCommand): Promise<{ deckId: string; created: boolean }>`; created jest wewnętrznym znacznikiem dla statusu HTTP i nie występuje w publicznej odpowiedzi.

- [x] Napisz testy kontraktu: poprawny UUID, opcjonalny tytuł, trim, puste spacje odrzucone przy podanym title, 200 znaków poprawne, 201 odrzucone. Odrzuć prompt/items przez strict schema. Zweryfikuj odpowiedź UUID. Zachowaj test odrzucenia pustych items w DraftInputSchema i DraftPatchSchema.

```ts
expect(CreateEmptyDeckCommandSchema.parse({ deckId, title: "  Zwierzęta  " }))
  .toEqual({ deckId, title: "Zwierzęta" });
expect(CreateEmptyDeckCommandSchema.safeParse({ deckId, title: " ".repeat(3) }).success).toBe(false);
expect(CreateEmptyDeckCommandSchema.safeParse({ deckId, title: "a".repeat(201) }).success).toBe(false);
expect(CreateEmptyDeckResultSchema.safeParse({ deckId: "invalid" }).success).toBe(false);
```

- [x] Uruchom `pnpm test:unit packages/contracts/src/manual-decks.test.ts`; RED: 3 awarie przez brak eksportowanych schematów.
- [x] Dodaj wskazane schematy i eksporty przez istniejący `export * from "./decks"`. W messages dodaj `decks.createEmpty = "Utwórz pusty zestaw"`, `defaultTitle = "Nowy zestaw"`, `emptyDraft = "Dodaj pierwsze słówko"`, `saveBeforePublish = "Najpierw zapisz zmiany"`, `emptyPublish = "Dodaj i zapisz przynajmniej jedno słówko."`; zmień addItem na „Dodaj słówko”.
- [x] Napisz testy integracyjne z istniejącym testDatabase/ManualClock i czyszczeniem tabel zestawów jak w decks-management.test.ts. Utworzenie bez providerów musi działać. Z fakeGeneration szpieguj generateDeck i potwierdź brak wywołań. Sprawdź wszystkie zerowe liczniki wymienione w ograniczeniach.

```ts
const result = await createEmptyDeck(services, { deckId });
expect(result).toEqual({ deckId, created: true });
expect(await readDeck(services, deckId)).toMatchObject({
  title: "Nowy zestaw", generation: null, published: null,
  draft: { status: "draft", editNumber: 1, items: [], assets: [] },
});
const duplicates = await Promise.all([
  createEmptyDeck(services, { deckId: secondId, title: "Pierwszy" }),
  createEmptyDeck(services, { deckId: secondId, title: "Drugi" }),
]);
expect(duplicates.filter((result) => result.created)).toHaveLength(1);
// SQL: dokładnie jedna deck_version dla secondId; tytuł pochodzi od zwycięzcy.
```

- [x] Dodaj test: zmień tytuł pustego draftu przez PATCH domeny, ponów tworzenie z tym samym UUID i potwierdź brak resetu editNumber/tytułu wersji; analogicznie po publikacji nie zmienia się publishedVersionId. Niepoprawny tytuł nie zapisuje deck ani wersji.
- [x] Uruchom `pnpm test:integration tests/integration/manual-decks.test.ts`; RED: 3 awarie „createEmptyDeck is not a function”.
- [x] Implementuj createEmptyDeck: walidacja przed transakcją; INSERT deck z onConflictDoNothing na id i returning; jeśli brak wstawionego wiersza, zwróć created=false bez zmiany istniejącego deck. Jeśli wstawiono, INSERT deck_version v1 z losowym UUID, editNumber=1, state=draft, title i locale. Transakcja obejmuje oba INSERT-y; równoległy konflikt klucza oczekuje na zakończenie pierwszej transakcji. Nie zlecaj kolejki i nie wywołuj createDraft wymagającego kart.
- [x] Dodaj test pełnej ścieżki domeny: pusta publikacja rzuca validation; zapis jednej kompletnej karty tworzy pięć skill_versions i zleca TTS; publikacja przed wykonaniem TTS odrzucona, po fake-workerze dozwolona. Z użyciem visualType=image sprawdź obecną możliwość pominięcia ilustracji. Liczba wywołań LLM pozostaje zero.
- [x] Uruchom `pnpm test:integration tests/integration/manual-decks.test.ts tests/integration/revisions.test.ts tests/integration/decks-management.test.ts tests/integration/media.test.ts`; PASS: 32 integracyjne. `pnpm test:unit` PASS: 232 testy. `pnpm typecheck` PASS.
- [x] Commit `227b055`: `feat: create empty vocabulary decks without generation`.

### Task 2: Zabezpieczone Parent API

**Pliki:** parent-router.ts, tests/integration/manual-decks-api.test.ts; docs/architecture.md (nowa trasa).

**Interfaces:**
- Consumes: createEmptyDeck i kontrakty zadania 1; `handleParentApi(request, services, segments): Promise<Response>`.
- Produces: `POST /api/v1/parent/decks`, wejście CreateEmptyDeckCommand, JSON CreateEmptyDeckResult, status 201 lub 200.

- [x] Napisz testy routera na prawdziwej bazie: zbuduj sesję przez setupParent/loginParent i Request z cookie parent_session oraz Origin localhost. Wywołuj handleParentApi z segments `["decks"]`. Poprawny POST zwraca 201; powtórzenie 200; dwa współbieżne POST zwracają posortowane statusy `[200, 201]` i jeden deck. Niepoprawny UUID/tytuł oraz prompt/items odrzucone bez zapisu. Brak cookie rzuca unauthorized, obcy Origin forbidden, licznik deck pozostaje zero.

```ts
const response = await handleParentApi(request, services, ["decks"]);
expect(response.status).toBe(201);
expect(await response.json()).toEqual({ deckId });
// request to nowe Request dla każdego wywołania (body czytane raz).
```

- [x] Uruchom `pnpm test:integration tests/integration/manual-decks-api.test.ts`; RED: poprawne żądanie kończyło się istniejącym `not_found`; kontrole sesji i Origin przechodziły.
- [x] Dodaj gałąź POST z second===undefined po obecnej ochronie sesji i Origin. Parse wejścia, wywołaj createEmptyDeck, zweryfikuj/publicznie zmapuj odpowiedź do `{deckId}`, dobierz status z created. Nie zmieniaj /generate ani /:id/draft. Uaktualnij tabelę API i opis pustego ręcznego szkicu w architecture.md.
- [x] Powtórz testy API i `pnpm test:integration tests/integration/auth-profiles.test.ts tests/integration/generation.test.ts`; PASS: 22 testy integracyjne. `pnpm typecheck` PASS.
- [x] Commit `d220484`: `feat: expose authenticated manual deck creation API`.

### Task 3: Przycisk i bezpieczna edycja pustego szkicu

**Pliki:** DecksPanel.tsx, DeckEditor.tsx, tests/e2e/manual-deck-flow.spec.ts; docs/SPEC.md i docs/folder-structure.md.

**Interfaces:**
- Consumes: API zadania 2, messages zadania 1, istniejące apiFetch<T>, props DeckEditor i onChanged(): Promise<void>.
- Produces: testid `create-empty-submit`, `empty-draft`, `publish-blocked-reason`; zachowuje `editor-title`, `editor-back`, `add-item`, `save-items`, `publish-deck` i selektory kart.

- [x] E2E loguje PIN-em 1234. Bez promptu tworzy i ponownie otwiera „Nowy zestaw” z empty-draft i bez kart; osobny przypadek trimuje własny tytuł, ignoruje prompt i potwierdza zero żądań /generate.

```ts
await page.getByTestId("create-empty-submit").click();
await expect(page.getByTestId("editor-title")).toHaveValue("Nowy zestaw");
await expect(page.getByTestId("empty-draft")).toHaveText("Dodaj pierwsze słówko");
await expect(page.locator('[data-testid^="item-card-"]')).toHaveCount(0);
await expect(page.getByTestId("publish-deck")).toBeDisabled();
```

- [x] E2E potwierdza idempotentne ponowienie po utraconej odpowiedzi, otwarcie edytora mimo błędu GET listy oraz blokadę obu przycisków podczas POST.
- [x] Początkowy E2E RED: brak przycisku create-empty-submit.
- [x] DecksPanel przechowuje niezmienny command UUID przy niepewnym błędzie; odświeżenie listy nie jest częścią wyniku tworzenia.
- [x] E2E edytora potwierdza title-only PATCH bez items, walidację niekompletnej karty, blokadę publikacji i pól podczas zapisu oraz ochronę wpisów przy aktywnym pollingu.
- [x] RED dla pustego PATCH: walidacja odrzucała `items: []`; test potwierdził problem przed zmianą edytora. Reaktywna blokada publikacji jest weryfikowana przez E2E przed i po zapisie.
- [x] DeckEditor utrzymuje reaktywny isDirty, zapisuje sam tytuł pustego draftu, blokuje publikację do zapisu kompletnej karty oraz blokuje mutacje podczas zapisu.
- [x] E2E manualne i `parent-flow.spec.ts` przechodzą; dotychczasowa ścieżka publikacji zachowana.
- [x] SPEC opisuje ręczne tworzenie, a folder-structure rzeczywiste ścieżki panelu i routera.
- [x] Commit `a72a193`: `feat: open empty decks in the parent editor`.

### Task 4: Pełny przepływ, regresje i odbiór

**Pliki:** tests/e2e/manual-deck-flow.spec.ts, docs/implementation-plan.md; ten plan i spec (checklista).

**Interfaces:**
- Consumes: interfejs zadania 3, istniejące przypisania i Kid API.
- Produces: dowody ręcznego obiegu oraz raport sprawdzonych i brakujących kryteriów.

- [x] E2E całego ręcznego obiegu potwierdza brak zestawu w Kid API przed publikacją oraz widoczność po publikacji/przypisaniu, zero żądań generowania; karta „kot” → „cat” zapisuje się i otwiera ponownie.
- [x] Widoki 390×844, 768×1024 i 1440×900 sprawdzone w Playwright; sześć zrzutów obejrzanych, przycisk/pusty stan/karta/zapis widoczne, brak poziomego overflow.
- [x] Unit 232/232, integration PostgreSQL 131/131, typecheck sześciu projektów, build oraz `git diff --check` przechodzą. Pełne E2E w prywatnym runnerze: 23/23.
- [x] Wyniki wszystkich testów odnotowano w ledgerze i implementation-plan; izolacja testu jednego profilu poprawiona, pełny przebieg 23/23.
- [x] Implementation-plan zawiera zakres ręcznej ścieżki; checklisty specyfikacji i planu odzwierciedlają tylko wykonane prace.
- [x] Verification-before-completion i self-review całego diffu względem spec: publikacja, media, retry, brak LLM, granice pakietów i zakres plików sprawdzone. Brak delegacji zgodnie z AGENTS.md; niezależny reviewer nie był dostępny bez delegacji.
- [x] Commit wyłącznie plików tego zadania: `test: verify manual deck creation workflow`; bez pushowania i integracji.

## Przegląd planu i przekazanie

- [x] Zakres odpowiada jednej zatwierdzonej specyfikacji.
- [x] Mapa plików i granice modułów ustalone na podstawie obecnego repo.
- [x] Typy wejścia, publicznej odpowiedzi i wewnętrznego wyniku zgodne między zadaniami.
- [x] Kryteria spec pokryte; pięć Review Focus przypisane do testów.
- [x] RED przed nowym kodem, regresje, realny PostgreSQL i końcowe sprawdzenia zapisane.
- [x] Właściciel zatwierdził ten plan i wybrał sposób wykonania.
- [x] Executing-plans i TDD uruchomione.
- [x] Zadania 1–4 zakończone i zweryfikowane.

Rekomendacja: wykonanie samodzielne w tej rozmowie przez executing-plans,
ponieważ cztery zadania składają się na jeden mały przepływ z zależnymi kontraktami.
Obecny checkout jest już worktree zarządzanym przez Codex; na początku wykonania
using-git-worktrees ma potwierdzić to i nie tworzyć kolejnego checkoutu.
Wymagany przez skill niezależny review pozostaje zależny od wyraźnej zgody
na delegację; AGENTS.md ma pierwszeństwo.
