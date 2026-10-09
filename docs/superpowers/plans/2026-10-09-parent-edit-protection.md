# Ochrona edycji rodzica — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Bez delegacji bez zgody właściciela.

**Goal:** Zachować lokalne poprawki przy konflikcie i zapobiec przypadkowemu opuszczeniu edytora.

**Architecture:** Formularz przypina wersję bazową niezależnie od pollingu. ParentApp koordynuje wyjścia; panel konfliktu porównuje zachowane poprawki z aktualnymi danymi. Przenoszenie poprawek ręczne, bez automatycznego nadpisania cudzej wersji.

**Tech Stack:** TypeScript, React, istniejące Parent API, Vitest, Playwright.

**Spec:** `../specs/2026-10-09-learning-and-parent-reliability-design.md` §4, §6; odbiór wspólny w `2026-10-09-learning-and-parent-reliability.md`.

## Global Constraints

- Jawny zapis; brak autosave/localStorage i automatycznego PATCH z podniesioną wersją.
- Dialog „Zostań” / „Opuść bez zapisu”; busy blokuje przejścia.
- Karty identyfikowane po ID, nie pozycji. Zachować locale, warianty i visualData. Wszystkie teksty w messages.ts.

## Review Focus

Polling w trakcie edycji, dwie nowe karty bez ID, publikacja w drugim oknie,
spóźniony GET oraz refresh failed po udanym PATCH są pokryte w B1–B3.

### Task 1: Bazowa migawka i zapis (B1)

**Files:** Create `apps/web/src/parent/{deck-editor-state.ts,deck-editor-state.test.ts}`; Modify `DeckEditor.tsx`, `packages/contracts/src/messages.ts`; Create `tests/e2e/parent-edit-protection.spec.ts`.

**Interfaces:** `EditableDeckForm` i `EditableDeckItem` = obecne pola plus `clientKey:string`, `visualData?:Record<string,unknown>`. `EditorSnapshot = {draftId:string; editNumber:number; form:EditableDeckForm}`. `createEditorSnapshot(draft:DraftDto,newKey:()=>string):EditorSnapshot`; `toDraftPatch(snapshot:EditorSnapshot):DraftPatch`. Existing item key = id; nowy key generowany raz, nie wysyłany do API.

- [ ] Unit: snapshot z editNumber=3 wysyła 3 mimo otrzymanego remote=4; usunięcie środkowej karty nie zmienia ID/visualData innych. Nowe karty mają różne clientKey bez serializacji do API; pusty szkic wysyła tylko tytuł bez items. RED `pnpm test:unit apps/web/src/parent/deck-editor-state.test.ts`, potem funkcje konwersji.
  Asercje `keeps_base_revision_after_remote_refresh`:
  ```ts
  expect(toDraftPatch(snapshotFromRevision3).expectedEditNumber).toBe(3);
  expect(toDraftPatch(snapshotAfterMiddleRemoval).items?.map(item => item.id)).toEqual([firstId,lastId]);
  expect(toDraftPatch(emptySnapshot).items).toBeUndefined();
  ```
- [ ] E2E polling: pending media podtrzymują GET; okno A wpisuje poprawkę, B zapisuje wersję 4, A odbiera ją pollingiem, PATCH A wysyła 3 i dostaje 409. RED `pnpm test:e2e tests/e2e/parent-edit-protection.spec.ts --grep polling` przed zmianą komponentu.
- [ ] Oddzielić snapshot od aktualnych mediów. Aktualizować bazę tylko przy braku dirty i nierozstrzygniętego konfliktu. Media mapować item.id → revisionId; nowa lub zmieniona lokalnie karta nie uruchamia mediów dla innej pozycji. Podczas dirty zablokować regenerację/omit do zapisu.
- [ ] Zapis ma synchroniczną blokadę ref i używa snapshotu. Pola, dodawanie/usuwanie, operacje mediów zablokowane podczas zapisu. Sukces PATCH daje zapisany DraftDto jako bazę; GET mediów to oddzielny refresh z osobnym komunikatem błędu. Stare odpowiedzi po unmount/zmianie deckId lub nowszym GET nie modyfikują bieżącego formularza.
- [ ] E2E delayed PATCH blokuje wszystkie pola; PATCH sukces + GET fail daje dirty=false i brak powtórnego zapisu. Napisać i uruchomić te przypadki RED przed odpowiadającą obsługą; kontrola przejść jest w B2.
- [ ] GREEN unit/E2E/typecheck; commit `fix: keep draft edits tied to their original revision`.

### Task 2: Kontrola wyjścia (B2)

**Files:** Create `apps/web/src/parent/{useParentLeaveGuard.ts,LeaveEditorDialog.tsx}`; Modify `ParentApp.tsx`, `DecksPanel.tsx`, `DeckEditor.tsx`, `apps/web/src/app/globals.css`, `messages.ts`, `tests/e2e/parent-edit-protection.spec.ts`.

**Interfaces:** `EditorLeaveState = {dirty:boolean; busy:boolean}`. `useParentLeaveGuard(): {register:(state:EditorLeaveState)=>void; requestLeave:(action:()=>void|Promise<void>)=>void; pending:boolean; stay:()=>void; leave:()=>Promise<void>}`. ParentApp posiada guard, DecksPanel przekazuje callbacki do edytora; unmount resetuje rejestrację. Dialog przyjmuje open/onStay/onLeave.

- [ ] E2E: dirty + powrót/każda zakładka/logout daje dialog; Zostań zachowuje wpisy, Opuść wykonuje akcję raz bez zapisu. Czysty edytor nie pyta. Busy blokuje akcję i nie odkłada niespodziewanego logout.
- [ ] E2E reload po interakcji: beforeunload tylko dla dirty, dismiss zachowuje ekran; po zapisie nie pyta. Nie zakładać własnego tekstu natywnego dialogu. RED `pnpm test:e2e tests/e2e/parent-edit-protection.spec.ts --grep "leave|reload|logout"`.
  Asercje `leave_stay_preserves_local_text` po kliknięciu powrotu i „Zostań”:
  ```ts
  await expect(page.getByTestId("leave-editor-dialog")).not.toBeVisible();
  await expect(page.getByTestId("item-target-0")).toHaveValue("local correction");
  expect(patchRequests).toHaveLength(0);
  ```
- [ ] Implementować wspólny guard i `<dialog>`: focus trap, Escape=Zostań, powrót fokusu. Beforeunload tylko dirty, cleanup przy unmount; brak storage. `DecksPanel.onAuthExpired:()=>void` przekazywany przez ParentApp dla późniejszego planu C; utrata autoryzacji nie zostawia w UI materiału po wylogowaniu.
- [ ] GREEN E2E/typecheck; commit `feat: protect unsaved parent edits when leaving`.

### Task 3: Konflikt i porównanie (B3)

**Files:** Create `apps/web/src/parent/DeckConflictPanel.tsx`; Modify `deck-editor-state.ts`, `deck-editor-state.test.ts`, `DeckEditor.tsx`, `messages.ts`, `globals.css`, `tests/e2e/parent-edit-protection.spec.ts`, `docs/{SPEC,architecture,folder-structure,implementation-plan}.md`.

**Interfaces:** `EditorConflict = {local:EditorSnapshot; remote:DeckDto|null; loadError:string|null}`. `compareEditorForms(local:EditableDeckForm,remote:EditableDeckForm): {title:{local:string;remote:string};rows:{key:string;local:EditableDeckItem|null;remote:EditableDeckItem|null}[]}`. Panel bierze conflict i callbacki onReloadRemote/onLoadRemote/onDismissComparison; nie wykonuje PATCH.

- [ ] Unit comparison: usunięta karta tylko z jednej strony; dwie nowe bez ID nie zlewają się, przesunięta istniejąca karta nadal dopasowana po id. RED unit, potem helper.
  Asercje `compares_removed_and_new_cards_by_identity`:
  ```ts
  expect(comparison.rows.find(row => row.key === removedId)?.local).toBeNull();
  expect(comparison.rows.filter(row => row.key.startsWith("local:")).length).toBe(2);
  ```
  Lokalne clientKey nadać z prefiksem `local:`; existing keys równe item.id.
- [ ] E2E dwóch okien: 409 zachowuje inputs; aktualna wersja osobno; brak automatycznego PATCH. Wczytanie remote wymaga potwierdzenia, porównanie ze starym local zostaje do przepisania wybranych wartości. Drugi konflikt zachowuje najnowszy lokalny snapshot.
- [ ] E2E: B usuwa kartę albo publikuje szkic; A nie traci poprawek, nie zapisuje do opublikowanego szkicu. Nowa wersja przez istniejącą operację, z jawnym potwierdzeniem zastąpienia formularza i zachowaniem porównania. Remote GET failed zachowuje local i daje retry odczytu. RED `pnpm test:e2e tests/e2e/parent-edit-protection.spec.ts --grep conflict`.
- [ ] Implementować zachowanie dirty po 409, osobny GET i blokadę zapisu do jawnego przejścia na remote. Porównanie przechowywane w pamięci; stare nieprzeniesione poprawki nadal objęte leave guardem. Zamknięcie panelu wymaga potwierdzenia; po udanym zapisie rodzic może jawnie zakończyć porównanie. Nie zmieniać backendowego optimistic locking.
- [ ] GREEN unit, nowe E2E i dotychczasowe manual-deck-flow/parent-flow, typecheck. Obejrzeć trzy viewporty, klawiaturę/focus; docs zgodnie ze specyfikacją. Commit `feat: preserve parent edits across draft conflicts`.

## Checklista

- [x] Self-review: §4, wersja bazowa, tożsamości, wszystkie wyjścia i Review Focus.
- [ ] Akceptacja planu i wykonania.
- [ ] B1–B3 z RED/GREEN i commitami; odbiór wspólny, w tym R06.
