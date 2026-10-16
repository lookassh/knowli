# Usuwanie przypisania zestawu dziecku Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Umożliwienie rodzicowi wycofania/usunięcia błędnie lub niepotrzebnie przypisanego zestawu (słówek lub lekcji) dziecku z zachowaniem historii ukończonych sesji.

**Architecture:** W warstwie bazy danych i logiki serwera (`removeAssignment`), jeśli dziecko nie odbyło jeszcze żadnych sesji z danym przypisaniem, wiersz jest fizycznie usuwany (`DELETE FROM assignments`); jeśli sesje już się odbyły, przypisanie jest oznaczane jako nieaktywne (`active = false`), aby chronić klucz obcy `learning_sessions_assignment_fk` oraz historię nauki. Zapytania `deckAssignments` i `lessonAssignments` filtrują `active = true`, a router API rodzica udostępnia endpoint `DELETE /api/v1/parent/assignments/:childId/:deckId`. Interfejsy `DeckEditor` i `LessonEditor` zyskują przycisk „Usuń przypisanie" z potwierdzeniem.

**Tech Stack:** Next.js (App Router, React), TypeScript (strict), PostgreSQL + Drizzle ORM, Zod, Vitest.

**Spec:** Projekt uzgodniony w fazie `/brainstorming` w niniejszej sesji (decyzja o hybrydowym usuwaniu: fizyczny delete przy braku sesji, soft-delete `active = false` przy istniejących sesjach, filtrowanie aktywnych przypisań w edytorach, endpoint `DELETE` w routerze rodzica).

## Global Constraints

- Język interfejsu i komunikaty: `pl-PL`, centralny katalog komunikatów w `@learning/contracts` (`messages.decks.*`).
- Niezmienność historii: nie wolno usuwać sesji ani ocen dziecka; brak kaskadowego usuwania z `learning_sessions`.
- Zachowanie ponownego przypisania: `upsertAssignment` musi bez zmian reaktywować deaktywowane przypisanie (`active = true`).
- Kid UI oraz widok MCP `learning-overview` muszą nadal widzieć wyłącznie aktywne przypisania (`assignments.active = true`).
- Kod i nazwy techniczne po angielsku; komentarze i komunikaty w UI po polsku.

## Review Focus

1. **Próba usunięcia nieistniejącego przypisania:** endpoint zwraca `404 Not Found` (`AppError("not_found")`).
2. **Przypisanie z istniejącymi sesjami w bazie:** usunięcie nie rzuca błędu naruszenia klucza obcego `learning_sessions_assignment_fk`, lecz ustawia `active = false`.
3. **Przypisanie bez sesji w bazie:** rekord w tabeli `assignments` zostaje całkowicie skasowany.
4. **Reaktywacja po soft-delete:** ponowne wywołanie `upsertAssignment` dla tego samego dziecka i zestawu przywraca `active = true` i nowy termin.
5. **Potwierdzenie w UI przed usunięciem:** kliknięcie „Usuń przypisanie" i anulowanie w `window.confirm` nie wysyła żądania HTTP ani nie modyfikuje stanu.

---

### Task 1: Komunikaty UI w kontraktach

**Files:**
- Modify: `packages/contracts/src/messages.ts:200-220`
- Test: `packages/contracts/src/messages.test.ts` (lub test sprawdzający strukturę komunikatów)

**Interfaces:**
- Consumes: brak
- Produces: `messages.decks.unassign` (`string`), `messages.decks.unassignConfirm` (`string`)

- [ ] **Step 1: Napisz test sprawdzający obecność nowych kluczy w messages.decks**

Utwórz lub zaktualizuj test weryfikujący obecność kluczy `unassign` i `unassignConfirm` w obiekcie `messages.decks`.

```typescript
// packages/contracts/src/messages.test.ts
import { describe, expect, it } from "vitest";
import { messages } from "./messages";

describe("messages.decks", () => {
  it("zawiera komunikaty dla usuwania przypisania", () => {
    expect(messages.decks.unassign).toBe("Usuń przypisanie");
    expect(messages.decks.unassignConfirm).toBe("Czy na pewno chcesz usunąć przypisanie tego zestawu dziecku?");
  });
});
```

- [ ] **Step 2: Uruchom test, aby potwierdzić, że nie przechodzi**

Run: `corepack pnpm vitest run packages/contracts/src/messages.test.ts`
Expected: FAIL z brakiem właściwości `unassign` w `messages.decks`.

- [ ] **Step 3: Dodaj klucze do messages.decks w `packages/contracts/src/messages.ts`**

Dodaj do sekcji `decks` w `messages.ts`:
```typescript
    unassign: "Usuń przypisanie",
    unassignConfirm: "Czy na pewno chcesz usunąć przypisanie tego zestawu dziecku?",
```

- [ ] **Step 4: Uruchom test, aby potwierdzić, że przechodzi**

Run: `corepack pnpm vitest run packages/contracts/src/messages.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/messages.ts packages/contracts/src/messages.test.ts
git commit -m "feat(contracts): dodaj komunikaty dla cofnięcia przypisania zestawu"
```

---

### Task 2: Logika serwera — `removeAssignment` oraz filtrowanie aktywnych przypisań

**Files:**
- Modify: `packages/server/src/modules/decks.ts`
- Modify: `packages/server/src/modules/lessons/lesson-api.ts`
- Modify: `packages/server/src/index.ts`
- Test: `tests/integration/decks-management.test.ts`

**Interfaces:**
- Consumes: `services.db`, tabele `assignments`, `learningSessions`
- Produces: `removeAssignment(services: Services, childId: string, deckId: string): Promise<void>`

- [ ] **Step 1: Napisz testy integracyjne dla `removeAssignment` i widoku przypisań**

W `tests/integration/decks-management.test.ts` dodaj zestaw testów:
1. `removeAssignment` usuwa fizycznie wiersz z `assignments`, gdy brak powiązanych sesji.
2. `removeAssignment` ustawia `active = false`, gdy istnieją sesje powiązane z danym `assignmentId`.
3. `removeAssignment` rzuca `AppError("not_found")`, gdy przypisanie nie istnieje.
4. `readDeck` (oraz `deckAssignments`) zwraca tylko aktywne przypisania (`active = true`).
5. Ponowny `upsertAssignment` reaktywuje nieaktywne przypisanie (`active = true`).

- [ ] **Step 2: Uruchom testy integracyjne, aby potwierdzić, że nie przechodzą**

Run: `corepack pnpm vitest run tests/integration/decks-management.test.ts`
Expected: FAIL z brakiem eksportu `removeAssignment` lub niespełnionymi asercjami.

- [ ] **Step 3: Zaimplementuj `removeAssignment` i zaktualizuj zapytania `deckAssignments` oraz `lessonAssignments`**

W `packages/server/src/modules/decks.ts`:
1. W `deckAssignments` dodaj warunek `and(eq(assignments.deckId, deckId), eq(assignments.active, true))`.
2. W `removeAssignment`:
   - Zweryfikuj `childId` i `deckId` za pomocą `z.string().uuid()`.
   - Pobierz rekord przypisania: `SELECT id FROM assignments WHERE child_id = $childId AND deck_id = $deckId`.
   - Jeśli brak — `throw new AppError("not_found")`.
   - Sprawdź liczbę sesji w `learningSessions`: `SELECT count(*)::int as count FROM learning_sessions WHERE assignment_id = $assignmentId`.
   - Jeśli `count === 0`: `DELETE FROM assignments WHERE id = $assignmentId`.
   - W przeciwnym razie: `UPDATE assignments SET active = false WHERE id = $assignmentId`.
W `packages/server/src/modules/lessons/lesson-api.ts`:
- W `lessonAssignments` dodaj warunek `and(eq(assignments.deckId, deckId), eq(assignments.active, true))`.
W `packages/server/src/index.ts`:
- Wyeksportuj `removeAssignment`.

- [ ] **Step 4: Uruchom testy integracyjne, aby potwierdzić, że przechodzą**

Run: `corepack pnpm vitest run tests/integration/decks-management.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/decks.ts packages/server/src/modules/lessons/lesson-api.ts packages/server/src/index.ts tests/integration/decks-management.test.ts
git commit -m "feat(server): dodaj removeAssignment i filtruj nieaktywne przypisania"
```

---

### Task 3: Obsługa endpointu w Parent Routerze (`DELETE /api/v1/parent/assignments/:childId/:deckId`)

**Files:**
- Modify: `apps/web/src/parent/parent-router.ts:262-268`
- Test: `tests/integration/assignments-api.test.ts`

**Interfaces:**
- Consumes: `removeAssignment` z `@learning/server`
- Produces: `DELETE /api/v1/parent/assignments/:childId/:deckId` -> `204 No Content` lub `404 Not Found`

- [ ] **Step 1: Napisz test integracyjny dla endpointu DELETE w parent-routerze**

Utwórz `tests/integration/assignments-api.test.ts` testujący wywołanie routera:
- `DELETE /api/v1/parent/assignments/${childId}/${deckId}` zwraca `204` i usuwa przypisanie.
- Ponowny `DELETE` dla tego samego zwraca `404`.

- [ ] **Step 2: Uruchom test integracyjny, aby potwierdzić błąd**

Run: `corepack pnpm vitest run tests/integration/assignments-api.test.ts`
Expected: FAIL z kodem 404/405 (brak obsługi metody DELETE).

- [ ] **Step 3: Dodaj obsługę DELETE w `parent-router.ts`**

W bloku `if (first === "assignments" && second !== undefined && third !== undefined && fourth === undefined)`:
```typescript
if (request.method === "DELETE") {
  await removeAssignment(services, second, third);
  return new Response(null, { status: 204 });
}
```

- [ ] **Step 4: Uruchom test, aby potwierdzić, że przechodzi**

Run: `corepack pnpm vitest run tests/integration/assignments-api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/parent/parent-router.ts tests/integration/assignments-api.test.ts
git commit -m "feat(web): obsluz DELETE w parent-router dla assignments"
```

---

### Task 4: UI usuwania przypisania w DeckEditor i LessonEditor

**Files:**
- Modify: `apps/web/src/parent/DeckEditor.tsx`
- Modify: `apps/web/src/parent/lessons/LessonEditor.tsx`
- Test: `apps/web/src/parent/deck-editor-assignments.test.tsx`

**Interfaces:**
- Consumes: `apiFetch("DELETE", ...)`, `messages.decks.unassign`, `messages.decks.unassignConfirm`
- Produces: przycisk „Usuń przypisanie" z `data-testid="unassign-submit-${index}"` na liście przypisań w edytorach

- [ ] **Step 1: Napisz test komponentu / zachowania unassign w edytorze**

Utwórz test w `apps/web/src/parent/deck-editor-assignments.test.tsx`:
- Renderowanie przycisku `Usuń przypisanie` dla przypisanego dziecka.
- Wywołanie `apiFetch("DELETE", ...)` po potwierdzeniu w oknie dialogowym.
- Brak wywołania API przy anulowaniu dialogu.

- [ ] **Step 2: Uruchom test, aby upewnić się, że nie przechodzi**

Run: `corepack pnpm vitest run apps/web/src/parent/deck-editor-assignments.test.tsx`
Expected: FAIL

- [ ] **Step 3: Zaimplementuj funkcję `unassign` oraz przycisk w `DeckEditor.tsx` i `LessonEditor.tsx`**

W obu edytorach:
1. Dodaj funkcję `unassign`:
```typescript
const unassign = async (childId: string) => {
  if (!window.confirm(messages.decks.unassignConfirm)) return;
  setError(null);
  try {
    await apiFetch("DELETE", `/api/v1/parent/assignments/${childId}/${deckId}`);
    await load();
  } catch (cause) {
    setError(errorMessage(cause));
  }
};
```
2. Na liście `deck.assignments.map((assignment, index) => ...)`:
Wyświetl obok daty przycisk:
```tsx
<button
  type="button"
  className="secondary"
  data-testid={`unassign-submit-${index}`}
  onClick={() => unassign(assignment.childId)}
>
  {messages.decks.unassign}
</button>
```

- [ ] **Step 4: Uruchom testy jednostkowe UI, aby potwierdzić przejście**

Run: `corepack pnpm vitest run apps/web/src/parent/deck-editor-assignments.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/parent/DeckEditor.tsx apps/web/src/parent/lessons/LessonEditor.tsx apps/web/src/parent/deck-editor-assignments.test.tsx
git commit -m "feat(ui): dodaj akcje usuwania przypisania w DeckEditor i LessonEditor"
```

---

### Task 5: Weryfikacja regresji i pełny typecheck

**Files:**
- Test: Cały zestaw testów jednostkowych i integracyjnych dotkniętych modułów

- [ ] **Step 1: Uruchom testy jednostkowe i integracyjne związane ze zmianą**

Run: `corepack pnpm vitest run tests/integration/decks-management.test.ts tests/integration/assignments-api.test.ts apps/web/src/parent/deck-editor-assignments.test.tsx packages/contracts/src/messages.test.ts`
Expected: ALL PASS

- [ ] **Step 2: Uruchom weryfikację typów (typecheck)**

Run: `corepack pnpm typecheck`
Expected: Sukces bez błędów typowania.

- [ ] **Step 3: Commit całościowy (jeśli potrzebne drobne poprawki porządkowe)**

```bash
git status
```
