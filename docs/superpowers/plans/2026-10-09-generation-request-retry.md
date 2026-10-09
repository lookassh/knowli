# Bezpieczne ponawianie generacji — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Bez delegacji bez zgody właściciela.

**Goal:** Ponowić niepewne przyjęcie zlecenia bez drugiego zestawu i runu.

**Architecture:** Klient zachowuje migawkę polecenia i UUID do sukcesu lub definitywnego odrzucenia. Obecna deduplikacja serwerowa zapewnia jedną logiczną operację. Sukces tworzenia oddzielony od refresh listy.

**Tech Stack:** TypeScript/React, obecne GenerationCommand i UuidSchema, Vitest, Playwright/PostgreSQL z fake-providerami.

**Spec:** `../specs/2026-10-09-learning-and-parent-reliability-design.md` §5–6; wspólny odbiór w `2026-10-09-learning-and-parent-reliability.md`.

## Global Constraints

- Identyczny payload i klucz do rozstrzygnięcia, retry wyłącznie ręczne.
- Brak nowego endpointu i storage; reload usuwa pamięć polecenia.
- Sukces to zweryfikowane generationRunId/deckId aktualnego HTTP 202, nie refresh.

## Review Focus

Utrata odpowiedzi, wadliwy JSON/UUID w 202, podwójne kliknięcie, wygaśnięcie
sesji i refresh fail mają testy C1–C2.

### Task 1: Polecenie i przyjęcie (C1)

**Files:** Create `apps/web/src/parent/{generation-request.ts,generation-request.test.ts}`; Modify `DecksPanel.tsx`, `packages/contracts/src/messages.ts`; reuse `ParentApp.onAuthExpired` wiring added in B2; Create `tests/e2e/generation-request-retry.spec.ts`.

**Interfaces:** `GenerationAcceptance = {generationRunId:string;deckId:string}`; `readGenerationAcceptance(value:unknown):GenerationAcceptance|null` weryfikuje UUID przez UuidSchema. `isDefinitiveGenerationRejection(error:unknown):boolean`: true dla ApiCallError 400+validation i 401/403, false dla sieci/5xx/nieczytelnej odpowiedzi. Pending ref ma istniejący GenerationCommand; osobny ref busy. `DecksPanel.onAuthExpired:()=>void` z B2 prowadzi do login.

- [x] Unit: błędny/brak UUID nie jest sukcesem; poprawna odpowiedź daje identyfikatory; 400 validation, 401, 403 definitywne, TypeError/SyntaxError/500 niepewne. RED: brak modułu, potem 7/7 GREEN.
  ```ts
  it("treats malformed acceptance as uncertain", () => {
    expect(readGenerationAcceptance({generationRunId:"invalid",deckId:"invalid"})).toBeNull();
    expect(isDefinitiveGenerationRejection(new SyntaxError("invalid JSON"))).toBe(false);
    expect(isDefinitiveGenerationRejection(new ApiCallError("error","internal",500))).toBe(false);
  });
  ```
- [x] E2E: route.fetch przyjmuje pierwszy POST, route.abort gubi odpowiedź, retry zachowuje `bodies[0]` i `bodies[1]`. Query PostgreSQL przez worldFile A0 potwierdza jeden run/deck; edytor otwiera ten deck. RED: klient pokazał `Failed to fetch`; po implementacji GREEN.
- [x] Implementować migawkę przed POST i synchroniczny ref guard; przy uncertainty polski komunikat i przycisk „Ponów tworzenie”. Prompt/tytuł/tworzenie pustego zablokowane do rozstrzygnięcia. Retry wysyła ten sam obiekt.
- [x] 401/403 czyści pending, 401 wywołuje istniejące onAuthExpired, 403 pokazuje odmowę; validation odblokowuje korektę. Niepewny wynik zachowuje dane. Sukces otwiera DeckEditor; refresh listy oddzielny. Nowe tworzenie ma nowy UUID. Late response po unmount nie otwiera obcego edytora.
- [x] GREEN unit 7/7, E2E utrata odpowiedzi 1/1 z PostgreSQL, `pnpm typecheck`.

### Task 2: Macierz błędów i regresje (C2)

**Files:** Modify `tests/e2e/{generation-request-retry.spec.ts,parent-flow.spec.ts}`, `docs/{SPEC,architecture,folder-structure,implementation-plan}.md`. Serwer generation bez zmian, chyba że test ujawni błąd — wtedy systematic-debugging i aktualizacja planu przed poprawką.

**Interfaces:** Consumes aktualne API `{generationRunId,deckId}`, worldFile A0, fake-worker; produces dowody HTTP+PostgreSQL jednej operacji, bez gwarancji exactly-once opłat providera.

- [x] E2E: błędny JSON/UUID w 202 i 500 po przyjęciu zachowują payload do retry; błędny deckId nie otwiera edytora; dwa synchroniczne kliknięcia wysyłają jeden POST; validation odblokowuje korektę; 401 prowadzi do logowania; 403 kończy polecenie bez retry.
- [x] E2E refresh fail po sukcesie pozostawia edytor działający i potwierdza pojedynczy POST/run/deck. Kolejna świadoma generacja ma inny UUID. parent-flow otwiera edytor po 202 i zachowuje reload trwającej generacji oraz publikację.
  Asercje `malformed_202_retries_original_command` po obu kliknięciach:
  ```ts
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(runRows).toHaveLength(1);
  expect(deckRows).toHaveLength(1);
  ```
- [x] Główny brakujący przypadek utraty odpowiedzi uruchomiono jako RED przed implementacją. Macierz uzupełniająca przeszła 11/11.
- [x] Regresje `manual-deck-flow` i `parent-flow`; integracyjne `generation.test.ts` i `manual-decks-api.test.ts` w pełnym przebiegu. Widok uncertainty obejrzany w trzech viewportach; klucz techniczny nie jest wyświetlany.
- [x] Docs opisują pamięć tylko do reloadu i osobny refresh; `pnpm typecheck`; commit `test: cover generation acknowledgement and retry failures`.

## Checklista

- [x] Self-review: §5, aktualna odpowiedź API, klasyfikacja błędów i Review Focus.
- [x] Właściciel zaakceptował wykonanie C w tej rozmowie; bez delegacji.
- [x] C1–C2 z RED/GREEN i commitami (`b5b0791` i następny commit C2); wspólny odbiór i raport ograniczeń.
