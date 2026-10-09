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

### C1: Polecenie i przyjęcie

**Files:** Create `apps/web/src/parent/{generation-request.ts,generation-request.test.ts}`; Modify `DecksPanel.tsx`, `ParentApp.tsx`, `packages/contracts/src/messages.ts`; Create `tests/e2e/generation-request-retry.spec.ts`.

**Interfaces:** `GenerationAcceptance = {generationRunId:string;deckId:string}`; `readGenerationAcceptance(value:unknown):GenerationAcceptance|null` weryfikuje UUID przez UuidSchema. `isDefinitiveGenerationRejection(error:unknown):boolean`: true dla ApiCallError 400+validation i 401/403, false dla sieci/5xx/nieczytelnej odpowiedzi. Pending ref ma istniejący GenerationCommand; osobny ref busy. `DecksPanel.onAuthExpired:()=>void` z B2 prowadzi do login.

- [ ] Unit: błędny/brak UUID nie jest sukcesem; poprawna odpowiedź daje identyfikatory; 400 validation, 401, 403 definitywne, TypeError/SyntaxError/500 niepewne. RED `pnpm test:unit apps/web/src/parent/generation-request.test.ts`, potem helpery.
  ```ts
  it("treats malformed acceptance as uncertain", () => {
    expect(readGenerationAcceptance({generationRunId:"invalid",deckId:"invalid"})).toBeNull();
    expect(isDefinitiveGenerationRejection(new SyntaxError("invalid JSON"))).toBe(false);
    expect(isDefinitiveGenerationRejection(new ApiCallError("error","internal",500))).toBe(false);
  });
  ```
- [ ] E2E: route.fetch przyjmuje pierwszy POST, route.abort gubi odpowiedź, retry zachowuje wartości `bodies[0]` i `bodies[1]`. Query PostgreSQL przez worldFile A0: jeden run/deck dla idempotencyKey; edytor otwiera ten deck. RED `pnpm test:e2e tests/e2e/generation-request-retry.spec.ts --grep lost`.
- [ ] Implementować migawkę przed POST i synchroniczny ref guard; po uncertainty tekst „Zlecenie mogło zostać przyjęte. Ponów tworzenie, aby sprawdzić jego wynik.” i przycisk „Ponów tworzenie”. Prompt/tytuł/tworzenie pustego zablokowane do rozstrzygnięcia. Retry wysyła ten sam obiekt.
- [ ] 401/403 czyści pending, 401 wywołuje onAuthExpired, 403 pokazuje odmowę; validation odblokowuje korektę. Niepewny wynik zachowuje dane. Sukces czyści pending i otwiera DeckEditor; refresh listy oddzielny i nie usuwa sukcesu. Nowe tworzenie ma nowe UUID. Late response po unmount nie otwiera obcego edytora.
- [ ] GREEN unit/E2E lost/typecheck; commit `fix: retry uncertain deck generation with the same command`.

### C2: Macierz błędów i regresje

**Files:** Modify `tests/e2e/{generation-request-retry.spec.ts,parent-flow.spec.ts}`, `docs/{SPEC,architecture,folder-structure,implementation-plan}.md`. Serwer generation bez zmian, chyba że test ujawni błąd — wtedy systematic-debugging i aktualizacja planu przed poprawką.

**Interfaces:** Consumes aktualne API `{generationRunId,deckId}`, worldFile A0, fake-worker; produces dowody HTTP+PostgreSQL jednej operacji, bez gwarancji exactly-once opłat providera.

- [ ] E2E: uszkodzony JSON 202 po przyjęciu → ten sam retry; brak/błędny deckId → nie otwiera edytora; 500 po przyjęciu → retry; szybkie podwójne kliknięcie → jeden POST; validation → korekta; 401 → login; 403 → odblokowanie bez samoczynnego POST.
- [ ] E2E refresh fail po sukcesie: edytor działa, ponowienie listy nie tworzy nowego zestawu. Nowa generacja po poprzednim sukcesie ma inny UUID. Dostosować parent-flow do otwierania edytora, zachowując scenariusz reload trwającej generacji i publikacji.
  Asercje `malformed_202_retries_original_command` po obu kliknięciach:
  ```ts
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(runRows).toHaveLength(1);
  expect(deckRows).toHaveLength(1);
  ```
- [ ] Każdy brakujący przypadek uruchomić RED przed jego obsługą, potem GREEN: `pnpm test:e2e tests/e2e/generation-request-retry.spec.ts`. Nie pisać całej macierzy dopiero po implementacji.
- [ ] Regresje: manual-deck-flow, parent-flow; integracyjne `generation.test.ts` i `manual-decks-api.test.ts` dla deduplikacji i CSRF. Obejrzeć uncertainty na trzech viewportach; brak technicznych kluczy w UI.
- [ ] Docs opisują pamięć tylko do reloadu i osobny refresh; typecheck; commit `test: cover generation acknowledgement and retry failures`.

## Checklista

- [x] Self-review: §5, aktualna odpowiedź API, klasyfikacja błędów i Review Focus.
- [ ] Akceptacja planu i wykonania.
- [ ] C1–C2 z RED/GREEN i commitami; wspólny odbiór i raport ograniczeń.
